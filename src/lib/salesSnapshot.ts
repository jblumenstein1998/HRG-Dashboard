import { PAR_LOCATIONS, getOrders, getOrdersLive, getShiftsLive, STATE_TIMEZONE, type PARLocation, type PAROrder } from "@/lib/par";
import { getPriorYearRange, PERIODS, type RangeKey } from "@/lib/fiscal";
import { getTotalsForRange } from "@/lib/parRollup";
import { resolveDateBounds } from "@/lib/tools/dateRange";

// One store-level sales snapshot (net sales / transactions / average check /
// labor) for a selectable range, each figure paired with the same range shifted
// back to last year (364 days, see getPriorYearDate — same weekday, not same
// calendar date).
//
// Two different data paths, depending on the range:
//
//  • "today" is LIVE — it hits PAR's order/shift API directly for both dates on
//    every call, because today's numbers are still moving. Last year's date
//    already fully happened, so its orders get cut off at the same time-of-day
//    as "now" for an apples-to-apples comparison (see summarize/cutoffMinutes).
//
//  • every other range (yesterday / WTD / last week / PTD / YTD / a past
//    fiscal period)
//    resolves entirely through the Postgres daily rollup, exactly like the
//    Net Sales / Transactions / Average Check tables below it on the POS tab.
//    Those windows all end yesterday-or-earlier, so they're settled: no live
//    PAR call, and no time-of-day cutoff is needed on either side.

// PAR's own order/shift timestamps are converted to each store's own local
// timezone in par.ts (STATE_TIMEZONE, reused here) — TN stores are Central,
// VA stores are Eastern, so "now" must be computed per state, not once for
// the whole company. Using a single Central "now" for every store (the
// original implementation) cut VA stores' last-year comparison off an hour
// early: if it's 2pm Eastern at Hampton, Central "now" is only 1pm.

function zonedParts(timeZone: string): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
}

// The business-date boundary (which calendar day counts as "today") stays a
// single Central reference, same convention as the rest of the app (e.g.
// todayCentralISO in parRollup.ts) — only the intraday minute-of-day cutoff
// used to slice last year's comparison needs to be state-aware.
function todayISOCentral(): string {
  const { y, m, d } = zonedParts("America/Chicago");
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function nowMinutesForState(state: PARLocation["state"]): number {
  const { hh, mm } = zonedParts(STATE_TIMEZONE[state]);
  return hh * 60 + mm;
}

function nowLabelForState(state: PARLocation["state"]): string {
  const { hh, mm } = zonedParts(STATE_TIMEZONE[state]);
  const period = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const tzAbbr = state === "TN" ? "CT" : "ET";
  return `${h12}:${String(mm).padStart(2, "0")} ${period} ${tzAbbr}`;
}

// ── Range keys ────────────────────────────────────────────────────────────────

export const QUICK_RANGES = ["today", "yesterday", "wtd", "last_week", "ptd", "ytd"] as const;
export type QuickRange = (typeof QUICK_RANGES)[number];
/** A quick range, or `p<n>` for a full fiscal period (e.g. "p5"). */
export type SnapshotRange = QuickRange | `p${number}`;

export const DEFAULT_SNAPSHOT_RANGE: SnapshotRange = "today";

const PERIOD_KEY_RE = /^p(\d+)$/;

/** Validates an untrusted range string (e.g. a query param). Null if unknown. */
export function parseSnapshotRange(raw: string | null | undefined): SnapshotRange | null {
  if (!raw) return null;
  const key = raw.toLowerCase();
  if ((QUICK_RANGES as readonly string[]).includes(key)) return key as QuickRange;
  const match = key.match(PERIOD_KEY_RE);
  if (match && PERIODS.some((p) => p.period === Number(match[1]))) return key as `p${number}`;
  return null;
}

const QUICK_RANGE_LABELS: Record<QuickRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  wtd: "WTD",
  last_week: "Last Week",
  ptd: "PTD",
  ytd: "YTD",
};

function snapshotRangeLabel(range: SnapshotRange): string {
  if (range in QUICK_RANGE_LABELS) return QUICK_RANGE_LABELS[range as QuickRange];
  return `P${range.match(PERIOD_KEY_RE)?.[1] ?? "?"}`;
}

// "PTD" is this app's name for fiscal.ts's "mtd" — HRG's periods are 4-4-5
// fiscal periods, not calendar months (same window, different label; the
// Drive-Thru tab does the same translation).
function resolveWindow(range: SnapshotRange): { start: string; end: string } {
  if (range === "today") {
    const t = todayISOCentral();
    return { start: t, end: t };
  }
  const key: RangeKey = range === "ptd" ? "mtd" : (range as RangeKey);
  const { start, end } = resolveDateBounds(key);
  return { start, end };
}

// ── Aggregation ───────────────────────────────────────────────────────────────

