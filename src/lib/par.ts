import { AsyncLocalStorage } from "node:async_hooks";
import { unstable_cache } from "next/cache";
import { readMany, readThrough } from "@/lib/sourceCache";

const ACCESS_TOKEN = process.env.PAR_ACCESS_TOKEN ?? "";
const BASE_URL     = process.env.PAR_BASE_URL ?? "https://api-apiint.brinkpos.net";

export const PAR_IS_SANDBOX = BASE_URL.includes("apiint");

export type PARLocation = { storeId: string; name: string; state: "TN" | "VA" };

const PROD_LOCATIONS: PARLocation[] = [
  { storeId: "36001", name: "Springfield",  state: "TN" },
  { storeId: "42601", name: "White House",  state: "TN" },
  { storeId: "56301", name: "Brentwood",    state: "TN" },
  { storeId: "61401", name: "Spring Hill",  state: "TN" },
  { storeId: "28901", name: "Columbia",     state: "TN" },
  { storeId: "75075", name: "Portland",     state: "TN" },
  { storeId: "57001", name: "College",      state: "VA" },
  { storeId: "57002", name: "Hampton",      state: "VA" },
  { storeId: "57003", name: "Oyster",       state: "VA" },
  { storeId: "57004", name: "Chesapeake",   state: "VA" },
  { storeId: "57005", name: "Jefferson",    state: "VA" },
  { storeId: "57006", name: "Hillcrest",    state: "VA" },
  { storeId: "57007", name: "Beach",        state: "VA" },
];

/**
 * A store whose PAR_TOKEN_* isn't set is left out rather than listed and failed
 * on every call. That is how a new store comes online: it sits in
 * PROD_LOCATIONS from the day it opens, and appears on every PAR-backed tab the
 * deploy after its location token is added in Vercel. Server-only — clients
 * import the PARLocation type, never this list.
 */
export const PAR_LOCATIONS: PARLocation[] = PAR_IS_SANDBOX
  ? [{ storeId: "SANDBOX", name: "API Lab-01 (Sandbox)", state: "TN" }]
  : PROD_LOCATIONS.filter((l) => process.env[`PAR_TOKEN_${l.storeId}`]);

export function getLocationToken(storeId: string): string {
  if (PAR_IS_SANDBOX) return process.env.PAR_SANDBOX_LOCATION_TOKEN ?? "";
  const token = process.env[`PAR_TOKEN_${storeId}`];
  // Stores reached by id rather than through PAR_LOCATIONS (bonus, Workstream)
  // get a sentence naming the missing variable instead of a SOAP fault.
  if (!token) throw new Error(`PAR_TOKEN_${storeId} is not set — store ${storeId} isn't connected to PAR yet`);
  return token;
}

// ── Rate limiter (5 concurrent per PAR best-practice guide) ──────────────────

/*
 * One queue per priority level, served lowest level first, FIFO within a level.
 *
 * The Staffing tab fires every section at once and they all share these five
 * permits, so without an order the roster at the top waited behind a hundred-odd
 * shift reads for the charts below it. The levels are the order somebody reads
 * the page in — see PAR_PRIORITY.
 */
export const PAR_PRIORITY = {
  onClock: 0,
  missedPunches: 1,
  hours: 2,
  openClose: 3,
  /** Anything that did not ask: crons, other tabs, the reconciliation. */
  background: 4,
} as const;

class Semaphore {
  private permits: number;
  private queues: (() => void)[][] = [];
  constructor(n: number) { this.permits = n; }
  acquire(level: number): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise(r => (this.queues[level] ??= []).push(r));
  }
  release(): void {
    for (const q of this.queues) {
      const next = q?.shift();
      if (next) { next(); return; }
    }
    this.permits++;
  }
}
const sem = new Semaphore(5);

// Carried through the async call chain rather than threaded as an argument
// through every fetcher, so getEmployees/getShifts/etc. need no changes.
const parPriority = new AsyncLocalStorage<number>();

/** Runs `fn` with its PAR calls queued at `level` (lower goes first). */
export function withParPriority<T>(level: number, fn: () => Promise<T>): Promise<T> {
  return parPriority.run(level, fn);
}

