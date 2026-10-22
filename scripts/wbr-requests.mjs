// Writes the Slides batchUpdate requests for the WBR sales/productivity slides
// to a JSON file, for inspecting or applying by hand. Usage:
//   node --env-file=.env.local scripts/wbr-requests.mjs <out.json> [weekEndSunday] [only: s0,p1,...]
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": `${root}src` } });
const { buildWbrWeek } = await jiti.import("@/lib/wbr/data.ts");
const { salesSlide, productivitySlide } = await jiti.import("@/lib/wbr/slides.ts");

const [out, weekEnd, only] = process.argv.slice(2);
const wk = await buildWbrWeek(weekEnd || undefined);
const n = wk.districts.length;
const runId = Date.now().toString(36);
const picks = only ? only.split(",") : [...wk.districts.map((_, i) => `s${i}`), ...wk.districts.map((_, i) => `p${i}`)];
const requests = picks.flatMap((key, idx) => {
  const i = Number(key.slice(1));
  const fn = key[0] === "s" ? salesSlide : productivitySlide;
  return fn(wk, wk.districts[i], i, n, `wbr${runId}${key}`, idx);
});
// One request per line, so the file can be read in pieces.
writeFileSync(out, "[\n" + requests.map((r) => JSON.stringify(r)).join(",\n") + "\n]");
console.log(`${requests.length} requests, ${JSON.stringify(requests).length} bytes → ${out}`);
