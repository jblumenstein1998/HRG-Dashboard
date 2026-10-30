// Run with:  node --env-file=.env.local scripts/migrate-teamworx.mjs
// Creates the Teamworx forecast tables in Neon. Safe to re-run.
//
// Filled nightly by /api/cron/teamworx (lib/teamworx.ts) from CrunchTime's
// Teamworx scheduling: this week and next, overwritten on each run, so a past
// date keeps the last forecast it had.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// Forecast per store and date. Teamworx's own figures; dollars are whole.
await sql`
  CREATE TABLE IF NOT EXISTS teamworx_forecast_daily (
    store_id        TEXT NOT NULL,
    business_date   DATE NOT NULL,
    forecast_sales  NUMERIC,
    forecast_guests INTEGER,
    forecast_checks INTEGER,
    fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, business_date)
  )
`;

// The week's schedule. Scheduled hours are only available as a week total
// (per-day hours come back 0 for the dashboard's login).
await sql`
  CREATE TABLE IF NOT EXISTS teamworx_schedule_weekly (
    store_id          TEXT NOT NULL,
    -- The Sunday that ends the Monday–Sunday week.
    week_ending       DATE NOT NULL,
    labor_schedule_id INTEGER,
    -- Published / Draft / Not Started.
    status            TEXT,
    sales_forecast    NUMERIC,
    scheduled_hours   NUMERIC,
    -- Scheduled labor dollars.
    scheduled_value   NUMERIC,
    fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, week_ending)
  )
`;

const [row] = await sql`
  SELECT (SELECT count(*)::int FROM teamworx_forecast_daily) AS daily_rows,
         (SELECT count(*)::int FROM teamworx_schedule_weekly) AS weekly_rows
`;
console.log(`teamworx ready — ${row.daily_rows} daily rows, ${row.weekly_rows} weekly rows`);
