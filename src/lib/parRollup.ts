import { sql } from "@/lib/db";
import { PAR_LOCATIONS, getOrders, getShifts, getOrdersLive, getShiftsLive, dateRange, type PARShift } from "@/lib/par";
import { businessDateISO } from "@/lib/businessDay";
import { avgCheck, laborHours, round2 } from "@/lib/parFigures";
import { readMany, readThrough } from "@/lib/sourceCache";

// ── Shared day-total computation ─────────────────────────────────────────────
// Used both to write the rollup (backfillStoreDay, always cached — a settled
// past day never changes) and to compute today's not-yet-rolled-up totals at
// read time (see "Live today merge" below, always live=true — a stale cache
// entry from earlier today would silently under-report everything that's
// happened since it was fetched).

type DayTotals = { netSales: number; orderCount: number; laborMinutes: number };

type PAROrders = Awaited<ReturnType<typeof getOrders>>;

async function computeDayTotals(storeId: string, businessDate: string, live = false): Promise<DayTotals> {
  const [orders, shifts] = await Promise.all([
    (live ? getOrdersLive(storeId, businessDate) : getOrders(storeId, businessDate)).catch(() => []),
    (live ? getShiftsLive(storeId, businessDate) : getShifts(storeId, businessDate)).catch(() => []),
  ]);
  return aggregateDay(orders, shifts);
}

// Same aggregation, but lets a PAR failure throw instead of being swallowed into
// an empty array. Used when recovering a missing day: there, "the API errored"
// and "the store sold nothing" must not collapse to the same $0.
async function computeDayTotalsStrict(storeId: string, businessDate: string): Promise<DayTotals> {
  const [orders, shifts] = await Promise.all([
    getOrdersLive(storeId, businessDate),
    getShiftsLive(storeId, businessDate),
  ]);
  return aggregateDay(orders, shifts);
}

function aggregateDay(orders: PAROrders, shifts: PARShift[]): DayTotals {
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
  await writeDayTotals(storeId, businessDate, await computeDayTotals(storeId, businessDate));
}