// ── Cache ─────────────────────────────────────────────────────────────────────
// Wrapped with unstable_cache (below) instead of an in-memory Map: on Vercel each
// serverless invocation can land on a different instance, so a module-level Map
// doesn't actually survive between requests in production — unstable_cache is
// backed by Next's durable Data Cache, which does.

const CACHE_REVALIDATE_SECONDS = 60 * 60; // 1 hr

/**
 * Bumped whenever a parser below starts reading a field it did not before.
 *
 * unstable_cache keys on the arguments, not on the shape of what was stored, so
 * a cached entry written by an older parser is served back missing the new
 * fields — silently, and for as long as the TTL runs. Adding regular/overtime
 * minutes to a shift did exactly that: a week that was already cached reported
 * zero hours for every store while a week that was not reported correctly.
 */
const PARSE_VERSION = "v2";

// ── XML helpers ───────────────────────────────────────────────────────────────

function tagVal(xml: string, tag: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`, "i");
  return xml.match(re)?.[1]?.trim() ?? null;
}

function allTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z]+:)?${tag}>`, "gi");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

// Removes a nested array block (e.g. Order.Entries, Shift.Breaks) before scalar-field
// extraction, since those arrays contain elements (OrderItem, Break, ...) with their own
// same-named fields (NetSales, StartTime, ...) that would otherwise be matched first by
// tagVal's naive first-match regex.
function stripTag(xml: string, tag: string): string {
  const re = new RegExp(`<(?:[a-zA-Z]+:)?${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[a-zA-Z]+:)?${tag}>`, "i");
  return xml.replace(re, "");
}

// ── SOAP transport ────────────────────────────────────────────────────────────

