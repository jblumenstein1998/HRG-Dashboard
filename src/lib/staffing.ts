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
import { businessDateISO } from "./businessDay";
import { shiftWorkedMinutesInWindow } from "./parRollup";
import {
  PAR_LOCATIONS,
  getShiftsLive,
  getShiftsRecent,
  getEmployees,
  getJobs,
  getStoreTimeZone,
  withParPriority,
  PAR_PRIORITY,
  nonLaborJobIds,
  type PARShift,
} from "./par";
import { sql } from "./db";
import { linkedRosterOrEmpty } from "./workstreamRoster";
import { getShiftsHistory, getShiftsHistoryRange } from "./parShiftStore";
import { clockLabel, rosterAt, type StoreDay } from "./staffingRoster";
import { storeHoursFor } from "./storeHours";
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
  /** Minutes worked this payroll week so far, the shift in progress included. */
  wtdMinutes: number;
  /** Shifts behind that total, so a bare number can be checked. */
  wtdShifts: number;
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
  /**
   * The store Workstream assigns them to, when it is not this one.
   *
   * Workstream's location is the baseline for where somebody belongs, so a
   * value here means they are working a store they are not assigned to. Either
   * the assignment is stale after a transfer, or they are covering away from
   * their home store and the labour is landing on another store's P&L.
   */
  assignedElsewhere: string | null;
};