async function writeDayTotals(storeId: string, businessDate: string, totals: DayTotals): Promise<void> {
  const { netSales, orderCount, laborMinutes } = totals;

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

// ── Trailing re-roll ──────────────────────────────────────────────────────────
// A business date was rolled up once, the morning after it closed, and never
// revisited. Timecards keep moving after that: measured over four weeks and four
// stores, 1.54% of labor hours belonged to shifts edited after their day's cron
// write had already happened, and that figure is a floor — a shift deleted after
// the write cannot appear in a live pull at all, and deletions were the larger
// error in practice (one store sat 26 hours above what PAR now reports). Sales
// barely move after close; labor does, so the visible symptom was productivity.
//
// Re-rolling a trailing window each morning folds those corrections in. The
// window is 14 days because the late-edit tail runs that long: a 3-day window
// recovers ~81% of late-edited hours, 7 days ~93%, 14 days all of it.

export const REROLL_WINDOW_DAYS = 14;

export type RerollChange = {
  storeId: string;
  businessDate: string;
  laborMinutesBefore: number | null;
  laborMinutesAfter: number;
  netSalesBefore: number | null;
  netSalesAfter: number;
};

export type RerollSummary = {
  windowStart: string;
  windowEnd: string;
  /** True when nothing was written — the run only reports what it would change. */
  dryRun: boolean;
  storeDays: number;
  written: number;
  changed: number;
  /** PAR errored for this store/day; the stored row was left alone. */
  skippedError: number;
  /** PAR returned an empty day over a stored non-empty one — treated as a failed
   *  read rather than a real correction. See guard below. */
  skippedZero: number;
  laborMinutesDelta: number;
  netSalesDelta: number;
  changes: RerollChange[];
  /** Store-days left untouched because a metric collapsed to zero. Worth eyes:
   *  each one is either a real closure that already read zero, or a bad read. */
  suspect: { storeId: string; businessDate: string; reason: string; prior: { netSales: number; orderCount: number; laborMinutes: number } | null }[];
};

/** Existing rows for the window, keyed `storeId__businessDate`. */
async function existingRows(start: string, end: string): Promise<Map<string, DayTotals>> {
  const rows = (await sql`
    SELECT store_id, business_date, net_sales, order_count, labor_minutes
    FROM par_daily_metrics
    WHERE business_date BETWEEN ${start} AND ${end}
  `) as {
    store_id: string;
    business_date: string | Date;
    net_sales: string;
    order_count: string;
    labor_minutes: string;
  }[];

  const map = new Map<string, DayTotals>();
  for (const row of rows) {
    const date =
      typeof row.business_date === "string"
        ? row.business_date.slice(0, 10)
        : row.business_date.toISOString().slice(0, 10);
    map.set(`${row.store_id}__${date}`, {
      netSales: Number(row.net_sales),
      orderCount: Number(row.order_count),
      laborMinutes: Number(row.labor_minutes),
    });
  }
  return map;
}

/**
 * Re-computes every store for every business date in [start, end] and overwrites
 * the rollup, reporting what moved.
 *
 * Reads live rather than through par.ts's 1hr cache: the whole point is to see
 * PAR as it stands now, and a re-roll that could serve a cached copy of the same
 * stale figures it is meant to correct would be the original bug wearing a hat.
 *
 * `dryRun` does every read and comparison but no write, so the same summary can
 * be inspected before letting it touch the table.
 *
 * `storeIds` narrows the run to those stores — for backfilling the history of a
 * store that just came online without re-reading every other store's years too.
 */
export async function rerollRange(
  start: string,
  end: string,
  dryRun = false,
  storeIds?: string[],
): Promise<RerollSummary> {
  const locations = storeIds ? PAR_LOCATIONS.filter(l => storeIds.includes(l.storeId)) : PAR_LOCATIONS;
  const before = await existingRows(start, end);
  const summary: RerollSummary = {
    windowStart: start,
    windowEnd: end,
    dryRun,
    storeDays: 0,
    written: 0,
    changed: 0,
    skippedError: 0,
    skippedZero: 0,
    laborMinutesDelta: 0,
    netSalesDelta: 0,
    changes: [],
    suspect: [],
  };

  // Dates in sequence, stores in parallel within a date. par.ts's semaphore caps
  // actual SOAP concurrency at 5 regardless, so this bounds wall time without
  // pushing PAR past its documented limit.
  for (const businessDate of dateRange(start, end)) {
    const results = await Promise.all(
      locations.map(async loc => {
        try {
          // Strict: a PAR failure throws here instead of collapsing to an empty
          // day, which would otherwise overwrite a good row with zeros.
          return { loc, totals: await computeDayTotalsStrict(loc.storeId, businessDate) };
        } catch {
          return { loc, totals: null };
        }
      }),
    );

    for (const { loc, totals } of results) {
      summary.storeDays++;
      const prior = before.get(`${loc.storeId}__${businessDate}`) ?? null;

      if (!totals) {
        summary.skippedError++;
        continue;
      }

      // Sales and labor come from separate endpoints, so they fail separately.
      // Judge them separately too: an earlier version demanded the WHOLE day be
      // empty before it would skip, and a day whose orders came back empty
      // while its shifts came back fine sailed straight past it — 113 labor
      // hours against $0 of sales, overwriting $8,646.69 (Spring Hill,
      // 2026-01-07). Either half collapsing to nothing where the stored row had
      // something is a failed read until proven otherwise.
      //
      // "Prior had something" is the test rather than any judgement about what
      // a plausible day looks like: real closures do post zero sales against a
      // little cleaning labor, and those days read zero in the stored row too,
      // so they are never mistaken for a failure.
      const salesCollapsed =
        totals.netSales === 0 && totals.orderCount === 0 && !!prior && (prior.netSales !== 0 || prior.orderCount !== 0);
      const laborCollapsed =
        totals.laborMinutes === 0 && !!prior && prior.laborMinutes !== 0;
      if (salesCollapsed || laborCollapsed) {
        summary.skippedZero++;
        summary.suspect.push({
          storeId: loc.storeId,
          businessDate,
          reason: salesCollapsed ? "sales went to zero" : "labor went to zero",
          prior: prior ? { netSales: prior.netSales, orderCount: prior.orderCount, laborMinutes: prior.laborMinutes } : null,
        });
        continue;
      }

      if (!dryRun) await writeDayTotals(loc.storeId, businessDate, totals);
      summary.written++;

      const laborDelta = totals.laborMinutes - (prior?.laborMinutes ?? 0);
      const salesDelta = totals.netSales - (prior?.netSales ?? 0);
      if (prior && (laborDelta !== 0 || Math.abs(salesDelta) >= 0.01)) {
        summary.changed++;
        summary.laborMinutesDelta += laborDelta;
        summary.netSalesDelta += salesDelta;
        summary.changes.push({
          storeId: loc.storeId,
          businessDate,
          laborMinutesBefore: prior.laborMinutes,
          laborMinutesAfter: totals.laborMinutes,
          netSalesBefore: prior.netSales,
          netSalesAfter: totals.netSales,
        });
      }
    }
  }

  return summary;
}

// ── Live "today" merge ────────────────────────────────────────────────────────
// The daily cron only rolls up business dates that have already closed (see
// /api/cron/par-rollup — it backfills "yesterday"), so today's date never has
// a rollup row until tomorrow morning's cron run. To answer "as the day goes"
// queries, the read path below fetches today live from PAR (a single day,
// same par.ts functions used everywhere else) and merges it with the rollup's
// totals for every prior day in range — so historical days stay instant and
// only today ever costs a live call.

/** Today's business date in Central (rolls at 2:15 AM — see lib/businessDay.ts). */
export function todayCentralISO(): string {
  return businessDateISO();
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// ── Read path ─────────────────────────────────────────────────────────────────
// All range queries are inclusive of start and end (YYYY-MM-DD).

type RangeTotals = { netSales: number; orderCount: number; laborMinutes: number };

const EMPTY_TOTALS: RangeTotals = { netSales: 0, orderCount: 0, laborMinutes: 0 };

// A day with no rollup row and a day that genuinely rang $0 are the same number
// once summed, so any historical gap is retried against the live PAR API rather
// than silently contributing zero. Bounded, because a long range against a
// stalled pipeline would otherwise fan out into hundreds of API calls.
const MAX_LIVE_BACKFILL_DAYS = 10;

export type RangeTotalsWithCoverage = RangeTotals & {
  // Historical dates still unaccounted for after the live retry. Any total
  // carrying entries here is under-reported and must be labelled incomplete
  // rather than presented as fact.
  missingDates: string[];
};

/**
 * A store's past days from the rollup, one entry per business date. The one
 * read every PAR total goes through — PAR tab, Drive-Thru cards, Slack checks —
 * so none can show a day differently.
 *
 * Reads the rows instead of SUM()ing in SQL on purpose: COALESCE(SUM(...), 0)
 * collapses "no data" and "zero sales" into an indistinguishable 0. A day with
 * no row is rebuilt from PAR and SAVED, so the next reader gets the same row
 * rather than its own rebuild (they used to differ: totals rebuilt a missing
 * day, the daily rows left it out). Past MAX_LIVE_BACKFILL_DAYS gaps, or when
 * PAR fails, the day is reported missing rather than counted as zero.
 */
export async function getPastDays(
  storeId: string,
  start: string,
  end: string,
): Promise<{ days: Map<string, DayTotals>; missingDates: string[] }> {
  const rows = (await sql`
    SELECT business_date, net_sales, order_count, labor_minutes
    FROM par_daily_metrics
    WHERE store_id = ${storeId}
      AND business_date BETWEEN ${start} AND ${end}
  `) as {
    business_date: string | Date;
    net_sales: string;
    order_count: string;
    labor_minutes: string;
  }[];

  const days = new Map<string, DayTotals>();
  for (const row of rows) {
    const date = typeof row.business_date === "string"
      ? row.business_date.slice(0, 10)
      : row.business_date.toISOString().slice(0, 10);
    days.set(date, {
      netSales: Number(row.net_sales),
      orderCount: Number(row.order_count),
      laborMinutes: Number(row.labor_minutes),
    });
  }

  const gaps = dateRange(start, end).filter(d => !days.has(d));
  // Too much missing to recover in one request — report the gaps rather than
  // fanning out into hundreds of PAR calls.
  if (gaps.length === 0 || gaps.length > MAX_LIVE_BACKFILL_DAYS) {
    return { days, missingDates: gaps };
  }

  const missingDates: string[] = [];
  await Promise.all(
    gaps.map(async date => {
      try {
        const totals = await computeDayTotalsStrict(storeId, date);
        await writeDayTotals(storeId, date, totals);
        days.set(date, totals);
      } catch {
        // PAR unreachable for this day — leave it reported as missing rather
        // than folding a zero into the total.
        missingDates.push(date);
      }
    }),
  );
  return { days, missingDates: missingDates.sort() };
}

export async function getTotalsForRange(
  storeId: string,
  start: string,
  end: string,
): Promise<RangeTotalsWithCoverage> {
  const today = todayCentralISO();
  const includesToday = end >= today && start <= today;
  const historicalEnd = end < today ? end : dayBefore(today);
  const hasHistorical = start <= historicalEnd;

  const [historical, live] = await Promise.all([
    hasHistorical
      ? getPastDays(storeId, start, historicalEnd)
      : Promise.resolve({ days: new Map<string, DayTotals>(), missingDates: [] }),
    includesToday ? computeDayTotals(storeId, today, true) : Promise.resolve(EMPTY_TOTALS),
  ]);

  const totals = { ...live };
  for (const day of historical.days.values()) {
    totals.netSales += day.netSales;
    totals.orderCount += day.orderCount;
    totals.laborMinutes += day.laborMinutes;
  }
  return { ...totals, missingDates: historical.missingDates };
}

export async function getNetSalesForRange(storeId: string, start: string, end: string): Promise<number> {
  const { netSales } = await getTotalsForRange(storeId, start, end);
  return round2(netSales);
}

export async function getOrderCountForRange(storeId: string, start: string, end: string): Promise<number> {
  const { orderCount } = await getTotalsForRange(storeId, start, end);
  return orderCount;
}

export async function getLaborHoursForRange(storeId: string, start: string, end: string): Promise<number> {
  const { laborMinutes } = await getTotalsForRange(storeId, start, end);
  return laborHours(laborMinutes);
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
    netSales: round2(netSales),
    transactions,
    avgTicket: round2(avgCheck(netSales, transactions)),
    laborHours: laborHours(laborMinutes),
  };
}

/** Per-day rows for a store over a range, oldest → newest (inclusive both ends). */
export async function getDailyRowsForRange(storeId: string, start: string, end: string): Promise<PARDailyRow[]> {
  const today = todayCentralISO();
  const includesToday = end >= today && start <= today;
  const historicalEnd = end < today ? end : dayBefore(today);

  const [historical, live] = await Promise.all([
    start <= historicalEnd ? getPastDays(storeId, start, historicalEnd) : null,
    includesToday ? computeDayTotals(storeId, today, true) : Promise.resolve(null),
  ]);

  const daily = [...(historical?.days ?? new Map<string, DayTotals>())]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, t]) => toDailyRow(date, t.netSales, t.orderCount, t.laborMinutes));

  if (live) {
    daily.push(toDailyRow(today, live.netSales, live.orderCount, live.laborMinutes));
  }

  return daily;
}

