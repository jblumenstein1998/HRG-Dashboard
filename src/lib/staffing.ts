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
import { shiftWorkedMinutesInWindow, todayCentralISO } from "./parRollup";
import {
  PAR_LOCATIONS,
  getOrders,
  getOrdersLive,
  getShifts,
  getShiftsLive,
  getBusinessHours,
  getEmployees,
  getJobs,
  getStoreTimeZone,
  type PARShift,
} from "./par";
import { linkedRosterOrEmpty } from "./workstreamRoster";
import { workstreamSyncStatus } from "./workstreamStore";

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
  /**
   * What Workstream says about this person, where they have been joined to a
   * Workstream record. Null throughout when they haven't been — see
   * lib/workstreamLink.ts for why nothing is guessed here.
   */
  workstream: WorkstreamFacts | null;
};

/**
 * Workstream's half of a person, hung off a PAR row.
 *
 * `position` is the title Workstream holds, which is what someone was hired as
 * — not the same claim as PAR's `job`, which is what they clocked in as for
 * this particular shift. A Shift Leader working a Cook shift is a normal
 * Tuesday, and showing both is the point: one is the job, the other is the
 * night.
 *
 * `rateOfRecord` is likewise not `payRate`. PAR's is what the shift was costed
 * at; Workstream's is what the person is supposed to be paid. Where they
 * disagree, somebody wants to know.
 */
export type WorkstreamFacts = {
  /** Workstream's full name. PAR's DisplayName truncates the surname. */
  fullName: string | null;
  position: string | null;
  rateOfRecord: number | null;
  hiredDate: string | null;
  terminationDate: string | null;
  /** How the two records were joined: a name match, or a person's decision. */
  linkedBy: "auto" | "confirmed";
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
   * Sum of the hourly rates on the clock, taken from the same source each card
   * shows: Workstream's rate of record where the person is linked, PAR's shift
   * rate otherwise.
   *
   * Salaried people are not in it — Workstream states their pay annually and
   * PAR records it as 0, and neither is an hourly figure to add — so it is
   * reported alongside a count of who was left out rather than suppressed. An
   * earlier version blanked the whole store if one salaried manager was on,
   * which hid the real wages of everyone else to avoid implying the manager
   * was free.
   */
  hourlyWageRunRate: number | null;
  /** People on the clock with no hourly rate in either system, i.e. salaried. */
  salariedOnClock: number;
  error: string | null;
};

