import { resolveRange, type RangeKey } from "@/lib/fiscal";

export function todayCentralISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Resolves a fiscal RangeKey ("ytd", "p4", "last_week", ...) to plain
 * YYYY-MM-DD start/end dates (inclusive both ends), suitable for SQL BETWEEN
 * or netchef's startDate/endDate params — as opposed to fiscal.ts's own
 * `range` string, which carries Superset-style timestamps and an exclusive
 * midnight end for short ranges (today/yesterday/last_week).
 */
export function resolveDateBounds(key: RangeKey): { start: string; end: string; label: string } {
  const { range, label } = resolveRange(key);
  const [startRaw, endRaw] = range.split(" : ").map(s => s.trim());
  const start = startRaw.split("T")[0];

  if (endRaw === "now") return { start, end: todayCentralISO(), label };

  const endDateStr = endRaw.split("T")[0];
  const endTime = endRaw.split("T")[1] ?? "";
  // Exclusive midnight boundary (today/yesterday/last_week) — back up one day.
  const end = endTime.startsWith("00:00:00") ? dayBefore(endDateStr) : endDateStr;
  return { start, end, label };
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolves a tool's date-range input, which may be either a preset fiscal
 * `rangeKey` or an explicit `startDate`/`endDate` pair (YYYY-MM-DD, inclusive
 * both ends) — so callers aren't limited to the preset ranges when the user
 * asks for an arbitrary window like "7/13-7/19".
 */
export function resolveToolDateRange(input: {
  rangeKey?: string;
  startDate?: string;
  endDate?: string;
}): { start: string; end: string; label: string } | { error: string } {
  if (input.startDate || input.endDate) {
    if (!input.startDate || !input.endDate) {
      return { error: "Both startDate and endDate are required when specifying a custom range." };
    }
    if (!ISO_DATE_RE.test(input.startDate) || !ISO_DATE_RE.test(input.endDate)) {
      return { error: "startDate and endDate must be in YYYY-MM-DD format." };
    }
    if (input.startDate > input.endDate) {
      return { error: "startDate must not be after endDate." };
    }
    return { start: input.startDate, end: input.endDate, label: `${input.startDate} – ${input.endDate}` };
  }
  if (input.rangeKey) return resolveDateBounds(input.rangeKey as RangeKey);
  return { error: "Either rangeKey or startDate/endDate must be provided." };
}

/**
 * Same rangeKey/startDate/endDate input as resolveToolDateRange, but resolves
 * to a Superset-format `time_range` string ("YYYY-MM-DDTHH:MM:SS : YYYY-MM-DDTHH:MM:SS")
 * instead of plain dates — for BerryAI/Superset-backed tools (drive-thru),
 * which filter on that format directly rather than SQL date columns.
 */
export function resolveSupersetTimeRange(input: {
  rangeKey?: string;
  startDate?: string;
  endDate?: string;
}): { timeRange: string; label: string } | { error: string } {
  if (input.startDate || input.endDate) {
    if (!input.startDate || !input.endDate) {
      return { error: "Both startDate and endDate are required when specifying a custom range." };
    }
    if (!ISO_DATE_RE.test(input.startDate) || !ISO_DATE_RE.test(input.endDate)) {
      return { error: "startDate and endDate must be in YYYY-MM-DD format." };
    }
    if (input.startDate > input.endDate) {
      return { error: "startDate must not be after endDate." };
    }
    return {
      timeRange: `${input.startDate}T00:00:00 : ${input.endDate}T23:59:59`,
      label: `${input.startDate} – ${input.endDate}`,
    };
  }
  if (input.rangeKey) {
    const { range, label } = resolveRange(input.rangeKey as RangeKey);
    return { timeRange: range, label };
  }
  return { error: "Either rangeKey or startDate/endDate must be provided." };
}