// ── Intraday window totals ───────────────────────────────────────────────────
// For hour-of-day / daypart questions ("Hampton's lunch sales today") — unlike
// every other read path above, this always hits PAR live (no rollup table has
// sub-day granularity) and filters/overlaps at the minute level rather than
// summing the whole day. startMinutes/endMinutes are store-local wall-clock
// minutes since midnight (PAR's own order/shift timestamps are already each
// store's own local time, so no timezone conversion happens here).

// Minutes of a shift that fall inside [windowStart, windowEnd) and count as
// actually worked — i.e. the shift/window overlap minus whatever portion of
// any break also falls in that same window. Verified against PAR's own
// MinutesWorked field: shift span minus its breaks reproduces MinutesWorked
// exactly, so the same subtraction has to happen per hour-bucket too, or a
// break shows up as worked labor in whichever hour it happened to fall in.
//
// A shift/break's own minutes (par.ts) can legitimately exceed 1440 when it
// runs past midnight into the next calendar day (a closing shift clocking
// out at 2am), while windowStart/windowEnd here are always 0-1440 (one
// hour-of-day bucket for THIS business date). Checking the window shifted by
// +1440 as well as its normal position is what lets an overnight shift's
// post-midnight portion still credit the early-hour buckets (0am, 1am, ...)
// of the same business date, instead of falling outside every window checked.
function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

