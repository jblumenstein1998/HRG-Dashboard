// Run with:  node --env-file=.env.local scripts/migrate-users.mjs
//
// Creates the account tables in Neon and seeds a starter set of positions.
// Safe to re-run: the DDL is IF NOT EXISTS and the seeds are ON CONFLICT
// DO NOTHING, so existing positions and their edited tab lists are preserved.
//
// If an owner email is given and no user exists yet, it also creates that first
// account with a generated temporary password and prints it once. That password
// is the only way into the admin screens, so it is printed and never stored in
// readable form — losing it means re-running this against a fresh account.
//
// Mirrors ensureUserSchema() in src/lib/users/schema.ts.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);



await sql`
  CREATE TABLE IF NOT EXISTS app_positions (
    id         TEXT PRIMARY KEY,
    label      TEXT NOT NULL,
    tabs       TEXT[] NOT NULL DEFAULT '{}',
    is_admin   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )
`;

await sql`
  CREATE TABLE IF NOT EXISTS app_users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL,
    name          TEXT NOT NULL,
    position_id   TEXT NOT NULL REFERENCES app_positions(id),
    password_hash TEXT NOT NULL,
    must_reset    BOOLEAN NOT NULL DEFAULT TRUE,
    disabled_at   TIMESTAMPTZ,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  )
`;

await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (lower(email))`;

const ALL = ["/dashboard", "/food-cost", "/par", "/survey-data", "/bonus"];
const OPS = ["/dashboard", "/food-cost", "/par", "/survey-data"];

// A starting point, not a decision — every one of these is editable in the
// admin UI. Only `owner` is special: it carries is_admin, and the app refuses
// to delete it.
const SEED_POSITIONS = [
  { id: "owner", label: "Owner", tabs: ALL, isAdmin: true },
  { id: "ops_director", label: "Operations Director", tabs: ALL, isAdmin: false },
  { id: "regional_manager", label: "Regional Manager", tabs: ALL, isAdmin: false },
  { id: "district_manager", label: "District Manager", tabs: OPS, isAdmin: false },
  { id: "gm", label: "General Manager", tabs: OPS, isAdmin: false },
  { id: "agm", label: "Assistant General Manager", tabs: OPS, isAdmin: false },
  { id: "director", label: "Director", tabs: OPS, isAdmin: false },
];

for (const p of SEED_POSITIONS) {
  await sql`
    INSERT INTO app_positions (id, label, tabs, is_admin)
    VALUES (${p.id}, ${p.label}, ${p.tabs}::text[], ${p.isAdmin})
    ON CONFLICT (id) DO NOTHING
  `;
}
console.log(`positions: ${SEED_POSITIONS.length} seeded or already present`);

const [{ n: userCount }] = await sql`SELECT COUNT(*)::int AS n FROM app_users`;
console.log(`users: ${userCount} existing`);


const positions = await sql`SELECT id, label, tabs, is_admin FROM app_positions ORDER BY label`;
console.log("\ncurrent positions:");
for (const p of positions) {
  console.log(`  ${p.id.padEnd(18)} ${p.label.padEnd(26)} ${p.is_admin ? "[admin] " : "        "}${p.tabs.join(" ")}`);
}
