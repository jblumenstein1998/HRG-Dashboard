/**
 * Turns four vendors into the flat bag of numbers the engine scores.
 *
 * This is where all the time-shaped work in the bonus docs happens, so the
 * engine never has to know what a week is. "Any week with <65% accuracy"
 * becomes a single `smgAccuracyMinWeekly`; "more than 5 days missing the target
 * goals for the day" becomes `dtDaysMissingTarget`; "YOY transaction growth in
 * every week of the period" becomes `txnAllWeeksGrew`, which is 1 or 0.
 *
 * Everything is resolved for **all twelve stores at once**, because every
 * source except PAR is naturally multi-store: one SMG query, one drive-thru
 * trend read and one netchef_costs read cover the whole company. Scoring stores
 * one at a time would multiply the vendor traffic by twelve for no gain.
 *
 * ── Weekly gates use complete weeks only ─────────────────────────────────────
 *
 * Period-to-date windows end mid-week. A three-day stub judged against a weekly
 * gate fails tests the full week would pass — and worse, the score would then
 * *improve on its own* as the week finished, which makes a bonus number that
 * moves for no visible reason. `completeWeeksIn` drops the stub.
 */

import { FISCAL_YEAR_START, getPriorYearRange } from "../fiscal";
import { getDailyRowsForRange } from "../parRollup";
import { getTrend, getDailyTrend, type TrendPoint, type TrendStorePoint } from "../driveThruTrend";
import { queryScores } from "../smgStore";
import { getPeriodCosts } from "../netchefRollup";
import { BONUS_STORES } from "./storeMap";
import { completeWeeksIn, FISCAL_YEAR, type BonusWindow } from "./periods";
import { rollupByStore } from "@/lib/smgCaseStore";
import { BONUS_ZCASE_TYPES } from "./goals";
import { BONUS_RULES } from "./rules";
import { passesGate, resolveGates, type MetricValues } from "./engine";
import type { Condition } from "./types";

// ── Label / key mapping ──────────────────────────────────────────────────────

/**
 * SMG's own period and week numbering matches fiscal.ts exactly — verified
 * empirically against P6 FY2026's dates. The trap to avoid is comparing SMG's
 * "Current Period" quick-date (the period in progress) against its period list
 * (completed periods only) and concluding they disagree.
 */
const smgPeriodLabel = (n: number) => `Period ${n}, ${FISCAL_YEAR}`;
const smgWeekLabel = (n: number) => `Week ${n}, ${FISCAL_YEAR}`;

/** drive_thru_trend bucket keys, e.g. "26-P07" and "26-W29". */
const yy = String(FISCAL_YEAR).slice(2);
const dtPeriodKey = (n: number) => `${yy}-P${String(n).padStart(2, "0")}`;
const dtWeekKey = (n: number) => `${yy}-W${String(n).padStart(2, "0")}`;

/**
 * Fiscal week number for a Monday, counting from the fiscal year start.
 * Both SMG and the drive-thru trend number weeks this way.
 */
