import { tool } from "ai";
import { z } from "zod";
import { listResolvedStores, resolveStore } from "./storeResolver";
import { resolveToolDateRange, resolveSupersetTimeRange, todayCentralISO } from "./dateRange";
import { getPriorYearRange } from "@/lib/fiscal";
import {
  getNetSalesForRange,
  getOrderCountForRange,
  getLaborHoursForRange,
  getTotalsForRange,
  getAvgOrderValueForRange,
  getWindowTotals,
  getDailyRowsForRange,
  type PARDailyRow,
} from "@/lib/parRollup";
import { getShiftsLive } from "@/lib/par";
import { fetchLocationReport } from "@/lib/netchef";
import { getDriveThruMetrics, warmStandardRanges, ChartFetchError, isClosedRange } from "@/lib/berryData";
import { getBerryAuth } from "@/lib/auth";
import { loginBerryService } from "@/lib/berryAuth";
import { resolveDaypart, daypartLabel } from "@/lib/dayparts";
import { money, money2, num2, count, pct, pctPlain, passthrough, usDate, usRange, incompleteNote } from "./displayFormat";
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
    const current = await getTotalsForRange(store.storeId, start, end);
    const netSales = Math.round(current.netSales * 100) / 100;

    // Days we could neither read from the rollup nor recover from PAR. Passed to
    // the model so an incomplete total gets labelled rather than reported as
    // fact — a missing day used to be indistinguishable from a genuine $0.
    const incomplete = current.missingDates.length
      ? {
          incompleteData: true,
          missingDates: current.missingDates,
          warning:
            "No data available for the dates listed in missingDates, so netSales is lower than the " +
            "true figure. Report this total as incomplete and name the missing dates. Do not present " +
            "it as the store's actual sales.",
        }
      : {};

    const note = incompleteNote(current.missingDates);

    if (!compareToPriorYear) {
      return {
        store: store.name, range: label, start, end, netSales, ...incomplete,
        display: {
          title: `${store.name} — Net Sales`,
          subtitle: usRange(start, end),
          rows: [{ label: "Net sales", value: money(netSales) }],
          ...(note ? { note } : {}),
        },
      };
    }

    const prior = getPriorYearRange(start, end);
    const priorTotals = await getTotalsForRange(store.storeId, prior.start, prior.end);
    const priorNetSales = Math.round(priorTotals.netSales * 100) / 100;
    return {
      store: store.name, range: label, start, end, netSales, ...incomplete,
      priorYear: {
        start: prior.start, end: prior.end, netSales: priorNetSales,
        changePct: changePct(netSales, priorNetSales),
        ...(priorTotals.missingDates.length
          ? { incompleteData: true, missingDates: priorTotals.missingDates }
          : {}),
      },
      display: {
        title: `${store.name} — Net Sales`,
        subtitle: usRange(start, end),
        rows: [
          { label: "Net sales", value: money(netSales) },
          { label: `Last year (${usRange(prior.start, prior.end)})`, value: money(priorNetSales) },
          { label: "Change", value: pct(changePct(netSales, priorNetSales)) },
        ],
        ...(note ? { note } : {}),
      },
    };
  },
});

type StoreNetSalesRow = {
  store: string;
  state: string;
  netSales: number;
  priorYearNetSales: number | null;
  changePct: number | null;
  missingDates: string[];
};