async function soapPost(service: string, action: string, body: string, locationToken: string): Promise<string> {
  await sem.acquire(parPriority.getStore() ?? PAR_PRIORITY.background);
  try {
    const res = await fetch(`${BASE_URL}/${service}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"${action}"`,
        "AccessToken": ACCESS_TOKEN,
        "LocationToken": locationToken,
      },
      body: `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`,
      // A full day of orders for a busy store runs to several MB; 30s was too
      // tight for the largest of them under load.
      signal: AbortSignal.timeout(90_000),
    });
    const text = await res.text();

    // Everything below turns a failed call into a thrown error rather than a
    // body that parses as "this day had no orders". That distinction is the
    // whole ballgame for the rollup: a caller can retry or skip on an error,
    // but an empty day is indistinguishable from a closed store and will be
    // written straight over good figures. One store-day was zeroed this way
    // (Spring Hill 2026-01-07, $8,646.69 of sales) before these checks existed.
    if (!res.ok) {
      throw new Error(`PAR ${service} HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    if (/<(?:[a-zA-Z]+:)?Fault[\s>]/.test(text)) {
      throw new Error(`PAR ${service} SOAP fault: ${(tagVal(text, "faultstring") ?? text.slice(0, 300))}`);
    }
    const resultCode = tagVal(text, "ResultCode");
    if (resultCode !== null && resultCode !== "0") {
      throw new Error(`PAR ${service} ResultCode=${resultCode}: ${tagVal(text, "Message") ?? "(no message)"}`);
    }
    return text;
  } finally {
    sem.release();
  }
}

// ── Data types ────────────────────────────────────────────────────────────────

export type PAROrder = {
  netSales:   number;
  // Hour/minute-of-day this order was OPENED, not closed — verified against
  // PAR's own back-office "Sales and Labor Report by Hour": it buckets orders
  // by OpenedTime, and an order that opens right before an hour boundary but
  // doesn't close/pay until just after it (routine for anything that takes
  // more than a few seconds to ring up) lands in the earlier hour there, not
  // the later one ClosedTime would suggest. Matching that convention here is
  // what makes our hourly numbers reconcile with PAR's own report.
  openedHour: number | null; // local hour 0-23, null if OpenedTime missing
  openedMinutes: number | null; // minutes since local midnight, null if OpenedTime missing
  isRefund:   boolean;
  // PAR's own "does this count as a transaction" flag (Order.Count, always 0 or 1).
  // Some closed $0 orders have Count=0 (not real transactions — duplicates/corrections)
  // while others are legitimate $0 transactions (e.g. comps) with Count=1. Order array
  // length overcounts vs PAR's own transaction count; always sum isCountedOrder instead
  // of using orders.length for order/transaction counts or avg-ticket calculations.
  isCountedOrder: boolean;
};

// Jobs PAR leaves out of the Labor Hours on its own Sales Summary. This is not
// our judgement call — each job in Settings2.svc carries an explicit
// ExcludeOnSalesAndLaborReports flag, and we read it rather than deciding for
// ourselves which roles count.
//
// As of 2026-08-31 exactly two jobs have it set, chain-wide: "Training mode"
// (649495739) and "Above Store" (649490824) — trainees are not productive
// labor, and above-store staff working in a restaurant are not that
// restaurant's labor. Counting them put productivity out by up to 2.7% on the
// four stores that had such shifts; verified against the report for all 12
// stores over 8/24-8/30, every one matching to the decimal once excluded.
//
// Note the flag is the rule, not an unpaid rate: "Salary - General Manager"
// (649487911) is PayRate 0 at five stores and PAR counts every minute of it.
//
// Fallback for a Settings2.svc failure. Reading the flag live is the point —
// this only keeps a transient outage from silently reinflating labor, and goes
// stale the moment someone flags a new job in the back office.
const KNOWN_NON_LABOR_JOB_IDS = new Set(["649495739", "649490824"]);

export type PARJob = {
  id: string;
  name: string;
  /** PAR's own flag for "leave this job out of the Sales and Labor reports". */
  excludeFromReports: boolean;
};

export type PARShift = {
  startMinutes: number; // minutes from midnight, local time
  endMinutes:   number;
  minutesWorked: number;
  jobId: string | null;
  /** PAR's employee id, joins to PAREmployee.id. */
  employeeId: string | null;
  /** Hourly rate as PAR recorded it on this shift. Salaried roles report 0. */
  payRate: number | null;
  /**
   * PAR's own split of the shift into straight time and overtime. Taken rather
   * than derived: overtime depends on a payroll workweek and on rules this app
   * has no sight of, and a total computed here would disagree with what people
   * are actually paid.
   */
  regularMinutes: number;
  overtimeMinutes: number;
  // True if this employee hasn't clocked out yet. PAR represents "no clock-out
  // yet" as an EndTime whose DateTime is the sentinel 0001-01-01 — NOT a missing
  // tag — so this can't be inferred from endDt being null.
  isOpen: boolean;
  // Unpaid/paid break windows within [startMinutes, endMinutes) — needed to
  // correctly attribute labor across hour buckets (see getWindowTotals):
  // MinutesWorked already excludes these for the whole-shift total, but an
  // hour-bucket overlap against the raw start/end span would otherwise count
  // break time as worked in whichever hour(s) the break happened to fall in.
  breaks: { startMinutes: number; endMinutes: number }[];
};

// ── Timezone conversion ──────────────────────────────────────────────────────
// PAR's ClosedTime/StartTime/EndTime DateTime values are explicit UTC (they
// carry a trailing "Z", e.g. "2026-07-22T15:17:49.7053991Z") — NOT naive
// store-local timestamps as previously assumed here. Using Date.getHours()
// on them returns the hour in whatever timezone the *server process* happens
// to be running in (Eastern on a dev machine, UTC on Vercel), which is wrong
// unless that machine's timezone happens to coincidentally match the store's
// own timezone. TN stores are Central, VA stores are Eastern, so this must be
// computed per store, not read off the ambient runtime timezone.

export const STATE_TIMEZONE: Record<PARLocation["state"], string> = {
  TN: "America/Chicago",
  VA: "America/New_York",
};

export function getStoreTimeZone(storeId: string): string {
  const loc = PAR_LOCATIONS.find(l => l.storeId === storeId);
  return STATE_TIMEZONE[loc?.state ?? "TN"];
}

function zonedMinutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return get("hour") * 60 + get("minute");
}

// ── XML parsing (shared between cached and always-live fetchers) ────────────

function parseOrdersXml(xml: string, timeZone: string): PAROrder[] {
  return allTags(xml, "Order").map(o => {
    const top           = stripTag(o, "Entries"); // line items carry their own NetSales
    const netSales      = parseFloat(tagVal(top, "NetSales") ?? "0") || 0;
    const isRefund      = tagVal(top, "IsRefund") === "true";
    const isCountedOrder = tagVal(top, "Count") === "1";
    const openedTimeXml = tagVal(top, "OpenedTime") ?? "";
    const dtStr         = tagVal(openedTimeXml, "DateTime");
    const openedMinutes = dtStr ? zonedMinutesOfDay(new Date(dtStr), timeZone) : null;
    const openedHour    = openedMinutes != null ? Math.floor(openedMinutes / 60) : null;
    return { netSales, openedHour, openedMinutes, isRefund, isCountedOrder };
  });
}

/**
 * A shift exactly as PAR records it — every field GetShifts returns, with
 * times left as PAR's UTC instants.
 *
 * This is what parShiftStore.ts saves, so nothing the response carries is lost
 * to the conversion into PARShift. Parsing goes response → record → PARShift
 * whether the response came from PAR a moment ago or from the database, which
 * is what keeps the two sources from ever disagreeing about a shift.
 */
export type PARShiftRecord = {
  /** PAR's own shift id (a GUID) — stable across edits. */
  id: string;
  number: number | null;
  businessDate: string | null;
  clockOutBusinessDate: string | null;
  employeeId: string | null;
  jobId: string | null;
  startAt: string | null;
  /** Null while still clocked in (PAR's EndTime is the 0001-01-01 sentinel). */
  endAt: string | null;
  minutesWorked: number;
  regularMinutes: number;
  overtimeMinutes: number;
  extendedMinutes: number;
  payRate: number | null;
  declaredTips: number | null;
  modifiedAt: string | null;
  breaks: { number: number | null; startAt: string | null; endAt: string | null; minutes: number | null; isPaid: boolean | null }[];
};

const num = (v: string | null): number | null => {
  const n = Number.parseFloat(v ?? "");
  return Number.isFinite(n) ? n : null;
};
const dateTimeOf = (xml: string, tag: string): string | null => tagVal(tagVal(xml, tag) ?? "", "DateTime");
const dateOnly = (v: string | null): string | null => (v ? v.slice(0, 10) : null);

export function parseShiftRecords(xml: string): PARShiftRecord[] {
  return allTags(xml, "Shift").map(s => {
    // Break StartTime/EndTime must be read from the raw (unstripped) shift —
    // stripTag below removes this block before extracting the shift's own
    // scalar fields, same nested-array reasoning as Order.Entries above.
    const breaksXml = tagVal(s, "Breaks") ?? "";
    const top = stripTag(s, "Breaks"); // breaks carry their own StartTime/EndTime

    const endDt = dateTimeOf(top, "EndTime");
    const paid = (b: string) => tagVal(b, "IsPaid");
    return {
      id: tagVal(top, "Id") ?? "",
      number: num(tagVal(top, "Number")),
      businessDate: dateOnly(tagVal(top, "BusinessDate")),
      clockOutBusinessDate: dateOnly(tagVal(top, "ClockOutBusinessDate")),
      employeeId: tagVal(top, "EmployeeId"),
      jobId: tagVal(top, "JobId"),
      startAt: dateTimeOf(top, "StartTime"),
      // Sentinel "no value" date PAR uses for an EndTime that hasn't happened yet.
      endAt: !endDt || endDt.startsWith("0001-01-01") ? null : endDt,
      minutesWorked: parseInt(tagVal(top, "MinutesWorked") ?? "0") || 0,
      regularMinutes: parseInt(tagVal(top, "RegularMinutesWorked") ?? "0") || 0,
      overtimeMinutes: parseInt(tagVal(top, "OvertimeMinutesWorked") ?? "0") || 0,
      extendedMinutes: parseInt(tagVal(top, "ExtendedMinutesWorked") ?? "0") || 0,
      payRate: num(tagVal(top, "PayRate")),
      declaredTips: num(tagVal(top, "DeclaredTips")),
      modifiedAt: dateTimeOf(top, "ModifiedTime"),
      breaks: allTags(breaksXml, "Break").map(b => ({
        number: num(tagVal(b, "Number")),
        startAt: dateTimeOf(b, "StartTime"),
        endAt: dateTimeOf(b, "EndTime"),
        minutes: num(tagVal(b, "Minutes")),
        isPaid: paid(b) == null ? null : paid(b) === "true",
      })),
    };
  });
}

function parseShiftsXml(xml: string, timeZone: string): PARShift[] {
  return parseShiftRecords(xml).map(r => shiftFromRecord(r, timeZone));
}

/** A stored or freshly parsed record, as the app reads shifts. */
export function shiftFromRecord(r: PARShiftRecord, timeZone: string): PARShift {
  const { jobId, employeeId, payRate, regularMinutes, overtimeMinutes, minutesWorked } = r;
  const endDt = r.endAt;
  const isOpen = endDt === null;

  const startDate = r.startAt ? new Date(r.startAt) : null;
  const startMinutes = startDate ? zonedMinutesOfDay(startDate, timeZone) : 0;

  // Every other minute-of-day value on this shift (break times, end time) is
  // derived as startMinutes + elapsed real minutes since start, NOT by
  // independently re-deriving wall-clock hour/minute from each timestamp.
  // A closing shift routinely ends after midnight (e.g. clocks out 2:15 AM
  // the next calendar day) — re-parsing that end timestamp's hour/minute in
  // isolation gives "2:15" = 135 minutes, which is *less* than a startMinutes
  // like 785 (1:05 PM), silently producing a negative/zero overlap against
  // every hour bucket for the rest of that shift. Anchoring everything to
  // elapsed time from the (correctly zoned) start avoids that entirely —
  // the result can legitimately exceed 1440 for a post-midnight end/break,
  // which shiftWorkedMinutesInWindow (parRollup.ts) accounts for.
  const elapsedMinutesSinceStart = (dt: string | null): number | null => {
    if (!dt || !startDate) return null;
    return startMinutes + (new Date(dt).getTime() - startDate.getTime()) / 60000;
  };

  const breaks = r.breaks.flatMap(b => {
    const bStart = elapsedMinutesSinceStart(b.startAt);
    const bEnd = elapsedMinutesSinceStart(b.endAt);
    return bStart != null && bEnd != null ? [{ startMinutes: bStart, endMinutes: bEnd }] : [];
  });

  const endMinutes = isOpen ? startMinutes + minutesWorked : (elapsedMinutesSinceStart(endDt) ?? startMinutes + minutesWorked);
  return {
    startMinutes, endMinutes, minutesWorked, jobId, employeeId, payRate,
    regularMinutes, overtimeMinutes, isOpen, breaks,
  };
}

// ── Fetch functions ───────────────────────────────────────────────────────────

export const getOrders = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PAROrder[]> => {
    const token = getLocationToken(storeId);
    const xml = await soapPost(
      "Sales2.svc",
      "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders",
      `<GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders>`,
      token,
    );
    return parseOrdersXml(xml, getStoreTimeZone(storeId));
  },
  ["par-orders", PARSE_VERSION],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["par-data"] },
);

// Job definitions change when someone edits them in the back office, which is
// rare — a day's cache is plenty, and it keeps GetJobs off the per-day path
// entirely when a range is being backfilled.
/**
 * One person, as much of them as this app has any business holding.
 *
 * GetEmployees returns an HR file: alongside the name and job it carries SSN,
 * date of birth, home address, personal phone numbers, payroll id, and the PIN
 * and card number the person logs into the POS with. None of that is read.
 * The narrowing happens here, at the boundary, so the sensitive fields exist
 * only for the microseconds this parser runs and can never reach a cache, an
 * API response or a browser.
 *
 * Pay rate is deliberately taken from the shift rather than from here — the
 * staffing tab wants what someone was paid for the shift being looked at, and
 * that avoids holding a current rate for the other 180 people who are not on it.
 */
export type PAREmployee = {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  /** Their default job. A shift carries its own, which wins where they differ. */
  jobId: string | null;
  terminated: boolean;
};

export const getEmployees = unstable_cache(
  async (storeId: string): Promise<PAREmployee[]> => {
    const xml = await soapPost(
      "Settings2.svc",
      "http://www.brinksoftware.com/webservices/settings/v2/ISettingsWebService2/GetEmployees",
      `<GetEmployees xmlns="http://www.brinksoftware.com/webservices/settings/v2"><request></request></GetEmployees>`,
      getLocationToken(storeId),
    );
    return allTags(xml, "Employee").flatMap(e => {
      // Jobs is a nested array whose entries carry their own Id and JobId, which
      // would otherwise be matched first by tagVal's naive first-match regex —
      // the same trap as Order.Entries and Shift.Breaks above.
      const top = stripTag(e, "Jobs");
      const id = tagVal(top, "Id");
      if (!id) return [];
      const firstName = tagVal(top, "FirstName") ?? "";
      const lastName = tagVal(top, "LastName") ?? "";
      return [{
        id,
        firstName,
        lastName,
        displayName: tagVal(top, "DisplayName") || [firstName, lastName].filter(Boolean).join(" ") || id,
        jobId: tagVal(top, "JobId"),
        terminated: tagVal(top, "Terminated") === "true",
      }];
    });
  },
  ["par-employees", PARSE_VERSION],
  // Its own tag as well, so the Staffing tab's Refresh can re-read thirteen
  // staff lists without throwing away every cached day of shifts and sales.
  { revalidate: 60 * 60 * 24, tags: ["par-data", "par-employees"] },
);

/**
 * When a store opens and closes, per day of week.
 *
 * PAR states these as ISO-8601 durations from midnight — PT10H30M is 10:30 —
 * which is why they are held as minutes rather than as clock strings: the whole
 * point is arithmetic against shift times, which are also minutes from midnight.
 *
 * A close at or before the open means the store trades past midnight, so the
 * close is pushed into the next day rather than left to read as a negative
 * trading day.
 */
export type PARBusinessHours = {
  /** Day of week, 0 = Sunday, as JavaScript counts them. */
  dayOfWeek: number;
  openMinutes: number;
  closeMinutes: number;
};

const DAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

/** "PT10H30M" -> 630. */
function isoDurationToMinutes(text: string | null): number | null {
  if (!text) return null;
  const h = Number(text.match(/(\d+)H/)?.[1] ?? 0);
  const m = Number(text.match(/(\d+)M/)?.[1] ?? 0);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

export const getBusinessHours = unstable_cache(
  async (storeId: string): Promise<PARBusinessHours[]> => {
    const xml = await soapPost(
      "Settings2.svc",
      "http://www.brinksoftware.com/webservices/settings/v2/ISettingsWebService2/GetBusinessHours",
      `<GetBusinessHours xmlns="http://www.brinksoftware.com/webservices/settings/v2"><request></request></GetBusinessHours>`,
      getLocationToken(storeId),
    );
    return allTags(xml, "BusinessHour").flatMap(b => {
      const day = DAY_INDEX[tagVal(b, "DayOfWeek") ?? ""];
      const openMinutes = isoDurationToMinutes(tagVal(b, "OpenTime"));
      const closeMinutes = isoDurationToMinutes(tagVal(b, "CloseTime"));
      if (day === undefined || openMinutes === null || closeMinutes === null) return [];
      return [{
        dayOfWeek: day,
        openMinutes,
        closeMinutes: closeMinutes <= openMinutes ? closeMinutes + 1440 : closeMinutes,
      }];
    });
  },
  ["par-business-hours", PARSE_VERSION],
  { revalidate: 60 * 60 * 24, tags: ["par-data"] },
);

export const getJobs = unstable_cache(
  async (storeId: string): Promise<PARJob[]> => {
    const xml = await soapPost(
      "Settings2.svc",
      "http://www.brinksoftware.com/webservices/settings/v2/ISettingsWebService2/GetJobs",
      `<GetJobs xmlns="http://www.brinksoftware.com/webservices/settings/v2"><request></request></GetJobs>`,
      getLocationToken(storeId),
    );
    return allTags(xml, "Job").flatMap(j => {
      const id = tagVal(j, "Id");
      if (!id) return [];
      return [{
        id,
        name: tagVal(j, "Name") ?? "",
        excludeFromReports: tagVal(j, "ExcludeOnSalesAndLaborReports") === "true",
      }];
    });
  },
  ["par-jobs", PARSE_VERSION],
  { revalidate: 60 * 60 * 24, tags: ["par-data"] },
);

export async function nonLaborJobIds(storeId: string): Promise<Set<string>> {
  try {
    const jobs = await getJobs(storeId);
    // An empty or unparseable response would exclude nothing and quietly
    // reinflate labor, so treat "no jobs came back" as a failure too.
    if (jobs.length === 0) throw new Error("GetJobs returned no jobs");
    return new Set(jobs.filter(j => j.excludeFromReports).map(j => j.id));
  } catch (err) {
    console.warn(`[par] GetJobs failed for ${storeId}, falling back to known exclusions`, err);
    return KNOWN_NON_LABOR_JOB_IDS;
  }
}

/** Drops the shifts PAR itself leaves out of Labor Hours. */
export function withoutNonLaborJobs(shifts: PARShift[], excluded: Set<string>): PARShift[] {
  return shifts.filter(s => !s.jobId || !excluded.has(s.jobId));
}

/**
 * PAR's whole GetShifts response for one store-day, uncached and unfiltered.
 *
 * For parShiftStore.ts, which saves every shift — non-labor jobs included,
 * since that filter is applied on read and a job's report flag can change — and
 * keeps the response itself as insurance against fields nobody parses yet.
 */
export async function getShiftsXml(storeId: string, businessDate: string): Promise<string> {
  return soapPost(
    "Labor2.svc",
    "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
    `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
    getLocationToken(storeId),
  );
}

