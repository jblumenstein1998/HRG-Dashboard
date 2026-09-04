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

import {
  PAR_LOCATIONS,
  getShifts,
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
  area: StaffArea;
  payRate: number | null;
  /** Minutes since local midnight of the shift's business date. */
  startMinutes: number;
  endMinutes: number;
  /** Wall-clock strings in the store's zone, e.g. "10:45am". */
  startLabel: string;
  endLabel: string;
  /** Still clocked in — PAR reports no clock-out yet. */
  isOpen: boolean;
  /** Minutes worked on this shift, breaks already excluded by PAR. */
  minutesWorked: number;
  /** How long they had been on when the query time landed. */
  minutesOnClockAtQuery: number;
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
  /** Sum of payRate across everyone on the clock, when every rate is known. */
  hourlyWageRunRate: number | null;
  error: string | null;
};

export type StaffingReport = {
  /** The instant asked about, ISO. */
  at: string;
  stores: StoreRoster[];
  fetchedAt: number;
};

/**
 * Front of house, back of house, or neither.
 *
 * PAR has no such field — it carries per-job booleans like IsHostess and
 * OrderEntry, but they are set inconsistently across this estate and several
 * jobs have none of them. So this is a judgement, made on the job name, and it
 * says "—" rather than guessing when a name is unfamiliar. The job name is
 * always shown next to it so a wrong call is visible rather than buried.
 */
export type StaffArea = "FOH" | "BOH" | "Management" | "Other";

export function classifyJob(jobName: string | null): StaffArea {
  if (!jobName) return "Other";
  const n = jobName.toLowerCase();
  if (/manager|above store|mgr/.test(n)) return "Management";
  if (/cook|breader|kitchen|prep|utility|dish/.test(n)) return "BOH";
  if (/cashier|host|drive|front|register|expo|delivery|driver/.test(n)) return "FOH";
  // Trainers and shift leaders work both sides; calling them either would be a
  // coin toss dressed up as data.
  if (/trainer|shift lead|crew lead/.test(n)) return "Other";
  return "Other";
}

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

/** Was this shift running at `queryMinutes`, measured in its own start frame? */
function coversMinute(shift: PARShift, queryMinutes: number): boolean {
  return queryMinutes >= shift.startMinutes && queryMinutes < shift.endMinutes;
}

const TRAILING_DAYS = 7;

async function rosterForStore(
  loc: (typeof PAR_LOCATIONS)[number],
  at: Date,
): Promise<StoreRoster> {
  const timeZone = getStoreTimeZone(loc.storeId);
  const { date: localDate, minutes: localMinutes } = zonedParts(at, timeZone);
  const base: Omit<StoreRoster, "onClock" | "hourlyWageRunRate" | "error"> = {
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

    const [employees, jobs, today, yesterday, ...trailing] = await Promise.all([
      getEmployees(loc.storeId),
      getJobs(loc.storeId),
      getShifts(loc.storeId, localDate),
      getShifts(loc.storeId, previousDate),
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
        area: classifyJob(jobName),
        payRate: shift.payRate,
        startMinutes: shift.startMinutes,
        endMinutes: shift.endMinutes,
        startLabel: clockLabel(shift.startMinutes),
        endLabel: shift.isOpen ? "on now" : clockLabel(shift.endMinutes),
        isOpen: shift.isOpen,
        minutesWorked: shift.minutesWorked,
        minutesOnClockAtQuery: Math.max(0, Math.round(queryMinutes - shift.startMinutes)),
        trailing7Minutes: trailingAcc?.minutes ?? 0,
        trailing7Shifts: trailingAcc?.shifts ?? 0,
      });
    }

    onClock.sort((a, b) => a.startMinutes - b.startMinutes || a.name.localeCompare(b.name));

    // Only meaningful when every rate is known; a salaried manager reports 0 and
    // would quietly drag the figure down if treated as a real rate.
    const rates = onClock.map((p) => p.payRate).filter((r): r is number => r !== null && r > 0);
    const hourlyWageRunRate = rates.length === onClock.length && rates.length > 0
      ? Math.round(rates.reduce((a, b) => a + b, 0) * 100) / 100
      : null;

    return { ...base, onClock, hourlyWageRunRate, error: null };
  } catch (err) {
    return {
      ...base,
      onClock: [],
      hourlyWageRunRate: null,
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
