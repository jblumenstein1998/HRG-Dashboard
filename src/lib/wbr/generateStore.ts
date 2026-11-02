/**
 * Makes the store deck as a PowerPoint file — for one store, or for every
 * store an above-store leader (district manager, director of operations)
 * covers.
 *
 * Built on the WBR template (template/wbr-template.pptx) for its theme, master
 * and fonts, with every one of its slides swapped out for the stores' slides —
 * spliceDeck sweeps up the screenshots nothing points at any more, so the file
 * stays small. Nothing is written anywhere; the file goes back to the caller.
 *
 * A multi-store deck is ordered slide by slide, not store by store: every
 * store's overview, then every store's sales, and so on, so the same slide for
 * each store sits side by side in the slide sorter. Each slide names its store
 * in the header, so nothing is lost by splitting a store's slides up.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spliceDeck } from "@/lib/wbr/pptx";
import { buildStoreDeck, storeDeckOptions, type StoreDeckData } from "@/lib/wbr/storeData";
import { storeDeckSlides } from "@/lib/wbr/slidesStore";
import { listLeaders } from "@/lib/users/leaders";

/** Bundled with the route by outputFileTracingIncludes in next.config.ts. */
const TEMPLATE_PATH = path.join(process.cwd(), "src/lib/wbr/template/wbr-template.pptx");

/** Stores built at once — each one calls PAR, Net-Chef, BerryAI and SMG. */
const CONCURRENCY = 4;

const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;

const MARKETS: Record<string, { name: string; section: string }> = {
  va: { name: "VA", section: "Virginia" },
  tn: { name: "TN", section: "Tennessee" },
  tx: { name: "TX", section: "Texas" },
};

/**
 * The stores a deck covers, in the tabs' order, and what to call the deck.
 *
 * `target` is the ribbon's store-filter value (components/StoreFilter): ""
 * for all stores, "va"/"tn"/"tx", "leader:<id>" or "store:<label>". Only
 * PAR-connected stores can be built; a selection with none of those, or a
 * value that names nothing, comes back with `stores` empty or as null.
 */
export async function resolveDeckTarget(target: string): Promise<{ name: string; stores: string[] } | null> {
  const options = storeDeckOptions();
  const labels = (keep: (s: { label: string; section: string }) => boolean) => options.filter(keep).map((s) => s.label);
  if (target === "") return { name: "All Stores", stores: labels(() => true) };
  if (target in MARKETS) {
    const m = MARKETS[target];
    return { name: m.name, stores: labels((s) => s.section === m.section) };
  }
  if (target.startsWith("leader:")) {
    const leader = (await listLeaders()).find((l) => l.id === target.slice("leader:".length));
    return leader ? { name: leader.name, stores: labels((s) => leader.stores.includes(s.label)) } : null;
  }
  if (target.startsWith("store:")) {
    const store = target.slice("store:".length);
    return { name: store, stores: labels((s) => s.label === store) };
  }
  return null;
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function generateStoreDeck(opts: { stores: string[]; name: string; weekEnd?: string }) {
  const [decks, template] = await Promise.all([
    mapLimited(opts.stores, CONCURRENCY, (s): Promise<StoreDeckData> => buildStoreDeck(s, opts.weekEnd)),
    readFile(TEMPLATE_PATH),
  ]);
  const perStore = decks.map(storeDeckSlides);
  // Slide by slide: slot 0 for every store, then slot 1, …
  const slides = perStore[0].flatMap((_, i) => perStore.map((s) => s[i]));
  const file = await spliceDeck(template, () => true, slides);
  const week = decks[0].week;
  return {
    file,
    fileName: `${opts.name} Store Review (${md(week.start)} - ${md(week.end)}).pptx`,
    week: { start: week.start, end: week.end },
    warnings: [...new Set(decks.flatMap((d) => d.warnings))],
  };
}