export type StaffingReport = {
  /** The instant asked about, ISO. */
  at: string;
  stores: StoreRoster[];
  fetchedAt: number;
  /**
   * When the stored Workstream roster was last filled, and how big it is.
   *
   * On the report rather than left implicit because the failure it describes is
   * invisible otherwise: with an empty or stale table every card reads "not
   * linked to Workstream" and everybody lands under "Other", which looks like
   * broken matching rather than absent data. An hour was already lost to
   * exactly that confusion once.
   */
  workstreamSync: {
    rows: number;
    lastSyncedAt: string | null;
    /** Hours since the last sync, or null if it has never run. Computed here
     *  rather than in the component, which must stay pure. */
    ageHours: number | null;
  };
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
    const [employees, jobs, linked, today, yesterday, ...trailing] = await Promise.all([
      getEmployees(loc.storeId),
      getJobs(loc.storeId),
      // Never throws: an unreachable Workstream costs the position column, not
      // the screen.
      linkedRosterOrEmpty(loc.storeId),
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
      const ws = shift.employeeId ? linked.get(shift.employeeId) : undefined;

      onClock.push({
        employeeId: shift.employeeId,
        // Workstream's name wins where there is one: PAR's is a first name and
        // a last initial, and a roster is read to find a person.
        name:
          ws?.name
          ?? fullName(emp)
          ?? (shift.employeeId ? `#${shift.employeeId}` : "unknown"),
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
        workstream: ws
          ? {
              fullName: ws.name,
              position: ws.title,
              rateOfRecord: ws.hourlyRate,
              hiredDate: ws.hiredDate,
              terminationDate: ws.terminationDate,
              linkedBy: ws.linkedBy,
            }
          : null,
      });
    }

    onClock.sort((a, b) => a.startMinutes - b.startMinutes || a.name.localeCompare(b.name));

    // Summed from the rate each card actually shows — Workstream's rate of
    // record where the person is linked, PAR's shift rate otherwise. A run rate
    // that totalled different numbers than the ones printed above it would be
    // unarguable-with, which is the opposite of what a figure like this is for.
    const rates = onClock
      .map((p) => p.workstream?.rateOfRecord ?? p.payRate)
      .filter((r): r is number => r !== null && r > 0);
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
  const [stores, status] = await Promise.all([
    Promise.all(PAR_LOCATIONS.map((loc) => rosterForStore(loc, at))),
    // Never a reason for the page to fail: if the roster table cannot be read,
    // say it has never synced and let the banner explain the blank columns.
    workstreamSyncStatus().catch(() => ({ rows: 0, lastSyncedAt: null })),
  ]);

  const workstreamSync = {
    ...status,
    ageHours: status.lastSyncedAt
      ? Math.round(((Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000) * 10) / 10
      : null,
  };

  return { at: at.toISOString(), stores, fetchedAt: Date.now(), workstreamSync };
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
  /**
   * Position and rate of record from Workstream, where this PAR employee has
   * been joined to a Workstream one. Null when they haven't — the hours are
   * still right, there is simply nobody to attribute them to on the other side.
   */
  workstream: WorkstreamFacts | null;
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
 * The last `count` completed business dates, oldest first.
 *
 * Today is left out for the same reason a running week is: a day still being
 * worked reports less overtime than it will finish with, and a line that climbs
 * through the afternoon reads as a store deteriorating when nothing has
 * happened.
 *
 * Each span is a single date, which `getStoreHours` handles without knowing
 * anything new — it already walks every date between start and end.
 *
 * Daily overtime is a different question from weekly. Overtime is a property of
 * a payroll week, so a single day's "overtime minutes" is PAR's own attribution
 * of that day's hours, not a day that broke forty on its own. It answers "which
 * day did the week tip over", which is the useful version for a manager
 * building next week's schedule.
 */
export function recentCompleteDays(today: string, count: number): HoursSpan[] {
  const days: HoursSpan[] = [];
  for (let i = count; i >= 1; i--) {
    const date = shiftLocalDate(today, -i);
    days.push({ start: date, end: date, label: date.slice(5).replace("-", "/") });
  }
  return days;
}

/**
 * This week so far — Monday through yesterday.
 *
 * Null on a Monday, when there is no "so far" yet. Returning an empty span
 * instead would plot a point at zero, which is a claim that nobody worked
 * overtime rather than that the week has not started.
 *
 * Today is excluded, as everywhere else on this screen: a day still being
 * worked reports less overtime than it will finish with.
 *
 * It sits alongside completed weeks knowing it is not their equal — a partial
 * week is always lower than a full one, and the axis cannot say so. The label
 * carries that warning, which is why it reads "WTD" rather than a date.
 */
export function weekToDateSpan(today: string): HoursSpan | null {
  const monday = mondayOf(today);
  const yesterday = shiftLocalDate(today, -1);
  if (yesterday < monday) return null;
  return { start: monday, end: yesterday, label: "WTD" };
}

/**
 * Each day of the current week, Monday through yesterday.
 *
 * The breakdown behind the WTD point: same window, one column per day, for
 * working out which shift put the week where it is.
 */
export function currentWeekDays(today: string): HoursSpan[] {
  const monday = mondayOf(today);
  const yesterday = shiftLocalDate(today, -1);
  const days: HoursSpan[] = [];
  for (const date of eachDate(monday, yesterday)) {
    days.push({ start: date, end: date, label: date.slice(5).replace("-", "/") });
  }
  return days;
}

/**
 * A chosen range, cut into days or into weeks.
 *
 * Weeks are Mon–Sun as everywhere else on this screen, and the first and last
 * are **clipped to the range** rather than dropped. Dropping them would be
 * tidier arithmetic and a worse answer: someone who picks the 3rd to the 17th
 * means those dates, and silently returning only the whole weeks inside would
 * answer a question they did not ask — sometimes with nothing at all.
 *
 * The cost is that an edge week can be short, and a short week carries less
 * overtime for that reason alone. A clipped span is marked with a `~` in its
 * label so the chart can say so rather than leaving it to be noticed.
 */
export function customSpans(from: string, to: string, grain: "day" | "week"): HoursSpan[] {
  if (to < from) return [];

  if (grain === "day") {
    return eachDate(from, to).map((date) => ({
      start: date,
      end: date,
      label: date.slice(5).replace("-", "/"),
    }));
  }

  const spans: HoursSpan[] = [];
  let cursor = mondayOf(from);
  while (cursor <= to) {
    const weekEnd = shiftLocalDate(cursor, 6);
    const start = cursor < from ? from : cursor;
    const end = weekEnd > to ? to : weekEnd;
    const clipped = start !== cursor || end !== weekEnd;
    spans.push({
      start,
      end,
      label: `${clipped ? "~" : ""}${start.slice(5).replace("-", "/")}`,
    });
    cursor = shiftLocalDate(cursor, 7);
  }
  return spans;
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
        const [employees, jobs, linked] = await Promise.all([
          getEmployees(loc.storeId),
          getJobs(loc.storeId),
          linkedRosterOrEmpty(loc.storeId),
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
                const ws = linked.get(sh.employeeId);
                const row = byEmployee.get(sh.employeeId) ?? {
                  employeeId: sh.employeeId,
                  name: ws?.name ?? fullName(empById.get(sh.employeeId)) ?? `#${sh.employeeId}`,
                  job: sh.jobId ? jobById.get(sh.jobId)?.name ?? null : null,
                  regularMinutes: 0,
                  overtimeMinutes: 0,
                  regularCost: 0,
                  overtimeCost: 0,
                  unratedMinutes: 0,
                  shifts: 0,
                  workstream: ws
                    ? {
                        fullName: ws.name,
                        position: ws.title,
                        rateOfRecord: ws.hourlyRate,
                        hiredDate: ws.hiredDate,
                        terminationDate: ws.terminationDate,
                        linkedBy: ws.linkedBy,
                      }
                    : null,
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

// ── Labor before open and after close ────────────────────────────────────────

/**
 * How much labor a store burns before it opens and after it shuts.
 *
 * Open and close come from PAR's own GetBusinessHours per day of week, not from
 * the first and last order — a store with a slow morning would otherwise look
 * like it opened late.
 *
 * Labor is measured with the same window-overlap the hourly rollup uses, so
 * break time inside the window is not counted as worked, and a closing shift
 * that runs past midnight is measured in its own frame rather than wrapping to
 * a negative span.
 */
// ── Payroll calendar ─────────────────────────────────────────────────────────

/**
 * A known pay date, to count fortnights from. 2026-09-22 is a Tuesday, and
 * 2026-09-08 — the one before it — confirms the fourteen-day step.
 */
const PAY_DATE_ANCHOR = "2026-09-22";

/**
 * How long after the work ends the money arrives.
 *
 * Nine days, which is stated by the estate and not inferred: pay date 9/22
 * covers 8/31–9/13, and pay date 9/8 covers 8/17–8/30. Both are Mon–Sun
 * fortnights ending nine days before the Tuesday they are paid on, so there is
 * better than a week between the last shift and the money.
 *
 * That gap is the reason this screen is useful rather than a curiosity: when
 * the next pay date comes into view its working period is already closed, so
 * every timecard in it can be corrected before payroll runs rather than after.
 *
 * **If payroll moves its cut-off, this is the line to change and nothing
 * else.** The selector, the ranges and the labels all come off it.
 */
const PAY_LAG_DAYS = 9;

export type PayPeriod = {
  /** The Tuesday the money lands. */
  payDate: string;
  /** First business date worked, a Monday. */
  start: string;
  /** Last business date worked, a Sunday. */
  end: string;
  /** Still being worked — the fortnight has not finished yet. */
  inProgress: boolean;
  label: string;
};

/**
 * The pay period paid on `payDate`.
 *
 * `today` only decides whether the fortnight is still running. It matters on
 * screen: a period in progress will always show fewer accumulated problems
 * than a closed one, for no reason other than that fewer days have happened.
 */
export function payPeriodFor(payDate: string, today?: string): PayPeriod {
  const end = shiftLocalDate(payDate, -PAY_LAG_DAYS);
  const start = shiftLocalDate(end, -13);
  return {
    payDate,
    start,
    end,
    inProgress: today ? end >= today : false,
    label: `Paid ${payDate.slice(5).replace("-", "/")}`,
  };
}

/**
 * Pay dates, newest first, led by one whose fortnight is still being worked.
 *
 * Two future-facing entries rather than one, and they answer different
 * questions:
 *
 *   the run being prepared   its working period closed days ago, thanks to the
 *                            nine-day lag, so it is a complete fortnight to
 *                            correct before the money goes out
 *   the one after it         still being worked. Not actionable in the same
 *                            way, but it shows what is piling up rather than
 *                            waiting for it to arrive as a finished list
 *
 * The second is marked `inProgress`, because it will always show fewer
 * problems than a closed period for no reason other than having had fewer days
 * to collect them, and a count that means something different from the one
 * above it should say so.
 */
export function recentPayPeriods(today: string, count = 6): PayPeriod[] {
  // Step to the first pay date on or after today, from the anchor.
  let date = PAY_DATE_ANCHOR;
  while (date < today) date = shiftLocalDate(date, 14);
  while (shiftLocalDate(date, -14) >= today) date = shiftLocalDate(date, -14);

  // Then one beyond it: the fortnight currently being worked.
  date = shiftLocalDate(date, 14);

  const out: PayPeriod[] = [];
  for (let i = 0; i < count; i++) {
    out.push(payPeriodFor(date, today));
    date = shiftLocalDate(date, -14);
  }
  return out;
}

// ── Missed punches ───────────────────────────────────────────────────────────

/**
 * Still on the clock at 2:13am: they forgot to punch out.
 *
 * The rule is the estate's, not an inference. Every store is long shut by then
 * — the latest close plus cleanup is nowhere near two in the morning — so a
 * shift still running at 2:13 is a timecard to fix, not a night worked.
 *
 * It has to be a time-of-day rule rather than "the shift never ended", because
 * PAR does not leave these open: something closes them out, so `isOpen` is
 * false by the time anybody looks and the only surviving evidence is an end
 * time in the small hours. Checking `isOpen` alone found nothing across a whole
 * pay period, which is what sent us looking for the real tell.
 *
 * `isOpen` is still checked, for the case where nothing has closed it yet.
 *
 * Minutes are counted from the business date's own midnight, so a shift that
 * legitimately runs past twelve carries on past 1440 rather than wrapping — see
 * lib/par.ts. 2:13am the following morning is therefore minute 1573.
 *
 * Missed *break* punches are the obvious companion and are deliberately not
 * here yet: "didn't clock out for a break" splits into a break left open, a
 * shift with no break at all, and a break shorter than policy, and the last two
 * need a rule nobody has written down yet.
 */
const MISSED_CLOCKOUT_MINUTE = 24 * 60 + 2 * 60 + 13;

export type MissedPunch = {
  businessDate: string;
  employeeId: string | null;
  name: string;
  job: string | null;
  /** When the shift began, in the store's own clock. */
  startLabel: string;
  /** When PAR says it ended, or "still open" if nothing ever closed it. */
  endLabel: string;
  /** Nothing has closed this shift at all — the worse of the two cases. */
  stillOpen: boolean;
  /**
   * Minutes PAR currently credits the shift. Not what anybody will be paid —
   * shown so the size of the correction is visible, not as a fact.
   */
  minutesWorked: number;
};

export type StoreMissedPunches = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  rows: MissedPunch[];
  error: string | null;
};

export type MissedPunchReport = {
  /** Business dates examined, oldest first. */
  dates: string[];
  stores: StoreMissedPunches[];
  fetchedAt: number;
};

/**
 * Every missed punch across the estate, over the given business dates.
 *
 * Dates are taken rather than a count so one report serves both "yesterday" and
 * a whole pay period without the caller having to know how either is built.
 */
export async function getMissedPunches(dates: string[]): Promise<MissedPunchReport> {
  const stores = await Promise.all(
    PAR_LOCATIONS.map(async (loc): Promise<StoreMissedPunches> => {
      try {
        const [employees, jobs, ...days] = await Promise.all([
          getEmployees(loc.storeId),
          getJobs(loc.storeId),
          ...dates.map((d) => getShifts(loc.storeId, d)),
        ]);
        const empById = new Map(employees.map((e) => [e.id, e]));
        const jobById = new Map(jobs.map((j) => [j.id, j]));

        const rows: MissedPunch[] = [];
        days.forEach((shifts, i) => {
          const businessDate = dates[i];
          for (const sh of shifts) {
            // Still on the clock at 2:13am, or never closed at all.
            if (!sh.isOpen && sh.endMinutes <= MISSED_CLOCKOUT_MINUTE) continue;
            rows.push({
              businessDate,
              employeeId: sh.employeeId,
              name: fullName(sh.employeeId ? empById.get(sh.employeeId) : undefined)
                ?? (sh.employeeId ? `#${sh.employeeId}` : "unknown"),
              job: sh.jobId ? jobById.get(sh.jobId)?.name ?? null : null,
              startLabel: clockLabel(sh.startMinutes),
              endLabel: sh.isOpen ? "still open" : clockLabel(sh.endMinutes),
              stillOpen: sh.isOpen,
              minutesWorked: sh.minutesWorked,
            });
          }
        });

        // Oldest first, then by who started earliest — the order somebody would
        // work down a list of corrections.
        rows.sort(
          (a, b) => a.businessDate.localeCompare(b.businessDate) || a.name.localeCompare(b.name),
        );

        return { storeId: loc.storeId, storeName: loc.name, state: loc.state, rows, error: null };
      } catch (err) {
        return {
          storeId: loc.storeId,
          storeName: loc.name,
          state: loc.state,
          rows: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { dates, stores, fetchedAt: Date.now() };
}

// ── Daypart productivity ─────────────────────────────────────────────────────

/**
 * Sales and transactions per labor hour, by daypart, for one business date.
 *
 * SPLH and TPLH are the two numbers a manager schedules against: what each paid
 * hour brought in, and how many transactions it served. Split by daypart
 * because a day that looks fine in total can be two good shifts either side of
 * an overstaffed afternoon, and the total hides exactly that.
 *
 * The three fixed bands are DAYPARTS 2–4 (11–2, 2–5, 5–8) from lib/dayparts.ts,
 * so this screen and the POS Sales tab are cutting the day the same way. The
 * last band runs from 8pm to **each store's own close**, which is why it cannot
 * be a fixed window: closes differ by store and by weekday, and a store that
 * shuts at ten judged against one that shuts at midnight would look short-
 * staffed for the two hours it was not open.
 *
 * "Opening" is the odd one out and carries hours and cost rather than SPLH: it
 * is the labor spent before the doors open, when there are no sales to divide
 * by. A productivity figure there would be a division by zero dressed up as a
 * number.
 */
export type DaypartCell = {
  label: string;
  /** Minutes worked inside the window, breaks excluded. */
  laborMinutes: number;
  netSales: number;
  transactions: number;
  /** Net sales per labor hour, or null when nobody was on the clock. */
  splh: number | null;
  /** Transactions per labor hour, or null when nobody was on the clock. */
  tplh: number | null;
};

export type StoreDayparts = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  /** Labor before the doors open — hours and what it cost. */
  opening: { laborMinutes: number; laborCost: number; openLabel: string | null };
  /** 11–2, 2–5, 5–8, then 8pm to this store's own close. */
  cells: DaypartCell[];
  closeLabel: string | null;
  /** The close came from the last order, because the configured one was wrong. */
  closeFromOrders: boolean;
  error: string | null;
};

export type DaypartReport = {
  businessDate: string;
  /** Column headings, so the table and the data cannot disagree. */
  columns: string[];
  stores: StoreDayparts[];
  fetchedAt: number;
};

/** The three fixed bands. The fourth runs to each store's own close. */
const PRODUCTIVITY_BANDS = [
  { label: "11–2", start: 11 * 60, end: 14 * 60 },
  { label: "2–5", start: 14 * 60, end: 17 * 60 },
  { label: "5–8", start: 17 * 60, end: 20 * 60 },
];

const LATE_BAND_START = 20 * 60;

export async function getDaypartProductivity(businessDate: string): Promise<DaypartReport> {
  const isToday = businessDate === todayCentralISO();

  const stores = await Promise.all(
    PAR_LOCATIONS.map(async (loc): Promise<StoreDayparts> => {
      const empty = {
        storeId: loc.storeId,
        storeName: loc.name,
        state: loc.state,
        opening: { laborMinutes: 0, laborCost: 0, openLabel: null },
        cells: [],
        closeLabel: null,
        closeFromOrders: false,
      };
      try {
        // Fetched once per store, then every window is computed from the same
        // two arrays. Asking getWindowTotals per band would re-read the day
        // four times over, and on today's date those reads deliberately bypass
        // the cache — four live PAR calls per store where one will do.
        const [hours, orders, shifts] = await Promise.all([
          getBusinessHours(loc.storeId),
          isToday ? getOrdersLive(loc.storeId, businessDate) : getOrders(loc.storeId, businessDate),
          isToday ? getShiftsLive(loc.storeId, businessDate) : getShifts(loc.storeId, businessDate),
        ]);

        const [y, m, d] = businessDate.split("-").map(Number);
        const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
        const today = hours.find((h) => h.dayOfWeek === dow) ?? null;

        const windowOf = (start: number, end: number, label: string): DaypartCell => {
          const laborMinutes = shifts.reduce(
            (sum, s) => sum + shiftWorkedMinutesInWindow(s, start, end),
            0,
          );
          const inWindow = orders.filter(
            (o) => o.openedMinutes != null && o.openedMinutes >= start && o.openedMinutes < end,
          );
          const netSales = inWindow.reduce((sum, o) => sum + o.netSales, 0);
          // PAR's own flag, never orders.length — see PAROrder.isCountedOrder.
          const transactions = inWindow.filter((o) => o.isCountedOrder).length;
          const laborHours = laborMinutes / 60;
          return {
            label,
            laborMinutes,
            netSales,
            transactions,
            splh: laborHours > 0 ? netSales / laborHours : null,
            tplh: laborHours > 0 ? transactions / laborHours : null,
          };
        };

        const cells = PRODUCTIVITY_BANDS.map((b) => windowOf(b.start, b.end, b.label));

        /*
         * 8pm to close — where "close" is when the store stopped selling, not
         * what its settings claim.
         *
         * PAR's configured close is not dependable: four stores return a flat
         * 10:30am–7:00pm for all seven days, an untouched default, while they
         * are plainly still taking orders at ten at night. Trusting it blanked
         * this band for a third of the estate and hid their busiest hours.
         *
         * So the band runs to the later of the configured close and the last
         * order actually rung. Correctly configured stores are unaffected —
         * their close already sits past the last order — and the broken ones
         * get measured against what really happened. The POS tab has never
         * needed the setting either; it reads the orders.
         *
         * Minutes are already store-local and already carry past 1440 for a
         * store trading beyond midnight, so nothing needs wrapping here.
         */
        const configuredClose = today?.closeMinutes ?? null;
        const lastOrder = orders.reduce<number | null>(
          (latest, o) =>
            o.openedMinutes != null && (latest === null || o.openedMinutes > latest)
              ? o.openedMinutes
              : latest,
          null,
        );
        // +1 so the last order falls inside a half-open window.
        const tradedUntil = lastOrder === null ? null : lastOrder + 1;
        const effectiveClose = Math.max(configuredClose ?? 0, tradedUntil ?? 0) || null;

        cells.push(
          effectiveClose != null && effectiveClose > LATE_BAND_START
            ? windowOf(LATE_BAND_START, effectiveClose, "8–Close")
            : { label: "8–Close", laborMinutes: 0, netSales: 0, transactions: 0, splh: null, tplh: null },
        );

        // Labor before the doors open, and what it cost. Salaried staff carry a
        // rate of 0 in PAR, so they contribute hours and no cost — the same
        // convention the rest of this screen uses.
        let openingMinutes = 0;
        let openingCost = 0;
        if (today) {
          for (const sh of shifts) {
            const mins = shiftWorkedMinutesInWindow(sh, 0, today.openMinutes);
            if (mins <= 0) continue;
            openingMinutes += mins;
            openingCost += (mins / 60) * (sh.payRate ?? 0);
          }
        }

        return {
          ...empty,
          opening: {
            laborMinutes: openingMinutes,
            laborCost: Math.round(openingCost * 100) / 100,
            openLabel: today ? clockLabel(today.openMinutes) : null,
          },
          cells,
          closeLabel: effectiveClose != null ? clockLabel(effectiveClose) : null,
          /**
           * True when the configured close was behind the trading and the last
           * order had to stand in for it. Worth surfacing rather than silently
           * correcting: the setting is wrong in PAR and everything else that
           * reads it is wrong too.
           */
          closeFromOrders:
            effectiveClose != null && (configuredClose ?? 0) < effectiveClose,
          error: null,
        };
      } catch (err) {
        return { ...empty, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  return {
    businessDate,
    columns: ["Opening", ...PRODUCTIVITY_BANDS.map((b) => b.label), "8–Close"],
    stores,
    fetchedAt: Date.now(),
  };
}

export type OpenCloseCell = {
  businessDate: string;
  /** Null when PAR has no hours for that day of week. */
  openLabel: string | null;
  closeLabel: string | null;
  /** Labor minutes worked strictly before open / strictly after close. */
  laborMinutes: number;
  /** How many people contributed any of it. */
  people: number;
  /** Earliest clock-in before open, or latest clock-out after close. */
  edgeLabel: string | null;
  /** Minutes between that edge and the open/close time. */
  edgeMinutes: number;
};

export type StoreOpenClose = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA";
  open: OpenCloseCell[];
  close: OpenCloseCell[];
  error: string | null;
};

export type OpenCloseReport = {
  dates: string[];
  stores: StoreOpenClose[];
  fetchedAt: number;
};

export async function getOpenCloseReport(today: string, dayCount: number): Promise<OpenCloseReport> {
  // Trailing days, ending with today. Today is included deliberately: the
  // morning has already happened by the time anyone looks, and waiting a day to
  // see it would make the screen useless for the thing it is for.
  const dates = Array.from({ length: dayCount }, (_, i) =>
    shiftLocalDate(today, -(dayCount - 1 - i)),
  );

  const stores = await Promise.all(
    PAR_LOCATIONS.map(async (loc): Promise<StoreOpenClose> => {
      try {
        const [hours, ...days] = await Promise.all([
          getBusinessHours(loc.storeId),
          ...dates.map((d) => getShifts(loc.storeId, d)),
        ]);
        const hoursByDay = new Map(hours.map((h) => [h.dayOfWeek, h]));

        const open: OpenCloseCell[] = [];
        const close: OpenCloseCell[] = [];

        dates.forEach((businessDate, i) => {
          const shifts = days[i] ?? [];
          const [y, m, d] = businessDate.split("-").map(Number);
          const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
          const h = hoursByDay.get(dow);

          if (!h) {
            const empty = {
              businessDate, openLabel: null, closeLabel: null,
              laborMinutes: 0, people: 0, edgeLabel: null, edgeMinutes: 0,
            };
            open.push({ ...empty });
            close.push({ ...empty });
            return;
          }

          // Before open: from the earliest clock-in of the day to the open time.
          let preMinutes = 0;
          let prePeople = 0;
          let earliest: number | null = null;
          // After close: from the close time to the last clock-out.
          let postMinutes = 0;
          let postPeople = 0;
          let latest: number | null = null;

          for (const sh of shifts) {
            const before = shiftWorkedMinutesInWindow(sh, 0, h.openMinutes);
            if (before > 0) {
              preMinutes += before;
              prePeople += 1;
              earliest = earliest === null ? sh.startMinutes : Math.min(earliest, sh.startMinutes);
            }
            // The upper bound is deliberately far past midnight rather than
            // 1440: a shift that ends at 1:20am reads as 1520 in its own frame,
            // and clipping at midnight would drop the part that matters most.
            const after = shiftWorkedMinutesInWindow(sh, h.closeMinutes, h.closeMinutes + 720);
            if (after > 0) {
              postMinutes += after;
              postPeople += 1;
              const end = sh.isOpen ? sh.startMinutes + sh.minutesWorked : sh.endMinutes;
              latest = latest === null ? end : Math.max(latest, end);
            }
          }

          open.push({
            businessDate,
            openLabel: clockLabel(h.openMinutes),
            closeLabel: clockLabel(h.closeMinutes),
            laborMinutes: Math.round(preMinutes),
            people: prePeople,
            edgeLabel: earliest === null ? null : clockLabel(earliest),
            edgeMinutes: earliest === null ? 0 : Math.max(0, Math.round(h.openMinutes - earliest)),
          });

          close.push({
            businessDate,
            openLabel: clockLabel(h.openMinutes),
            closeLabel: clockLabel(h.closeMinutes),
            laborMinutes: Math.round(postMinutes),
            people: postPeople,
            edgeLabel: latest === null ? null : clockLabel(latest),
            edgeMinutes: latest === null ? 0 : Math.max(0, Math.round(latest - h.closeMinutes)),
          });
        });

        return { storeId: loc.storeId, storeName: loc.name, state: loc.state, open, close, error: null };
      } catch (err) {
        return {
          storeId: loc.storeId,
          storeName: loc.name,
          state: loc.state,
          open: [],
          close: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return { dates, stores, fetchedAt: Date.now() };
}
