import { sql } from "@/lib/db";
import { PAR_LOCATIONS, getOrders, getShifts, dateRange } from "@/lib/par";

// ── Shared day-total computation ─────────────────────────────────────────────
// Used both to write the rollup (backfillStoreDay) and to compute today's
// not-yet-rolled-up totals live at read time (see "Live today merge" below).

type DayTotals = { netSales: number; orderCount: number; laborMinutes: number };

async function computeDayTotals(storeId: string, businessDate: string): Promise<DayTotals> {
  const [orders, shifts] = await Promise.all([
    getOrders(storeId, businessDate).catch(() => []),
    getShifts(storeId, businessDate).catch(() => []),
  ]);

  // Net sales sums every order (refunds included — they're already negative).
  // Order/transaction count must NOT use orders.length: PAR returns some closed
  // $0 orders that aren't real transactions (duplicates/corrections) alongside
  // legitimate $0 transactions (e.g. comps) — only Order.Count (isCountedOrder)
  // reliably distinguishes them. Confirmed against PAR's own reporting: summing
  // isCountedOrder instead of orders.length was off by ~10% on order count and
  // therefore average ticket, while net sales $ was already correct either way.
  const netSales = orders.reduce((sum, o) => sum + o.netSales, 0);
  const orderCount = orders.filter(o => o.isCountedOrder).length;
  const laborMinutes = shifts.reduce((sum, s) => sum + s.minutesWorked, 0);
  return { netSales, orderCount, laborMinutes };
}

// ── Write path ────────────────────────────────────────────────────────────────
// Pulls one store/day from PAR (via the existing cached+rate-limited par.ts
// fetchers) and upserts the daily rollup row. Re-running for the same
// store/day overwrites with fresh totals (e.g. late-settling orders).

export async function backfillStoreDay(storeId: string, businessDate: string): Promise<void> {
  const { netSales, orderCount, laborMinutes } = await computeDayTotals(storeId, businessDate);

  await sql`
    INSERT INTO par_daily_metrics (store_id, business_date, net_sales, order_count, labor_minutes, updated_at)
    VALUES (${storeId}, ${businessDate}, ${netSales}, ${orderCount}, ${laborMinutes}, now())
    ON CONFLICT (store_id, business_date)
    DO UPDATE SET
      net_sales     = EXCLUDED.net_sales,
      order_count   = EXCLUDED.order_count,
      labor_minutes = EXCLUDED.labor_minutes,
      updated_at    = now()
  `;
}

// Backfills every store for every date in [start, end] (inclusive). Runs stores
// in sequence per date to stay well under PAR's 5-concurrent-call rate limit —
// par.ts's own semaphore caps concurrency further within each store/day call.
export async function backfillRange(start: string, end: string): Promise<{ storeId: string; businessDate: string }[]> {
  const dates = dateRange(start, end);
  const done: { storeId: string; businessDate: string }[] = [];
  for (const businessDate of dates) {
    for (const loc of PAR_LOCATIONS) {
      await backfillStoreDay(loc.storeId, businessDate);
      done.push({ storeId: loc.storeId, businessDate });
    }
  }
  return done;
}

// ── Live "today" merge ────────────────────────────────────────────────────────
// The daily cron only rolls up business dates that have already closed (see
// /api/cron/par-rollup — it backfills "yesterday"), so today's date never has
// a rollup row until tomorrow morning's cron run. To answer "as the day goes"
// queries, the read path below fetches today live from PAR (a single day,
// same par.ts functions used everywhere else) and merges it with the rollup's
// totals for every prior day in range — so historical days stay instant and
// only today ever costs a live call.

function todayCentralISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ── Read path ─────────────────────────────────────────────────────────────────
// All range queries are inclusive of start and end (YYYY-MM-DD).

type RangeTotals = { netSales: number; orderCount: number; laborMinutes: number };

async function getRollupTotals(storeId: string, start: string, end: string): Promise<RangeTotals> {
  const rows = await sql`
    SELECT
      COALESCE(SUM(net_sales), 0)     AS net_sales,
      COALESCE(SUM(order_count), 0)   AS order_count,
      COALESCE(SUM(labor_minutes), 0) AS labor_minutes
    FROM par_daily_metrics
    WHERE store_id = ${storeId}
      AND business_date BETWEEN ${start} AND ${end}
  `;
  const row = rows[0] as { net_sales: string; order_count: string; labor_minutes: string };
  return {
    netSales: Number(row.net_sales),
    orderCount: Number(row.order_count),
    laborMinutes: Number(row.labor_minutes),
  };
}