export type StoreRoster = {
  storeId: string;
  storeName: string;
  state: "TN" | "VA" | "TX";
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
  /**
   * The instant asked about, ISO — null when the question was a local time of
   * day, because then there is no single instant to report. Six o'clock in
   * Virginia and six o'clock in Tennessee are an hour apart, and picking either
   * one to stand for both is how this went wrong in the first place.
   */
  at: string | null;
  /** What was asked for, so the screen can say which of the two it is showing. */
  moment: { kind: "instant" | "local"; label: string };
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

/**
 * Business dates from this week's Monday up to, but not including, `date`.
 *
 * The payroll week runs Monday to Sunday, the same as everywhere else on this
 * screen, so week-to-date means the same thing here as it does in the hours
 * table. Empty on a Monday, when the week has not started.
 */
function weekToDateBefore(date: string): string[] {
  const monday = mondayOf(date);
  const out: string[] = [];
  for (let d = monday; d < date; d = shiftLocalDate(d, 1)) out.push(d);
  return out;
}

/**
 * The moment to read a store at, in one of the two ways it can be asked for.
 *
 * `instant` is a single point in time, the same for every store — what "Now"
 * means, and the only honest way to ask what is happening across the estate
 * this second.
 *
 * `local` is a time of day, resolved separately inside each store's own zone.
 * Six o'clock means six o'clock in Virginia *and* six o'clock in Tennessee,
 * which are an hour apart and are deliberately two different instants. That is
 * what somebody means by "how were we staffed at dinner" — and it makes the
 * answer independent of where the person asking happens to be sitting, which
 * the instant form is not: a bare `YYYY-MM-DDTHH:mm` is read in the *browser's*
 * zone, so the same slider position queried a different moment depending on the
 * viewer's laptop.
 */
export type StaffingMoment =
  | { kind: "instant"; at: Date }
  | { kind: "local"; date: string; minutes: number };

async function rosterForStore(
  loc: (typeof PAR_LOCATIONS)[number],
  moment: StaffingMoment,
  /** Refresh was pressed: read today and yesterday live even off the slider. */
  fresh: boolean,
): Promise<StoreRoster> {
  const timeZone = getStoreTimeZone(loc.storeId);
  const { date: localDate, minutes: localMinutes } =
    moment.kind === "instant"
      ? zonedParts(moment.at, timeZone)
      : { date: moment.date, minutes: moment.minutes };
  const [day] = await storeDaysFor(loc, [localDate], moment.kind === "instant" || fresh);
  return rosterAt(day, localMinutes);
}

/**
 * One store's shifts and facts for one or more local dates — everything
 * rosterAt needs to answer any minute of each.
 *
 * Several dates share one read: every date needed — each day, the day before
 * it, and its week so far — is fetched once, the settled ones from Postgres in
 * a single batch (getShiftsHistoryRange). So the slider's seven-day preload is
 * about the same cost per store as one day was.
 *
 * Where each date comes from: only the business day still being worked can
 * have shifts open on it — PAR closes a day at 2:15 AM — so every date before
 * it is stored history, read from Postgres (and re-read from PAR when Refresh
 * flags it). The day still being worked, and the calendar day before it while
 * an overnight shift can still be open on it, come from PAR: live for Now and
 * Refresh (`live`), otherwise at most two minutes old.
 */
async function storeDaysFor(
  loc: (typeof PAR_LOCATIONS)[number],
  dates: string[],
  live: boolean,
): Promise<StoreDay[]> {
  const timeZone = getStoreTimeZone(loc.storeId);
  const baseFor = (localDate: string) => ({
    storeId: loc.storeId,
    storeName: loc.name,
    state: loc.state,
    timeZone,
    localDate,
  });

  try {
    const needed = new Set<string>();
    for (const d of dates) {
      needed.add(d);
      needed.add(shiftLocalDate(d, -1));
      for (const w of weekToDateBefore(d)) needed.add(w);
    }
    const settledBefore = businessDateISO(timeZone);
    const settled = [...needed].filter((d) => d < settledBefore);
    const current = [...needed].filter((d) => d >= settledBefore);

    const [employees, jobs, linked, settledByDate, ...currentShifts] = await Promise.all([
      getEmployees(loc.storeId),
      getJobs(loc.storeId),
      // Never throws: an unreachable Workstream costs the position column, not
      // the screen.
      linkedRosterOrEmpty(loc.storeId),
      settled.length ? getShiftsHistoryRange(loc.storeId, settled) : Promise.resolve(new Map<string, PARShift[]>()),
      ...current.map((d) => (live ? getShiftsLive(loc.storeId, d) : getShiftsRecent(loc.storeId, d))),
    ]);
    const currentByDate = new Map(current.map((d, i) => [d, currentShifts[i]]));
    const shiftsOn = (d: string): PARShift[] => settledByDate.get(d) ?? currentByDate.get(d) ?? [];

    const nameById = new Map(employees.map((e) => [e.id, e]));
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    return dates.map((localDate) => buildStoreDay(baseFor(localDate), shiftsOn, nameById, jobById, linked));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return dates.map((localDate) => ({
      ...baseFor(localDate),
      today: [],
      yesterday: [],
      wtd: {},
      names: {},
      jobs: {},
      workstream: {},
      error,
    }));
  }
}

/** One store-day from shifts already read — the part of storeDaysFor per date. */
function buildStoreDay(
  base: Pick<StoreDay, "storeId" | "storeName" | "state" | "timeZone" | "localDate">,
  shiftsOn: (date: string) => PARShift[],
  nameById: Map<string, Awaited<ReturnType<typeof getEmployees>>[number]>,
  jobById: Map<string, Awaited<ReturnType<typeof getJobs>>[number]>,
  linked: Awaited<ReturnType<typeof linkedRosterOrEmpty>>,
): StoreDay {
  const localDate = base.localDate;
  const today = shiftsOn(localDate);
  const yesterday = shiftsOn(shiftLocalDate(localDate, -1));

  /*
   * Week to date, including the date's own shifts — so on today the figure
   * climbs through the day, which is the point: the question it answers is
   * whether somebody should be sent home before they cross forty.
   *
   * On a Monday the week has no earlier days and yesterday is Sunday, which
   * belongs to last week's payroll — so it is left out entirely, and somebody
   * finishing an overnight Sunday shift correctly shows no hours against the
   * week that just started.
   */
  const weekDays = weekToDateBefore(localDate).map(shiftsOn);

  const wtd: StoreDay["wtd"] = {};
  for (const day of [...weekDays, today]) {
    for (const sh of day) {
      if (!sh.employeeId) continue;
      const acc = (wtd[sh.employeeId] ??= { minutes: 0, shifts: 0 });
      acc.minutes += sh.minutesWorked;
      acc.shifts += 1;
    }
  }

  // Names, jobs and Workstream facts for just the people and jobs on these
  // two days — what a minute's roster can show — so the day stays small
  // enough to send to the page.
  const names: StoreDay["names"] = {};
  const jobNames: StoreDay["jobs"] = {};
  const workstream: StoreDay["workstream"] = {};
  for (const sh of [...today, ...yesterday]) {
    if (sh.jobId && !(sh.jobId in jobNames)) {
      const job = jobById.get(sh.jobId);
      if (job) jobNames[sh.jobId] = job.name;
    }
    const id = sh.employeeId;
    if (!id || id in names) continue;
    const ws = linked.get(id);
    // Workstream's name wins where there is one: PAR's is a first name and a
    // last initial, and a roster is read to find a person.
    names[id] = ws?.name ?? fullName(nameById.get(id)) ?? `#${id}`;
    if (ws) {
      workstream[id] = {
        fullName: ws.name,
        position: ws.title,
        rateOfRecord: ws.hourlyRate,
        hiredDate: ws.hiredDate,
        terminationDate: ws.terminationDate,
        linkedBy: ws.linkedBy,
        assignedElsewhere: ws.assignedElsewhere,
      };
    }
  }

  return { ...base, today, yesterday, wtd, names, jobs: jobNames, workstream, error: null };
}

export type StaffingDay = {
  date: string;
  stores: StoreDay[];
  fetchedAt: number;
  workstreamSync: StaffingReport["workstreamSync"];
};

/**
 * Every store's whole day for each of `dates`, for the page to answer any
 * minute of them itself (rosterAt) — the slider then needs no request per
 * position, and the week behind today none per date.
 *
 * Same reads as a single minute: the day still being worked from PAR (live on
 * Refresh, else at most two minutes old), earlier dates from stored history in
 * one batch per store.
 */
export async function getStaffingDays(dates: string[], { fresh = false }: { fresh?: boolean } = {}): Promise<StaffingDay[]> {
  const [byStore, status] = await Promise.all([
    withParPriority(PAR_PRIORITY.onClock, () =>
      Promise.all(PAR_LOCATIONS.map((loc) => storeDaysFor(loc, dates, fresh)))),
    workstreamSyncStatus().catch(() => ({ rows: 0, lastSyncedAt: null })),
  ]);
  const fetchedAt = Date.now();
  const workstreamSync = syncAge(status);
  return dates.map((date, i) => ({ date, stores: byStore.map((days) => days[i]), fetchedAt, workstreamSync }));
}

function syncAge(status: { rows: number; lastSyncedAt: string | null }): StaffingReport["workstreamSync"] {
  return {
    ...status,
    ageHours: status.lastSyncedAt
      ? Math.round(((Date.now() - new Date(status.lastSyncedAt).getTime()) / 3_600_000) * 10) / 10
      : null,
  };
}

/**
 * Every store's roster, at one instant or at one local time of day.
 *
 * Stores run in parallel; par.ts's semaphore caps the actual SOAP concurrency
 * at five, and every call here is cached, so a repeat look at the same moment
 * costs nothing.
 */
export async function getStaffingAt(
  moment: StaffingMoment,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<StaffingReport> {
  const [stores, status] = await Promise.all([
    // Ahead of the other sections' PAR reads: this is the roster at the top of
    // the tab, and the one somebody is waiting on.
    withParPriority(PAR_PRIORITY.onClock, () =>
      Promise.all(PAR_LOCATIONS.map((loc) => rosterForStore(loc, moment, fresh)))),
    // Never a reason for the page to fail: if the roster table cannot be read,
    // say it has never synced and let the banner explain the blank columns.
    workstreamSyncStatus().catch(() => ({ rows: 0, lastSyncedAt: null })),
  ]);

  const workstreamSync = syncAge(status);

  return {
    at: moment.kind === "instant" ? moment.at.toISOString() : null,
    moment:
      moment.kind === "instant"
        ? { kind: "instant", label: moment.at.toISOString() }
        : // Said as "local" on purpose: every store on screen is at this time
          // on its own clock, which is a different instant in each timezone.
          { kind: "local", label: `${moment.date} ${clockLabel(moment.minutes)} local` },
    stores,
    fetchedAt: Date.now(),
    workstreamSync,
  };
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
   * The rate on their latest shift in the week, from PAR — what the costs
   * here are computed at. Shown when there is no Workstream rate of record, so
   * an unlinked person still has a rate beside the dollars it produced.
   */
  payRate: number | null;
  /**
   * Paid a salary, so overtime costs nothing: their hours are shown, their
   * overtime is never priced, and none of it reaches a store's cost. Workstream
   * decides where the person is linked (no hourly rate there means salaried);
   * otherwise a $0 rate on their PAR shifts does.
   */
  salaried: boolean;
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
  state: "TN" | "VA" | "TX";
  weeks: StoreWeekHours[];
  error: string | null;
};

export type HoursSpan = { start: string; end: string; label: string };

export type HoursReport = {
  /** The columns, oldest first: four finished, then the one in progress. */
  weeks: HoursSpan[];
  stores: StoreHours[];
  fetchedAt: number;
};

/** What one column of the overtime table is. */
export type HoursGrain = "week" | "payPeriod" | "period" | "quarter";

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

/** "2026-10-06" → "10/06". */
const md = (iso: string) => iso.slice(5).replace("-", "/");

/**
 * Fiscal periods for FY2025 through FY2027, oldest first.
 *
 * lib/fiscal lists FY2026 only. The other years follow the same 4-4-5 pattern
 * from their own start — FY2025 from 2024-12-30, the 364-day shift the rest of
 * the dashboard uses, and FY2027 from the day after FY2026's last period — with
 * each year's final period cut at the day before the next year begins, since
 * the year lengths differ.
 */
function fiscalPeriods(): { fy: number; period: number; quarter: number; start: string; end: string }[] {
  const fy2026Start = PERIODS[0].start;
  const yearStarts = [
    { fy: 2025, start: shiftLocalDate(fy2026Start, -364) },
    { fy: 2026, start: fy2026Start },
    { fy: 2027, start: shiftLocalDate(PERIODS[PERIODS.length - 1].end, 1) },
  ];
  const offset = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
  return yearStarts.flatMap(({ fy, start }, i) => {
    const days = offset(fy2026Start, start);
    const nextStart = yearStarts[i + 1]?.start;
    return PERIODS.map((p, j) => {
      const end = shiftLocalDate(p.end, days);
      return {
        fy,
        period: p.period,
        quarter: p.quarter,
        start: shiftLocalDate(p.start, days),
        end: j === PERIODS.length - 1 && nextStart ? shiftLocalDate(nextStart, -1) : end,
      };
    });
  });
}

/**
 * The overtime table's columns: the last four finished units of `grain` and
 * the one in progress, cut at yesterday — five points whichever is chosen.
 *
 *   week        Mon–Sun weeks, then WTD
 *   payPeriod   payroll's Mon–Sun fortnights, then PPTD
 *   period      fiscal 4-4-5 periods, then PTD
 *   quarter     fiscal quarters, then QTD
 *
 * The running unit stops at yesterday because a day still being worked reports
 * less overtime than it will finish with. On the first day of a unit, when the
 * running one has no finished days yet, the last five finished are shown.
 */
export function overtimeColumns(grain: HoursGrain, today: string): HoursSpan[] {
  const yesterday = shiftLocalDate(today, -1);
  type Unit = { start: string; end: string; label: string; toDate: string };
  let units: Unit[];

  if (grain === "week") {
    const thisMonday = mondayOf(today);
    units = [6, 5, 4, 3, 2, 1, 0].map((i) => {
      const start = shiftLocalDate(thisMonday, -7 * i);
      return { start, end: shiftLocalDate(start, 6), label: `Wk ${md(start)}`, toDate: "WTD" };
    });
  } else if (grain === "payPeriod") {
    units = recentPayPeriods(today, 7).reverse().map((p) => ({
      start: p.start, end: p.end, label: `${md(p.start)}–${md(p.end)}`, toDate: "PPTD",
    }));
  } else {
    const periods = fiscalPeriods();
    if (grain === "period") {
      units = periods.map((p) => ({
        start: p.start, end: p.end, label: `P${p.period} FY${String(p.fy).slice(2)}`, toDate: "PTD",
      }));
    } else {
      const quarters = new Map<string, Unit>();
      for (const p of periods) {
        const key = `${p.fy}Q${p.quarter}`;
        const q = quarters.get(key);
        if (q) q.end = p.end;
        else quarters.set(key, { start: p.start, end: p.end, label: `Q${p.quarter} FY${String(p.fy).slice(2)}`, toDate: "QTD" });
      }
      units = [...quarters.values()];
    }
  }

  const started = units.filter((u) => u.start <= yesterday);
  const running = started.find((u) => u.end > yesterday);
  const finished = started.filter((u) => u.end <= yesterday);
  const cols = running
    ? [...finished.slice(-4), { ...running, end: yesterday, label: running.toDate }]
    : finished.slice(-5);
  return cols.map(({ start, end, label }) => ({ start, end, label }));
}

type OvertimeRow = {
  store_id: string; col: string; employee_id: string | null;
  reg: number; ot: number; reg_cost: number; ot_cost: number; unrated: number; shifts: number;
  rate: number | null; job_id: string | null;
};

/**
 * Regular and overtime hours and cost, per store, per column, per person —
 * added up in Postgres.
 *
 * A quarter view is five quarters, about 65 weeks of shifts: some 170,000 rows
 * across the stores, too many to ship to the app on every load (and the free
 * plan's monthly transfer would feel it). Grouping in the database sends back
 * one row per person per store per column instead, a few thousand at most,
 * whichever grain is asked for.
 *
 * Costs follow the shift-level rule the screen always used: regular minutes at
 * the shift's own rate, overtime at that rate times OVERTIME_MULTIPLIER, and
 * minutes on a zero rate (salaried) counted as unrated rather than as free.
 * Jobs PAR leaves out of labor are left out here too.
 *
 * Days inside the edit window that Refresh flagged, or that we do not hold yet,
 * are brought up to date from PAR first — the same rule every other read of
 * stored shifts follows.
 */
export async function getOvertimeReport(columns: HoursSpan[]): Promise<HoursReport> {
  if (columns.length === 0) return { weeks: [], stores: [], fetchedAt: Date.now() };
  const first = columns[0].start;
  const last = columns[columns.length - 1].end;

  const facts = await Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
      try {
        const windowStart = shiftLocalDate(businessDateISO(getStoreTimeZone(loc.storeId)), -14);
        const recent = eachDate(windowStart > first ? windowStart : first, last);
        const [employees, jobs, linked, excluded] = await Promise.all([
          getEmployees(loc.storeId),
          getJobs(loc.storeId),
          linkedRosterOrEmpty(loc.storeId),
          nonLaborJobIds(loc.storeId),
          // Read for its side effect: re-reads flagged or missing window days.
          recent.length ? getShiftsHistoryRange(loc.storeId, recent) : null,
        ]);
        return { loc, employees, jobs, linked, excluded, error: null as string | null };
      } catch (err) {
        return { loc, employees: [], jobs: [], linked: new Map(), excluded: new Set<string>(), error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const excludedPairs = facts.flatMap((f) => [...f.excluded].map((job) => `${f.loc.storeId}:${job}`));
  const rows = (await sql`
    WITH cols AS (
      SELECT * FROM UNNEST(${columns.map((c) => c.start)}::text[], ${columns.map((c) => c.start)}::date[], ${columns.map((c) => c.end)}::date[])
        AS c(col, s, e)
    )
    SELECT ps.store_id, c.col, ps.employee_id,
      sum(ps.regular_minutes)::int AS reg,
      sum(ps.overtime_minutes)::int AS ot,
      sum(ps.regular_minutes * coalesce(ps.pay_rate, 0) / 60.0)::float8 AS reg_cost,
      sum(ps.overtime_minutes * coalesce(ps.pay_rate, 0) / 60.0 * ${OVERTIME_MULTIPLIER})::float8 AS ot_cost,
      sum(CASE WHEN coalesce(ps.pay_rate, 0) > 0 THEN 0 ELSE ps.regular_minutes + ps.overtime_minutes END)::int AS unrated,
      count(*)::int AS shifts,
      ((array_agg(ps.pay_rate ORDER BY ps.business_date DESC, ps.start_at DESC) FILTER (WHERE ps.pay_rate > 0))[1])::float8 AS rate,
      (array_agg(ps.job_id ORDER BY ps.business_date DESC, ps.start_at DESC))[1] AS job_id
    FROM par_shifts ps
    JOIN cols c ON ps.business_date BETWEEN c.s AND c.e
    WHERE NOT ((ps.store_id || ':' || coalesce(ps.job_id, '')) = ANY(${excludedPairs}::text[]))
    GROUP BY ps.store_id, c.col, ps.employee_id
  `) as OvertimeRow[];

  const byStoreCol = new Map<string, OvertimeRow[]>();
  for (const r of rows) {
    const key = `${r.store_id} ${r.col}`;
    byStoreCol.set(key, [...(byStoreCol.get(key) ?? []), r]);
  }
  const cents = (n: number) => Math.round(n * 100) / 100;

  const stores = facts.map(({ loc, employees, jobs, linked, error }): StoreHours => {
    if (error) return { storeId: loc.storeId, storeName: loc.name, state: loc.state, weeks: [], error };
    const empById = new Map(employees.map((e) => [e.id, e]));
    const jobById = new Map(jobs.map((jb) => [jb.id, jb]));

    /*
     * Salaried people's overtime has no pay impact, so it is never costed: the
     * hours stay, the dollars go — from the person and from the store's total.
     * Workstream is the authority where somebody is linked, because PAR's pay
     * setup lags promotions (a GM still carrying the hourly rate they had as an
     * AGM); a $0 PAR rate decides it for anyone not linked.
     */
    const isSalaried = (r: OvertimeRow) => {
      const ws = r.employee_id ? linked.get(r.employee_id) : undefined;
      return ws ? ws.hourlyRate == null : !(r.rate && r.rate > 0);
    };
    const otCost = (r: OvertimeRow) => (isSalaried(r) ? 0 : r.ot_cost);

    const weeks = columns.map((c): StoreWeekHours => {
      const cell = byStoreCol.get(`${loc.storeId} ${c.start}`) ?? [];
      const people: EmployeeWeekHours[] = cell
        .filter((r): r is OvertimeRow & { employee_id: string } => r.employee_id !== null)
        .map((r) => {
          const ws = linked.get(r.employee_id);
          return {
            employeeId: r.employee_id,
            name: ws?.name ?? fullName(empById.get(r.employee_id)) ?? `#${r.employee_id}`,
            job: r.job_id ? jobById.get(r.job_id)?.name ?? null : null,
            regularMinutes: r.reg,
            overtimeMinutes: r.ot,
            regularCost: cents(r.reg_cost),
            overtimeCost: cents(otCost(r)),
            unratedMinutes: r.unrated,
            shifts: r.shifts,
            payRate: r.rate,
            salaried: isSalaried(r),
            workstream: ws
              ? {
                  fullName: ws.name,
                  position: ws.title,
                  rateOfRecord: ws.hourlyRate,
                  hiredDate: ws.hiredDate,
                  terminationDate: ws.terminationDate,
                  linkedBy: ws.linkedBy,
                  assignedElsewhere: ws.assignedElsewhere,
                }
              : null,
          };
        })
        // Whoever is deepest into overtime first — the question this table
        // is opened to answer.
        .sort((a, b) => b.overtimeMinutes - a.overtimeMinutes || b.regularMinutes - a.regularMinutes || a.name.localeCompare(b.name));

      const sum = (f: (r: OvertimeRow) => number) => cell.reduce((n, r) => n + f(r), 0);
      return {
        weekStart: c.start,
        weekEnd: c.end,
        regularMinutes: sum((r) => r.reg),
        overtimeMinutes: sum((r) => r.ot),
        regularCost: cents(sum((r) => r.reg_cost)),
        overtimeCost: cents(sum(otCost)),
        unratedMinutes: sum((r) => r.unrated),
        people,
      };
    });
    return { storeId: loc.storeId, storeName: loc.name, state: loc.state, weeks, error: null };
  });

  return { weeks: columns, stores, fetchedAt: Date.now() };
}

function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = shiftLocalDate(d, 1)) out.push(d);
  return out;
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
  state: "TN" | "VA" | "TX";
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
          ...dates.map((d) => getShiftsHistory(loc.storeId, d)),
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
  state: "TN" | "VA" | "TX";
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
        // Opening hours from the store's Google listing (lib/storeHours), per
        // date so holidays count, with PAR's Business Hours only as a last
        // resort — PAR had five stores closing at 7pm that trade to 11.
        const [hoursByDate, ...days] = await Promise.all([
          storeHoursFor(loc.storeId, dates),
          ...dates.map((d) => getShiftsHistory(loc.storeId, d)),
        ]);

        const open: OpenCloseCell[] = [];
        const close: OpenCloseCell[] = [];

        dates.forEach((businessDate, i) => {
          const shifts = days[i] ?? [];
          const h = hoursByDate.get(businessDate);

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
          let earliest: number | null = null;
          // After close: from the close time to the last clock-out.
          let postMinutes = 0;
          let latest: number | null = null;
          // People, not shifts: somebody who clocked out and back in before
          // open is one person. A shift with no employee counts on its own.
          const prePeople = new Set<string>();
          const postPeople = new Set<string>();
          const who = (sh: PARShift, i: number) => sh.employeeId ?? `shift-${i}`;

          for (const [i, sh] of shifts.entries()) {
            const before = shiftWorkedMinutesInWindow(sh, 0, h.openMinutes);
            if (before > 0) {
              preMinutes += before;
              prePeople.add(who(sh, i));
              earliest = earliest === null ? sh.startMinutes : Math.min(earliest, sh.startMinutes);
            }
            // The upper bound is deliberately far past midnight rather than
            // 1440: a shift that ends at 1:20am reads as 1520 in its own frame,
            // and clipping at midnight would drop the part that matters most.
            const after = shiftWorkedMinutesInWindow(sh, h.closeMinutes, h.closeMinutes + 720);
            if (after > 0) {
              postMinutes += after;
              postPeople.add(who(sh, i));
              const end = sh.isOpen ? sh.startMinutes + sh.minutesWorked : sh.endMinutes;
              latest = latest === null ? end : Math.max(latest, end);
            }
          }

          open.push({
            businessDate,
            openLabel: clockLabel(h.openMinutes),
            closeLabel: clockLabel(h.closeMinutes),
            laborMinutes: Math.round(preMinutes),
            people: prePeople.size,
            edgeLabel: earliest === null ? null : clockLabel(earliest),
            edgeMinutes: earliest === null ? 0 : Math.max(0, Math.round(h.openMinutes - earliest)),
          });

          close.push({
            businessDate,
            openLabel: clockLabel(h.openMinutes),
            closeLabel: clockLabel(h.closeMinutes),
            laborMinutes: Math.round(postMinutes),
            people: postPeople.size,
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
