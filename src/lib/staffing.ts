/**
 * Who is on the clock, per store, at a moment in time.
 *
 * Three PAR calls per store, all of them already used elsewhere: GetShifts for
 * the clock windows, GetEmployees for the names, GetJobs for the roles. The
 * only new work here is deciding what "on the clock at 6:30pm" means, which is
 * less obvious than it sounds.
 *
 * ── Business dates, not calendar days ────────────────────────────────────────
 *
 * A shift belongs to the business date it started on, and closing shifts run
 * past midnight. par.ts already models this: `endMinutes` is measured from the
 * shift's own start, so a close that ends at 2:15am reads as 1575 rather than
 * 135, and never as a negative span. A query at 00:30 on the 5th therefore has
 * to look at the 4th's shifts, not the 5th's — the 5th has barely begun.
 *
 * Both business dates are fetched and the query time is tested against each in
 * its own frame of reference. That is one extra call per store and removes a
 * whole class of "the late crew vanished at midnight" bug.
 *
 * ── Timezones ────────────────────────────────────────────────────────────────
 *
 * The Tennessee stores are Central and the Virginia stores Eastern, so "now" is
 * a different wall-clock in each. The caller passes an instant; each store
 * resolves it against its own zone. Asking for 6:30pm without saying whose
 * 6:30pm is how you end up an hour out for half the estate.
 */

import { PERIODS } from "./fiscal";
import {
  PAR_LOCATIONS,
  getShifts,
  getShiftsLive,
  getEmployees,
  getJobs,
  getStoreTimeZone,
  type PARShift,
} from "./par";

export type StaffOnClock = {
  employeeId: string | null;
  name: string;
  /** PAR's own job name for the shift, e.g. "Cook", "Shift Leader". */
  job: string | null;
  jobId: string | null;
  payRate: number | null;
  /** Minutes since local midnight of the shift's business date. */
  startMinutes: number;
  endMinutes: number;
  /** Wall-clock strings in the store's zone, e.g. "10:45am". */
  startLabel: string;
  endLabel: string;
  /** Still clocked in — PAR reports no clock-out yet. */
  isOpen: boolean;
  /** On a break at the queried minute, per PAR's own recorded break windows. */
  onBreak: boolean;
  /** Minutes worked on this shift, breaks already excluded by PAR. */
  minutesWorked: number;
  /**
   * Elapsed time since clocking in, at the queried minute. Not the same as
   * minutesWorked, which is what PAR pays and has breaks taken out.
   */
  minutesElapsedAtQuery: number;
  /** Total minutes worked across the seven business dates before this one. */
  trailing7Minutes: number;
  /** Shifts behind that total, so a bare number can be checked. */
  trailing7Shifts: number;
};

export type StoreRoster = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  timeZone: string;
  /** The query instant as this store's wall clock reads it. */
  localTime: string;
  localDate: string;
  onClock: StaffOnClock[];
  /**
   * Sum of the hourly rates on the clock. Salaried people are not in it — PAR
   * records their rate as 0, and there is no hourly figure to add — so it is
   * reported alongside a count of who was left out rather than suppressed. An
   * earlier version blanked the whole store if one salaried manager was on,
   * which hid the real wages of everyone else to avoid implying the manager
   * was free.
   */
  hourlyWageRunRate: number | null;
  /** People on the clock whose rate PAR reports as 0, i.e. salaried. */
  salariedOnClock: number;
  error: string | null;
};

export type StaffingReport = {
  /** The instant asked about, ISO. */
  at: string;
  stores: StoreRoster[];
  fetchedAt: number;
};

/**
 * First and last name where PAR has them, falling back to its DisplayName —
 * which is only ever a first name and a last initial, and reads as a truncation
 * bug on a staffing screen rather than as the abbreviation it is.
 */
function fullName(emp: { firstName: string; lastName: string; displayName: string } | undefined): string | null {
  if (!emp) return null;
  const full = [emp.firstName, emp.lastName].filter(Boolean).join(" ").trim();
  return full || emp.displayName || null;
}

