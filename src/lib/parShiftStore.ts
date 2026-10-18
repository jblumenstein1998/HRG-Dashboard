/**
 * PAR shift history, kept in Postgres.
 *
 * PAR answers one store, one business date per GetShifts call, five calls at a
 * time. Every screen that looks back weeks — overtime, HR Cleanup's 30-day
 * activity, timecards to fix — was therefore hundreds of calls on a cold cache,
 * and the cache only lasted an hour. Past days barely change, so they are read
 * once and kept here (tables: scripts/migrate-par-shifts.mjs).
 *
 * ── Write: one store-day at a time, whole ────────────────────────────────────
 *
 * A store-day is replaced, never merged: delete its shifts, insert what PAR
 * holds now. That is what makes a shift deleted in PAR disappear here too —
 * the larger of the late-edit errors par-rollup measured. The nightly job
 * re-reads the trailing 14 days for the same reason it does there.
 *
 * A failed call never blanks a day. It is recorded as an error and a day that
 * was already good keeps its rows; and PAR answering "no shifts" for a day we
 * hold shifts for is treated as a failure, not a deletion of everybody.
 *
 * ── Read: three ages of day ──────────────────────────────────────────────────
 *
 *   today            PAR, as before — shifts are still open and moving.
 *   last 14 days     here, as of the nightly job or the last Refresh. This is
 *                    where timecards get fixed, but a page load never waits on
 *                    PAR for it: the tab's Refresh flags the window
 *                    (needs_refresh), and only a flagged day is re-read from PAR
 *                    on its next read. A day in the window we do not hold at all
 *                    — yesterday, before the nightly job — is fetched once.
 *   older            here, as stored. Nobody edits a month-old timecard, and
 *                    the nightly job re-reads the window before days leave it.
 *
 * Anything not held as good falls back to PAR — so a backfill in progress, or
 * a store-day that errored, costs speed and never correctness.
 */

import { gzipSync } from "node:zlib";
import { unstable_cache } from "next/cache";
import { sql } from "./db";
import {
  PAR_LOCATIONS,
  dateRange,
  getShifts,
  getShiftsXml,
  getStoreTimeZone,
  nonLaborJobIds,
  parseShiftRecords,
  shiftFromRecord,
  withoutNonLaborJobs,
  type PARShift,
  type PARShiftRecord,
} from "./par";
import { businessDateISO } from "./businessDay";
import { shiftDate } from "./workstreamAuditFormat";

/** Tag on every cached read, cleared after each sync so new rows show at once. */
export const SHIFT_HISTORY_TAG = "par-shift-history";

// ── Write ────────────────────────────────────────────────────────────────────

export type SyncResult = { storeId: string; businessDate: string; ok: boolean; shifts: number; error?: string };

