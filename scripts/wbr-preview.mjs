// Prints the WBR sales/productivity data for one week, for checking against a
// deck by eye. Usage (from the repo root):
//   node --env-file=.env.local scripts/wbr-preview.mjs [weekEndSunday]
import { createJiti } from "jiti";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { "@": `${root}src` } });
const { buildWbrWeek } = await jiti.import("@/lib/wbr/data.ts");

const wk = await buildWbrWeek(process.argv[2]);
const k = (n) => (n == null ? "—" : `$${(n / 1000).toFixed(1)}K`);
const p = (a, b) => (a == null || b == null || !b ? "N/A" : `${(((a - b) / b) * 100).toFixed(1)}%`);
console.log(`Week ${wk.week.start}..${wk.week.end}  prior ${wk.priorWeek.start}  PY ${wk.priorYearWeek.start}..${wk.priorYearWeek.end}`);
for (const d of wk.districts) {
  console.log(`\n== ${d.leader} (${d.market}) legacyOnly=${d.yoyLegacyOnly}`);
  const total = { label: "TOTAL", ...d.total, splh: [], tplh: [], missingDays: [] };
  for (const s of [...d.stores, total]) {
    // YoY on the total compares like with like: legacy stores this year vs last.
    const y = s === total ? d.total.currentLegacy : s.current;
    console.log(
      `${s.label.padEnd(12)} ${k(s.current.netSales).padStart(8)} WoW ${p(s.current.netSales, s.prior.netSales).padStart(7)} YoY ${p(y.netSales, s.priorYear?.netSales).padStart(7)} | txn ${s.current.transactions} WoW ${p(s.current.transactions, s.prior.transactions)} YoY ${p(y.transactions, s.priorYear?.transactions)} | chk ${s.current.avgCheck?.toFixed(2)} | splh ${s.splh.map((v) => v?.toFixed(2) ?? "—").join(" ")} | tplh ${s.tplh.map((v) => v?.toFixed(2) ?? "—").join(" ")} ${s.missingDays.length ? "MISSING " + s.missingDays.join(",") : ""}`,
    );
  }
}
