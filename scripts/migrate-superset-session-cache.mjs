// Run with:  node --env-file=.env.local scripts/migrate-superset-session-cache.mjs
// Creates the superset_session_cache table in Neon. Safe to re-run (IF NOT EXISTS).
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS superset_session_cache (
    id            integer PRIMARY KEY DEFAULT 1,
    guest_token   text NOT NULL,
    session_cookie text NOT NULL,
    csrf_token    text NOT NULL,
    expires_at    timestamptz NOT NULL,
    CONSTRAINT single_row CHECK (id = 1)
  )
`;

console.log("superset_session_cache ready.");