/** Wall-clock parts of an instant in a given zone. */
function zonedParts(at: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function shiftLocalDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function clockLabel(minutes: number): string {
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

const TRAILING_DAYS = 7;

async function rosterForStore(
  loc: (typeof PAR_LOCATIONS)[number],
  at: Date,
): Promise<StoreRoster> {
  const timeZone = getStoreTimeZone(loc.storeId);
  const { date: localDate, minutes: localMinutes } = zonedParts(at, timeZone);
  const base: Omit<StoreRoster, "onClock" | "hourlyWageRunRate" | "salariedOnClock" | "error"> = {
    storeId: loc.storeId,
    storeName: loc.name,
    state: loc.state,
    timeZone,
    localTime: clockLabel(localMinutes),
    localDate,
  };

  try {
    const previousDate = shiftLocalDate(localDate, -1);

    // The seven business dates before today's, for the trailing total. Fetched
    // alongside so one store is one round of parallel calls rather than two.
    const trailingDates = Array.from({ length: TRAILING_DAYS }, (_, i) =>
      shiftLocalDate(localDate, -(i + 1)),
    );

    // The two roster dates are read live; the trailing seven come from cache.
    // A shift that is still open keeps changing, and the whole question this
    // screen answers is "right now" — an hour-old snapshot answers a different
    // one. Past business dates do not move, so caching them is free.
    const [employees, jobs, today, yesterday, ...trailing] = await Promise.all([
      getEmployees(loc.storeId),
      getJobs(loc.storeId),
      getShiftsLive(loc.storeId, localDate),
      getShiftsLive(loc.storeId, previousDate),
      ...trailingDates.map((d) => getShifts(loc.storeId, d)),
    ]);

    const nameById = new Map(employees.map((e) => [e.id, e]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const trailingByEmployee = new Map<string, { minutes: number; shifts: number }>();
    for (const day of trailing) {
      for (const sh of day) {
        if (!sh.employeeId) continue;
        const acc = trailingByEmployee.get(sh.employeeId) ?? { minutes: 0, shifts: 0 };
        acc.minutes += sh.minutesWorked;
        acc.shifts += 1;
        trailingByEmployee.set(sh.employeeId, acc);
      }
    }

    // Today's shifts are tested against today's clock; yesterday's are tested
    // against the same instant expressed as "minutes since yesterday's
    // midnight", which is how a shift that started at 6pm and ends at 2am is
    // still running when the query says 00:30.
    const candidates: { shift: PARShift; queryMinutes: number }[] = [
      ...today.map((shift) => ({ shift, queryMinutes: localMinutes })),
      ...yesterday.map((shift) => ({ shift, queryMinutes: localMinutes + 1440 })),
    ];

    const onClock: StaffOnClock[] = [];
    for (const { shift, queryMinutes } of candidates) {
      if (!coversMinute(shift, queryMinutes)) continue;
      const emp = shift.employeeId ? nameById.get(shift.employeeId) : undefined;
      const job = shift.jobId ? jobById.get(shift.jobId) : undefined;
      const jobName = job?.name ?? null;
      const trailingAcc = shift.employeeId ? trailingByEmployee.get(shift.employeeId) : undefined;

      onClock.push({
        employeeId: shift.employeeId,
        name: fullName(emp) ?? (shift.employeeId ? `#${shift.employeeId}` : "unknown"),
        job: jobName,
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
        trailing7Minutes: trailingAcc?.minutes ?? 0,
        trailing7Shifts: trailingAcc?.shifts ?? 0,
      });
    }

    onClock.sort((a, b) => a.startMinutes - b.startMinutes || a.name.localeCompare(b.name));

    const rates = onClock.map((p) => p.payRate).filter((r): r is number => r !== null && r > 0);
    const hourlyWageRunRate = rates.length
      ? Math.round(rates.reduce((a, b) => a + b, 0) * 100) / 100
      : null;
    const salariedOnClock = onClock.length - rates.length;

    return { ...base, onClock, hourlyWageRunRate, salariedOnClock, error: null };
  } catch (err) {
    return {
      ...base,
      onClock: [],
      hourlyWageRunRate: null,
      salariedOnClock: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Every store's roster at one instant.
 *
 * Stores run in parallel; par.ts's semaphore caps the actual SOAP concurrency
 * at five, and every call here is cached, so a repeat look at the same moment
 * costs nothing.
 */
export async function getStaffingAt(at: Date): Promise<StaffingReport> {
  const stores = await Promise.all(PAR_LOCATIONS.map((loc) => rosterForStore(loc, at)));
  return { at: at.toISOString(), stores, fetchedAt: Date.now() };
}

// ── Hours by store by week ───────────────────────────────────────────────────

/**
 * Regular and overtime hours, per store, per week, with the people behind them.
 *
 * The split is PAR's own — every shift carries RegularMinutesWorked and
 * OvertimeMinutesWorked — rather than something derived here from a 40-hour
 * rule. Overtime depends on a payroll workweek and on rules this app cannot
 * see, and a number computed locally would disagree with what people are
 * actually paid, which is the one thing a screen about overtime must not do.
 *
 * Weeks run Monday to Sunday and only complete ones are shown. A week still in
 * progress reports less overtime than it will finish with, and a figure that
 * climbs all week reads as a store improving when nothing has changed.
 */
export type EmployeeWeekHours = {
  employeeId: string;
  name: string;
  job: string | null;
  regularMinutes: number;
  overtimeMinutes: number;
  regularCost: number;
  overtimeCost: number;
  /** Minutes worked at a rate PAR reports as 0, i.e. salaried. Costed at nothing. */
  unratedMinutes: number;
  shifts: number;
};

export type StoreWeekHours = {
  weekStart: string;
  weekEnd: string;
  regularMinutes: number;
  overtimeMinutes: number;
  regularCost: number;
  overtimeCost: number;
  /** Minutes in the week worked by someone with no hourly rate on file. */
  unratedMinutes: number;
  people: EmployeeWeekHours[];
};

export type StoreHours = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  weeks: StoreWeekHours[];
  error: string | null;
};

export type HoursSpan = { start: string; end: string; label: string };

export type HoursReport = {
  /** The columns, oldest first. Weeks or pay periods depending on the request. */
  weeks: HoursSpan[];
  stores: StoreHours[];
  fetchedAt: number;
};

/**
 * What an overtime hour costs, as a multiple of the base rate.
 *
 * PAR records the hours as regular and overtime but not what it pays for them,
 * so this is the one number here that is neither read from a vendor nor
 * measured: the FLSA time-and-a-half, applied to the rate on the shift. It is
 * stated on the screen for that reason. Anywhere your payroll differs — a
 * double-time rule, a shift differential — the overtime column will be low.
 */
const OVERTIME_MULTIPLIER = 1.5;

/** The Monday on or before a date. */
function mondayOf(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  dt.setUTCDate(dt.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return dt.toISOString().slice(0, 10);
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftLocalDate(d, 1)) out.push(d);
  return out;
}

/**
 * The last `count` complete Monday–Sunday weeks before the week containing
 * `today`. The current week is excluded on purpose; see the note above.
 */
export function recentCompleteWeeks(today: string, count: number): HoursSpan[] {
  const thisMonday = mondayOf(today);
  const weeks: HoursSpan[] = [];
  for (let i = count; i >= 1; i--) {
    const start = shiftLocalDate(thisMonday, -7 * i);
    weeks.push({ start, end: shiftLocalDate(start, 6), label: start.slice(5).replace("-", "/") });
  }
  return weeks;
}

/**
 * The last `count` completed pay periods.
 *
 * A pay period here is the fiscal period from lib/fiscal — four or five weeks,
 * which is what the bonus docs mean when they say "pay-period" and what the
 * bonus engine already scores against. If payroll actually runs on a different
 * cycle, this is the line to change and nothing else.
 *
 * Only completed periods: one still running reports less overtime than it will
 * finish with, the same reason the weekly columns stop at the last full week.
 */
export function recentCompletePeriods(today: string, count: number): HoursSpan[] {
  return PERIODS.filter((p) => p.end < today)
    .slice(-count)
    .map((p) => ({ start: p.start, end: p.end, label: `P${p.period}` }));
}

export async function getStoreHours(spans: HoursSpan[]): Promise<HoursReport> {
  const weeks = spans;

  const stores = await Promise.all(
    PAR_LOCATIONS.map(async (loc): Promise<StoreHours> => {
      try {
        const [employees, jobs] = await Promise.all([
          getEmployees(loc.storeId),
          getJobs(loc.storeId),
        ]);
        const empById = new Map(employees.map((e) => [e.id, e]));
        const jobById = new Map(jobs.map((jb) => [jb.id, jb]));

        const weekRows = await Promise.all(
          weeks.map(async (w): Promise<StoreWeekHours> => {
            const days = await Promise.all(
              eachDate(w.start, w.end).map((d) => getShifts(loc.storeId, d)),
            );

            const byEmployee = new Map<string, EmployeeWeekHours>();
            let regularMinutes = 0;
            let overtimeMinutes = 0;
            let regularCost = 0;
            let overtimeCost = 0;
            let unratedMinutes = 0;

            for (const day of days) {
              for (const sh of day) {
                // Each shift is costed at its own recorded rate rather than at a
                // person's current one: a raise mid-window should not silently
                // reprice the weeks before it.
                const rate = sh.payRate ?? 0;
                const shiftRegularCost = (sh.regularMinutes / 60) * rate;
                const shiftOvertimeCost = (sh.overtimeMinutes / 60) * rate * OVERTIME_MULTIPLIER;
                const shiftUnrated = rate > 0 ? 0 : sh.regularMinutes + sh.overtimeMinutes;

                regularMinutes += sh.regularMinutes;
                overtimeMinutes += sh.overtimeMinutes;
                regularCost += shiftRegularCost;
                overtimeCost += shiftOvertimeCost;
                unratedMinutes += shiftUnrated;

                if (!sh.employeeId) continue;
                const row = byEmployee.get(sh.employeeId) ?? {
                  employeeId: sh.employeeId,
                  name: fullName(empById.get(sh.employeeId)) ?? `#${sh.employeeId}`,
                  job: sh.jobId ? jobById.get(sh.jobId)?.name ?? null : null,
                  regularMinutes: 0,
                  overtimeMinutes: 0,
                  regularCost: 0,
                  overtimeCost: 0,
                  unratedMinutes: 0,
                  shifts: 0,
                };
                row.regularMinutes += sh.regularMinutes;
                row.overtimeMinutes += sh.overtimeMinutes;
                row.regularCost += shiftRegularCost;
                row.overtimeCost += shiftOvertimeCost;
                row.unratedMinutes += shiftUnrated;
                row.shifts += 1;
                byEmployee.set(sh.employeeId, row);
              }
            }

            // Whoever is deepest into overtime first — the question this table
            // is opened to answer.
            const people = [...byEmployee.values()].sort(
              (a, b) =>
                b.overtimeMinutes - a.overtimeMinutes ||
                b.regularMinutes - a.regularMinutes ||
                a.name.localeCompare(b.name),
            );

            return {
              weekStart: w.start,
              weekEnd: w.end,
              regularMinutes,
              overtimeMinutes,
              regularCost: Math.round(regularCost * 100) / 100,
              overtimeCost: Math.round(overtimeCost * 100) / 100,
              unratedMinutes,
              people,
            };
          }),
        );

        return { storeId: loc.storeId, storeName: loc.name, state: loc.state, weeks: weekRows, error: null };
      } catch (err) {
        return {
          storeId: loc.storeId,
          storeName: loc.name,
          state: loc.state,
          weeks: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { weeks, stores, fetchedAt: Date.now() };
}
