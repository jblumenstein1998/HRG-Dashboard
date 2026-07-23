import { tool } from "ai";
import { z } from "zod";
import { listResolvedStores, resolveStore } from "./storeResolver";
import { resolveToolDateRange, resolveSupersetTimeRange, todayCentralISO } from "./dateRange";
import { getPriorYearRange } from "@/lib/fiscal";
import {
  getNetSalesForRange,
  getOrderCountForRange,
  getLaborHoursForRange,
  getAvgOrderValueForRange,
  getWindowTotals,
} from "@/lib/parRollup";
import { getShiftsLive } from "@/lib/par";
import { fetchLocationReport } from "@/lib/netchef";
import { getDriveThruMetrics, warmStandardRanges, ChartFetchError, isClosedRange } from "@/lib/berryData";
import { getBerryAuth } from "@/lib/auth";
import { loginBerryService } from "@/lib/berryAuth";
import { resolveDaypart, daypartLabel } from "@/lib/dayparts";
import { after } from "next/server";

const rangeKeyDescription =
  "Preset time range. One of: today, yesterday, wtd (week to date), last_week, " +
  "mtd (current fiscal period to date), last_period (prior full fiscal period), " +
  "qtd (current fiscal quarter to date), ytd (fiscal year to date), or p1..p12 " +
  "(a specific full fiscal period, e.g. \"p4\" for Period 4). Omit if using startDate/endDate instead.";

const storeNameSchema = z.string().describe(
  "Store name, e.g. \"Hillcrest\", \"Brentwood\". Matches HRG's 12 Zaxby's locations across TN and VA."
);
const dateRangeSchema = {
  rangeKey: z.string().optional().describe(rangeKeyDescription),
  startDate: z.string().optional().describe(
    "Custom range start date (YYYY-MM-DD), for an arbitrary date range not covered by rangeKey " +
    "(e.g. the user asks about a specific week like \"7/13-7/19\"). Requires endDate. Omit if using rangeKey instead."
  ),
  endDate: z.string().optional().describe("Custom range end date (YYYY-MM-DD). Required if startDate is given."),
  compareToPriorYear: z.boolean().optional().describe(
    "Set true when the user asks to compare against last year (e.g. \"vs last year\", \"year over year\"). " +
    "Compares against the same weekday 52 weeks earlier, not the same calendar date — e.g. a Saturday compares " +
    "to a Saturday, not to whatever weekday shares the same month/day last year."
  ),
};

function storeNotFound(storeName: string) {
  const names = listResolvedStores().map(s => s.name).join(", ");
  return { error: `Unknown store "${storeName}". Known stores: ${names}` };
}

function changePct(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 100 * 100) / 100;
}

export const listStores = tool({
  description: "Lists all HRG store locations with their state (TN/VA), for disambiguating store names.",
  inputSchema: z.object({}),
  execute: async () => {
    return listResolvedStores().map(s => ({ name: s.name, state: s.state }));
  },
});

export const getNetSales = tool({
  description:
    "Gets total net sales (in dollars) for a store over a given time range. Supports either a preset " +
    "rangeKey (ytd, p4, last_week, ...) or a custom startDate/endDate for arbitrary date ranges. Set " +
    "compareToPriorYear for year-over-year comparisons.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate, compareToPriorYear }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;
    const netSales = await getNetSalesForRange(store.storeId, start, end);

    if (!compareToPriorYear) return { store: store.name, range: label, start, end, netSales };

    const prior = getPriorYearRange(start, end);
    const priorNetSales = await getNetSalesForRange(store.storeId, prior.start, prior.end);
    return {
      store: store.name, range: label, start, end, netSales,
      priorYear: { start: prior.start, end: prior.end, netSales: priorNetSales, changePct: changePct(netSales, priorNetSales) },
    };
  },
});

export const getLaborHours = tool({
  description:
    "Gets total labor hours worked for a store over a given time range. Supports either a preset " +
    "rangeKey (ytd, p4, last_week, ...) or a custom startDate/endDate for arbitrary date ranges. Set " +
    "compareToPriorYear for year-over-year comparisons.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate, compareToPriorYear }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;
    const laborHours = await getLaborHoursForRange(store.storeId, start, end);

    if (!compareToPriorYear) return { store: store.name, range: label, start, end, laborHours };

    const prior = getPriorYearRange(start, end);
    const priorLaborHours = await getLaborHoursForRange(store.storeId, prior.start, prior.end);
    return {
      store: store.name, range: label, start, end, laborHours,
      priorYear: { start: prior.start, end: prior.end, laborHours: priorLaborHours, changePct: changePct(laborHours, priorLaborHours) },
    };
  },
});

