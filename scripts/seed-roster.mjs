// Run with:  node --env-file=.env.local scripts/seed-roster.mjs
//
// Creates the account tables if they don't exist, then loads the HRG roster:
// three positions and the people in them. Idempotent — re-running only fixes up
// names, and leaves positions and their edited tab lists alone.
//
// Nobody gets a password: everyone signs in with their Google account. A row
// here only records that an address is allowed to sign in and which position it
// holds. See src/lib/users/google.ts.
import { neon } from "@neondatabase/serverless";
import { randomUUID } from "node:crypto";

const sql = neon(process.env.DATABASE_URL);

// Mirrors ensureUserSchema() in src/lib/users/schema.ts, so a fresh database can
// be brought up from this one script.
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
    disabled_at   TIMESTAMPTZ,
    token_version INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
  )
`;
await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (lower(email))`;

const ALL = ["/dashboard", "/food-cost", "/par", "/survey-data", "/bonus"];
const OPS = ["/dashboard", "/food-cost", "/par", "/survey-data"];

// Bonus is restricted to Administrator for now — it's still being built. Change
// it in the admin screen, not here; this script won't overwrite an edited row.
const POSITIONS = [
  { id: "administrator", label: "Administrator", tabs: ALL, isAdmin: true },
  { id: "director_of_operations", label: "Director of Operations", tabs: OPS, isAdmin: false },
  { id: "district_manager", label: "District Manager", tabs: OPS, isAdmin: false },
];

// Emails must match the person's Google account — that's what sign-in matches
// against, and a typo shows up as "isn't set up on the dashboard".
const ROSTER = [
  ["Josh Blumenstein",  "josh@hudsonrestaurantgroup.com",             "administrator"],
  ["Connor Lynn",       "connor@hudsonrestaurantgroup.com",           "administrator"],
  ["Derek Qualls",      "derek.qualls@hudsonrestaurantgroup.com",     "director_of_operations"],
  ["Preston James",     "preston.james@hudsonrestaurantgroup.com",    "director_of_operations"],
  ["Maegan McAlister",  "maegan.mcalister@hudsonrestaurantgroup.com", "district_manager"],
  ["Tommy Demorest",    "tommy.demorest@hudsonrestaurantgroup.com",   "district_manager"],
  ["Latonya Hall",      "latonya.hall@hudsonrestaurantgroup.com",     "district_manager"],
  ["Star Allen",        "star.allen@hudsonrestaurantgroup.com",       "district_manager"],
  ["Corey Stephens",    "corey.stephens@hudsonrestaurantgroup.com",   "district_manager"],
];

for (const p of POSITIONS) {
  await sql`
    INSERT INTO app_positions (id, label, tabs, is_admin)
    VALUES (${p.id}, ${p.label}, ${p.tabs}::text[], ${p.isAdmin})
    ON CONFLICT (id) DO NOTHING
  `;
}
console.log(`positions: ${POSITIONS.map((p) => p.id).join(", ")}`);

for (const [name, email, positionId] of ROSTER) {
  const [existing] = await sql`SELECT id FROM app_users WHERE lower(email) = lower(${email})`;
  if (existing) {
    await sql`UPDATE app_users SET name = ${name} WHERE id = ${existing.id}`;
    console.log(`  = ${email.padEnd(45)} already on the roster`);
    continue;
  }
  await sql`
    INSERT INTO app_users (id, email, name, position_id)
    VALUES (${randomUUID()}, ${email.toLowerCase()}, ${name}, ${positionId})
  `;
  console.log(`  + ${email.padEnd(45)} created`);
}

// Any position nobody is in that isn't one of ours. `= ANY($1)` with a text[]
// parameter, not `IN ${sql(...)}` — that's a postgres.js idiom and the Neon
// driver rejects any call that isn't a tagged template.
const keep = POSITIONS.map((p) => p.id);
const removed = await sql`
  DELETE FROM app_positions
  WHERE NOT (id = ANY(${keep}::text[]))
    AND id NOT IN (SELECT DISTINCT position_id FROM app_users)
  RETURNING id
`;
if (removed.length) console.log(`removed unused positions: ${removed.map((r) => r.id).join(", ")}`);

const summary = await sql`
  SELECT p.label, COUNT(u.id)::int AS n, p.tabs, p.is_admin
  FROM app_positions p LEFT JOIN app_users u ON u.position_id = p.id
  GROUP BY p.id, p.label, p.tabs, p.is_admin ORDER BY p.label
`;
console.log("positions now:");
for (const r of summary) {
  console.log(`  ${r.label.padEnd(24)} ${String(r.n).padStart(2)} user(s)  ${r.is_admin ? "[admin] " : "        "}${r.tabs.join(" ")}`);
}
