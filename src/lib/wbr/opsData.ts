/**
 * Food cost and drive-thru numbers for the district-style WBR, per store, for
 * the deck's week and for the fiscal period to date.
 *
 * Same calls the dashboard tabs make: Net-Chef's fetchLocationReport (the Food
 * Cost tab's COGS and Variance tables) and Berry's getDriveThruMetrics (the
 * Drive-Thru tab's location cards). District totals are weighted the way those
 * tabs weight theirs — food cost by Net-Chef's own sales base, drive-thru times
 * by cars.
 */

import { fetchLocationReport, type LocationReport } from "@/lib/netchef";
import { getDriveThruMetrics } from "@/lib/berryData";
import { getBerryAuth } from "@/lib/auth";
import { parseMMSS, type StoreMetrics } from "@/lib/berry";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import { getPeriodForDate } from "@/lib/fiscal";
import { getNetSalesForRange } from "@/lib/parRollup";
import type { WbrWeek } from "@/lib/wbr/data";

export type Span = { start: string; end: string; label: string };

export type FoodCost = {
  cogsPct: number | null;
  cogsDollars: number | null;
  variancePct: number | null;
  varianceDollars: number | null;
  /** Net-Chef's sales figure — the base its percentages are computed on. */
  salesBase: number | null;
};

export type DriveThru = {
  laneSecs: number | null;
  windowSecs: number | null;
  cars: number | null;
  flagged: number | null;
  peakLaneSecs: number | null;
  nonPeakLaneSecs: number | null;
  peakWindowSecs: number | null;
  nonPeakWindowSecs: number | null;
  /** Weekly-equivalent PAR sales — picks the goal tier, as on the Drive-Thru tab. */
  tierSales: number | null;
};

export type StoreOps = {
  label: string;
  food: { week: FoodCost; ptd: FoodCost; priorWeekVariancePct: number | null };
  drive: { week: DriveThru | null; ptd: DriveThru | null };
};

export type OpsData = {
  week: Span;
  ptd: Span;
  /** Keyed by store label. */
  stores: Map<string, StoreOps>;
  /** Anything that came back empty — surfaced as generation warnings. */
  gaps: string[];
};

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

const food = (r: LocationReport): FoodCost => ({
  cogsPct: r.actualCostPct,
  cogsDollars: r.actualCostDollars,
  variancePct: r.variancePct,
  varianceDollars: r.varianceDollars,
  salesBase: r.salesBase,
});

function drive(m: StoreMetrics | undefined, tierSales: number | null): DriveThru | null {
  // A row with no cars is a store Berry lists but doesn't measure yet (Portland
  // came back as a 0:00 lane) — no data, not a perfect time.
  if (!m || !m.overall.total_cars) return null;
  return {
    laneSecs: parseMMSS(m.overall.lane_total),
    windowSecs: parseMMSS(m.overall.window_service),
    cars: m.overall.total_cars,
    flagged: m.overall.flagged_pull_forward,
    peakLaneSecs: parseMMSS(m.peak.lane_total),
    nonPeakLaneSecs: parseMMSS(m.nonpeak.lane_total),
    peakWindowSecs: parseMMSS(m.peak.window_service),
    nonPeakWindowSecs: parseMMSS(m.nonpeak.window_service),
    tierSales,
  };
}

const supersetRange = (s: Span) => `${s.start}T00:00:00 : ${s.end}T23:59:59`;

