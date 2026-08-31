// Scans the PAR rollup for store-days whose figures look like missing data
// rather than a quiet day.
//
//   node --env-file=.env.local scripts/par-anomaly-scan.mjs [minRatio]
//
// Why this shape: PAR's GetOrders can answer ResultCode=0 with an empty <Orders/>
// collection for a day the store actually traded (see Springfield 2025-11-02,
// $9,822 of sales the API does not have). Success-with-no-data is
// indistinguishable from a real closure at the point of ingestion, so the only
// way to find these is after the fact, by asking whether a day looks like the
// same store's other same-weekday days.
//
// Each day is compared with the median of the same store's same weekday within
// +/- 28 days, which absorbs seasonality and store size. Two ratios matter:
//   salesRatio  - sales collapse when orders go missing, wholly or partly
//   laborRatio  - the mirror case, shifts missing while sales survive
//
// The discriminator against real closures is "peers": how many OTHER stores were
// also depressed that day. A holiday or a snowstorm takes the market down
// together; a data fault takes one store down alone.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const MIN_RATIO = Number(process.argv[2] ?? 0.5);

const rows = await sql`
  SELECT store_id, business_date, net_sales, order_count, labor_minutes
  FROM par_daily_metrics ORDER BY store_id, business_date`;

const NAMES = {
  "36001": "Springfield", "42601": "White House", "56301": "Brentwood",
  "61401": "Spring Hill", "28901": "Columbia", "57001": "College",
  "57002": "Hampton", "57003": "Oyster", "57004": "Chesapeake",
  "57005": "Jefferson", "57006": "Hillcrest", "57007": "Beach",
};

const days = rows.map(r => {
  const date = r.business_date.toISOString().slice(0, 10);
  return {
    store: r.store_id,
    date,
    t: Date.parse(date + "T00:00:00Z"),
    dow: new Date(date + "T00:00:00Z").getUTCDay(),
    sales: Number(r.net_sales),
    orders: Number(r.order_count),
    labor: Number(r.labor_minutes) / 60,
  };
});

const byStore = new Map();
for (const d of days) {
  if (!byStore.has(d.store)) byStore.set(d.store, []);
  byStore.get(d.store).push(d);
}

const median = a => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const WINDOW = 28 * 86400000;
for (const [, list] of byStore) {
  for (const d of list) {
    const peers = list.filter(o => o !== d && o.dow === d.dow && Math.abs(o.t - d.t) <= WINDOW);
    const ms = median(peers.map(p => p.sales).filter(v => v > 0));
    const ml = median(peers.map(p => p.labor).filter(v => v > 0));
    d.medSales = ms;
    d.medLabor = ml;
    d.salesRatio = ms ? d.sales / ms : null;
    d.laborRatio = ml ? d.labor / ml : null;
    d.shortfall = ms ? ms - d.sales : 0;
  }
}

// How many stores were depressed on each date — the closure discriminator.
const lowByDate = new Map();
for (const d of days) {
  if (d.salesRatio !== null && d.salesRatio < MIN_RATIO) {
    lowByDate.set(d.date, (lowByDate.get(d.date) ?? 0) + 1);
  }
}

const flagged = days
  .filter(d => (d.salesRatio !== null && d.salesRatio < MIN_RATIO) ||
               (d.laborRatio !== null && d.laborRatio < MIN_RATIO && d.sales > 0))
  .map(d => ({ ...d, peersLow: (lowByDate.get(d.date) ?? 0) - (d.salesRatio !== null && d.salesRatio < MIN_RATIO ? 1 : 0) }))
  .sort((a, b) => b.shortfall - a.shortfall);

const solo = flagged.filter(d => d.peersLow === 0);
const group = flagged.filter(d => d.peersLow > 0);

console.log(`Scanned ${days.length} store-days. Flagged ${flagged.length} at ratio < ${MIN_RATIO}.\n`);

console.log(`=== ISOLATED (${solo.length}) - one store down while every other store traded normally ===`);
console.log("These are the data-loss candidates. Verify each against PAR's Sales Summary.\n");
console.log("store         date        sales      typical   ratio  labor(h)  laborRatio   shortfall");
for (const d of solo) {
  console.log(
    `${(NAMES[d.store] ?? d.store).padEnd(12)} ${d.date} ${d.sales.toFixed(2).padStart(10)} ` +
    `${(d.medSales ?? 0).toFixed(2).padStart(10)} ${(d.salesRatio ?? 0).toFixed(2).padStart(7)} ` +
    `${d.labor.toFixed(2).padStart(9)} ${d.laborRatio === null ? "    -" : d.laborRatio.toFixed(2).padStart(9)} ` +
    `${d.shortfall.toFixed(2).padStart(11)}`
  );
}

console.log(`\n=== MARKET-WIDE (${group.length}) - other stores also down the same day ===`);
console.log("Consistent with holidays and weather. Listed by date, not individually.\n");
const byDate = new Map();
for (const d of group) {
  if (!byDate.has(d.date)) byDate.set(d.date, []);
  byDate.get(d.date).push(d);
}
console.log("date         stores  total shortfall");
for (const [date, list] of [...byDate.entries()].sort()) {
  console.log(`${date} ${String(list.length).padStart(7)}  ${list.reduce((s, d) => s + d.shortfall, 0).toFixed(2).padStart(14)}   ${list.map(d => NAMES[d.store] ?? d.store).join(", ")}`);
}