export const getAvgOrderValue = tool({
  description:
    "Gets the average order value (average ticket) for a store over a given time range, computed as total " +
    "net sales divided by order count. Also returns the order count itself, so this can answer \"how many " +
    "orders/transactions\" questions too. Supports either a preset rangeKey (ytd, p4, last_week, ...) or a " +
    "custom startDate/endDate for arbitrary date ranges. Set compareToPriorYear for year-over-year comparisons.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate, compareToPriorYear }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;
    const [avgOrderValue, orderCount] = await Promise.all([
      getAvgOrderValueForRange(store.storeId, start, end),
      getOrderCountForRange(store.storeId, start, end),
    ]);

    if (!compareToPriorYear) return { store: store.name, range: label, start, end, avgOrderValue, orderCount };

    const prior = getPriorYearRange(start, end);
    const [priorAvgOrderValue, priorOrderCount] = await Promise.all([
      getAvgOrderValueForRange(store.storeId, prior.start, prior.end),
      getOrderCountForRange(store.storeId, prior.start, prior.end),
    ]);
    return {
      store: store.name, range: label, start, end, avgOrderValue, orderCount,
      priorYear: {
        start: prior.start, end: prior.end, avgOrderValue: priorAvgOrderValue, orderCount: priorOrderCount,
        changePct: changePct(avgOrderValue, priorAvgOrderValue),
      },
    };
  },
});

export const getProductivity = tool({
  description:
    "Gets labor productivity for a store over a given time range: SPLH (sales per labor hour, i.e. net sales " +
    "divided by labor hours) and TPLH (transactions per labor hour, i.e. order count divided by labor hours). " +
    "Also returns the underlying net sales, order count, and labor hours it computed those from, so this can " +
    "answer questions about any of those three individually too. Use this for questions about \"productivity\", " +
    "\"SPLH\", or \"TPLH\". Supports either a preset rangeKey (ytd, p4, last_week, ...) or a custom " +
    "startDate/endDate for arbitrary date ranges. Set compareToPriorYear for year-over-year comparisons.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate, compareToPriorYear }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;

    const computeSplhTplh = async (s: string, e: string) => {
      const [netSales, orderCount, laborHours] = await Promise.all([
        getNetSalesForRange(store.storeId, s, e),
        getOrderCountForRange(store.storeId, s, e),
        getLaborHoursForRange(store.storeId, s, e),
      ]);
      const splh = laborHours > 0 ? Math.round((netSales / laborHours) * 100) / 100 : null;
      const tplh = laborHours > 0 ? Math.round((orderCount / laborHours) * 100) / 100 : null;
      return { netSales, orderCount, laborHours, splh, tplh };
    };

    const current = await computeSplhTplh(start, end);

    if (!compareToPriorYear) return { store: store.name, range: label, start, end, ...current };

    const prior = getPriorYearRange(start, end);
    const priorMetrics = await computeSplhTplh(prior.start, prior.end);
    return {
      store: store.name, range: label, start, end, ...current,
      priorYear: {
        start: prior.start, end: prior.end, ...priorMetrics,
        splhChangePct: current.splh != null && priorMetrics.splh != null ? changePct(current.splh, priorMetrics.splh) : null,
        tplhChangePct: current.tplh != null && priorMetrics.tplh != null ? changePct(current.tplh, priorMetrics.tplh) : null,
      },
    };
  },
});

