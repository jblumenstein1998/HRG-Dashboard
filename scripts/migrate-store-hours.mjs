// Run with:  node --env-file=.env.local scripts/migrate-store-hours.mjs
// Creates the store opening-hours tables in Neon. Safe to re-run.
//
// Hours come from each store's Google listing (lib/storeHours.ts), refreshed
// daily by /api/cron/store-hours. Two tables because Google answers two
// questions: the regular week, and the next seven actual dates — which is
// where holiday and one-off hours show up.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

// The regular week, per store and day of week (0 = Sunday). The fallback for
// any date there is no dated row for.
await sql`
  CREATE TABLE IF NOT EXISTS store_hours_weekly (
    store_id      TEXT NOT NULL,
    day_of_week   INTEGER NOT NULL,
    -- Minutes after local midnight. A close past midnight is > 1440.
    open_minutes  INTEGER NOT NULL,
    close_minutes INTEGER NOT NULL,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, day_of_week)
  )
`;

// Actual hours for specific dates, holidays included. Each daily refresh
// writes the coming week, so past dates keep the hours they really had.
await sql`
  CREATE TABLE IF NOT EXISTS store_hours_daily (
    store_id      TEXT NOT NULL,
    business_date DATE NOT NULL,
    open_minutes  INTEGER,
    close_minutes INTEGER,
    -- Closed all day (a holiday): no open/close.
    closed        BOOLEAN NOT NULL DEFAULT false,
    fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, business_date)
  )
`;

const [row] = await sql`
  SELECT (SELECT count(DISTINCT store_id)::int FROM store_hours_weekly) AS weekly_stores,
         (SELECT count(*)::int FROM store_hours_daily) AS daily_rows
`;
console.log(`store hours ready — ${row.weekly_stores} stores with a regular week, ${row.daily_rows} dated rows`);
