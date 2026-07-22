// Run with:  node --env-file=.env.local scripts/clear-drive-thru-caches.mjs
// Clears both drive-thru caches for a true cold-state test:
//   - drive_thru_cache: computed per-range results (permanent for closed ranges, TTL for rolling)
//   - superset_session_cache: the guest token / cookie / CSRF handshake
// Pass --session-only or --data-only to clear just one.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const arg = process.argv[2];

if (arg !== "--session-only") {
  const r = await sql`DELETE FROM drive_thru_cache`;
  console.log(`cleared drive_thru_cache (${r.length ?? 0} rows)`);
}
if (arg !== "--data-only") {
  await sql`DELETE FROM superset_session_cache`;
  console.log("cleared superset_session_cache");
}
