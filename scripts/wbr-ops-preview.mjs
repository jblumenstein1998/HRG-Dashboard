// Prints the district-style WBR's food cost and drive-thru numbers for one week.
//   node --env-file=.env.local scripts/wbr-ops-preview.mjs [weekEndSunday]
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": `${root}src` } });
const { buildWbrWeek } = await jiti.import("@/lib/wbr/data.ts");
const { buildOpsData, totalFood, totalDrive } = await jiti.import("@/lib/wbr/opsData.ts");

const wk = await buildWbrWeek(process.argv[2]);
const labels = wk.districts.flatMap((d) => d.stores.map((s) => s.label));
const ops = await buildOpsData(wk, labels);
const pct = (v) => (v == null ? "—" : `${v.toFixed(2)}%`);
const mmss = (s) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`);
console.log(ops.week.label, "|", ops.ptd.label);
for (const d of wk.districts) {
  console.log(`\n== ${d.leader}`);
  const rows = d.stores.map((s) => ops.stores.get(s.label));
  for (const o of rows) {
    console.log(
      `${o.label.padEnd(12)} COGS wk ${pct(o.food.week.cogsPct)} ptd ${pct(o.food.ptd.cogsPct)} | var wk ${pct(o.food.week.variancePct)} prev ${pct(o.food.priorWeekVariancePct)} | lane wk ${mmss(o.drive.week?.laneSecs)} win ${mmss(o.drive.week?.windowSecs)} cars ${o.drive.week?.cars ?? "—"} | ptd lane ${mmss(o.drive.ptd?.laneSecs)} win ${mmss(o.drive.ptd?.windowSecs)}`,
    );
  }
  const tf = totalFood(rows.map((o) => o.food.week));
  const td = totalDrive(rows.map((o) => o.drive.week));
  console.log(`TOTAL        COGS wk ${pct(tf.cogsPct)} var ${pct(tf.variancePct)} | lane ${mmss(td?.laneSecs)} win ${mmss(td?.windowSecs)} cars ${td?.cars}`);
}
if (ops.gaps.length) console.log("\nGAPS:\n" + ops.gaps.join("\n"));
