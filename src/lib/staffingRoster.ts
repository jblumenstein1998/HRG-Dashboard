/**
 * Who was on the clock at a minute, from one store's day of shifts.
 *
 * Split out of staffing.ts so the browser can run it as well as the server.
 * The slider on the Staffing tab used to ask the server for every position it
 * stopped on; now the page loads a store-day once (getStaffingDay) and answers
 * every minute of it here, instantly. "Now" still goes through the server, and
 * through this same function, so the two can never disagree about a shift.
 *
 * Pure — no PAR, no database, no Node — which is what lets it ship to the page.
 */

import type { PARShift } from "./par";
import type { StaffOnClock, StoreRoster, WorkstreamFacts } from "./staffing";

/**
 * Everything one store's roster needs for any minute of one local date.
 *
 * Shifts for the date and the calendar day before it (an overnight shift
 * started yesterday can still be running at 00:30), with the per-person facts
 * already resolved, so answering a minute needs nothing else.
 */
export type StoreDay = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  timeZone: string;
  localDate: string;
  today: PARShift[];
  yesterday: PARShift[];
  /** Payroll week to date per PAR employee id, the date's own shifts included. */
  wtd: Record<string, { minutes: number; shifts: number }>;
  /** Display name per PAR employee id: Workstream's where linked, else PAR's. */
  names: Record<string, string>;
  /** PAR job name per job id, for the jobs on these shifts. */
  jobs: Record<string, string>;
  /** Workstream facts per PAR employee id, for the people linked. */
  workstream: Record<string, WorkstreamFacts>;
  error: string | null;
};

export function clockLabel(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = String(m % 60).padStart(2, "0");
  const suffix = h24 < 12 ? "am" : "pm";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm}${suffix}`;
}

/**
 * Was this shift running at `queryMinutes`, measured in its own start frame?
 *
 * An open shift has no end, and must not be given one. par.ts fills endMinutes
 * for a shift with no clock-out as start + minutesWorked, which is "as far as
 * they had got when PAR was asked" — a moving target, and a stale one the
 * moment it is cached. Comparing against it hid every person currently on the
 * clock: six were working at Springfield while this screen read zero.
 */
function coversMinute(shift: PARShift, queryMinutes: number): boolean {
  if (queryMinutes < shift.startMinutes) return false;
  return shift.isOpen || queryMinutes < shift.endMinutes;
}

/** Were they on a break at that minute? PAR records the windows; this reads them. */
function onBreakAt(shift: PARShift, queryMinutes: number): boolean {
  return shift.breaks.some((b) => queryMinutes >= b.startMinutes && queryMinutes < b.endMinutes);
}

/** One store's roster at `minutes` past local midnight on its day. */
export function rosterAt(day: StoreDay, minutes: number): StoreRoster {
  const base = {
    storeId: day.storeId,
    storeName: day.storeName,
    state: day.state,
    timeZone: day.timeZone,
    localTime: clockLabel(minutes),
    localDate: day.localDate,
  };
  if (day.error) {
    return { ...base, onClock: [], hourlyWageRunRate: null, salariedOnClock: 0, error: day.error };
  }

  // Today's shifts are tested against today's clock; yesterday's against the
  // same moment expressed as minutes since yesterday's midnight, which is how a
  // shift that started at 6pm and ends at 2am is still running at 00:30.
  const candidates: { shift: PARShift; queryMinutes: number }[] = [
    ...day.today.map((shift) => ({ shift, queryMinutes: minutes })),
    ...day.yesterday.map((shift) => ({ shift, queryMinutes: minutes + 1440 })),
  ];

  const onClock: StaffOnClock[] = [];
  for (const { shift, queryMinutes } of candidates) {
    if (!coversMinute(shift, queryMinutes)) continue;
    const id = shift.employeeId;
    const wtd = id ? day.wtd[id] : undefined;
    onClock.push({
      employeeId: id,
      // Workstream's name wins where there is one: PAR's is a first name and a
      // last initial, and a roster is read to find a person.
      name: (id && day.names[id]) || (id ? `#${id}` : "unknown"),
      job: shift.jobId ? (day.jobs[shift.jobId] ?? null) : null,
      jobId: shift.jobId,
      payRate: shift.payRate,
      startMinutes: shift.startMinutes,
      endMinutes: shift.endMinutes,
      startLabel: clockLabel(shift.startMinutes),
      endLabel: shift.isOpen ? "on now" : clockLabel(shift.endMinutes),
      isOpen: shift.isOpen,
      onBreak: onBreakAt(shift, queryMinutes),
      minutesWorked: shift.minutesWorked,
      minutesElapsedAtQuery: Math.max(0, Math.round(queryMinutes - shift.startMinutes)),
      wtdMinutes: wtd?.minutes ?? 0,
      wtdShifts: wtd?.shifts ?? 0,
      workstream: (id && day.workstream[id]) || null,
    });
  }

  onClock.sort((a, b) => a.startMinutes - b.startMinutes || a.name.localeCompare(b.name));

  // Summed from the rate each card actually shows — Workstream's rate of record
  // where the person is linked, PAR's shift rate otherwise. A run rate that
  // totalled different numbers than the ones printed above it would be
  // unarguable-with, which is the opposite of what a figure like this is for.
  const rates = onClock
    .map((p) => p.workstream?.rateOfRecord ?? p.payRate)
    .filter((r): r is number => r !== null && r > 0);
  const hourlyWageRunRate = rates.length
    ? Math.round(rates.reduce((a, b) => a + b, 0) * 100) / 100
    : null;

  return { ...base, onClock, hourlyWageRunRate, salariedOnClock: onClock.length - rates.length, error: null };
}
