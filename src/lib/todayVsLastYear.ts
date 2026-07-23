import { PAR_LOCATIONS, getOrders, getOrdersLive, getShiftsLive, type PARLocation, type PAROrder } from "@/lib/par";
import { getPriorYearDate } from "@/lib/fiscal";

// Live intraday comparison: today's sales-so-far vs the same clock time on
// the corresponding weekday last year (364-day shift, see getPriorYearDate).
// Unlike the other comp tables (which read the Postgres daily rollup), this
// hits PAR's live order API directly for both dates — today's orders are
// naturally "through now" already (the business day just hasn't finished),
// but last year's date already fully happened, so its orders are filtered
// down to the same time-of-day cutoff for an apples-to-apples comparison.

function centralParts(): { y: number; m: number; d: number; hh: number; mm: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
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

function todayISOCentral(): string {
  const { y, m, d } = centralParts();
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function nowMinutesCentral(): number {
  const { hh, mm } = centralParts();
  return hh * 60 + mm;
}

function nowLabelCentral(): string {
  const { hh, mm } = centralParts();
  const period = hh < 12 ? "AM" : "PM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${period} CT`;
}

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
    if (cutoffMinutes != null && (o.closedMinutes == null || o.closedMinutes > cutoffMinutes)) continue;
    netSales += o.netSales;
    if (o.isCountedOrder) transactions += 1;
  }
  return { netSales: Math.round(netSales * 100) / 100, transactions };
}

export type StoreTodayRaw = {
  storeId: string;
  name: string;
  state: PARLocation["state"];
  netSalesTY: number;
  netSalesLY: number;
  txTY: number;
  txLY: number;
  laborHoursTY: number;
  clockedInTY: number;
};

export type TodayVsLastYearResult = {
  stores: StoreTodayRaw[];
  todayDate: string;
  lastYearDate: string;
  asOfLabel: string;
};

export async function getTodayVsLastYear(): Promise<TodayVsLastYearResult> {
  const todayDate = todayISOCentral();
  const lastYearDate = getPriorYearDate(todayDate);
  const nowMin = nowMinutesCentral();

  const stores = await Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
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
      const ly = summarize(lastYearOrders, nowMin);
      const laborHoursTY = Math.round((todayShifts.reduce((s, sh) => s + sh.minutesWorked, 0) / 60) * 100) / 100;
      const clockedInTY = todayShifts.filter(sh => sh.isOpen).length;
      return {
        storeId: loc.storeId,
        name: loc.name,
        state: loc.state,
        netSalesTY: ty.netSales,
        netSalesLY: ly.netSales,
        txTY: ty.transactions,
        txLY: ly.transactions,
        laborHoursTY,
        clockedInTY,
      };
    })
  );

  return { stores, todayDate, lastYearDate, asOfLabel: nowLabelCentral() };
}