export const getClockedIn = tool({
  description:
    "Gets how many employees are currently clocked in (still working, not yet clocked out) at a store " +
    "right now, along with today's labor hours so far. This is live data as of the moment it's called, " +
    "not a historical range — use this for \"how many people are clocked in\", \"who's working right now\", " +
    "or \"current staffing\" questions. Not available for past dates.",
  inputSchema: z.object({ storeName: storeNameSchema }),
  execute: async ({ storeName }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);

    const today = todayCentralISO();
    const shifts = await getShiftsLive(store.storeId, today);
    const clockedIn = shifts.filter(s => s.isOpen).length;
    const laborHours = Math.round((shifts.reduce((sum, s) => sum + s.minutesWorked, 0) / 60) * 100) / 100;

    return { store: store.name, clockedIn, laborHoursToday: laborHours, asOf: new Date().toISOString() };
  },
});

export const getDriveThru = tool({
  description:
    "Gets drive-thru lane performance for a store over a given time range: overall lane total time " +
    "(order to pickup), pre-menu queue time, window service time (all as MM:SS), total cars, flagged " +
    "pull-forward car count, and a peak vs. non-peak breakdown. Use this for questions about drive-thru, " +
    "lane times, speed of service, or flagged/pulled-forward cars. Supports either a preset rangeKey " +
    "(ytd, p4, last_week, ...) or a custom startDate/endDate for arbitrary date ranges.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);

    const resolved = resolveSupersetTimeRange({ rangeKey, startDate, endDate });
    if ("error" in resolved) return resolved;
    const { timeRange, label } = resolved;

    // A browser session (berry_token cookie) is only present when this tool is
    // called from the logged-in web dashboard's chat. Callers with no browser
    // session at all — the Slack/Telegram bot, or any other server-to-server
    // caller — fall back to the same service-level login the daily cron uses.
    let { token } = await getBerryAuth();
    if (!token) {
      try {
        token = await loginBerryService();
      } catch {
        return { error: "Could not connect to the BerryAI drive-thru dashboard." };
      }
    }

    let payload;
    try {
      // An open range (includes today) gets a forced-fresh fetch rather than
      // relying on the dashboard's normal 5-minute rolling cache — a chat
      // query about "today" should reflect what's happened right up to the
      // moment it's asked, not whatever was cached a few minutes ago. Closed
      // (fully historical) ranges skip this — they're cached permanently
      // since the numbers can't change anymore, so busting would be pure cost.
      payload = await getDriveThruMetrics(token, timeRange, label, { bust: !isClosedRange(timeRange) });
    } catch (err) {
      if (err instanceof ChartFetchError) return { error: `Drive-thru data fetch failed (${err.status}).` };
      return { error: "Failed to establish drive-thru data session." };
    }

    after(() => warmStandardRanges(token));

    const storeMetrics = payload.stores.find(s => s.store_name_and_id.includes(store.storeId));
    if (!storeMetrics) return { error: `No drive-thru data found for "${store.name}" in this range.` };

    return {
      store: store.name,
      range: payload.range_label,
      laneTotal: storeMetrics.overall.lane_total,
      preMenuQueue: storeMetrics.overall.pre_menu_queue,
      windowService: storeMetrics.overall.window_service,
      totalCars: storeMetrics.overall.total_cars,
      flaggedPullForward: storeMetrics.overall.flagged_pull_forward,
      peak: storeMetrics.peak,
      nonpeak: storeMetrics.nonpeak,
    };
  },
});

export const getFoodCostMetrics = tool({
  description:
    "Gets food cost / COGS and variance for a store over a given time range: actual cost % and $ vs. theoretical, " +
    "and variance % and $ (actual minus theoretical). Use this for questions about \"variance\" or \"food cost\" or " +
    "\"COGS\". Supports either a preset rangeKey (ytd, p4, last_week, ...) or a custom startDate/endDate for " +
    "arbitrary date ranges. Set compareToPriorYear for year-over-year comparisons.",
  inputSchema: z.object({ storeName: storeNameSchema, ...dateRangeSchema }),
  execute: async ({ storeName, rangeKey, startDate, endDate, compareToPriorYear }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);
    if (store.ncLocationId == null) return { error: `No Net-Chef location mapped for "${store.name}".` };
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;
    // A range that includes today gets a forced-fresh fetch instead of the
    // normal 1hr cache — same reasoning as getDriveThru's bust flag above.
    const report = await fetchLocationReport(store.ncLocationId, start, end, { bust: end >= todayCentralISO() });

    if (!compareToPriorYear) return { store: store.name, range: label, start, end, ...report };

    const prior = getPriorYearRange(start, end);
    const priorReport = await fetchLocationReport(store.ncLocationId, prior.start, prior.end);
    return {
      store: store.name, range: label, start, end, ...report,
      priorYear: {
        start: prior.start, end: prior.end, ...priorReport,
        variancePctChangePts: report.variancePct != null && priorReport.variancePct != null
          ? Math.round((report.variancePct - priorReport.variancePct) * 100) / 100
          : null,
      },
    };
  },
});

