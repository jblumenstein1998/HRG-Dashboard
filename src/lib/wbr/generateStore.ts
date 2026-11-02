/**
 * Makes the single-store deck as a PowerPoint file.
 *
 * Built on the WBR template (template/wbr-template.pptx) for its theme, master
 * and fonts, with every one of its slides swapped out for the store's four —
 * spliceDeck sweeps up the screenshots nothing points at any more, so the file
 * stays small. Nothing is written anywhere; the file goes back to the caller.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { spliceDeck } from "@/lib/wbr/pptx";
import { buildStoreDeck } from "@/lib/wbr/storeData";
import { storeDeckSlides } from "@/lib/wbr/slidesStore";

/** Bundled with the route by outputFileTracingIncludes in next.config.ts. */
const TEMPLATE_PATH = path.join(process.cwd(), "src/lib/wbr/template/wbr-template.pptx");

const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;

export async function generateStoreDeck(opts: { store: string; weekEnd?: string }) {
  const [data, template] = await Promise.all([buildStoreDeck(opts.store, opts.weekEnd), readFile(TEMPLATE_PATH)]);
  const file = await spliceDeck(template, () => true, storeDeckSlides(data));
  return {
    file,
    fileName: `${data.label} Store Review (${md(data.week.start)} - ${md(data.week.end)}).pptx`,
    week: { start: data.week.start, end: data.week.end },
    warnings: data.warnings,
  };
}