export function shiftWorkedMinutesInWindow(shift: PARShift, windowStart: number, windowEnd: number): number {
  const windowedOverlap = (offsetMinutes: number) => {
    const wStart = windowStart + offsetMinutes;
    const wEnd = windowEnd + offsetMinutes;
    const shiftOverlap = overlapMinutes(shift.startMinutes, shift.endMinutes, wStart, wEnd);
    const breakOverlap = shift.breaks.reduce((sum, b) => sum + overlapMinutes(b.startMinutes, b.endMinutes, wStart, wEnd), 0);
    return Math.max(0, shiftOverlap - breakOverlap);
  };
  return windowedOverlap(0) + windowedOverlap(1440);
}

export type WindowTotals = { netSales: number; orderCount: number; laborMinutes: number };

export async function getWindowTotals(
  storeId: string,
  businessDate: string,
  startMinutes: number,
  endMinutes: number,
): Promise<WindowTotals> {
  // A closed/past day is safe to read from the 1hr-cached fetchers (nothing
  // about it changes anymore), but "today" must bypass that cache entirely —
  // the whole point of a same-day hourly query is to reflect orders that
  // closed minutes ago, and a stale cache entry from earlier in the day (e.g.
  // fetched at 11:05am and not due to refresh for another 55 minutes) would
  // silently show a near-empty lunch instead of what's actually happened
  // since. See getOrdersLive/getShiftsLive's own doc comment in par.ts.
  const isToday = businessDate === todayCentralISO();
  const [orders, shifts] = await Promise.all([
    (isToday ? getOrdersLive(storeId, businessDate) : getOrders(storeId, businessDate)).catch(() => []),
    (isToday ? getShiftsLive(storeId, businessDate) : getShifts(storeId, businessDate)).catch(() => []),
  ]);

  // Same isCountedOrder distinction computeDayTotals uses above — orders.length
  // over/undercounts real transactions.
  const windowOrders = orders.filter(
    (o) => o.openedMinutes != null && o.openedMinutes >= startMinutes && o.openedMinutes < endMinutes
  );
  const netSales = windowOrders.reduce((sum, o) => sum + o.netSales, 0);
  const orderCount = windowOrders.filter((o) => o.isCountedOrder).length;

  // A shift doesn't need to fall entirely inside the window to count — only
  // the portion of it that overlaps the window does (e.g. a 10am–3pm shift
  // contributes 3 of its hours to an 11am–2pm window, not all 5 or none) —
  // minus any break time that also overlaps the window.
  const laborMinutes = shifts.reduce((sum, s) => sum + shiftWorkedMinutesInWindow(s, startMinutes, endMinutes), 0);

  return { netSales, orderCount, laborMinutes };
}