export const getShifts = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PARShift[]> => {
    const token = getLocationToken(storeId);
    // Sequential, NOT Promise.all: both calls draw on the same 5-permit
    // semaphore, so overlapping them lets five callers each hold a shifts
    // permit while waiting for a jobs permit, and nothing ever releases.
    // GetJobs is cached for a day, so this costs one request, once.
    const excluded = await nonLaborJobIds(storeId);
    const xml = await soapPost(
      "Labor2.svc",
      "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
      `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
      token,
    );
    return withoutNonLaborJobs(parseShiftsXml(xml, getStoreTimeZone(storeId)), excluded);
  },
  ["par-shifts", PARSE_VERSION],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["par-data"] },
);

// Uncached variants — used by the live "Today vs Last Year" table, which needs
// to reflect PAR's numbers at the exact moment of each refresh (today's order
// count and open shifts' worked-minutes keep changing minute to minute), not
// whatever happened to be sitting in the 1hr shared cache.
/**
 * Cash over/short for a business day: the sum of every till's OverShort
 * (positive = over). Sales2.svc GetTills, one till per drawer session.
 *
 * Checked against store-posted Slack figures on 2026-10-29: Brentwood matched
 * to the cent on four days; Hampton's posts didn't match on either day tried,
 * so what Hampton reports is something other than the drawer total.
 *
 * PaidInOuts and Skims are stripped before reading the till's own fields —
 * same nested-array hazard stripTag exists for.
 */
export type PARCashSummary = {
  overShort: number;
  tills: number;
  openTills: number;
  /**
   * Tills closed with nothing declared, left out of overShort. Columbia
   * 2026-10-27 closed one with $0.00 declared, and PAR booked the whole
   * expected drawer as short (−$733.20) while every counted till balanced.
   */
  uncountedTills: number;
};

const fetchCashSummary = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PARCashSummary> => {
    const xml = await soapPost(
      "Sales2.svc",
      "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetTills",
      `<GetTills xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetTills>`,
      getLocationToken(storeId),
    );
    const tills = [...xml.matchAll(/<(?:[a-zA-Z]+:)?Till>([\s\S]*?)<\/(?:[a-zA-Z]+:)?Till>/g)].map((m) =>
      stripTag(stripTag(m[1], "PaidInOuts"), "Skims"),
    );
    let overShort = 0;
    let openTills = 0;
    let uncountedTills = 0;
    for (const t of tills) {
      const os = Number(tagVal(t, "OverShort") ?? 0);
      if (tagVal(t, "IsClosed") !== "true") openTills++;
      if (Number(tagVal(t, "DeclaredCash") ?? 0) === 0 && os !== 0) {
        uncountedTills++;
        continue;
      }
      overShort += os;
    }
    return { overShort: Math.round(overShort * 100) / 100, tills: tills.length, openTills, uncountedTills };
  },
  ["par-cash-v2", PARSE_VERSION],
  { revalidate: CACHE_REVALIDATE_SECONDS, tags: ["par-data"] },
);

/** A store's tills for a day. A past day is read from source_cache, fetched and saved the first time. */
export function getCashSummary(storeId: string, businessDate: string): Promise<PARCashSummary> {
  return readThrough("par_cash", `${storeId}:${businessDate}`, businessDate, () => fetchCashSummary(storeId, businessDate));
}

/** Several days' tills at once, for the Slack checks of a whole range. */
export async function getCashSummaryMany(storeId: string, days: string[]): Promise<Map<string, PARCashSummary>> {
  const stored = await readMany("par_cash", days.map((d) => `${storeId}:${d}`));
  const out = new Map<string, PARCashSummary>();
  for (const d of days) {
    const hit = stored.get(`${storeId}:${d}`) as PARCashSummary | undefined;
    if (hit) out.set(d, hit);
  }
  return out;
}

export async function getOrdersLive(storeId: string, businessDate: string): Promise<PAROrder[]> {
  const token = getLocationToken(storeId);
  const xml = await soapPost(
    "Sales2.svc",
    "http://www.brinksoftware.com/webservices/sales/v2/ISalesWebService2/GetOrders",
    `<GetOrders xmlns="http://www.brinksoftware.com/webservices/sales/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate><ExcludeOpenOrders>true</ExcludeOpenOrders></request></GetOrders>`,
    token,
  );
  return parseOrdersXml(xml, getStoreTimeZone(storeId));
}

