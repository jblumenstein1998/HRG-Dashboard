/**
 * The Management tab: for every leader (Workstream's Leadership and Directors
 * tiers), how many bad things happened at a store while they were on its PAR
 * clock over a range.
 *
 * One rule for every column: an event has a store and a window, and every
 * leader with a shift overlapping that window is counted against it. The
 * windows are the ones each tab's team-on-duty button already uses —
 *
 *   zCases                the guest's visit (the whole hour when it came on the hour)
 *   slow dayparts         the daypart's hours on that day
 *   Jolt Protein / Time Temp, missed or late   shown → deadline
 *   Slack missed / late   the slot's deadline
 *   Slack accuracy        the slot's deadline, figures accurate ÷ figures posted
 *
 * — so a count here is exactly the number of times that person would appear
 * in those panels. Overlap is decided in one SQL join against par_shifts, so
 * the work is a handful of reads however many events there are.
 *
 * par_shifts is filled nightly, so a store-day it doesn't hold yet — today,
 * and yesterday until the morning cron — is read from PAR live instead, the
 * way the Staffing tab's "Now" is.
 */

import { sql } from "./db";
import { addDays, localMidnight, SLACK_SLOTS, type SlackSlot } from "./slackReports";
import { PAR_LOCATIONS, getStoreTimeZone, getShiftsRecent } from "./par";
import { getLinkedRoster } from "./workstreamRoster";
import { fetchStoreLists } from "./jolt";
import { cachedDriveThruDays, dayTimeRange, getDriveThruMetrics, type DriveThruPayload } from "./berryData";
import { loginBerryService } from "./berryAuth";
import { parseMMSS } from "./berry";
import { DAYPARTS } from "./dayparts";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS } from "./salesTierGoals";
import { BONUS_STORES } from "./bonus/storeMap";
import { mapLimit, storeSlackReport, STORE_CONCURRENCY } from "./slackCompletion";
import { checkStoreReports, loadSharedDays } from "./slackAccuracy";
import { businessDateISO } from "./businessDay";

/** Workstream titles shown as rows: the Leadership and Directors tiers. */
const LEADER_TITLES = ["General Manager", "AGM", "Director"];

/** Slower than the 100% (green) goal by more than this, in seconds. */
const LANE_OVER_SECS = 60;
const WINDOW_OVER_SECS = 30;

/** How far back Slack keeps history — the Slack columns can't see past it. */
export const SLACK_HISTORY_DAYS = 90;

export type ManagerRow = {
  uuid: string;
  name: string;
  position: string;
  /** Workstream's home store, PAR id and name; null for above-store people. */
  storeId: string | null;
  storeName: string | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  /**
   * Why a row of zeros might not mean a clean record: "unmatched" — no PAR id
   * linked to them, so nothing can be attributed; "noShifts" — linked, but no
   * shift in the range. Null when they worked.
   */
  caveat: "unmatched" | "noShifts" | null;
  zcases: number;
  slowLane: number;
  slowWindow: number;
  joltProtein: number;
  joltTimeTemp: number;
  slackMissedLate: number;
  /** Figures accurate ÷ figures posted, on reports due while on the clock. Null when none. */
  slackAccuracyPct: number | null;
  slackFigures: number;
};

export type ManagementReport = {
  start: string;
  end: string;
  /** Set when the Slack columns had to start later than the range (history limit). */
  slackFrom: string | null;
  rows: ManagerRow[];
  /** Sources that failed; their columns read low rather than the page failing. */
  warnings: string[];
};

type Kind = "zcase" | "slowLane" | "slowWindow" | "joltProtein" | "joltTimeTemp" | "slackMissedLate" | "slackAccuracy";

type Event = {
  kind: Kind;
  storeId: string;
  /** Unix seconds, inclusive both ends. */
  from: number;
  to: number;
  /** Slack accuracy only. */
  figures?: number;
  accurate?: number;
};

