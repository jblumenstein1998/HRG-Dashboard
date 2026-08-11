/**
 * The period vocabulary for bonus attainment.
 *
 * Bonus is paid per fiscal period, so every score, every manual entry and every
 * lock is keyed by a period label. This module owns that label's format and the
 * date window it resolves to — one place, so a stored `bonus_inputs` row can
 * never end up under a label the scorer computes differently.
 *
 * Pure, no env reads, safe to import from a client component.
 *
 * **History horizon**: fiscal.ts defines FY2026 only, so bonus periods run P1
 * FY2026 (starting 2025-12-29) through the period in progress. That happens to
 * match the underlying data anyway — drive_thru_trend also starts at the fiscal
 * year boundary. Extending further back means adding FY2025 to fiscal.ts first.
 */

import { PERIODS, currentPeriod, type FiscalPeriod } from "../fiscal";

/** Fiscal year label, derived the same way driveThruTrend.ts derives its key prefix. */
export const FISCAL_YEAR = Number(PERIODS[0].end.slice(0, 4));

export function periodLabel(p: FiscalPeriod): string {
  return `P${p.period} FY${FISCAL_YEAR}`;
}

export function parsePeriodLabel(label: string): FiscalPeriod | null {
  const m = label.match(/^P(\d+) FY(\d{4})$/);
  if (!m || Number(m[2]) !== FISCAL_YEAR) return null;
  return PERIODS.find((p) => p.period === Number(m[1])) ?? null;
}

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Today in America/Chicago — Vercel runs UTC, so the server clock can't be trusted. */
function todayCentral(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"));
}

export type BonusWindow = {
  periodLabel: string;
  period: FiscalPeriod;
  start: string;
  /** Inclusive. Period end for a closed period, yesterday for the one in progress. */
  end: string;
  /** True while the period is still running — the score will keep moving. */
  isPartial: boolean;
  /** Human label for the header, e.g. "P7 FY2026 · period to date through 7/30". */
  label: string;
};

/**
 * Resolve a period label to the window actually scored.
 *
 * The open period is scored **through yesterday**, matching every other "to
 * date" range in the app (see the note in fiscal.ts on why they all stop short
 * of today: a partial day drags averages around on every reload, and a closed
 * window caches permanently). Returns null on the first day of a period, when
 * there is no completed day to score yet.
 */
export function resolveBonusWindow(label: string): BonusWindow | null {
  const period = parsePeriodLabel(label);
  if (!period) return null;

  const today = todayCentral();
  const periodEnd = toDate(period.end);
  const isPartial = periodEnd >= today;

  if (!isPartial) {
    return {
      periodLabel: label,
      period,
      start: period.start,
      end: period.end,
      isPartial: false,
      label: `${label} · full period`,
    };
  }

  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (yesterday < toDate(period.start)) return null;

  return {
    periodLabel: label,
    period,
    start: period.start,
    end: fmt(yesterday),
    isPartial: true,
    label: `${label} · through ${yesterday.getMonth() + 1}/${yesterday.getDate()}`,
  };
}

/**
 * Every period that has started, newest first — the period picker's options.
 * The one in progress leads the list, since period-to-date is what people check
 * day to day.
 */
export function listBonusPeriods(): { label: string; isPartial: boolean }[] {
  const cur = currentPeriod();
  return PERIODS.filter((p) => p.period <= cur.period)
    .sort((a, b) => b.period - a.period)
    .map((p) => ({ label: periodLabel(p), isPartial: p.period === cur.period }));
}

export function currentPeriodLabel(): string {
  return periodLabel(currentPeriod());
}

/** Monday–Sunday weeks inside a window, trimmed to the window's end. */
export function weeksIn(start: string, end: string): { start: string; end: string }[] {
  const last = toDate(end);
  const weeks: { start: string; end: string }[] = [];
  for (let cursor = toDate(start); cursor <= last; cursor.setDate(cursor.getDate() + 7)) {
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({ start: fmt(cursor), end: fmt(weekEnd > last ? last : weekEnd) });
  }
  return weeks;
}

/**
 * Whole Monday–Sunday weeks only.
 *
 * Weekly gates ("any week below 65%", "YoY growth every week", "≤4
 * pull-forwards per week") must not be judged on the partial week at the end of
 * a period-to-date window: three days of data would fail a weekly volume test
 * that the full week would pass, and the score would then *improve* on its own
 * as the week completed.
 */
export function completeWeeksIn(start: string, end: string): { start: string; end: string }[] {
  const last = toDate(end);
  return weeksIn(start, end).filter((w) => {
    const weekEnd = toDate(w.start);
    weekEnd.setDate(weekEnd.getDate() + 6);
    return weekEnd <= last;
  });
}
