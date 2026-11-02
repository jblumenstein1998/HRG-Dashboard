/**
 * The numbers behind the single-store deck: one store, one Mon–Sun week, with
 * eight weeks of history behind it and the same week a year ago beside it.
 *
 * Like lib/wbr/data.ts, nothing here invents a metric: daily rows come from
 * getDailyRowsForRange (the POS Sales tab's source), weekly SPLH/TPLH from
 * lib/parWeekly, food cost and drive-thru from buildOpsData (the Food Cost and
 * Drive-Thru tabs' calls). A slide can only show a number the dashboard would.
 */

import { PAR_LOCATIONS } from "@/lib/par";
import { getDailyRowsForRange, type PARDailyRow } from "@/lib/parRollup";
import { getPriorYearDate, getPriorYearRange } from "@/lib/fiscal";
import { bucketDaily, lastNWeeks, productivityOf, tplhOf, type Week } from "@/lib/parWeekly";
import { listLeaders } from "@/lib/users/leaders";
import { ALL_STORES } from "@/lib/stores";
import { WBR_TARGETS, type StoreTargets } from "@/lib/wbr/targets";
import { districtLeaders } from "@/lib/wbr/data";
import { buildOpsData, type OpsData, type StoreOps } from "@/lib/wbr/opsData";

/** Weeks of history on the trend charts, the deck's week included. */
export const STORE_TREND_WEEKS = 8;

export type WeekFigures = {
  week: Week;
  netSales: number;
  transactions: number;
  avgCheck: number | null;
  laborHours: number;
  splh: number | null;
  tplh: number | null;
  /** Same week last year; null when the store didn't trade all seven days of it. */
  py: { netSales: number; transactions: number; avgCheck: number | null } | null;
};

export type DayFigures = {
  date: string;
  /** This week's day; null when PAR has no row for it. */
  now: PARDailyRow | null;
  /** Same weekday, prior week. */
  prior: PARDailyRow | null;
  /** The fiscal prior-year date the POS tab compares this day with. */
  py: PARDailyRow | null;
};

export type StoreDeckData = {
  label: string;
  storeId: string;
  market: string;
  /** The district manager(s) whose stores include this one. */
  leaders: string[];
  week: Week;
  /** Oldest → newest; the last entry is the deck's week. */
  weeks: WeekFigures[];
  days: DayFigures[];
  targets: StoreTargets | null;
  ops: StoreOps | null;
  opsSpans: Pick<OpsData, "week" | "ptd">;
  warnings: string[];
};

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Store labels a deck can be built for — PAR-connected stores, in the tabs' order. */
export function storeDeckOptions(): { label: string; section: string }[] {
  const par = new Set(PAR_LOCATIONS.map((l) => l.name));
  return ALL_STORES.filter((s) => par.has(s.label)).map((s) => ({ label: s.label, section: s.section }));
}

export async function buildStoreDeck(label: string, weekEnd?: string): Promise<StoreDeckData> {
  const loc = PAR_LOCATIONS.find((l) => l.name === label);
  if (!loc) throw new Error(`${label} isn't connected to PAR.`);
  const store = ALL_STORES.find((s) => s.label === label);

  const weeks = lastNWeeks(STORE_TREND_WEEKS, weekEnd);
  const week = weeks[weeks.length - 1];
  const pyWeeks = weeks.map((w) => getPriorYearRange(w.start, w.end));

  const [daily, pyDaily, leaders, ops] = await Promise.all([
    // From a week before the trend starts, for the first week's prior-week days.
    getDailyRowsForRange(loc.storeId, shift(weeks[0].start, -7), week.end),
    getDailyRowsForRange(loc.storeId, pyWeeks[0].start, pyWeeks[pyWeeks.length - 1].end),
    listLeaders(),
    buildOpsData({ week }, [label]),
  ]);

  const buckets = bucketDaily(daily, weeks);
  const pyBuckets = bucketDaily(pyDaily, pyWeeks);
  const pyDays = (r: { start: string; end: string }) => pyDaily.filter((d) => d.date >= r.start && d.date <= r.end && d.netSales > 0).length;

  const weekFigures: WeekFigures[] = weeks.map((w, i) => {
    const b = buckets[i];
    const p = pyBuckets[i];
    return {
      week: w,
      netSales: b.netSales,
      transactions: b.transactions,
      avgCheck: b.transactions > 0 ? b.netSales / b.transactions : null,
      laborHours: b.laborHours,
      splh: productivityOf(b),
      tplh: tplhOf(b),
      // A prior-year week only counts when every day of it rang sales — a store
      // that opened mid-week last year would otherwise post a huge fake YoY.
      py: pyDays(pyWeeks[i]) === 7 ? { netSales: p.netSales, transactions: p.transactions, avgCheck: p.transactions > 0 ? p.netSales / p.transactions : null } : null,
    };
  });

  const byDate = new Map(daily.map((d) => [d.date, d]));
  const pyByDate = new Map(pyDaily.map((d) => [d.date, d]));
  const days: DayFigures[] = Array.from({ length: 7 }, (_, i) => {
    const date = shift(week.start, i);
    return {
      date,
      now: byDate.get(date) ?? null,
      prior: byDate.get(shift(date, -7)) ?? null,
      py: pyByDate.get(getPriorYearDate(date)) ?? null,
    };
  });

  const warnings = [...ops.gaps];
  const missing = days.filter((d) => !d.now).map((d) => d.date);
  if (missing.length) warnings.push(`${label}: no PAR data for ${missing.join(", ")} — the week's numbers are short.`);
  const targets = WBR_TARGETS[label] ?? null;
  if (!targets) warnings.push(`${label}: no productivity target set (lib/wbr/targets.ts).`);

  return {
    label,
    storeId: loc.storeId,
    market: (store?.section ?? "").toUpperCase(),
    leaders: districtLeaders(leaders).filter((l) => l.stores.includes(label)).map((l) => l.name),
    week,
    weeks: weekFigures,
    days,
    targets,
    ops: ops.stores.get(label) ?? null,
    opsSpans: { week: ops.week, ptd: ops.ptd },
    warnings,
  };
}