const storeIdByName = new Map(PAR_LOCATIONS.map((l) => [l.name.toLowerCase(), l.storeId]));
const storeNameById = new Map(PAR_LOCATIONS.map((l) => [l.storeId, l.name]));

/** A store-local date and minute as a unix instant. */
const localInstant = (storeId: string, date: string, minutes: number) =>
  localMidnight(date, getStoreTimeZone(storeId)) + minutes * 60;

function daysIn(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ── Events, one source at a time ─────────────────────────────────────────────

/** zCases by visit — event_at is the store's local wall-clock (see caseVisit). */
async function zcaseEvents(start: string, end: string): Promise<Event[]> {
  const rows = (await sql`
    SELECT store,
           to_char(event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d,
           (extract(hour FROM event_at AT TIME ZONE 'UTC') * 60
             + extract(minute FROM event_at AT TIME ZONE 'UTC'))::int AS m
    FROM smg_zcases
    WHERE event_at IS NOT NULL AND store IS NOT NULL
      AND case_type IN ('unsolicited', 'locationSurvey')
      AND (event_at AT TIME ZONE 'UTC')::date BETWEEN ${start}::date AND ${end}::date
  `) as { store: string; d: string; m: number }[];
  return rows
    .filter((r) => storeNameById.has(r.store))
    .map((r) => {
      const m = Number(r.m);
      const from = localInstant(r.store, r.d, m);
      // On the hour = given to the hour (see /api/smg/zcase/[caseKey]/team).
      return { kind: "zcase", storeId: r.store, from, to: m % 60 === 0 ? from + 59 * 60 : from };
    });
}

/**
 * Dayparts slower than the store's green goal. The tier is the drive-thru
 * tab's own for the range (weekly-equivalent sales), passed in by the caller.
 */
async function daypartEvents(
  start: string,
  end: string,
  tierSales: Record<string, number>,
  warnings: string[],
): Promise<Event[]> {
  const days = daysIn(start, end);
  const byDay = await cachedDriveThruDays(days).catch(() => new Map<string, DriveThruPayload>());
  const missing = days.filter((d) => !byDay.has(d));
  if (missing.length) {
    try {
      const token = await loginBerryService();
      await mapLimit(missing, 3, async (d) => {
        try {
          byDay.set(d, await getDriveThruMetrics(token, dayTimeRange(d), d));
        } catch (err) {
          warnings.push(`Drive-thru ${d}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    } catch (err) {
      warnings.push(`Drive-thru sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const out: Event[] = [];
  for (const [day, payload] of byDay) {
    for (const store of payload.stores) {
      // "Columbia - Columbia_28901": BerryAI's name, then the PAR id.
      const storeId = store.store_name_and_id.match(/_(\d{5})\s*$/)?.[1];
      if (!storeId || !storeNameById.has(storeId)) continue;
      const sales = tierSales[storeId];
      const lane = sales == null ? undefined : TOTAL_TIME_TIERS.find((t) => t.test(sales));
      const win = sales == null ? undefined : WINDOW_TIME_TIERS.find((t) => t.test(sales));
      for (const dp of store.dayparts) {
        const slot = DAYPARTS.find((d) => d.index === dp.index);
        if (!slot) continue;
        const from = localInstant(storeId, day, slot.startMinutes);
        const to = localInstant(storeId, day, slot.endMinutes) - 60;
        const laneSecs = parseMMSS(dp.lane_total);
        const windowSecs = parseMMSS(dp.window_service);
        if (lane && laneSecs !== null && laneSecs > lane.greenMax + LANE_OVER_SECS) {
          out.push({ kind: "slowLane", storeId, from, to });
        }
        if (win && windowSecs !== null && windowSecs > win.greenMax + WINDOW_OVER_SECS) {
          out.push({ kind: "slowWindow", storeId, from, to });
        }
      }
    }
  }
  return out;
}

/** Missed or late Protein Traceability and Time/Temperature lists. */
async function joltEvents(start: string, end: string): Promise<Event[]> {
  const report = await fetchStoreLists(start, end);
  const out: Event[] = [];
  for (const store of report.stores) {
    const storeId = storeIdByName.get(store.store.toLowerCase());
    if (!storeId) continue;
    for (const row of store.rows) {
      if ((row.status !== "missed" && row.status !== "late") || row.deadline === null) continue;
      const kind: Kind | null = /protein/i.test(row.title)
        ? "joltProtein"
        : /time\s*\/?\s*temp/i.test(row.title)
          ? "joltTimeTemp"
          : null;
      if (!kind) continue;
      out.push({ kind, storeId, from: row.shownAt ?? row.deadline - 3600, to: row.deadline });
    }
  }
  return out;
}

const deadlineMinutes = (slot: SlackSlot) => {
  const hhmm = SLACK_SLOTS.find((s) => s.id === slot)!.deadline;
  return Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
};

/** Missed and late Slack reports, and every checked report's figures, at the slot deadline. */
async function slackEvents(start: string, end: string, warnings: string[]): Promise<Event[]> {
  const shared = await loadSharedDays(start, end);
  const perStore = await mapLimit(BONUS_STORES, STORE_CONCURRENCY, async (store) => {
    const out: Event[] = [];
    try {
      const { timeZone, messages, result } = await storeSlackReport(store, start, end);
      for (const day of result.days) {
        for (const { id } of SLACK_SLOTS) {
          const status = day.slots[id];
          if (status !== "late" && status !== "missed") continue;
          const at = localInstant(store.storeId, day.date, deadlineMinutes(id));
          out.push({ kind: "slackMissedLate", storeId: store.storeId, from: at, to: at });
        }
      }
      const checks = await checkStoreReports(store, timeZone, messages, start, end, { shared });
      for (const c of checks.values()) {
        // Same counting as the admin table: by figure, "couldn't check" counts
        // as correct, and a report with nothing checkable stays out.
        if (c.accurate === null || c.checks.length === 0) continue;
        const at = localInstant(store.storeId, c.date, deadlineMinutes(c.slot));
        out.push({
          kind: "slackAccuracy",
          storeId: store.storeId,
          from: at,
          to: at,
          figures: c.checks.length,
          accurate: c.checks.filter((f) => f.ok !== false).length,
        });
      }
    } catch (err) {
      warnings.push(`Slack ${store.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
    return out;
  });
  return perStore.flat();
}

// ── People ───────────────────────────────────────────────────────────────────

type Leader = Omit<ManagerRow, "caveat" | "zcases" | "slowLane" | "slowWindow" | "joltProtein" | "joltTimeTemp" | "slackMissedLate" | "slackAccuracyPct" | "slackFigures">;

async function leaders(): Promise<{ people: Leader[]; byParKey: Map<string, string> }> {
  const rows = (await sql`
    SELECT uuid, first_name, last_name, preferred_name, job_title, store_id, hourly_rate, annual_salary
    FROM workstream_employees
    WHERE status = 'active' AND job_title = ANY(${LEADER_TITLES}::text[])
  `) as {
    uuid: string; first_name: string; last_name: string; preferred_name: string;
    job_title: string; store_id: string | null; hourly_rate: string | null; annual_salary: string | null;
  }[];
  const people: Leader[] = rows.map((r) => ({
    uuid: r.uuid,
    name: `${r.preferred_name || r.first_name} ${r.last_name}`.trim(),
    position: r.job_title,
    storeId: r.store_id,
    storeName: r.store_id ? (storeNameById.get(r.store_id) ?? null) : null,
    hourlyRate: r.hourly_rate === null ? null : Number(r.hourly_rate),
    annualSalary: r.annual_salary === null ? null : Number(r.annual_salary),
  }));
  const wanted = new Set(people.map((p) => p.uuid));

  // PAR ids per store, through the same links the Staffing tab uses (name
  // matches plus confirmed decisions). One person can hold an id at several
  // stores; every one of them counts toward the same row.
  const byParKey = new Map<string, string>();
  await Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
      const roster = await getLinkedRoster(loc.storeId).catch(() => new Map());
      for (const [parId, person] of roster) {
        if (wanted.has(person.workstreamUuid)) byParKey.set(`${loc.storeId}|${parId}`, person.workstreamUuid);
      }
    }),
  );
  return { people, byParKey };
}

// ── Shifts par_shifts doesn't hold yet ───────────────────────────────────────

/** Most store-days read live in one report — today and yesterday is 26. */
const MAX_LIVE_STORE_DAYS = 60;

type LiveShift = { storeId: string; date: string; employeeId: string; from: number; to: number };

/**
 * Leaders' shifts for every store-day in the range (and the day before, for
 * overnight closes) that par_shift_days has no good copy of — today always,
 * yesterday until the nightly cron. Read from PAR as Staffing reads "Now":
 * cached two minutes, an open shift running to the present.
 */
async function liveLeaderShifts(
  start: string,
  end: string,
  byParKey: Map<string, string>,
  warnings: string[],
): Promise<LiveShift[]> {
  const stored = new Set(
    ((await sql`
      SELECT store_id, business_date::text AS d FROM par_shift_days
      WHERE status = 'ok' AND business_date BETWEEN ${addDays(start, -1)}::date AND ${end}::date
    `) as { store_id: string; d: string }[]).map((r) => `${r.store_id}|${r.d}`),
  );
  const missing = PAR_LOCATIONS.flatMap((loc) =>
    daysIn(addDays(start, -1), end)
      .filter((d) => !stored.has(`${loc.storeId}|${d}`))
      .map((d) => ({ storeId: loc.storeId, date: d })),
  );
  if (missing.length > MAX_LIVE_STORE_DAYS) {
    warnings.push(`${missing.length} store-days of shifts aren't stored yet; read the newest ${MAX_LIVE_STORE_DAYS} from PAR`);
  }
  const now = Math.floor(Date.now() / 1000);
  const read = await mapLimit(
    missing.sort((a, b) => b.date.localeCompare(a.date)).slice(0, MAX_LIVE_STORE_DAYS),
    5,
    async ({ storeId, date }) => {
      try {
        const shifts = await getShiftsRecent(storeId, date);
        return shifts
          .filter((s) => s.employeeId && byParKey.has(`${storeId}|${s.employeeId}`))
          .map((s) => ({
            storeId,
            date,
            employeeId: s.employeeId!,
            from: localInstant(storeId, date, s.startMinutes),
            // endMinutes is in the same frame as startMinutes (an overnight
            // close passes 1440); an open shift is still going.
            to: s.isOpen ? now : localInstant(storeId, date, s.endMinutes),
          }));
      } catch (err) {
        warnings.push(`PAR shifts ${storeNameById.get(storeId)} ${date}: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
  );
  return read.flat();
}

// ── The report ───────────────────────────────────────────────────────────────

export async function getManagementReport(
  start: string,
  endRequested: string,
  tierSales: Record<string, number>,
): Promise<ManagementReport> {
  const today = businessDateISO();
  const end = endRequested > today ? today : endRequested;
  const warnings: string[] = [];
  if (start > end) return { start, end, slackFrom: null, rows: [], warnings: ["Nothing in this range yet."] };

  const slackOldest = addDays(businessDateISO(), -(SLACK_HISTORY_DAYS - 1));
  const slackStart = start < slackOldest ? slackOldest : start;

  const settle = <T>(label: string, p: Promise<T[]>): Promise<T[]> =>
    p.catch((err) => {
      warnings.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    });

  const [{ people, byParKey }, ...eventLists] = await Promise.all([
    leaders(),
    settle("zCases", zcaseEvents(start, end)),
    settle("Drive-thru", daypartEvents(start, end, tierSales, warnings)),
    settle("Jolt", joltEvents(start, end)),
    slackStart <= end ? settle("Slack", slackEvents(slackStart, end, warnings)) : Promise.resolve([]),
  ]);
  const events = eventLists.flat();
  const live = await liveLeaderShifts(start, end, byParKey, warnings);

  // Who worked at all in the range, so a row of zeros can say why.
  const parKeys = [...byParKey.keys()];
  const worked = new Set(
    parKeys.length
      ? ((await sql`
          SELECT DISTINCT store_id, employee_id FROM par_shifts
          WHERE business_date BETWEEN ${start}::date AND ${end}::date
            AND (store_id || '|' || employee_id) = ANY(${parKeys}::text[])
        `) as { store_id: string; employee_id: string }[]).map((r) => byParKey.get(`${r.store_id}|${r.employee_id}`)!)
      : [],
  );
  for (const s of live) if (s.date >= start) worked.add(byParKey.get(`${s.storeId}|${s.employeeId}`)!);
  const matched = new Set(byParKey.values());

  // Every (event, leader shift) overlap in one join. Shifts are PAR's UTC
  // instants; an open shift (end_at NULL) runs to now.
  const hits = events.length
    ? ((await sql`
        WITH e AS (
          SELECT * FROM unnest(
            ${events.map((_, i) => i)}::int[],
            ${events.map((e) => e.storeId)}::text[],
            ${events.map((e) => new Date(e.from * 1000).toISOString())}::timestamptz[],
            ${events.map((e) => new Date(e.to * 1000).toISOString())}::timestamptz[]
          ) AS t(idx, store_id, f, t)
        )
        SELECT DISTINCT e.idx, s.store_id, s.employee_id
        FROM e
        JOIN par_shifts s
          ON s.store_id = e.store_id
         AND s.start_at <= e.t
         AND COALESCE(s.end_at, now()) >= e.f
        WHERE s.employee_id IS NOT NULL
          AND s.business_date BETWEEN ${addDays(start, -1)}::date AND ${end}::date
      `) as { idx: number; store_id: string; employee_id: string }[])
    : [];
  // And the days par_shifts doesn't hold yet, against PAR's live shifts.
  events.forEach((e, idx) => {
    for (const s of live) {
      if (s.storeId === e.storeId && s.from <= e.to && s.to >= e.from) {
        hits.push({ idx, store_id: s.storeId, employee_id: s.employeeId });
      }
    }
  });

  // One count per event per person, however many of their shifts overlapped
  // it (a break splits a day into two).
  const counted = new Set<string>();
  const totals = new Map<string, Omit<ManagerRow, keyof Leader | "caveat"> & { slackAccurate: number }>();
  const blank = () => ({
    zcases: 0, slowLane: 0, slowWindow: 0, joltProtein: 0, joltTimeTemp: 0,
    slackMissedLate: 0, slackAccuracyPct: null, slackFigures: 0, slackAccurate: 0,
  });
  for (const h of hits) {
    const uuid = byParKey.get(`${h.store_id}|${h.employee_id}`);
    if (!uuid) continue;
    const key = `${h.idx}|${uuid}`;
    if (counted.has(key)) continue;
    counted.add(key);
    const e = events[h.idx];
    const t = totals.get(uuid) ?? blank();
    switch (e.kind) {
      case "zcase": t.zcases++; break;
      case "slowLane": t.slowLane++; break;
      case "slowWindow": t.slowWindow++; break;
      case "joltProtein": t.joltProtein++; break;
      case "joltTimeTemp": t.joltTimeTemp++; break;
      case "slackMissedLate": t.slackMissedLate++; break;
      case "slackAccuracy":
        t.slackFigures += e.figures ?? 0;
        t.slackAccurate += e.accurate ?? 0;
        break;
    }
    totals.set(uuid, t);
  }

  const rows: ManagerRow[] = people.map((p) => {
    const { slackAccurate, ...t } = totals.get(p.uuid) ?? blank();
    return {
      ...p,
      ...t,
      caveat: !matched.has(p.uuid) ? "unmatched" : !worked.has(p.uuid) ? "noShifts" : null,
      slackAccuracyPct: t.slackFigures > 0 ? Math.round((slackAccurate / t.slackFigures) * 1000) / 10 : null,
    };
  });

  return { start, end, slackFrom: slackStart > start ? slackStart : null, rows, warnings };
}
