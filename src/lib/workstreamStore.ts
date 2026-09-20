/**
 * Postgres copy of the Workstream roster.
 *
 * The app used to read Workstream live on every request, behind an
 * `unstable_cache` that turned out not to be caching: two identical requests
 * took 32.4s each, and a single staffing page load re-read all 1,332 employees
 * once per store. Next silently declines to cache an entry over its size limit,
 * and a roster with job assignments and earning rates is comfortably over it,
 * so the "cache" was a no-op nobody noticed.
 *
 * It ended the way that always ends: `429 Too many requests. Try again after
 * 69401 seconds.` Nineteen hours locked out of the vendor, because a screen
 * people open a few times an hour was pulling the whole company each time.
 *
 * So the roster is synced here once a morning and read from Postgres. The tab
 * then costs PAR calls and one indexed query. A hard refresh is available for
 * the minutes after somebody fixes a record in Workstream and wants to see it.
 *
 * ── Last known store is never forgotten ──────────────────────────────────────
 *
 * The one piece of real cleverness, and it exists to fix retention. When
 * somebody is terminated, Workstream usually drops their job assignment — and
 * the assignment is what names their store. So a leaver becomes storeless, and
 * a quarter of every retention cohort could not be attributed to anywhere,
 * which flattered every store's number by eight points company-wide.
 *
 * On sync, a row that arrives with no location keeps the location it already
 * had. Once we have seen where somebody works, we do not unlearn it because
 * they left — which is exactly the moment retention needs to know.
 */

import { sql } from "@/lib/db";
import {
  EMPLOYEE_EMBED,
  employeeLocationId,
  hourlyRate,
  jobTitle,
  listEmployees,
} from "./workstream";
import { storeByWorkstreamLocation } from "./bonus/storeMap";

let schemaReady: Promise<void> | null = null;

export function ensureWorkstreamEmployeeSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS workstream_employees (
      uuid             TEXT PRIMARY KEY,
      first_name       TEXT NOT NULL DEFAULT '',
      middle_initial   TEXT NOT NULL DEFAULT '',
      last_name        TEXT NOT NULL DEFAULT '',
      preferred_name   TEXT NOT NULL DEFAULT '',
      -- "hired" | "onboarding" | "active" | "offboarded"
      status           TEXT NOT NULL DEFAULT '',
      applied_date     DATE,
      hired_date       DATE,
      start_date       DATE,
      onboard_date     TIMESTAMPTZ,
      termination_date DATE,
      termination_note TEXT NOT NULL DEFAULT '',
      -- Last known. Deliberately never overwritten with NULL: a terminated
      -- record loses its job assignment, and with it the only statement of
      -- where the person worked. See the header.
      location_uuid    TEXT,
      store_id         TEXT,
      job_title        TEXT,
      hourly_rate      NUMERIC,
      synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS workstream_employees_store
      ON workstream_employees (store_id, status)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS workstream_employees_dates
      ON workstream_employees (hired_date, termination_date)
  `;
}

export type WorkstreamEmployeeRow = {
  uuid: string;
  firstName: string;
  middleInitial: string;
  lastName: string;
  preferredName: string;
  status: string;
  appliedDate: string | null;
  hiredDate: string | null;
  startDate: string | null;
  terminationDate: string | null;
  terminationNote: string;
  locationUuid: string | null;
  storeId: string | null;
  jobTitle: string | null;
  hourlyRate: number | null;
  syncedAt: string;
};

type Row = {
  uuid: string;
  first_name: string;
  middle_initial: string;
  last_name: string;
  preferred_name: string;
  status: string;
  applied_date: string | null;
  hired_date: string | null;
  start_date: string | null;
  termination_date: string | null;
  termination_note: string;
  location_uuid: string | null;
  store_id: string | null;
  job_title: string | null;
  hourly_rate: string | number | null;
  synced_at: string;
};

const iso = (d: string | null) => (d ? String(d).slice(0, 10) : null);

function toRow(r: Row): WorkstreamEmployeeRow {
  return {
    uuid: r.uuid,
    firstName: r.first_name,
    middleInitial: r.middle_initial,
    lastName: r.last_name,
    preferredName: r.preferred_name,
    status: r.status,
    appliedDate: iso(r.applied_date),
    hiredDate: iso(r.hired_date),
    startDate: iso(r.start_date),
    terminationDate: iso(r.termination_date),
    terminationNote: r.termination_note,
    locationUuid: r.location_uuid,
    storeId: r.store_id,
    jobTitle: r.job_title,
    hourlyRate: r.hourly_rate === null ? null : Number(r.hourly_rate),
    syncedAt: new Date(r.synced_at).toISOString(),
  };
}

/** Rows written per statement. Keeps one insert well inside any parameter cap. */
const CHUNK = 400;

/**
 * Re-read Workstream and write it here.
 *
 * Returns what changed, because a sync that silently wrote nothing and a sync
 * that found nothing look identical from the outside, and only one of them is
 * fine.
 */
export async function syncWorkstreamEmployees(): Promise<{
  fetched: number;
  written: number;
  withStore: number;
  keptPriorStore: number;
}> {
  await ensureWorkstreamEmployeeSchema();

  const everyone = await listEmployees({ embed: EMPLOYEE_EMBED });

  // Which uuids already have a location, so the count below can say how many
  // rows were saved from forgetting one.
  const priorRows = (await sql`
    SELECT uuid FROM workstream_employees WHERE location_uuid IS NOT NULL
  `) as { uuid: string }[];
  const knownLocation = new Set(priorRows.map((r) => r.uuid));

  let written = 0;
  let withStore = 0;
  let keptPriorStore = 0;

  for (let i = 0; i < everyone.length; i += CHUNK) {
    const batch = everyone.slice(i, i + CHUNK);

    const cols = {
      uuid: [] as string[],
      first: [] as string[],
      middle: [] as string[],
      last: [] as string[],
      preferred: [] as string[],
      status: [] as string[],
      applied: [] as (string | null)[],
      hired: [] as (string | null)[],
      start: [] as (string | null)[],
      onboard: [] as (string | null)[],
      term: [] as (string | null)[],
      note: [] as string[],
      location: [] as (string | null)[],
      store: [] as (string | null)[],
      title: [] as (string | null)[],
      rate: [] as (number | null)[],
    };

    for (const e of batch) {
      const location = employeeLocationId(e);
      if (location) withStore += 1;
      else if (knownLocation.has(e.uuid)) keptPriorStore += 1;

      cols.uuid.push(e.uuid);
      cols.first.push(e.first_name ?? "");
      cols.middle.push(e.middle_initial ?? "");
      cols.last.push(e.last_name ?? "");
      cols.preferred.push(e.preferred_name ?? "");
      cols.status.push(String(e.status ?? ""));
      cols.applied.push(e.applied_date ?? null);
      cols.hired.push(e.hired_date ?? null);
      cols.start.push(e.start_date ?? null);
      cols.onboard.push(e.onboard_date ?? null);
      cols.term.push(e.termination_date ?? null);
      cols.note.push(e.termination_note ?? "");
      cols.location.push(location);
      cols.store.push(storeByWorkstreamLocation(location)?.storeId ?? null);
      cols.title.push(jobTitle(e));
      cols.rate.push(hourlyRate(e));
    }

    // COALESCE on location_uuid/store_id/job_title is the whole point: a
    // terminated record arrives with none of them, and must not erase what we
    // already knew. Everything else is overwritten, because Workstream is the
    // authority on it.
    await sql`
      INSERT INTO workstream_employees (
        uuid, first_name, middle_initial, last_name, preferred_name, status,
        applied_date, hired_date, start_date, onboard_date,
        termination_date, termination_note,
        location_uuid, store_id, job_title, hourly_rate, synced_at
      )
      SELECT * FROM UNNEST(
        ${cols.uuid}::text[], ${cols.first}::text[], ${cols.middle}::text[],
        ${cols.last}::text[], ${cols.preferred}::text[], ${cols.status}::text[],
        ${cols.applied}::date[], ${cols.hired}::date[], ${cols.start}::date[],
        ${cols.onboard}::timestamptz[],
        ${cols.term}::date[], ${cols.note}::text[],
        ${cols.location}::text[], ${cols.store}::text[], ${cols.title}::text[],
        ${cols.rate}::numeric[]
      ) AS t(
        uuid, first_name, middle_initial, last_name, preferred_name, status,
        applied_date, hired_date, start_date, onboard_date,
        termination_date, termination_note,
        location_uuid, store_id, job_title, hourly_rate
      ), LATERAL (SELECT now()) AS s(synced_at)
      ON CONFLICT (uuid) DO UPDATE SET
        first_name       = EXCLUDED.first_name,
        middle_initial   = EXCLUDED.middle_initial,
        last_name        = EXCLUDED.last_name,
        preferred_name   = EXCLUDED.preferred_name,
        status           = EXCLUDED.status,
        applied_date     = EXCLUDED.applied_date,
        hired_date       = EXCLUDED.hired_date,
        start_date       = EXCLUDED.start_date,
        onboard_date     = EXCLUDED.onboard_date,
        termination_date = EXCLUDED.termination_date,
        termination_note = EXCLUDED.termination_note,
        location_uuid    = COALESCE(EXCLUDED.location_uuid, workstream_employees.location_uuid),
        store_id         = COALESCE(EXCLUDED.store_id,      workstream_employees.store_id),
        job_title        = COALESCE(EXCLUDED.job_title,     workstream_employees.job_title),
        hourly_rate      = COALESCE(EXCLUDED.hourly_rate,   workstream_employees.hourly_rate),
        synced_at        = EXCLUDED.synced_at
    `;
    written += batch.length;
  }

  return { fetched: everyone.length, written, withStore, keptPriorStore };
}

/** Everyone, as last synced. */
export async function listStoredEmployees(): Promise<WorkstreamEmployeeRow[]> {
  await ensureWorkstreamEmployeeSchema();
  const rows = (await sql`
    SELECT * FROM workstream_employees ORDER BY last_name, first_name
  `) as Row[];
  return rows.map(toRow);
}

/** One store's people, as last synced. */
export async function listStoredEmployeesForStore(storeId: string): Promise<WorkstreamEmployeeRow[]> {
  await ensureWorkstreamEmployeeSchema();
  const rows = (await sql`
    SELECT * FROM workstream_employees
    WHERE store_id = ${storeId}
    ORDER BY last_name, first_name
  `) as Row[];
  return rows.map(toRow);
}

/**
 * When the roster was last read, and how much of it there is.
 *
 * Shown on screen so a stale copy is visible as staleness rather than as
 * missing people — the failure this whole module exists to stop being silent.
 */
export async function workstreamSyncStatus(): Promise<{
  rows: number;
  lastSyncedAt: string | null;
}> {
  await ensureWorkstreamEmployeeSchema();
  const [row] = (await sql`
    SELECT count(*)::int AS rows, max(synced_at) AS last_synced_at
    FROM workstream_employees
  `) as { rows: number; last_synced_at: string | null }[];
  return {
    rows: row?.rows ?? 0,
    lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
  };
}
