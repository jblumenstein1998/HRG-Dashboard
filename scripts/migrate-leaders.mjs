// Run with:  node --env-file=.env.local scripts/migrate-leaders.mjs
//
// Creates app_leaders — an above-store leader and the stores they cover, read
// by the Drive-Thru tab's leader filter and edited on Users & Access.
//
// Not load-bearing: ensureLeaderSchema() in src/lib/users/leaders.ts creates the
// same table on the first read or write in any process, following the pattern
// in users/schema.ts. This exists to do it deliberately and say what happened,
// so the first person to open the admin screen isn't the one discovering
// whether the DDL works.
//
// Safe to re-run.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const [before] = await sql`
  SELECT to_regclass('public.app_leaders') IS NOT NULL AS present
`;

await sql`
  CREATE TABLE IF NOT EXISTS app_leaders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    stores     TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS app_leaders_name_key ON app_leaders (lower(name))
`;

console.log(before.present ? "app_leaders already existed" : "created app_leaders");

const rows = await sql`SELECT name, stores FROM app_leaders ORDER BY name`;
if (rows.length === 0) {
  console.log("no leaders yet — add them on Users & Access");
} else {
  console.log("\nleaders now:");
  for (const r of rows) {
    console.log(`  ${r.name}: ${r.stores.length ? r.stores.join(", ") : "(no stores)"}`);
  }
}
