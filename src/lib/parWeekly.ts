import type { PARDailyRow } from "@/lib/parRollup";

/**
 * Week bucketing and the per-bucket productivity math, shared by the PAR tab
 * and the Weekly Business Review deck so the two can never disagree about what
 * a store's SPLH or TPLH was. Pure — no fetching, safe in client and server.
 */

export type Week = { start: string; end: string; label: string };
export type Bucket = { netSales: number; transactions: number; laborHours: number };

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}
function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}

// Mon–Sun business week, matching FoodCostClient's lastCompletedWeekEndDate convention:
// most recent Sunday on/before today (if today IS Sunday, that week counts as "completed").
function mostRecentSunday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

/**
 * The n Mon–Sun weeks ending on `lastSunday` (default: the most recent
 * completed one), oldest first.
 */
export function lastNWeeks(n: number, lastSunday?: string): Week[] {
  // Local midnight either way, so the setDate() arithmetic below behaves the same
  // for an explicit Sunday as for the computed one.
  const lastSun = lastSunday ? new Date(lastSunday + "T00:00:00") : mostRecentSunday();
  const weeks: Week[] = [];
  for (let i = 0; i < n; i++) {
    const end = new Date(lastSun);
    end.setDate(lastSun.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    weeks.push({ start: toISO(start), end: toISO(end), label: `${fmtDate(toISO(start))}–${fmtDate(toISO(end))}` });
  }
  return weeks.reverse();
}

/** Sums daily rows into one bucket per range; days outside every range are ignored. */
export function bucketDaily(daily: PARDailyRow[], ranges: { start: string; end: string }[]): Bucket[] {
  const buckets: Bucket[] = ranges.map(() => ({ netSales: 0, transactions: 0, laborHours: 0 }));
  for (const day of daily) {
    const idx = ranges.findIndex(r => day.date >= r.start && day.date <= r.end);
    if (idx === -1) continue;
    buckets[idx].netSales += day.netSales;
    buckets[idx].transactions += day.transactions;
    buckets[idx].laborHours += day.laborHours;
  }
  return buckets;
}

/** Sales per labor hour ("Productivity"), or null when no labor was recorded. */
export const productivityOf = (b: Bucket): number | null => (b.laborHours > 0 ? b.netSales / b.laborHours : null);

/** Transactions per labor hour, or null when no labor was recorded. */
export const tplhOf = (b: Bucket): number | null => (b.laborHours > 0 ? b.transactions / b.laborHours : null);
