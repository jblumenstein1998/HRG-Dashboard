/**
 * HRG 4-4-5 Fiscal Calendar — FY2026
 * Periods run Monday–Sunday. Update PERIODS each fiscal year.
 */

export type FiscalPeriod = {
  period: number;   // P1–P12
  quarter: number;  // Q1–Q4
  start: string;    // YYYY-MM-DD (Monday)
  end: string;      // YYYY-MM-DD (Sunday)
  weeks: number;
};

export const FISCAL_YEAR_START = "2025-12-29"; // Dec 29, 2025

export const PERIODS: FiscalPeriod[] = [
  { period: 1,  quarter: 1, start: "2025-12-29", end: "2026-01-25", weeks: 4 },
  { period: 2,  quarter: 1, start: "2026-01-26", end: "2026-02-22", weeks: 4 },
  { period: 3,  quarter: 1, start: "2026-02-23", end: "2026-03-29", weeks: 5 },
  { period: 4,  quarter: 2, start: "2026-03-30", end: "2026-04-26", weeks: 4 },
  { period: 5,  quarter: 2, start: "2026-04-27", end: "2026-05-24", weeks: 4 },
  { period: 6,  quarter: 2, start: "2026-05-25", end: "2026-06-28", weeks: 5 },
  { period: 7,  quarter: 3, start: "2026-06-29", end: "2026-07-26", weeks: 4 },
  { period: 8,  quarter: 3, start: "2026-07-27", end: "2026-08-23", weeks: 4 },
  { period: 9,  quarter: 3, start: "2026-08-24", end: "2026-09-27", weeks: 5 },
  { period: 10, quarter: 4, start: "2026-09-28", end: "2026-10-25", weeks: 4 },
  { period: 11, quarter: 4, start: "2026-10-26", end: "2026-11-22", weeks: 4 },
  { period: 12, quarter: 4, start: "2026-11-23", end: "2027-01-03", weeks: 5 },
];

function toDate(s: string): Date {
  // Parse as local date (not UTC) to avoid timezone shift
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format a date as a Superset datetime string: YYYY-MM-DDTHH:MM:SS */
function fmtDT(d: Date, endOfDay = false): string {
  const base = fmt(d);
  return endOfDay ? `${base}T23:59:59` : `${base}T00:00:00`;
}

// HRG operates in Central time. Vercel servers run UTC, so we must derive
// the current date in America/Chicago rather than the server's local clock.
function today(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"));
}

/** Find the fiscal period containing a given date */
export function getPeriodForDate(date: Date): FiscalPeriod | null {
  for (const p of PERIODS) {
    if (date >= toDate(p.start) && date <= toDate(p.end)) return p;
  }
  return null;
}

/** Current fiscal period */
export function currentPeriod(): FiscalPeriod {
  return getPeriodForDate(today()) ?? PERIODS[PERIODS.length - 1];
}

/** All periods in the same quarter as the given period */
function periodsInQuarter(quarter: number): FiscalPeriod[] {
  return PERIODS.filter((p) => p.quarter === quarter);
}

/**
 * "MTD" = start of current fiscal period through today
 * Returns Superset range string: "YYYY-MM-DD : YYYY-MM-DD"
 */
export function getMtdRange(): { range: string; label: string } {
  const p = currentPeriod();
  return {
    range: `${fmtDT(toDate(p.start))} : now`,
    label: `P${p.period} · MTD`,
  };
}

/**
 * "Last month" = the prior completed fiscal period (full range)
 */
export function getLastPeriodRange(): { range: string; label: string } {
  const cur = currentPeriod();
  const prev = PERIODS.find((p) => p.period === cur.period - 1);
  if (!prev) return getMtdRange(); // fallback if P1
  return {
    range: `${fmtDT(toDate(prev.start))} : ${fmtDT(toDate(prev.end), true)}`,
    label: `P${prev.period} · Full`,
  };
}

/**
 * "QTD" = start of current fiscal quarter through today
 */
export function getQtdRange(): { range: string; label: string } {
  const cur = currentPeriod();
  const qPeriods = periodsInQuarter(cur.quarter);
  const firstInQ = qPeriods[0];
  return {
    range: `${fmtDT(toDate(firstInQ.start))} : now`,
    label: `Q${cur.quarter} · QTD`,
  };
}

/**
 * "YTD" = fiscal year start through today
 */
export function getYtdRange(): { range: string; label: string } {
  return {
    range: `${fmtDT(toDate(FISCAL_YEAR_START))} : now`,
    label: "FY2026 · YTD",
  };
}

/**
 * Full period range (start to end) for any period number
 */
export function getFullPeriodRange(periodNum: number): { range: string; label: string } | null {
  const p = PERIODS.find((x) => x.period === periodNum);
  if (!p) return null;
  return {
    range: `${fmtDT(toDate(p.start))} : ${fmtDT(toDate(p.end), true)}`,
    label: `P${p.period} · Full`,
  };
}

/**
 * "WTD" = Monday of the current week through today (weeks start Monday)
 */
export function getWtdRange(): { range: string; label: string } {
  const t = today();
  const day = t.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - diffToMonday);
  return {
    range: `${fmtDT(monday)} : now`,
    label: "Week to Date",
  };
}

