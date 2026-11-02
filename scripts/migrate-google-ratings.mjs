// Run with:  node --env-file=.env.local scripts/migrate-google-ratings.mjs
// Creates the Google rating history table in Neon. Safe to re-run.
//
// One row per store per day, written by /api/cron/google-ratings
// (lib/googleRatings.ts). Google keeps no history of its own, so this table
// is the only way to say how a rating moved over a window.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS google_ratings (
    store_id     TEXT NOT NULL,
    -- The day of the reading (US Eastern). The first reading of a day is kept.
    as_of        DATE NOT NULL,
    -- Google's lifetime average, to one decimal, and lifetime review count.
    rating       NUMERIC(2, 1) NOT NULL,
    review_count INTEGER NOT NULL,
    reviews_uri  TEXT,
    fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, as_of)
  )
`;

const [row] = await sql`
  SELECT count(DISTINCT store_id)::int AS stores, count(*)::int AS readings FROM google_ratings
`;
console.log(`google_ratings ready — ${row.stores} stores, ${row.readings} readings`);