export async function getShiftsLive(storeId: string, businessDate: string): Promise<PARShift[]> {
  const token = getLocationToken(storeId);
  // Only the shifts are refetched — "live" is about today's minutes still
  // moving, and a job's report flag is not something that changes hour to hour.
  // Sequential for the same semaphore reason as getShifts above.
  const excluded = await nonLaborJobIds(storeId);
  const xml = await soapPost(
    "Labor2.svc",
    "http://www.brinksoftware.com/webservices/labor/v2/ILaborWebService2/GetShifts",
    `<GetShifts xmlns="http://www.brinksoftware.com/webservices/labor/v2"><request><BusinessDate>${businessDate}T00:00:00</BusinessDate></request></GetShifts>`,
    token,
  );
  return withoutNonLaborJobs(parseShiftsXml(xml, getStoreTimeZone(storeId)), excluded);
}

/**
 * Today's shifts, at most two minutes old.
 *
 * For scrubbing the Staffing slider through today: every position on it reads
 * the same two business dates, so a live read per position re-fetched identical
 * shifts twelve stores at a time. "Now" and Refresh still go through
 * getShiftsLive.
 */
export const getShiftsRecent = unstable_cache(
  getShiftsLive,
  ["par-shifts-recent", PARSE_VERSION],
  { revalidate: 120, tags: ["par-data"] },
);

// ── Date utilities ────────────────────────────────────────────────────────────

export function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + "T00:00:00");
  const e = new Date(end   + "T00:00:00");
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

