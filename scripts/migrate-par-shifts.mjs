// Run with:  node --env-file=.env.local scripts/migrate-par-shifts.mjs
// Creates the stored PAR shift history in Neon. Safe to re-run.
//
// Mirrors ensureShiftSchema() in src/lib/parShiftStore.ts, which runs before
// every read and write. Separate so the tables can be created and inspected
// on a live database before anything has written to them.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// One row per shift, carrying every field GetShifts returns — not just the ones
// the app reads today — so a field somebody wants later is already here rather
// than another 22-month pull. Times are PAR's own UTC instants, not converted
// minutes-of-day: a conversion can be redone, an original cannot be recovered.
await sql`
  CREATE TABLE IF NOT EXISTS par_shifts (
    store_id                TEXT NOT NULL,
    business_date           DATE NOT NULL,
    shift_id                TEXT NOT NULL,
    shift_number            INTEGER,
    employee_id             TEXT,
    job_id                  TEXT,
    start_at                TIMESTAMPTZ,
    -- NULL while still clocked in (PAR sends a 0001-01-01 sentinel).
    end_at                  TIMESTAMPTZ,
    clock_out_business_date DATE,
    minutes_worked          INTEGER NOT NULL DEFAULT 0,
    regular_minutes         INTEGER NOT NULL DEFAULT 0,
    overtime_minutes        INTEGER NOT NULL DEFAULT 0,
    extended_minutes        INTEGER NOT NULL DEFAULT 0,
    pay_rate                NUMERIC,
    declared_tips           NUMERIC,
    modified_at             TIMESTAMPTZ,
    -- [{ number, startAt, endAt, minutes, isPaid }]
    breaks                  JSONB NOT NULL DEFAULT '[]',
    PRIMARY KEY (store_id, business_date, shift_id)
  )
`;
await sql`
  CREATE INDEX IF NOT EXISTS par_shifts_employee
    ON par_shifts (store_id, employee_id, business_date)
`;

// One row per store-day that was asked for: whether PAR answered, how many
// shifts it held, and PAR's whole response, gzipped (~2-3 KB). The status is
// what keeps "PAR errored" from ever reading as "nobody worked"; the raw
// response is insurance for anything the columns above missed.
await sql`
  CREATE TABLE IF NOT EXISTS par_shift_days (
    store_id      TEXT NOT NULL,
    business_date DATE NOT NULL,
    -- "ok" | "error"
    status        TEXT NOT NULL,
    shift_count   INTEGER NOT NULL DEFAULT 0,
    raw_gzip      BYTEA,
    error         TEXT,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, business_date)
  )
`;

// Set by the Staffing tab's Refresh for the last 14 days; the next read of a
// flagged day re-reads PAR and clears it. Nothing else re-reads PAR on a read —
// the nightly job keeps the window current otherwise.
await sql`
  ALTER TABLE par_shift_days ADD COLUMN IF NOT EXISTS needs_refresh BOOLEAN NOT NULL DEFAULT false
`;

const [row] = await sql`
  SELECT
    (SELECT count(*)::int FROM par_shifts) AS shifts,
    (SELECT count(*)::int FROM par_shift_days WHERE status = 'ok') AS ok_days,
    (SELECT count(*)::int FROM par_shift_days WHERE status <> 'ok') AS bad_days,
    (SELECT min(business_date)::text FROM par_shift_days WHERE status = 'ok') AS first_day
`;
console.log(
  `par_shifts ready — ${row.shifts} shifts over ${row.ok_days} store-days`
  + (row.bad_days ? `, ${row.bad_days} store-days in error` : "")
  + (row.first_day ? `, from ${row.first_day}` : ""),
);