/**
 * "Today" = current calendar day only.
 * Uses exclusive end (tomorrow 00:00:00) — the standard Superset convention
 * for single-day ranges, which avoids an empty result when start == end date.
 */
export function getTodayRange(): { range: string; label: string } {
  const t = today();
  return {
    range: `${fmtDT(t)} : now`,
    label: "Today",
  };
}

/**
 * "Yesterday" = the prior calendar day.
 * Uses exclusive end (today 00:00:00) for the same reason as getTodayRange.
 */
export function getYesterdayRange(): { range: string; label: string } {
  const t = today();
  const y = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
  return {
    range: `${fmtDT(y)} : ${fmtDT(t)}`,
    label: "Yesterday",
  };
}

/**
 * "Last Week" = the most recently completed Monday–Sunday week
 */
export function getLastWeekRange(): { range: string; label: string } {
  const t = today();
  const day = t.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  // Monday of the current week
  const thisMonday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - diffToMonday);
  // Last week: Mon 7 days prior through Sun 1 day prior
  const lastMonday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
  return {
    range: `${fmtDT(lastMonday)} : ${fmtDT(lastSunday, true)}`,
    label: "Last Week",
  };
}

export type RangeKey = "today" | "yesterday" | "wtd" | "last_week" | "mtd" | "last_period" | "qtd" | "ytd" | `p${number}`;

export function resolveRange(key: RangeKey): { range: string; label: string } {
  if (key === "today") return getTodayRange();
  if (key === "yesterday") return getYesterdayRange();
  if (key === "last_week") return getLastWeekRange();
  if (key === "wtd") return getWtdRange();
  if (key === "mtd") return getMtdRange();
  if (key === "last_period") return getLastPeriodRange();
  if (key === "qtd") return getQtdRange();
  if (key === "ytd") return getYtdRange();
  const match = key.match(/^p(\d+)$/);
  if (match) return getFullPeriodRange(Number(match[1])) ?? getMtdRange();
  return getMtdRange();
}

/**
 * Format a resolved range string ("YYYY-MM-DDTHH:MM:SS : YYYY-MM-DDTHH:MM:SS")
 * as a short human-readable label: "Apr 7 – Apr 12" or "Apr 12" for single-day.
 *
 * When the end is midnight (T00:00:00), it's an exclusive boundary — subtract
 * one day so "Apr 13T00:00:00 : Apr 14T00:00:00" displays as "Apr 13".
 */
export function formatRangeDates(range: string): string {
  const parts = range.split(" : ").map((s) => s.trim());
  if (parts.length !== 2) return range;

  const startStr = parts[0].split("T")[0];
  const endRaw = parts[1].trim();

  // "now" keyword — display as today's date
  const endStr = endRaw === "now"
    ? fmt(today())
    : (() => {
        const endDateStr = endRaw.split("T")[0];
        const endTime = endRaw.split("T")[1] ?? "";
        // Exclusive midnight end — back up one day for display
        if (endTime.startsWith("00:00:00")) {
          const [y, m, d] = endDateStr.split("-").map(Number);
          return fmt(new Date(y, m - 1, d - 1));
        }
        return endDateStr;
      })();

  const fmtDate = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  return startStr === endStr
    ? fmtDate(startStr)
    : `${fmtDate(startStr)} – ${fmtDate(endStr)}`;
}