export type HourBucket = {
  hour: number; // 0-23, local to the store
  label: string; // e.g. "11:00 AM–12:00 PM"
  netSales: number;
  orderCount: number;
  laborHours: number;
};

function fmtHourRange(h: number): string {
  const fmt = (hh: number) => {
    const h12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${h12}:00 ${hh < 12 ? "AM" : "PM"}`;
  };
  return `${fmt(h)}–${fmt((h + 1) % 24)}`;
}

// All 24 one-hour buckets for a single store/day in one order+shift fetch —
// for reconciling against Brink's own hourly sales report (PAR's back-office
// portal), which is what this exists for: getWindowTotals fetches fresh on
// every call, so computing 24 buckets by calling it 24 times would mean 24
// separate live PAR round-trips for "today". This fetches once and buckets
// in memory instead.
/**
 * A store's day by hour — the PAR tab's hourly table and the Slack checks of
 * the 2/5/8 PM reports. A past day is read from source_cache (one stored copy
 * for every screen), built from PAR and saved the first time. A PAR failure is
 * never saved: it falls back to the uncached build, which reads a failed pull
 * as an empty one.
 */
export async function getHourlyBreakdown(storeId: string, businessDate: string): Promise<HourBucket[]> {
  const isToday = businessDate === todayCentralISO();
  if (!isToday) {
    try {
      return await readThrough("par_hourly", `${storeId}:${businessDate}`, businessDate, async () => {
        const [orders, shifts] = await Promise.all([getOrders(storeId, businessDate), getShifts(storeId, businessDate)]);
        return toHourBuckets(orders, shifts);
      });
    } catch {
      // Fall through to the lenient build below.
    }
  }
  const [orders, shifts] = await Promise.all([
    (isToday ? getOrdersLive(storeId, businessDate) : getOrders(storeId, businessDate)).catch(() => []),
    (isToday ? getShiftsLive(storeId, businessDate) : getShifts(storeId, businessDate)).catch(() => []),
  ]);
  return toHourBuckets(orders, shifts);
}

/** Several past days' hourly breakdowns at once, for the Slack checks of a whole range. */
export async function getHourlyBreakdownMany(storeId: string, days: string[]): Promise<Map<string, HourBucket[]>> {
  const stored = await readMany("par_hourly", days.map((d) => `${storeId}:${d}`));
  const out = new Map<string, HourBucket[]>();
  await Promise.all(days.map(async (d) => {
    out.set(d, (stored.get(`${storeId}:${d}`) as HourBucket[] | undefined) ?? await getHourlyBreakdown(storeId, d));
  }));
  return out;
}

function toHourBuckets(orders: PAROrders, shifts: PARShift[]): HourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const startMinutes = hour * 60;
    const endMinutes = startMinutes + 60;

    const hourOrders = orders.filter(
      (o) => o.openedMinutes != null && o.openedMinutes >= startMinutes && o.openedMinutes < endMinutes
    );
    const netSales = hourOrders.reduce((sum, o) => sum + o.netSales, 0);
    const orderCount = hourOrders.filter((o) => o.isCountedOrder).length;

    const laborMinutes = shifts.reduce((sum, s) => sum + shiftWorkedMinutesInWindow(s, startMinutes, endMinutes), 0);

    return {
      hour,
      label: fmtHourRange(hour),
      netSales: round2(netSales),
      orderCount,
      laborHours: laborHours(laborMinutes),
    };
  });
}

// Latest business_date already rolled up for a store (drives incremental backfill).
export async function getLastRolledUpDate(storeId: string): Promise<string | null> {
  const rows = await sql`
    SELECT MAX(business_date) AS max_date FROM par_daily_metrics WHERE store_id = ${storeId}
  `;
  const row = rows[0] as { max_date: string | null };
  return row.max_date;
}