export async function syncShiftDay(storeId: string, businessDate: string): Promise<SyncResult> {
  try {
    const xml = await getShiftsXml(storeId, businessDate);
    const records = parseShiftRecords(xml);

    if (records.length === 0) {
      const [held] = await sql`
        SELECT count(*)::int AS n FROM par_shifts
        WHERE store_id = ${storeId} AND business_date = ${businessDate}
      `;
      if (held.n > 0) throw new Error(`PAR returned no shifts for a day we hold ${held.n} for`);
    }

    const ids = records.map((r, i) => r.id || `n${r.number ?? "?"}-${i}`);
    const col = <T,>(f: (r: PARShiftRecord) => T) => records.map(f);

    await sql.transaction([
      sql`DELETE FROM par_shifts WHERE store_id = ${storeId} AND business_date = ${businessDate}`,
      sql`
        INSERT INTO par_shifts (
          store_id, business_date, shift_id, shift_number, employee_id, job_id,
          start_at, end_at, clock_out_business_date,
          minutes_worked, regular_minutes, overtime_minutes, extended_minutes,
          pay_rate, declared_tips, modified_at, breaks
        )
        SELECT ${storeId}, ${businessDate}::date, t.*
        FROM UNNEST(
          ${ids}::text[], ${col((r) => r.number)}::int[],
          ${col((r) => r.employeeId)}::text[], ${col((r) => r.jobId)}::text[],
          ${col((r) => r.startAt)}::timestamptz[], ${col((r) => r.endAt)}::timestamptz[],
          ${col((r) => r.clockOutBusinessDate)}::date[],
          ${col((r) => r.minutesWorked)}::int[], ${col((r) => r.regularMinutes)}::int[],
          ${col((r) => r.overtimeMinutes)}::int[], ${col((r) => r.extendedMinutes)}::int[],
          ${col((r) => r.payRate)}::numeric[], ${col((r) => r.declaredTips)}::numeric[],
          ${col((r) => r.modifiedAt)}::timestamptz[],
          ${col((r) => JSON.stringify(r.breaks))}::jsonb[]
        ) AS t
      `,
      sql`
        INSERT INTO par_shift_days (store_id, business_date, status, shift_count, raw_gzip, error, fetched_at)
        VALUES (${storeId}, ${businessDate}, 'ok', ${records.length}, ${gzipSync(xml)}, NULL, now())
        ON CONFLICT (store_id, business_date) DO UPDATE SET
          status = 'ok', shift_count = EXCLUDED.shift_count, raw_gzip = EXCLUDED.raw_gzip,
          error = NULL, fetched_at = now(), needs_refresh = false
      `,
    ]);
    return { storeId, businessDate, ok: true, shifts: records.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // A day already held keeps its rows and its "ok": one bad morning from PAR
    // must not turn good history back into a gap. The Refresh flag is cleared
    // either way, so a PAR outage costs one failed try per Refresh rather than
    // one per page load; the nightly job tries again.
    await sql`
      INSERT INTO par_shift_days (store_id, business_date, status, error, fetched_at)
      VALUES (${storeId}, ${businessDate}, 'error', ${error.slice(0, 500)}, now())
      ON CONFLICT (store_id, business_date) DO UPDATE SET
        error = EXCLUDED.error, fetched_at = now(), needs_refresh = false
    `.catch(() => {});
    return { storeId, businessDate, ok: false, shifts: 0, error };
  }
}

/**
 * Sync store-days until done or `deadline` (epoch ms), in batches.
 *
 * Batches of ten keep the five PAR permits busy without queueing the whole
 * list at once, so stopping at the deadline leaves nothing half-started.
 */
export async function syncShiftDays(
  days: { storeId: string; businessDate: string }[],
  deadline: number,
): Promise<{ results: SyncResult[]; remaining: number }> {
  const results: SyncResult[] = [];
  let i = 0;
  for (; i < days.length && Date.now() < deadline; i += 10) {
    results.push(...await Promise.all(days.slice(i, i + 10).map((d) => syncShiftDay(d.storeId, d.businessDate))));
  }
  return { results, remaining: Math.max(0, days.length - i) };
}

/** Every store-day from `start` to `end` not yet held as "ok", newest first. */
export async function missingShiftDays(start: string, end: string): Promise<{ storeId: string; businessDate: string }[]> {
  if (start > end) return [];
  const held = await sql`
    SELECT store_id, business_date::text AS d FROM par_shift_days
    WHERE status = 'ok' AND business_date BETWEEN ${start} AND ${end}
  `;
  const have = new Set(held.map((r) => `${r.store_id} ${r.d}`));
  const out: { storeId: string; businessDate: string }[] = [];
  for (const businessDate of dateRange(start, end).reverse()) {
    for (const loc of PAR_LOCATIONS) {
      if (!have.has(`${loc.storeId} ${businessDate}`)) out.push({ storeId: loc.storeId, businessDate });
    }
  }
  return out;
}

// ── Read ─────────────────────────────────────────────────────────────────────

type ShiftRow = {
  shift_id: string; shift_number: number | null; business_date: string; clock_out_business_date: string | null;
  employee_id: string | null; job_id: string | null; start_at: string | null; end_at: string | null;
  minutes_worked: number; regular_minutes: number; overtime_minutes: number; extended_minutes: number;
  pay_rate: string | null; declared_tips: string | null; modified_at: string | null;
  breaks: PARShiftRecord["breaks"];
};

const toNumber = (v: string | null) => (v == null ? null : Number(v));

/** The days timecards are still being fixed on — par-rollup measured 14. */
const EDIT_WINDOW_DAYS = 14;

type DayStatus = { ok: boolean; fetchedAt: string; needsRefresh: boolean };

/** Status of one stored day — a few bytes, never cached. */
async function dayStatus(storeId: string, businessDate: string): Promise<DayStatus | null> {
  const [day] = await sql`
    SELECT status, to_json(fetched_at) AS fetched_at, needs_refresh FROM par_shift_days
    WHERE store_id = ${storeId} AND business_date = ${businessDate}
  `;
  return day
    ? { ok: day.status === "ok", fetchedAt: day.fetched_at as string, needsRefresh: day.needs_refresh === true }
    : null;
}

/**
 * Whether reading an edit-window day should go to PAR first: only when Refresh
 * flagged it, or when we have never asked PAR for it at all. Age alone never
 * does — a page load reads what is stored.
 */
const shouldReread = (s: DayStatus | null | undefined): boolean => !s || s.needsRefresh;

/**
 * One re-read per store-day at a time.
 *
 * Every section on the Staffing tab loads at once and several read the same
 * days, so without this a stale day would be fetched from PAR once per section.
 */
const inFlight = new Map<string, Promise<SyncResult>>();
function syncOnce(storeId: string, businessDate: string): Promise<SyncResult> {
  const key = `${storeId} ${businessDate}`;
  let p = inFlight.get(key);
  if (!p) {
    p = syncShiftDay(storeId, businessDate).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
  }
  return p;
}

/**
 * Flag the edit window, so the next read of each day re-reads PAR.
 *
 * The Staffing tab's Refresh button, and the only thing that makes a read go
 * to PAR for a day we hold: "I just fixed a timecard" is when it is worth the
 * wait, and an ordinary page load is not.
 */
export async function expireEditWindow(): Promise<void> {
  const today = businessDateISO();
  await sql`
    UPDATE par_shift_days SET needs_refresh = true
    WHERE business_date >= ${shiftDate(today, -EDIT_WINDOW_DAYS)}
  `;
}

/**
 * One store-day as stored, or null when we do not hold it as good.
 *
 * Cached, so a page reads each store-day from Postgres once rather than once
 * per visitor — which is what keeps this inside the free plan's network
 * transfer. `version` is the day's fetched_at: a re-read changes it, so a fresh
 * copy is a new cache entry rather than something to invalidate. Older days
 * pass a constant and rely on SHIFT_HISTORY_TAG, which every sync clears.
 */
const readStoredShiftDay = unstable_cache(
  async (storeId: string, businessDate: string, version: string): Promise<PARShiftRecord[] | null> => {
    void version;
    const [day] = await sql`
      SELECT status FROM par_shift_days WHERE store_id = ${storeId} AND business_date = ${businessDate}
    `;
    if (day?.status !== "ok") return null;
    return (await selectShifts(storeId, [businessDate])).map(toRecord);
  },
  ["par-shift-history", "v1"],
  { revalidate: 60 * 60 * 24, tags: [SHIFT_HISTORY_TAG] },
);

/** Every stored shift for a store on any of `dates`, in one query. */
async function selectShifts(storeId: string, dates: string[]): Promise<ShiftRow[]> {
  // to_json gives ISO-8601 instants, which Date parses everywhere; the
  // driver's own text form for timestamptz does not.
  return (await sql`
    SELECT shift_id, shift_number, business_date::text, clock_out_business_date::text,
           employee_id, job_id, to_json(start_at) AS start_at, to_json(end_at) AS end_at,
           minutes_worked, regular_minutes, overtime_minutes, extended_minutes,
           pay_rate::text, declared_tips::text, to_json(modified_at) AS modified_at, breaks
    FROM par_shifts WHERE store_id = ${storeId} AND business_date = ANY(${dates}::date[])
    ORDER BY business_date, shift_number NULLS LAST, shift_id
  `) as ShiftRow[];
}

function toRecord(r: ShiftRow): PARShiftRecord {
  return {
    id: r.shift_id,
    number: r.shift_number,
    businessDate: r.business_date,
    clockOutBusinessDate: r.clock_out_business_date,
    employeeId: r.employee_id,
    jobId: r.job_id,
    startAt: r.start_at,
    endAt: r.end_at,
    minutesWorked: r.minutes_worked,
    regularMinutes: r.regular_minutes,
    overtimeMinutes: r.overtime_minutes,
    extendedMinutes: r.extended_minutes,
    payRate: toNumber(r.pay_rate),
    declaredTips: toNumber(r.declared_tips),
    modifiedAt: r.modified_at,
    breaks: r.breaks ?? [],
  };
}

/**
 * A store's stored shifts over many days, grouped by day — one query.
 *
 * Cached like the single-day read. `version` carries the fetched_at of every
 * edit-window day in the range, so re-reading any of them makes a new entry,
 * and a range already seen is served without touching Postgres.
 */
const readStoredShiftRange = unstable_cache(
  async (storeId: string, dates: string[], version: string): Promise<Record<string, PARShiftRecord[]>> => {
    void version;
    const out: Record<string, PARShiftRecord[]> = Object.fromEntries(dates.map((d) => [d, []]));
    for (const row of await selectShifts(storeId, dates)) out[row.business_date]?.push(toRecord(row));
    return out;
  },
  ["par-shift-range", "v1"],
  { revalidate: 60 * 60 * 24, tags: [SHIFT_HISTORY_TAG] },
);

/**
 * A store's shifts for many business dates at once — getShiftsHistory for a
 * range, in a handful of queries instead of two per day.
 *
 * Read one day at a time, a new 40-day overtime range was ~1,000 round trips
 * to Postgres across the stores. Here it is one status query, one batched
 * PAR re-read of whatever Refresh flagged in the edit window, and one shift
 * query, per store. Days not held as good fall back to PAR, as for a single day.
 */
export async function getShiftsHistoryRange(storeId: string, dates: string[]): Promise<Map<string, PARShift[]>> {
  const timeZone = getStoreTimeZone(storeId);
  const today = businessDateISO(timeZone);
  const windowStart = shiftDate(today, -EDIT_WINDOW_DAYS);
  const unique = [...new Set(dates)].sort();
  const past = unique.filter((d) => d < today);
  const out = new Map<string, PARShift[]>();

  const statuses = async (ds: string[]) => {
    if (ds.length === 0) return new Map<string, DayStatus>();
    const rows = await sql`
      SELECT business_date::text AS d, status, to_json(fetched_at) AS fetched_at, needs_refresh
      FROM par_shift_days
      WHERE store_id = ${storeId} AND business_date = ANY(${ds}::date[])
    `;
    return new Map(rows.map((r) => [
      r.d as string,
      { ok: r.status === "ok", fetchedAt: r.fetched_at as string, needsRefresh: r.needs_refresh === true },
    ]));
  };

  const status = await statuses(past).catch(() => new Map<string, DayStatus>());
  // Inside the edit window: only days Refresh flagged, or that PAR was never
  // asked for, are re-read from PAR first — all of them together.
  const stale = past.filter((d) => d >= windowStart && shouldReread(status.get(d)));
  if (stale.length) {
    await Promise.all(stale.map((d) => syncOnce(storeId, d)));
    for (const [d, s] of await statuses(stale).catch(() => new Map())) status.set(d, s);
  }

  const held = past.filter((d) => status.get(d)?.ok);
  const version = held.filter((d) => d >= windowStart).map((d) => status.get(d)!.fetchedAt).join("|");
  const stored = held.length
    ? await readStoredShiftRange(storeId, held, version || "settled").catch(() => null)
    : {};

  const excluded = await nonLaborJobIds(storeId);
  await Promise.all(unique.map(async (d) => {
    const records = stored?.[d];
    out.set(
      d,
      records
        ? withoutNonLaborJobs(records.map((r) => shiftFromRecord(r, timeZone)), excluded)
        : await getShifts(storeId, d),
    );
  }));
  return out;
}

/**
 * A store's shifts for one business date — the drop-in for getShifts on any
 * screen that looks back past today.
 *
 * Same output as getShifts, non-labor jobs already removed: stored days are
 * converted by the same shiftFromRecord a live response goes through.
 */
export async function getShiftsHistory(storeId: string, businessDate: string): Promise<PARShift[]> {
  const timeZone = getStoreTimeZone(storeId);
  const today = businessDateISO(timeZone);
  if (businessDate >= today) return getShifts(storeId, businessDate);

  let version = "settled";
  if (businessDate >= shiftDate(today, -EDIT_WINDOW_DAYS)) {
    // Inside the edit window: re-read PAR first only if Refresh flagged this
    // day, or PAR was never asked for it.
    let status = await dayStatus(storeId, businessDate).catch(() => null);
    if (shouldReread(status)) {
      await syncOnce(storeId, businessDate);
      status = await dayStatus(storeId, businessDate).catch(() => null);
    }
    if (!status?.ok) return getShifts(storeId, businessDate);
    version = status.fetchedAt;
  }

  const stored = await readStoredShiftDay(storeId, businessDate, version).catch(() => null);
  if (!stored) return getShifts(storeId, businessDate);

  const excluded = await nonLaborJobIds(storeId);
  return withoutNonLaborJobs(stored.map((r) => shiftFromRecord(r, timeZone)), excluded);
}
