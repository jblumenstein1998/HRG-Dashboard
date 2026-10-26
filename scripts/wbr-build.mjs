// Builds the WBR deck locally, exactly as the dashboard's Download button does.
// Usage (from the repo root):
//   node --env-file=.env.local scripts/wbr-build.mjs <outDir> [weekEndSunday] [classic|district]
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import path from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": `${root}src` } });
const { generateWbr } = await jiti.import("@/lib/wbr/generate.ts");

const [outDir, weekEnd, style] = process.argv.slice(2);
const deck = await generateWbr({ weekEnd: weekEnd || undefined, style: style === "district" ? "district" : "classic" });
const out = path.join(outDir, deck.fileName);
writeFileSync(out, deck.file);
console.log(`${deck.week.start}..${deck.week.end}  ${(deck.file.length / 1e6).toFixed(1)} MB → ${out}`);
for (const w of deck.warnings) console.log(`  ! ${w}`);