export const getAllStoresNetSales = tool({
  description:
    "Gets net sales for EVERY HRG store in a single call, with per-state (TN/VA) and company-wide totals " +
    "already summed. Use this for any question covering more than one store: \"all stores\", \"the whole " +
    "company\", \"which store did best\", a ranked list, or a regional summary. Never call getNetSales " +
    "repeatedly to assemble a multi-store answer, and never add the stores up yourself — the rollups here " +
    "are computed in code. Supports a preset rangeKey or custom startDate/endDate, plus compareToPriorYear.",
  inputSchema: z.object({ ...dateRangeSchema }),
  execute: async ({ rangeKey, startDate, endDate, compareToPriorYear }) => {
    const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
    if ("error" in bounds) return bounds;
    const { start, end, label } = bounds;
    const prior = compareToPriorYear ? getPriorYearRange(start, end) : null;

    const rows: StoreNetSalesRow[] = await Promise.all(
      listResolvedStores().map(async s => {
        const [cur, pri] = await Promise.all([
          getTotalsForRange(s.storeId, start, end),
          prior ? getTotalsForRange(s.storeId, prior.start, prior.end) : Promise.resolve(null),
        ]);
        const netSales = Math.round(cur.netSales * 100) / 100;
        const priorYearNetSales = pri ? Math.round(pri.netSales * 100) / 100 : null;
        return {
          store: s.name,
          state: s.state,
          netSales,
          priorYearNetSales,
          changePct: priorYearNetSales == null ? null : changePct(netSales, priorYearNetSales),
          missingDates: cur.missingDates,
        };
      }),
    );

    // Summed here rather than by the model. This tool exists because a
    // multi-store question previously meant a dozen separate calls and manual
    // arithmetic, which is exactly where fabricated totals came from.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalOf = (list: StoreNetSalesRow[]) => round2(list.reduce((t, r) => t + r.netSales, 0));
    const priorTotalOf = (list: StoreNetSalesRow[]) =>
      list.every(r => r.priorYearNetSales == null)
        ? null
        : round2(list.reduce((t, r) => t + (r.priorYearNetSales ?? 0), 0));

    const states = [...new Set(rows.map(r => r.state))].sort();
    const rollups = [
      ...states.map(st => {
        const list = rows.filter(r => r.state === st);
        const netSales = totalOf(list);
        const priorNet = priorTotalOf(list);
        return {
          label: st,
          netSales,
          priorYearNetSales: priorNet,
          changePct: priorNet == null ? null : changePct(netSales, priorNet),
        };
      }),
      (() => {
        const netSales = totalOf(rows);
        const priorNet = priorTotalOf(rows);
        return {
          label: "All stores",
          netSales,
          priorYearNetSales: priorNet,
          changePct: priorNet == null ? null : changePct(netSales, priorNet),
        };
      })(),
    ];

    const ranked = [...rows].sort((a, b) => b.netSales - a.netSales);
    const allMissing = [...new Set(rows.flatMap(r => r.missingDates))].sort();

    return {
      range: label, start, end,
      stores: ranked,
      rollups,
      ...(allMissing.length ? { incompleteData: true, missingDates: allMissing } : {}),
      display: {
        title: "All Stores — Net Sales",
        subtitle: usRange(start, end),
        rows: [
          // pct() already parenthesises negatives per house convention — don't
          // wrap it again or a decline renders as "((5.19%))".
          ...ranked.map(r => ({
            label: r.store,
            value: prior ? `${money(r.netSales)}   ${pct(r.changePct)}` : money(r.netSales),
          })),
          ...rollups.map(r => ({
            label: `▸ ${r.label}`,
            value: prior ? `${money(r.netSales)}   ${pct(r.changePct)}` : money(r.netSales),
          })),
        ],
        ...(incompleteNote(allMissing) ? { note: incompleteNote(allMissing) } : {}),
      },
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

    if (!compareToPriorYear) {
      return {
        store: store.name, range: label, start, end, laborHours,
        display: {
          title: `${store.name} — Labor Hours`,
          subtitle: usRange(start, end),
          rows: [{ label: "Labor hours", value: num2(laborHours) }],
        },
      };
    }

    const prior = getPriorYearRange(start, end);
    const priorLaborHours = await getLaborHoursForRange(store.storeId, prior.start, prior.end);
    return {
      store: store.name, range: label, start, end, laborHours,
      priorYear: { start: prior.start, end: prior.end, laborHours: priorLaborHours, changePct: changePct(laborHours, priorLaborHours) },
      display: {
        title: `${store.name} — Labor Hours`,
        subtitle: usRange(start, end),
        rows: [
          { label: "Labor hours", value: num2(laborHours) },
          { label: `Last year (${usRange(prior.start, prior.end)})`, value: num2(priorLaborHours) },
          { label: "Change", value: pct(changePct(laborHours, priorLaborHours)) },
        ],
      },
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

    if (!compareToPriorYear) {
      return {
        store: store.name, range: label, start, end, avgOrderValue, orderCount,
        display: {
          title: `${store.name} — Average Order Value`,
          subtitle: usRange(start, end),
          rows: [
            { label: "Average order value", value: money2(avgOrderValue) },
            { label: "Orders", value: count(orderCount) },
          ],
        },
      };
    }

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
      display: {
        title: `${store.name} — Average Order Value`,
        subtitle: usRange(start, end),
        rows: [
          { label: "Average order value", value: money2(avgOrderValue) },
          { label: "Orders", value: count(orderCount) },
          { label: `Last year AOV (${usRange(prior.start, prior.end)})`, value: money2(priorAvgOrderValue) },
          { label: "Last year orders", value: count(priorOrderCount) },
          { label: "AOV change", value: pct(changePct(avgOrderValue, priorAvgOrderValue)) },
        ],
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

    if (!compareToPriorYear) {
      return {
        store: store.name, range: label, start, end, ...current,
        display: {
          title: `${store.name} — Productivity`,
          subtitle: usRange(start, end),
          rows: [
            { label: "SPLH", value: money2(current.splh) },
            { label: "TPLH", value: num2(current.tplh) },
            { label: "Net sales", value: money(current.netSales) },
            { label: "Orders", value: count(current.orderCount) },
            { label: "Labor hours", value: num2(current.laborHours) },
          ],
        },
      };
    }

    const prior = getPriorYearRange(start, end);
    const priorMetrics = await computeSplhTplh(prior.start, prior.end);
    const splhChange = current.splh != null && priorMetrics.splh != null ? changePct(current.splh, priorMetrics.splh) : null;
    const tplhChange = current.tplh != null && priorMetrics.tplh != null ? changePct(current.tplh, priorMetrics.tplh) : null;
    return {
      store: store.name, range: label, start, end, ...current,
      priorYear: {
        start: prior.start, end: prior.end, ...priorMetrics,
        splhChangePct: splhChange,
        tplhChangePct: tplhChange,
      },
      display: {
        title: `${store.name} — Productivity`,
        subtitle: usRange(start, end),
        rows: [
          { label: "SPLH", value: money2(current.splh) },
          { label: `Last year SPLH (${usRange(prior.start, prior.end)})`, value: money2(priorMetrics.splh) },
          { label: "SPLH change", value: pct(splhChange) },
          { label: "TPLH", value: num2(current.tplh) },
          { label: "Last year TPLH", value: num2(priorMetrics.tplh) },
          { label: "TPLH change", value: pct(tplhChange) },
        ],
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

    return {
      store: store.name, clockedIn, laborHoursToday: laborHours, asOf: new Date().toISOString(),
      display: {
        title: `${store.name} — Currently Clocked In`,
        subtitle: "Live, as of now",
        rows: [
          { label: "Clocked in", value: count(clockedIn) },
          { label: "Labor hours today", value: num2(laborHours) },
        ],
      },
    };
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
      display: {
        title: `${store.name} — Drive-Thru`,
        subtitle: payload.range_label,
        // Lane total and window service only: pre-menu queue is deliberately
        // omitted here to match the scope rule in the system prompt. It stays
        // in the raw result above for when the user asks for it explicitly.
        rows: [
          { label: "Lane total", value: passthrough(storeMetrics.overall.lane_total) },
          { label: "Window service", value: passthrough(storeMetrics.overall.window_service) },
          { label: "Total cars", value: passthrough(storeMetrics.overall.total_cars) },
        ],
      },
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

    const foodCostRows = (r: typeof report) => [
      { label: "Actual cost", value: pctPlain(r.actualCostPct) },
      { label: "Actual cost $", value: money(r.actualCostDollars) },
      { label: "Variance", value: pctPlain(r.variancePct) },
      { label: "Variance $", value: money(r.varianceDollars) },
    ];

    if (!compareToPriorYear) {
      return {
        store: store.name, range: label, start, end, ...report,
        display: {
          title: `${store.name} — Food Cost & Variance`,
          subtitle: usRange(start, end),
          rows: foodCostRows(report),
        },
      };
    }

    const prior = getPriorYearRange(start, end);
    const priorReport = await fetchLocationReport(store.ncLocationId, prior.start, prior.end);
    const varianceChangePts = report.variancePct != null && priorReport.variancePct != null
      ? Math.round((report.variancePct - priorReport.variancePct) * 100) / 100
      : null;
    return {
      store: store.name, range: label, start, end, ...report,
      priorYear: {
        start: prior.start, end: prior.end, ...priorReport,
        variancePctChangePts: varianceChangePts,
      },
      display: {
        title: `${store.name} — Food Cost & Variance`,
        subtitle: usRange(start, end),
        rows: [
          ...foodCostRows(report),
          { label: `Last year variance (${usRange(prior.start, prior.end)})`, value: pctPlain(priorReport.variancePct) },
          // Percentage points, not a percent change — a variance moving from
          // 2% to 3% is +1.00 pts, not +50%.
          { label: "Variance change (pts)", value: varianceChangePts == null ? "—" : pct(varianceChangePts) },
        ],
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

    const roundedNetSales = Math.round(netSales * 100) / 100;
    return {
      store: store.name,
      businessDate,
      window: windowLabel,
      netSales: roundedNetSales,
      orderCount,
      avgOrderValue,
      laborHours,
      splh,
      tplh,
      display: {
        title: `${store.name} — ${windowLabel}`,
        subtitle: usDate(businessDate),
        rows: [
          { label: "Net sales", value: money(roundedNetSales) },
          { label: "Orders", value: count(orderCount) },
          { label: "Average order value", value: money2(avgOrderValue) },
          { label: "Labor hours", value: num2(laborHours) },
          { label: "SPLH", value: money2(splh) },
          { label: "TPLH", value: num2(tplh) },
        ],
      },
    };
  },
});

const TREND_METRICS = ["netSales", "transactions", "avgTicket", "laborHours", "splh", "tplh"] as const;

type TrendPoint = {
  date: string;
  netSales: number;
  transactions: number;
  avgTicket: number;
  laborHours: number;
  splh: number | null;
  tplh: number | null;
};

function toTrendPoint(date: string, netSales: number, transactions: number, laborHours: number): TrendPoint {
  return {
    date,
    netSales: Math.round(netSales * 100) / 100,
    transactions,
    avgTicket: transactions > 0 ? Math.round((netSales / transactions) * 100) / 100 : 0,
    laborHours: Math.round(laborHours * 100) / 100,
    splh: laborHours > 0 ? Math.round((netSales / laborHours) * 100) / 100 : null,
    tplh: laborHours > 0 ? Math.round((transactions / laborHours) * 100) / 100 : null,
  };
}

// Monday of the week containing this date — same week boundary as
// getWtdRange/getLastWeekRange (fiscal.ts) elsewhere in the app. Points are
// labeled by their week's Monday.
function mondayOf(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const day = dt.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Deterministic "last N weeks" range: N full Monday–Sunday weeks ending at
// the most recently COMPLETED Sunday (today's own in-progress week, if any,
// is excluded — e.g. if today is Thursday, this week doesn't count as one of
// the N). Computed in code rather than asked of the model: an LLM doing this
// date arithmetic by hand is exactly what produced a wrong-by-a-year range
// the first time this was tried purely via startDate/endDate.
function lastNWeeksRange(weeks: number): { start: string; end: string } {
  const todayIso = todayCentralISO();
  const day = new Date(`${todayIso}T00:00:00`).getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceLastSunday = day === 0 ? 7 : day; // today itself is never "completed"
  const end = addDays(todayIso, -daysSinceLastSunday);
  const start = addDays(mondayOf(end), -7 * (weeks - 1));
  return { start, end };
}

function aggregateWeekly(daily: PARDailyRow[]): TrendPoint[] {
  const weeks = new Map<string, { netSales: number; transactions: number; laborMinutes: number }>();
  for (const d of daily) {
    const weekStart = mondayOf(d.date);
    const acc = weeks.get(weekStart) ?? { netSales: 0, transactions: 0, laborMinutes: 0 };
    acc.netSales += d.netSales;
    acc.transactions += d.transactions;
    acc.laborMinutes += d.laborHours * 60;
    weeks.set(weekStart, acc);
  }
  return Array.from(weeks.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, acc]) => toTrendPoint(weekStart, acc.netSales, acc.transactions, acc.laborMinutes / 60));
}

export const getSalesTrend = tool({
  description:
    "Gets a trend for a store over a date range, for the user to SEE as a chart — e.g. \"chart Hillcrest's sales " +
    "trend this month\", \"show me Brentwood's labor hours over the last 2 weeks\", \"plot Columbia's weekly " +
    "productivity for the last 6 weeks\". Use this instead of getNetSales/getProductivity/etc. whenever the user " +
    "wants to visualize how a metric moved over time, not just get one total for a range. " +
    "For a \"last N weeks\" request, set weeks: N instead of computing startDate/endDate yourself — this is " +
    "computed correctly in code (N full Monday–Sunday weeks ending at the most recently completed Sunday), " +
    "which you cannot reliably do by hand; setting weeks also implies weekly granularity automatically. " +
    "For any other multi-week range, or when the user just says \"weekly\"/\"by week\" for a range you already " +
    "have from a rangeKey or explicit dates, set granularity: \"weekly\" instead — never sum/average the daily " +
    "figures into weeks yourself, and never invent a week boundary other than Monday–Sunday (the same one the " +
    "dashboard's own WTD/Last Week use). " +
    "Each point includes net sales, transactions, average ticket, labor hours, SPLH, and TPLH (weekly points are " +
    "the real sum/weighted-average for that week, not an average of daily values). Set metric to whichever one " +
    "the user is asking to see (defaults to netSales if unspecified). Call this tool EXACTLY ONCE per chart.",
  inputSchema: z.object({
    storeName: storeNameSchema,
    metric: z.enum(TREND_METRICS).optional().describe(
      "Which metric to chart: netSales, transactions, avgTicket, laborHours, splh, or tplh. Defaults to netSales."
    ),
    granularity: z.enum(["daily", "weekly"]).optional().describe(
      "\"daily\" (default) for one point per day, or \"weekly\" to aggregate into Monday–Sunday weekly totals " +
      "— use weekly whenever the user says \"weekly\", \"by week\", \"each week\", or asks for a range spanning " +
      "several weeks where daily points would be too noisy to read. Implied automatically when weeks is set."
    ),
    weeks: z.number().int().positive().optional().describe(
      "Shortcut for a \"last N weeks\" request: number of most-recently-completed Monday–Sunday weeks to " +
      "include, ending at the most recent completed Sunday. Use this INSTEAD of rangeKey/startDate/endDate for " +
      "\"last N weeks\" — do not also set those. Implies weekly granularity unless you override it."
    ),
    rangeKey: dateRangeSchema.rangeKey,
    startDate: dateRangeSchema.startDate,
    endDate: dateRangeSchema.endDate,
  }),
  execute: async ({ storeName, metric, granularity, weeks, rangeKey, startDate, endDate }) => {
    const store = resolveStore(storeName);
    if (!store) return storeNotFound(storeName);

    let start: string, end: string, label: string;
    if (weeks != null) {
      ({ start, end } = lastNWeeksRange(weeks));
      label = `Last ${weeks} week${weeks === 1 ? "" : "s"} (${start} to ${end})`;
    } else {
      const bounds = resolveToolDateRange({ rangeKey, startDate, endDate });
      if ("error" in bounds) return bounds;
      ({ start, end, label } = bounds);
    }

    const effectiveGranularity = granularity ?? (weeks != null ? "weekly" : "daily");
    const daily = await getDailyRowsForRange(store.storeId, start, end);
    const points =
      effectiveGranularity === "weekly"
        ? aggregateWeekly(daily)
        : daily.map(d => toTrendPoint(d.date, d.netSales, d.transactions, d.laborHours));

    return { store: store.name, range: label, metric: metric ?? "netSales", granularity: effectiveGranularity, points };
  },
});

export const dashboardTools = {
  listStores,
  getNetSales,
  getAllStoresNetSales,
  getLaborHours,
  getAvgOrderValue,
  getProductivity,
  getClockedIn,
  getFoodCostMetrics,
  getDriveThru,
  getHourlyMetrics,
  getSalesTrend,
};
