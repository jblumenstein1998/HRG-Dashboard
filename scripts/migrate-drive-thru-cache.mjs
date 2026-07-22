// Run with:  node --env-file=.env.local scripts/migrate-drive-thru-cache.mjs
// Creates the drive_thru_cache table in Neon. Safe to re-run (IF NOT EXISTS).
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS drive_thru_cache (
    time_range   text NOT NULL PRIMARY KEY,
    range_label  text NOT NULL,
    payload      jsonb NOT NULL,
    fetched_at   timestamptz NOT NULL DEFAULT now()
  )
`;

console.log("drive_thru_cache ready.");
