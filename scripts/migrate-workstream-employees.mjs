// Run with:  node --env-file=.env.local scripts/migrate-workstream-employees.mjs
// Creates the stored Workstream roster table in Neon. Safe to re-run.
//
// Mirrors ensureWorkstreamEmployeeSchema() in src/lib/workstreamStore.ts, which
// runs before every read and write. It exists separately because the staffing
// tab reads this table before anything has ever written to it, and because the
// COALESCE behaviour on location_uuid is the part of the design worth being
// able to inspect on a live database without reading the app.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

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
    -- Last known, and never overwritten with NULL. A terminated record loses
    -- its job assignment, and the assignment is the only thing that names the
    -- store -- so forgetting it here is what made a quarter of every retention
    -- cohort unattributable.
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

const [row] = await sql`
  SELECT count(*)::int AS rows, max(synced_at) AS last FROM workstream_employees
`;
console.log(`workstream_employees ready — ${row.rows} rows`
  + (row.last ? `, last synced ${new Date(row.last).toISOString()}` : ", never synced"));
console.log("Populate it with: curl -X POST .../api/workstream/refresh  (admin session)");
console.log("or wait for the 11:00 UTC cron.");