async function getTotalsForRange(storeId: string, start: string, end: string): Promise<RangeTotals> {
  const today = todayCentralISO();
  const includesToday = end >= today && start <= today;
  const historicalEnd = end < today ? end : dayBefore(today);

  const [historical, live] = await Promise.all([
    start <= historicalEnd ? getRollupTotals(storeId, start, historicalEnd) : Promise.resolve({ netSales: 0, orderCount: 0, laborMinutes: 0 }),
    includesToday ? computeDayTotals(storeId, today) : Promise.resolve({ netSales: 0, orderCount: 0, laborMinutes: 0 }),
  ]);

  return {
    netSales: historical.netSales + live.netSales,
    orderCount: historical.orderCount + live.orderCount,
    laborMinutes: historical.laborMinutes + live.laborMinutes,
  };
}

export async function getNetSalesForRange(storeId: string, start: string, end: string): Promise<number> {
  const { netSales } = await getTotalsForRange(storeId, start, end);
  return Math.round(netSales * 100) / 100;
}

export async function getOrderCountForRange(storeId: string, start: string, end: string): Promise<number> {
  const { orderCount } = await getTotalsForRange(storeId, start, end);
  return orderCount;
}

export async function getLaborHoursForRange(storeId: string, start: string, end: string): Promise<number> {
  const { laborMinutes } = await getTotalsForRange(storeId, start, end);
  return Math.round((laborMinutes / 60) * 100) / 100;
}

export async function getAvgOrderValueForRange(storeId: string, start: string, end: string): Promise<number> {
  const { netSales, orderCount } = await getTotalsForRange(storeId, start, end);
  return orderCount > 0 ? Math.round((netSales / orderCount) * 100) / 100 : 0;
}

export type PARDailyRow = {
  date: string;
  netSales: number;
  transactions: number;
  avgTicket: number;
  laborHours: number;
};

function toDailyRow(date: string, netSales: number, transactions: number, laborMinutes: number): PARDailyRow {
  return {
    date,
    netSales: Math.round(netSales * 100) / 100,
    transactions,
    avgTicket: transactions > 0 ? Math.round((netSales / transactions) * 100) / 100 : 0,
    laborHours: Math.round((laborMinutes / 60) * 100) / 100,
  };
}

/** Per-day rows for a store over a range, oldest → newest (inclusive both ends). */
export async function getDailyRowsForRange(storeId: string, start: string, end: string): Promise<PARDailyRow[]> {
  const today = todayCentralISO();
  const includesToday = end >= today && start <= today;
  const historicalEnd = end < today ? end : dayBefore(today);

  const [rows, live] = await Promise.all([
    start <= historicalEnd
      ? sql`
          SELECT business_date, net_sales, order_count, labor_minutes
          FROM par_daily_metrics
          WHERE store_id = ${storeId}
            AND business_date BETWEEN ${start} AND ${historicalEnd}
          ORDER BY business_date ASC
        `
      : Promise.resolve([]),
    includesToday ? computeDayTotals(storeId, today) : Promise.resolve(null),
  ]);

  const daily = (rows as { business_date: string | Date; net_sales: string; order_count: string; labor_minutes: string }[]).map(r =>
    toDailyRow(
      new Date(r.business_date).toISOString().split("T")[0],
      Number(r.net_sales),
      Number(r.order_count),
      Number(r.labor_minutes),
    )
  );

  if (live) {
    daily.push(toDailyRow(today, live.netSales, live.orderCount, live.laborMinutes));
  }

  return daily;
}

// Latest business_date already rolled up for a store (drives incremental backfill).
export async function getLastRolledUpDate(storeId: string): Promise<string | null> {
  const rows = await sql`
    SELECT MAX(business_date) AS max_date FROM par_daily_metrics WHERE store_id = ${storeId}
  `;
  const row = rows[0] as { max_date: string | null };
  return row.max_date;
}
