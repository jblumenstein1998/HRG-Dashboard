/**
 * Makes the Weekly Business Review deck as a PowerPoint file.
 *
 * The deck is the WBR template (template/wbr-template.pptx — a WBR exported
 * from Google Slides, hand-built slides and all) with its data slides redrawn
 * for the chosen week. Nothing is read from or written to anyone's Drive: the
 * file is handed back for whoever pressed the button to download, upload to
 * Drive (which opens it as Google Slides) and share.
 *
 * To refresh the hand-built slides, export the current deck from Google Slides
 * (File → Download → Microsoft PowerPoint) over the template file and commit it.
 * The data slides are found by what they say, so the template's own copies of
 * them can hold any week's numbers.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildWbrWeek, type WbrWeek } from "@/lib/wbr/data";
import { wbrSalesAndProductivity } from "@/lib/wbr/slides";
import { wbrByDistrict } from "@/lib/wbr/slidesDistrict";
import { buildOpsData } from "@/lib/wbr/opsData";
import { spliceDeck, type TemplateSlide } from "@/lib/wbr/pptx";

/** Bundled with the route by outputFileTracingIncludes in next.config.ts. */
export const TEMPLATE_PATH = path.join(process.cwd(), "src/lib/wbr/template/wbr-template.pptx");

/**
 * classic  — the deck's own layout: sales and productivity slides per district,
 *            everything else left as it was.
 * district — sales, labour, food cost and drive-thru regrouped by district
 *            manager, replacing the by-metric variance, COGS and drive-time
 *            slides too.
 */
export type WbrStyle = "classic" | "district";

/** A per-district sales or productivity slide — the ones every run redraws. */
const isDataSlide = ({ text }: TemplateSlide) =>
  text.includes("WEEKLY BUSINESS REVIEW") && (text.includes("AVERAGE CHECK") || text.includes("TPLH"));

/**
 * The by-metric screenshot slides the district style folds into its own:
 * Portfolio Variance, TN/VA COGS, and the four "Drive Times – <DM>" slides.
 * Matched by title text; the SOS rankings slide is deliberately not among them.
 */
const isFoldedSlide = ({ text }: TemplateSlide) =>
  text.includes("PORTFOLIO VARIANCE") || /\b(TN|VA) COGS\b/.test(text) || text.includes("DRIVE TIMES");

/** "Weekly Business Review (10.26 - 11.1)" — the meeting week, i.e. the week after the data. */
export function wbrTitle(wk: WbrWeek): string {
  const d = new Date(wk.week.end + "T12:00:00Z");
  const label = (offset: number) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + offset);
    return `${x.getUTCMonth() + 1}.${x.getUTCDate()}`;
  };
  return `Weekly Business Review (${label(1)} - ${label(7)})`;
}

export type GenerateResult = {
  file: Uint8Array;
  /** "Weekly Business Review (10.26 - 11.1).pptx" — what the upload to Drive will be called. */
  fileName: string;
  week: { start: string; end: string };
  /** Things worth a look before the meeting — short data, stores without targets. */
  warnings: string[];
};

export async function generateWbr(opts: { weekEnd?: string; style?: WbrStyle } = {}): Promise<GenerateResult> {
  const style = opts.style ?? "classic";
  const [wk, template] = await Promise.all([buildWbrWeek(opts.weekEnd), readFile(TEMPLATE_PATH)]);
  const ops = style === "district" ? await buildOpsData(wk, wk.districts.flatMap((d) => d.stores.map((s) => s.label))) : null;

  const slides = ops ? wbrByDistrict(wk, ops) : wbrSalesAndProductivity(wk);
  const file = await spliceDeck(template, (s) => isDataSlide(s) || (style === "district" && isFoldedSlide(s)), slides);

  const warnings: string[] = [...(ops?.gaps ?? [])];
  for (const d of wk.districts) {
    for (const s of d.stores) {
      if (s.missingDays.length) warnings.push(`${s.label}: no PAR data for ${s.missingDays.join(", ")} — its numbers are short.`);
      if (!s.targets) warnings.push(`${s.label}: no productivity target set (lib/wbr/targets.ts).`);
    }
  }

  return {
    file,
    fileName: `${wbrTitle(wk)}${style === "district" ? " (by district)" : ""}.pptx`,
    week: { start: wk.week.start, end: wk.week.end },
    warnings,
  };
}