// Net sales sums every order (refunds/corrections included — already negative),
// matching parRollup.ts's convention. Only the transaction *count* excludes
// non-counted orders (PAR's Order.Count flag) — a store can have void/correction
// orders with isCountedOrder=false that still carry a real net-sales adjustment,
// so excluding them from the sum (not just the count) understates/overstates
// net sales for stores that have any.
function summarize(orders: PAROrder[], cutoffMinutes: number | null): { netSales: number; transactions: number } {
  let netSales = 0;
  let transactions = 0;
  for (const o of orders) {
    if (cutoffMinutes != null && (o.openedMinutes == null || o.openedMinutes > cutoffMinutes)) continue;
    netSales += o.netSales;
    if (o.isCountedOrder) transactions += 1;
  }
  return { netSales: Math.round(netSales * 100) / 100, transactions };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type StoreSnapshotRaw = {
  storeId: string;
  name: string;
  state: PARLocation["state"];
  netSalesTY: number;
  netSalesLY: number;
  txTY: number;
  txLY: number;
  laborHoursTY: number;
  // Employees currently on the clock — only meaningful for the live "today"
  // range; null for settled ranges, where "currently" has no meaning.
  clockedInTY: number | null;
};

export type SalesSnapshotResult = {
  stores: StoreSnapshotRaw[];
  range: SnapshotRange;
  rangeLabel: string;
  startDate: string;
  endDate: string;
  priorStartDate: string;
  priorEndDate: string;
  /** True only for "today" — figures came from a live PAR pull, not the rollup. */
  live: boolean;
  /**
   * The window contains no completed business day yet (WTD on a Monday, since
   * every "to date" range ends yesterday). Figures are all zero — that's the
   * calendar, not missing data.
   */
  emptyWindow: boolean;
  asOfLabelCT: string; // TN stores' local cutoff time (live ranges only)
  asOfLabelET: string; // VA stores' local cutoff time (live ranges only)
};

async function liveTodayStore(loc: PARLocation, todayDate: string, lastYearDate: string): Promise<StoreSnapshotRaw> {
  // Today's orders/shifts must be genuinely live (not the shared 1hr cache) —
  // open shifts' worked-minutes and today's order count both keep changing
  // minute to minute, so a stale cache read would understate/overstate them
  // relative to whatever moment this table gets compared against PAR's own
  // report. Last year's date already fully happened, so it's safe (and
  // faster) to read through the normal cache.
  const [todayOrders, lastYearOrders, todayShifts] = await Promise.all([
    getOrdersLive(loc.storeId, todayDate),
    getOrders(loc.storeId, lastYearDate),
    getShiftsLive(loc.storeId, todayDate),
  ]);
  const ty = summarize(todayOrders, null);
  // Cut last year's same-weekday orders off at the same time-of-day as
  // "now" — but "now" in this store's own local time, not blanket Central
  // (see nowMinutesForState's doc comment above).
  const ly = summarize(lastYearOrders, nowMinutesForState(loc.state));
  return {
    storeId: loc.storeId,
    name: loc.name,
    state: loc.state,
    netSalesTY: ty.netSales,
    netSalesLY: ly.netSales,
    txTY: ty.transactions,
    txLY: ly.transactions,
    laborHoursTY: round2(todayShifts.reduce((s, sh) => s + sh.minutesWorked, 0) / 60),
    clockedInTY: todayShifts.filter((sh) => sh.isOpen).length,
  };
}

async function rollupStore(
  loc: PARLocation,
  start: string,
  end: string,
  priorStart: string,
  priorEnd: string,
): Promise<StoreSnapshotRaw> {
  const [ty, ly] = await Promise.all([
    getTotalsForRange(loc.storeId, start, end),
    getTotalsForRange(loc.storeId, priorStart, priorEnd),
  ]);
  return {
    storeId: loc.storeId,
    name: loc.name,
    state: loc.state,
    netSalesTY: round2(ty.netSales),
    netSalesLY: round2(ly.netSales),
    txTY: ty.orderCount,
    txLY: ly.orderCount,
    laborHoursTY: round2(ty.laborMinutes / 60),
    clockedInTY: null,
  };
}

function emptyStore(loc: PARLocation): StoreSnapshotRaw {
  return {
    storeId: loc.storeId,
    name: loc.name,
    state: loc.state,
    netSalesTY: 0,
    netSalesLY: 0,
    txTY: 0,
    txLY: 0,
    laborHoursTY: 0,
    clockedInTY: null,
  };
}

export async function getSalesSnapshot(range: SnapshotRange = DEFAULT_SNAPSHOT_RANGE): Promise<SalesSnapshotResult> {
  const live = range === "today";
  const { start, end } = resolveWindow(range);
  const prior = getPriorYearRange(start, end);

  const base = {
    range,
    rangeLabel: snapshotRangeLabel(range),
    startDate: start,
    endDate: end,
    priorStartDate: prior.start,
    priorEndDate: prior.end,
    live,
    asOfLabelCT: live ? nowLabelForState("TN") : "",
    asOfLabelET: live ? nowLabelForState("VA") : "",
  };

  // WTD on a Monday: the window starts today and ends yesterday, i.e. it holds
  // no completed day yet. Querying it would be harmless but meaningless.
  if (start > end) {
    return { ...base, stores: PAR_LOCATIONS.map(emptyStore), emptyWindow: true };
  }

  const stores = await Promise.all(
    PAR_LOCATIONS.map((loc) =>
      live
        ? liveTodayStore(loc, start, prior.start)
        : rollupStore(loc, start, end, prior.start, prior.end)
    )
  );

  return { ...base, stores, emptyWindow: false };
}