function toMinutesOfDay(hhmm: string): number | null {
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

export const getHourlyMetrics = tool({
  description:
    "Gets sales and productivity (net sales, order count, average order value, labor hours, SPLH, TPLH) for a " +
    "store within a specific time-of-day window on a single business date — e.g. \"Hampton's sales and " +
    "productivity from 11 to 2 today\" or \"how was lunch at Columbia yesterday\". Times are each store's own " +
    "local wall-clock time (no timezone conversion needed). Use this instead of getNetSales/getProductivity " +
    "whenever the question names a specific hour range or a named daypart/meal period, rather than a full day " +
    "or multi-day range. Specify the window with EITHER daypart OR startTime+endTime, not both: daypart 1 = " +
    "before 11am (no nickname), 2 = 11am-2pm (\"lunch\"), 3 = 2-5pm (\"afternoon snack\"), 4 = 5-8pm " +
    "(\"dinner\"), 5 = 8-11pm (\"late night\" / \"late night snack\"), 6 = after 11pm (no nickname).",
  inputSchema: z.object({
    storeName: storeNameSchema,
    date: z.string().optional().describe("Business date (YYYY-MM-DD) for the window. Omit for today."),
    daypart: z.string().optional().describe(
      "Named window: a daypart number 1-6, or nickname \"lunch\", \"afternoon snack\", \"dinner\", \"late night\". " +
      "Use this OR startTime/endTime, not both."
    ),
    startTime: z.string().optional().describe(
      "Custom window start, 24-hour HH:MM, store-local time (e.g. \"13:00\" for 1pm). Requires endTime. " +
      "Use this OR daypart, not both."
    ),
    endTime: z.string().optional().describe("Custom window end, 24-hour HH:MM, store-local time. Required if startTime is given."),
  }),
  execute: async ({ storeName, date, daypart, startTime, endTime }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);

    const businessDate = date ?? todayCentralISO();

    let startMinutes: number, endMinutes: number, windowLabel: string;
    if (daypart) {
      const dp = resolveDaypart(daypart);
      if (!dp) {
        return { error: `Unknown daypart "${daypart}". Use a number 1-6, or "lunch", "afternoon snack", "dinner", "late night".` };
      }
      startMinutes = dp.startMinutes;
      endMinutes = dp.endMinutes;
      windowLabel = daypartLabel(dp);
    } else if (startTime && endTime) {
      const s = toMinutesOfDay(startTime);
      const e = toMinutesOfDay(endTime);
      if (s == null || e == null) return { error: "startTime/endTime must be 24-hour HH:MM (e.g. \"13:00\")." };
      startMinutes = s;
      endMinutes = e;
      windowLabel = `${startTime}–${endTime}`;
    } else {
      return { error: "Provide either a daypart or both startTime and endTime." };
    }

    const { netSales, orderCount, laborMinutes } = await getWindowTotals(store.storeId, businessDate, startMinutes, endMinutes);
    const laborHours = Math.round((laborMinutes / 60) * 100) / 100;
    const avgOrderValue = orderCount > 0 ? Math.round((netSales / orderCount) * 100) / 100 : 0;
    const splh = laborHours > 0 ? Math.round((netSales / laborHours) * 100) / 100 : null;
    const tplh = laborHours > 0 ? Math.round((orderCount / laborHours) * 100) / 100 : null;

    return {
      store: store.name,
      businessDate,
      window: windowLabel,
      netSales: Math.round(netSales * 100) / 100,
      orderCount,
      avgOrderValue,
      laborHours,
      splh,
      tplh,
    };
  },
});

export const dashboardTools = {
  listStores,
  getNetSales,
  getLaborHours,
  getAvgOrderValue,
  getProductivity,
  getClockedIn,
  getFoodCostMetrics,
  getDriveThru,
  getHourlyMetrics,
};
