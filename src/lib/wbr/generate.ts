/**
 * Makes this Monday's Weekly Business Review deck.
 *
 * Last week's deck is copied rather than a template filled in, because half the
 * deck is worksheets the team fills in by hand (maintenance commitments, the
 * hiring bench, hot fires) and each week starts from where the last one left
 * off. Only the slides drawn from dashboard data are rebuilt: the per-district
 * sales and productivity slides, found by their content the first time and by
 * this module's object-id prefix every time after.
 */

import { batchUpdate, copyFile, findPresentations, getPresentation, trashFile, type DriveFile } from "@/lib/google/workspace";
import { buildWbrWeek, type WbrWeek } from "@/lib/wbr/data";
import { wbrSalesAndProductivity, WBR_SLIDE_PREFIX } from "@/lib/wbr/slides";

export const WBR_TITLE_PREFIX = "Weekly Business Review (";

/** Appended to a "Make a copy" deck, so it never collides with — or stands in for — the real one. */
export const COPY_SUFFIX = " (dashboard copy)";

/** Decks that look like WBRs but must never be the starting point. */
const SKIP_SOURCE = /dont use|don't use|\[test\]|\(dashboard copy\)/i;

/**
 * new     — no deck for this week yet; start from the latest earlier one.
 * replace — rebuild this week's deck in place of the existing one.
 * copy    — rebuild this week's deck as a separate "(dashboard copy)", leaving
 *           the existing one alone. For trying the generator against a real week.
 */
export type GenerateMode = "new" | "replace" | "copy";

type Presentation = {
  slides: {
    objectId: string;
    slideProperties?: { layoutObjectId?: string };
    pageElements?: { shape?: { text?: { textElements?: { textRun?: { content?: string } }[] } } }[];
  }[];
};

const slideText = (s: Presentation["slides"][number]) =>
  (s.pageElements ?? [])
    .flatMap((e) => e.shape?.text?.textElements ?? [])
    .map((t) => t.textRun?.content ?? "")
    .join(" ")
    .toUpperCase();

/**
 * A slide this generator owns: one it drew (by id), or — for decks made by hand
 * before it existed — a per-district sales or productivity slide (by content).
 */
const isDataSlide = (s: Presentation["slides"][number]) => {
  if (s.objectId.startsWith(WBR_SLIDE_PREFIX)) return true;
  const t = slideText(s);
  return t.includes("WEEKLY BUSINESS REVIEW") && (t.includes("AVERAGE CHECK") || t.includes("TPLH"));
};

/** "Weekly Business Review (10.26 - 11.1)" — the meeting week, i.e. the week after the data. */
export function wbrTitle(wk: WbrWeek): string {
  const d = new Date(wk.week.end + "T12:00:00Z");
  const label = (offset: number) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + offset);
    return `${x.getUTCMonth() + 1}.${x.getUTCDate()}`;
  };
  return `${WBR_TITLE_PREFIX}${label(1)} - ${label(7)})`;
}

export type GenerateResult = {
  url: string;
  title: string;
  sourceTitle: string;
  week: { start: string; end: string };
  /** Things worth a look before the meeting — short data, stores without targets. */
  warnings: string[];
};

export class AlreadyExistsError extends Error {
  constructor(readonly file: DriveFile) {
    super(`"${file.name}" already exists.`);
  }
}

export async function generateWbr(opts: { weekEnd?: string; mode?: GenerateMode } = {}): Promise<GenerateResult> {
  const mode = opts.mode ?? "new";
  const wk = await buildWbrWeek(opts.weekEnd);
  const title = wbrTitle(wk);

  const decks = (await findPresentations(WBR_TITLE_PREFIX)).filter(
    (f) => f.name.startsWith(WBR_TITLE_PREFIX) && !SKIP_SOURCE.test(f.name),
  );
  const existing = decks.find((f) => f.name === title);
  if (existing && mode === "new") throw new AlreadyExistsError(existing);

  // Rebuilding a week that already has a deck starts from that deck, so the
  // hand-filled worksheets in it survive. Otherwise: the newest deck made before
  // this week's meeting — last week's, or for a back-filled week, that week's
  // predecessor rather than today's deck.
  const meetingDay = new Date(wk.week.end + "T00:00:00Z");
  meetingDay.setUTCDate(meetingDay.getUTCDate() + 2);
  const source =
    existing ??
    decks.find((f) => f.name !== title && new Date(f.createdTime) < meetingDay);
  if (!source) throw new Error(`No earlier "${WBR_TITLE_PREFIX}…)" deck found to start from.`);

  const copy = await copyFile(source.id, mode === "copy" ? title + COPY_SUFFIX : title);
  try {
    const deck = await getPresentation<Presentation>(
      copy.id,
      "slides(objectId,slideProperties.layoutObjectId,pageElements.shape.text.textElements.textRun.content)",
    );
    const old = deck.slides.map((s, i) => ({ s, i })).filter(({ s }) => isDataSlide(s));
    if (!old.length) throw new Error(`"${source.name}" has no sales or productivity slides to replace.`);

    // New slides go straight after the first old one and reuse its layout: the
    // Slides API only accepts layouts from the master of the slide before the
    // insertion point, and this deck mixes masters.
    const first = old[0];
    const layoutId = first.s.slideProperties?.layoutObjectId;
    if (!layoutId) throw new Error("Couldn't read the layout of the existing sales slides.");

    const runId = Date.now().toString(36);
    for (const slide of wbrSalesAndProductivity(wk, first.i + 1, layoutId, runId)) {
      await batchUpdate(copy.id, slide);
    }
    await batchUpdate(
      copy.id,
      old.map(({ s }) => ({ deleteObject: { objectId: s.objectId } })),
    );
  } catch (err) {
    // A half-built deck named like the real one is worse than none.
    await trashFile(copy.id).catch(() => {});
    throw err;
  }
  // Only now that the new deck is whole — a failure above leaves the old one standing.
  if (existing && mode === "replace") await trashFile(existing.id);

  const warnings: string[] = [];
  for (const d of wk.districts) {
    for (const s of d.stores) {
      if (s.missingDays.length) warnings.push(`${s.label}: no PAR data for ${s.missingDays.join(", ")} — its numbers are short.`);
      if (!s.targets) warnings.push(`${s.label}: no productivity target set (lib/wbr/targets.ts).`);
    }
  }

  return {
    url: copy.webViewLink ?? `https://docs.google.com/presentation/d/${copy.id}/edit`,
    title: copy.name,
    sourceTitle: source.name,
    week: { start: wk.week.start, end: wk.week.end },
    warnings,
  };
}
