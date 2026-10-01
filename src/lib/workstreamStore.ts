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

/**
 * The same mapping for a roster read, which selects only the columns it needs.
 *
 * Separate from `toRow` rather than sharing it, because `toRow` reads columns
 * this query does not select — and on a missing `synced_at` it does not degrade,
 * it throws, since `new Date(undefined).toISOString()` is a RangeError. A
 * mapper that matches its query is the honest way to say which columns a
 * caller actually gets.
 */
function toRosterEntry(r: Partial<Row>): WorkstreamRosterEntry {
  return {
    uuid: r.uuid as string,
    firstName: r.first_name as string,
    middleInitial: r.middle_initial as string,
    lastName: r.last_name as string,
    preferredName: r.preferred_name as string,
    status: r.status as string,
    hiredDate: iso(r.hired_date ?? null),
    startDate: iso(r.start_date ?? null),
    terminationDate: iso(r.termination_date ?? null),
    storeId: r.store_id ?? null,
    jobTitle: r.job_title ?? null,
    hourlyRate: r.hourly_rate == null ? null : Number(r.hourly_rate),
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
/**
 * What a roster read actually needs to answer.
 *
 * Narrower than the stored row on purpose: the columns left out — the applied
 * date, the termination note, the location uuid, the sync timestamp — are
 * written by the sync and read by nobody on a page load. Dropping them is most
 * of the difference between a 3.4s read and a 1.6s one, because the cost here
 * is bytes over an HTTP database connection rather than work in the database.
 */
export type WorkstreamRosterEntry = Pick<
  WorkstreamEmployeeRow,
  | "uuid"
  | "firstName"
  | "middleInitial"
  | "lastName"
  | "preferredName"
  | "status"
  | "hiredDate"
  | "startDate"
  | "terminationDate"
  | "storeId"
  | "jobTitle"
  | "hourlyRate"
>;

/*
 * The read in progress, shared by everyone who asks while it is running.
 *
 * Null whenever no read is in flight, which is almost always — it exists for
 * the fraction of a second in which twelve stores all ask at once.
 */
let rosterInFlight: Promise<WorkstreamRosterEntry[]> | null = null;

/**
 * Everyone currently employed, fetched once however many callers ask at once.
 *
 * Two things are going on here, and both were measured rather than assumed.
 *
 * ── One read instead of twelve ───────────────────────────────────────────────
 *
 * `activeElsewhere()` wants "everyone active who is *not* at this store", so it
 * reads the roster and filters in memory. That is correct, and it runs once per
 * store — and the staffing tab builds twelve stores in parallel, then calls a
 * second endpoint that does the same. Twenty-four full copies of one table per
 * page load, against a database reached over HTTP rather than a pooled local
 * socket, where a single read of this table has been seen to take seconds.
 *
 * So concurrent callers share the read already in flight; once it settles the
 * slot is cleared and the next caller goes to Postgres again. That is request
 * scope in practice — the twelve stores ask within the same tick — without a
 * timed cache's one real hazard: the reconciliation screen's refresh button
 * exists so somebody who has just fixed a record in Workstream sees it
 * immediately, and anything holding rows for minutes would make that button
 * look broken for exactly as long as it held them. Nothing here is ever more
 * stale than a single query.
 *
 * Not React's `cache`, which the Next docs recommend for deduplicating direct
 * database reads, because it does nothing in a Route Handler — that advice is
 * about a render pass, and these endpoints are handlers, not components. A
 * probe route calling a `cache()`-wrapped function twelve times concurrently
 * ran the inner function all twelve times.
 *
 * ── Fewer rows, fewer columns ────────────────────────────────────────────────
 *
 * Filtering in SQL rather than in JS, because 1,333 stored rows are 471 current
 * employees and the rest are leavers nobody on a page load can act on. With the
 * unused columns dropped as well, the read went from 3.4s to 1.6s.
 *
 * Leavers are deliberately excluded. The one place that needs them is a store's
 * own roster — a link confirmed while somebody worked there has to keep
 * resolving after they leave — and that is `listStoredEmployeesForStore`, which
 * still returns everybody.
 */
function loadRoster(): Promise<WorkstreamRosterEntry[]> {
  if (rosterInFlight) return rosterInFlight;

  const read = (async () => {
    await ensureWorkstreamEmployeeSchema();
    const rows = (await sql`
      SELECT uuid, first_name, middle_initial, last_name, preferred_name, status,
             hired_date, start_date, termination_date, store_id, job_title, hourly_rate
      FROM workstream_employees
      ORDER BY last_name, first_name
    `) as Partial<Row>[];
    return rows.map(toRosterEntry);
  })();

  rosterInFlight = read;
  // Cleared on failure as well as success, so one bad read does not poison
  // every later one. Both branches are handlers, which is also what stops a
  // rejection here being reported as unhandled — the rejection still reaches
  // the real callers through the promise they were given.
  read.then(
    () => { if (rosterInFlight === read) rosterInFlight = null; },
    () => { if (rosterInFlight === read) rosterInFlight = null; },
  );
  return read;
}

/** Everyone currently employed. Leavers are not a task on any live screen. */
export async function listActiveStoredEmployees(): Promise<WorkstreamRosterEntry[]> {
  const everyone = await loadRoster();
  return everyone.filter((r) => r.status === "active" && !r.terminationDate);
}

/**
 * One store's people, leavers included, derived from the shared read.
 *
 * Leavers matter here and nowhere else: a link confirmed while somebody worked
 * at this store has to keep resolving after they go, or their past hours would
 * quietly lose the title and rate they were worked at.
 *
 * Derived in memory rather than asked for with `WHERE store_id = $1`, which is
 * the whole point of this module's shape. The indexed query is the better one
 * in isolation; it is the twelfth copy of it that is the problem, because this
 * database is reached over HTTP and the cost is per *query*, not per row. Twelve
 * store-scoped reads measured 8.8s against 1.5s for a single full one — and
 * twelve reads of the nineteen-row decisions table managed 20s between them,
 * which is as clear a statement as you could want that rows are not what is
 * being paid for.
 */
export async function listStoredRosterForStore(
  storeId: string,
): Promise<WorkstreamRosterEntry[]> {
  const everyone = await loadRoster();
  return everyone.filter((r) => r.storeId === storeId);
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
