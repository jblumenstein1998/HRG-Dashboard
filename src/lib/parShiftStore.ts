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
 * ── Read: settled days from here, the last two from PAR ─────────────────────
 *
 * Today and yesterday are still moving (open shifts, managers fixing punches),
 * so they keep coming from PAR. Anything older comes from here if we hold it,
 * and from PAR if we do not yet — so a backfill in progress, or a store-day
 * that errored, costs speed and never correctness.
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
          error = NULL, fetched_at = now()
      `,
    ]);
    return { storeId, businessDate, ok: true, shifts: records.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    // A day already held keeps its rows and its "ok": one bad morning from PAR
    // must not turn good history back into a gap.
    await sql`
      INSERT INTO par_shift_days (store_id, business_date, status, error, fetched_at)
      VALUES (${storeId}, ${businessDate}, 'error', ${error.slice(0, 500)}, now())
      ON CONFLICT (store_id, business_date) DO UPDATE SET
        error = EXCLUDED.error, fetched_at = now()
      WHERE par_shift_days.status <> 'ok'
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

/**
 * One store-day as stored, or null when we do not hold it as good.
 *
 * Cached for a day under SHIFT_HISTORY_TAG, which every sync clears — so a
 * page reads each store-day from Postgres once, not once per visitor, which is
 * what keeps this inside the free plan's network transfer.
 */
const readStoredShiftDay = unstable_cache(
  async (storeId: string, businessDate: string): Promise<PARShiftRecord[] | null> => {
    const [day] = await sql`
      SELECT status FROM par_shift_days WHERE store_id = ${storeId} AND business_date = ${businessDate}
    `;
    if (day?.status !== "ok") return null;
    // to_json gives ISO-8601 instants, which Date parses everywhere; the
    // driver's own text form for timestamptz does not.
    const rows = (await sql`
      SELECT shift_id, shift_number, business_date::text, clock_out_business_date::text,
             employee_id, job_id, to_json(start_at) AS start_at, to_json(end_at) AS end_at,
             minutes_worked, regular_minutes, overtime_minutes, extended_minutes,
             pay_rate::text, declared_tips::text, to_json(modified_at) AS modified_at, breaks
      FROM par_shifts WHERE store_id = ${storeId} AND business_date = ${businessDate}
      ORDER BY shift_number NULLS LAST, shift_id
    `) as ShiftRow[];
    return rows.map((r) => ({
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
    }));
  },
  ["par-shift-history", "v1"],
  { revalidate: 60 * 60 * 24, tags: [SHIFT_HISTORY_TAG] },
);

/**
 * A store's shifts for one business date — the drop-in for getShifts on any
 * screen that looks back further than yesterday.
 *
 * Same output as getShifts, non-labor jobs already removed: stored days are
 * converted by the same shiftFromRecord a live response goes through.
 */
export async function getShiftsHistory(storeId: string, businessDate: string): Promise<PARShift[]> {
  const timeZone = getStoreTimeZone(storeId);
  if (businessDate >= shiftDate(businessDateISO(timeZone), -1)) return getShifts(storeId, businessDate);

  const stored = await readStoredShiftDay(storeId, businessDate).catch(() => null);
  if (!stored) return getShifts(storeId, businessDate);

  const excluded = await nonLaborJobIds(storeId);
  return withoutNonLaborJobs(stored.map((r) => shiftFromRecord(r, timeZone)), excluded);
}