function fiscalWeekNumber(mondayISO: string, fyStartISO: string): number {
  const d = (s: string) => {
    const [y, m, day] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((d(mondayISO) - d(fyStartISO)) / (7 * 86400000)) + 1;
}

/**
 * Pull the PAR store id out of a drive-thru trend store key.
 *
 * Keys look like "Hampton - Hampton_57002". Matching on the name would be a
 * trap: BerryAI calls the College store "Suffolk", and SMG has two stores named
 * NEWPORTNEWS and two named CHESAPEAKE. The trailing id is the only safe join.
 */
function storeIdFromTrendKey(key: string): string | null {
  return key.match(/_(\d+)\s*$/)?.[1] ?? null;
}

function byStoreId(point: TrendPoint | undefined): Map<string, TrendStorePoint> {
  const out = new Map<string, TrendStorePoint>();
  if (!point) return out;
  for (const [key, value] of Object.entries(point.stores)) {
    const id = storeIdFromTrendKey(key);
    if (id) out.set(id, value);
  }
  return out;
}

// ── Small numeric helpers ────────────────────────────────────────────────────

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const minOf = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const maxOf = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

function put(values: MetricValues, key: string, value: number | null | undefined): void {
  // Absent means "not known"; the engine reports that as pending rather than as
  // a failing zero, so a null must never be written as 0 here.
  if (value === null || value === undefined || Number.isNaN(value)) return;
  values.set(key, value);
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export type ResolveDiagnostics = {
  weeks: number;
  smgPeriodRows: number;
  smgWeeklyRows: number;
  dailyDriveThruDays: number;
  storesWithCost: number;
  /** ZCases found in the window, estate-wide. Zero means missing data. */
  zcases: number;
  warnings: string[];
};

/**
 * Every automatic metric for every store, for one period window.
 *
 * `berryToken` is optional: without it the drive-thru sources are skipped and
 * those criteria come back pending rather than wrong. That keeps the whole
 * scorecard from failing when a Superset session can't be established.
 */
export async function resolvePeriodMetrics(
  window: BonusWindow,
  berryToken: string | null
): Promise<{ byStore: Map<string, MetricValues>; diagnostics: ResolveDiagnostics }> {
  const warnings: string[] = [];
  const weeks = completeWeeksIn(window.start, window.end);
  // Week numbers count from the fiscal year start, not the period start — both
  // SMG and the drive-thru trend number them that way.
  const weekNumbers = weeks.map((w) => fiscalWeekNumber(w.start, FISCAL_YEAR_START));

  const byStore = new Map<string, MetricValues>();
  for (const s of BONUS_STORES) byStore.set(s.storeId, new Map());
  const vals = (id: string) => byStore.get(id) as MetricValues;

  // ── SMG ────────────────────────────────────────────────────────────────────
  const SMG_METRICS = [
    "Overall Satisfaction",
    "Accuracy of Order",
    "Friendliness of Team Members",
    "Cleanliness",
  ];
  const METRIC_KEY: Record<string, string> = {
    "Overall Satisfaction": "smgOsat",
    "Accuracy of Order": "smgAccuracy",
    "Friendliness of Team Members": "smgFriendliness",
    "Cleanliness": "smgCleanliness",
  };

  const storeIds = BONUS_STORES.map((s) => s.storeId);
  const [smgPeriod, smgWeekly] = await Promise.all([
    queryScores({ level: "store", periodType: "period", units: storeIds, metrics: SMG_METRICS, limit: 40 }),
    queryScores({ level: "store", periodType: "weekly", units: storeIds, metrics: SMG_METRICS, limit: 160 }),
  ]);

  const wantPeriod = smgPeriodLabel(window.period.period);
  const periodRows = smgPeriod.filter((r) => r.periodLabel === wantPeriod);
  if (periodRows.length === 0) {
    warnings.push(`No SMG period scores stored for ${wantPeriod}`);
  }
  for (const row of periodRows) {
    const key = METRIC_KEY[row.metric];
    const v = vals(row.unitKey);
    if (!key || !v) continue;
    put(v, key, row.score);
    // The docs' "response rate" is SMG's response count, taken from OSAT — the
    // one metric every respondent answers.
    if (row.metric === "Overall Satisfaction") put(v, "smgResponses", row.responses);
  }

  const wantWeeks = new Set(weekNumbers.map(smgWeekLabel));
  const weeklyRows = smgWeekly.filter((r) => wantWeeks.has(r.periodLabel));
  const weeklyByStore = new Map<string, Map<string, number[]>>();
  for (const row of weeklyRows) {
    if (row.score === null) continue;
    const key = METRIC_KEY[row.metric];
    if (!key) continue;
    let m = weeklyByStore.get(row.unitKey);
    if (!m) {
      m = new Map();
      weeklyByStore.set(row.unitKey, m);
    }
    m.set(key, [...(m.get(key) ?? []), row.score]);
  }
  for (const [storeId, metrics] of weeklyByStore) {
    const v = vals(storeId);
    if (!v) continue;
    for (const [key, scores] of metrics) put(v, `${key}MinWeekly`, minOf(scores));
  }

  // ── Net-Chef ───────────────────────────────────────────────────────────────
  const costs = await getPeriodCosts(window.periodLabel);
  if (costs.size === 0) warnings.push(`No stored food cost for ${window.periodLabel}`);
  for (const [storeId, cost] of costs) {
    const v = vals(storeId);
    if (!v) continue;
    put(v, "cogsPct", cost.cogsPct);
    // The doc's bands are symmetric (±1.5% / ±1%), so the sign is discarded.
    put(v, "varianceAbsPct", cost.variancePct === null ? null : Math.abs(cost.variancePct));
  }

  // ── PAR: sales, labour, transactions, YoY ──────────────────────────────────
  const prior = getPriorYearRange(window.start, window.end);
  await Promise.all(
    BONUS_STORES.map(async (store) => {
      const v = vals(store.storeId);
      const [rows, priorRows] = await Promise.all([
        getDailyRowsForRange(store.storeId, window.start, window.end),
        getDailyRowsForRange(store.storeId, prior.start, prior.end),
      ]);
      if (rows.length === 0) return;

      const byDate = new Map(rows.map((r) => [r.date, r]));
      const priorByDate = new Map(priorRows.map((r) => [r.date, r]));

      const netSales = rows.reduce((s, r) => s + r.netSales, 0);
      const transactions = rows.reduce((s, r) => s + r.transactions, 0);
      const laborHours = rows.reduce((s, r) => s + r.laborHours, 0);

      if (laborHours > 0) {
        put(v, "splh", netSales / laborHours);
        put(v, "tplh", transactions / laborHours);
      }

      // Weekly-equivalent sales drives every sales-tiered gate. Averaging the
      // complete weeks matches how the Drive-Thru tab already tiers stores
      // (salesTierData.ts); falling back to a day-rate keeps the first week of
      // a period from tiering every store as if it were tiny.
      const weekSales = weeks.map((w) =>
        sumBetween(byDate, w.start, w.end, (r) => r.netSales)
      );
      const weekly = mean(weekSales.filter((n) => n > 0));
      put(v, "weeklyEquivalentSales", weekly ?? (netSales / rows.length) * 7);

      // The kicker: growth in EVERY complete week, or nothing.
      if (weeks.length > 0 && priorRows.length > 0) {
        const grew = weeks.every((w) => {
          const py = getPriorYearRange(w.start, w.end);
          const now = sumBetween(byDate, w.start, w.end, (r) => r.transactions);
          const then = sumBetween(priorByDate, py.start, py.end, (r) => r.transactions);
          return then > 0 && now > then;
        });
        put(v, "txnAllWeeksGrew", grew ? 1 : 0);
      }
    })
  );

  // ── Drive-thru ─────────────────────────────────────────────────────────────
  let dailyDays = 0;
  if (!berryToken) {
    warnings.push("No BerryAI token — drive-thru criteria left pending");
  } else {
    try {
      const [periodTrend, weekTrend, dailyTrend] = await Promise.all([
        getTrend(berryToken, "period"),
        getTrend(berryToken, "week"),
        getDailyTrend(berryToken, window.start, window.end),
      ]);
      dailyDays = dailyTrend.length;

      const periodPoint = byStoreId(periodTrend.find((p) => p.bucketKey === dtPeriodKey(window.period.period)));
      for (const [storeId, point] of periodPoint) {
        const v = vals(storeId);
        if (!v) continue;
        put(v, "dtWindowSecs", point.window_service_secs);
        put(v, "dtTotalSecs", point.lane_total_secs);
      }

      const wantWeekKeys = new Set(weekNumbers.map(dtWeekKey));
      const pullForwards = new Map<string, number[]>();
      for (const point of weekTrend.filter((p) => wantWeekKeys.has(p.bucketKey))) {
        for (const [storeId, sp] of byStoreId(point)) {
          if (sp.flagged_pull_forward === null) continue;
          pullForwards.set(storeId, [...(pullForwards.get(storeId) ?? []), sp.flagged_pull_forward]);
        }
      }
      for (const [storeId, counts] of pullForwards) {
        const v = vals(storeId);
        if (v) put(v, "dtMaxWeeklyPullForwards", maxOf(counts));
      }

      countDaysMissingTarget(dailyTrend, byStore);
    } catch (err) {
      warnings.push(`Drive-thru fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── ZCases ─────────────────────────────────────────────────────────────────
  //
  // The same two guest-facing types and the same event-date window the SMG tab
  // reports on, so a manager checking the tab sees the number their scorecard
  // was built from. The team-member hotline is excluded, as it is there.
  let zcaseRows = 0;
  try {
    const rollup = await rollupByStore({
      start: window.start,
      end: window.end,
      types: [...BONUS_ZCASE_TYPES],
    });
    zcaseRows = rollup.reduce((n, r) => n + r.cases, 0);

    if (zcaseRows === 0) {
      // Zero ZCases estate-wide is not a perfect period, it's an empty table —
      // the norm is dozens per period. Left pending rather than scored, because
      // defaulting to "no complaints" would hand every store full marks on
      // missing data, which is precisely the failure the cached-metric guards
      // elsewhere in this file exist to prevent.
      warnings.push(
        `No ZCases stored for ${window.periodLabel} — Guest Recovery left pending rather than scored as zero`,
      );
    } else {
      const byStoreId = new Map(rollup.map((r) => [r.store ?? "", r]));

      for (const store of BONUS_STORES) {
        const v = vals(store.storeId);
        if (!v) continue;
        const row = byStoreId.get(store.storeId);

        // A store with no ZCases has to be an explicit 0, not an absent value:
        // the engine reads `undefined` as pending, which would leave the whole
        // category unscored for exactly the stores that did best.
        put(v, "hosp_zcase_count", row?.cases ?? 0);

        // The doc asks for "% resolved within 24 hrs"; the store reports the
        // complement. No cases means nothing was left unresolved, which scores
        // as 100 rather than as a 0/0 that would read like a total failure.
        put(v, "hosp_zcase_resolution", row?.over24Pct == null ? 100 : 100 - row.over24Pct);
      }
    }
  } catch (err) {
    warnings.push(`ZCase fetch failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  return {
    byStore,
    diagnostics: {
      weeks: weeks.length,
      smgPeriodRows: periodRows.length,
      smgWeeklyRows: weeklyRows.length,
      dailyDriveThruDays: dailyDays,
      storesWithCost: costs.size,
      zcases: zcaseRows,
      warnings,
    },
  };
}

function sumBetween<T extends { date: string }>(
  byDate: Map<string, T>,
  start: string,
  end: string,
  pick: (row: T) => number
): number {
  let total = 0;
  for (const [date, row] of byDate) {
    if (date >= start && date <= end) total += pick(row);
  }
  return total;
}

/**
 * Count the days that missed the Drive-Thru Director's daily target.
 *
 * The doc's disqualifier is "> 5 days in a pay-period missing the target goals
 * for the day", where "the target goals" are the same sales-tiered window and
 * total-time targets the SOS category scores on. Rather than restate those
 * numbers here — and risk them drifting apart from rules.ts — this reads the
 * actual conditions and reuses the engine's own tier resolution, so a change to
 * one target changes both tests at once.
 *
 * A day with no drive-thru data isn't counted as a miss: the store may have
 * been closed, and inventing failures out of absent rows would zero the
 * category for a data gap.
 */
function countDaysMissingTarget(
  dailyTrend: TrendPoint[],
  byStore: Map<string, MetricValues>
): void {
  const sos = BONUS_RULES.driveThru.categories.find((c) => c.id === "sos");
  const windowCondition = sos?.conditions.find((c) => c.id === "dt_window_time");
  const totalCondition = sos?.conditions.find((c) => c.id === "dt_total_time");
  if (!windowCondition || !totalCondition) return;

  const missed = new Map<string, number>();
  const seen = new Set<string>();

  for (const day of dailyTrend) {
    for (const [storeId, point] of byStoreId(day)) {
      const values = byStore.get(storeId);
      if (!values) continue;
      const checks: [Condition, number | null][] = [
        [windowCondition, point.window_service_secs],
        [totalCondition, point.lane_total_secs],
      ];
      const measured = checks.filter(([, v]) => v !== null);
      if (measured.length === 0) continue;

      seen.add(storeId);
      const failed = measured.some(([condition, value]) =>
        !passesGate(value as number, resolveGates(condition, values).target)
      );
      if (failed) missed.set(storeId, (missed.get(storeId) ?? 0) + 1);
    }
  }

  for (const storeId of seen) {
    byStore.get(storeId)?.set("dtDaysMissingTarget", missed.get(storeId) ?? 0);
  }
}