export async function buildOpsData(wk: WbrWeek, labels: string[]): Promise<OpsData> {
  const period = getPeriodForDate(new Date(wk.week.end + "T12:00:00"));
  const week: Span = { start: wk.week.start, end: wk.week.end, label: `Week ${md(wk.week.start)}–${md(wk.week.end)}` };
  const ptd: Span = period
    ? { start: period.start, end: wk.week.end, label: `P${period.period} to date ${md(period.start)}–${md(wk.week.end)}` }
    : week;
  const ptdWeeks = Math.max(1, Math.round((Date.parse(ptd.end) - Date.parse(ptd.start)) / 86_400_000 + 1) / 7);
  const prior = { start: shift(wk.week.start, -7), end: shift(wk.week.end, -7) };

  const stores = BONUS_STORES.filter(s => labels.includes(s.name));
  const gaps: string[] = [];

  const { token } = await getBerryAuth();
  const [weekDrive, ptdDrive] = await Promise.all([
    getDriveThruMetrics(token, supersetRange(week), week.label).catch(err => {
      gaps.push(`Drive-thru for ${week.label} unavailable: ${err instanceof Error ? err.message : err}`);
      return null;
    }),
    getDriveThruMetrics(token, supersetRange(ptd), ptd.label).catch(err => {
      gaps.push(`Drive-thru for ${ptd.label} unavailable: ${err instanceof Error ? err.message : err}`);
      return null;
    }),
  ]);

  const out = new Map<string, StoreOps>();
  await Promise.all(
    stores.map(async s => {
      const [w, p, pw, weekSales, ptdSales] = await Promise.all([
        fetchLocationReport(s.netchefLocationId, week.start, week.end),
        fetchLocationReport(s.netchefLocationId, ptd.start, ptd.end),
        fetchLocationReport(s.netchefLocationId, prior.start, prior.end),
        getNetSalesForRange(s.storeId, week.start, week.end),
        getNetSalesForRange(s.storeId, ptd.start, ptd.end),
      ]);
      if (w.actualCostPct === null) gaps.push(`${s.name}: no Net-Chef food cost for ${week.label}.`);
      const find = (stores?: StoreMetrics[]) => stores?.find(m => m.store_name_and_id.includes(s.storeId));
      out.set(s.name, {
        label: s.name,
        food: { week: food(w), ptd: food(p), priorWeekVariancePct: pw.variancePct },
        drive: {
          week: drive(find(weekDrive?.stores), weekSales),
          ptd: drive(find(ptdDrive?.stores), ptdSales / ptdWeeks),
        },
      });
    }),
  );

  return { week, ptd, stores: out, gaps };
}

// ── District roll-ups ────────────────────────────────────────────────────────

/** Food cost across stores, weighted by Net-Chef's sales base like the Food Cost tab's total row. */
export function totalFood(list: FoodCost[]): FoodCost {
  const ok = list.filter(f => f.salesBase && f.salesBase > 0);
  const base = ok.reduce((s, f) => s + f.salesBase!, 0);
  const sum = (k: "cogsDollars" | "varianceDollars") => ok.reduce((s, f) => s + (f[k] ?? 0), 0);
  const wpct = (k: "cogsPct" | "variancePct") =>
    base ? ok.reduce((s, f) => s + (f[k] ?? 0) * f.salesBase!, 0) / base : null;
  return {
    cogsPct: wpct("cogsPct"),
    cogsDollars: ok.length ? sum("cogsDollars") : null,
    variancePct: wpct("variancePct"),
    varianceDollars: ok.length ? sum("varianceDollars") : null,
    salesBase: base || null,
  };
}

/** Drive-thru across stores: times weighted by cars, counts summed. */
export function totalDrive(list: (DriveThru | null)[]): DriveThru | null {
  const ok = list.filter((d): d is DriveThru => !!d && !!d.cars);
  if (!ok.length) return null;
  const cars = ok.reduce((s, d) => s + d.cars!, 0);
  const w = (k: keyof DriveThru) => {
    const have = ok.filter(d => d[k] != null);
    const c = have.reduce((s, d) => s + d.cars!, 0);
    return c ? have.reduce((s, d) => s + (d[k] as number) * d.cars!, 0) / c : null;
  };
  return {
    laneSecs: w("laneSecs"),
    windowSecs: w("windowSecs"),
    cars,
    flagged: ok.reduce((s, d) => s + (d.flagged ?? 0), 0),
    peakLaneSecs: w("peakLaneSecs"),
    nonPeakLaneSecs: w("nonPeakLaneSecs"),
    peakWindowSecs: w("peakWindowSecs"),
    nonPeakWindowSecs: w("nonPeakWindowSecs"),
    tierSales: null,
  };
}
