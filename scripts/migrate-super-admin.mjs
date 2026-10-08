// Run with:  node --env-file=.env.local scripts/migrate-super-admin.mjs [email]
//
// Adds the super-admin rank and puts one person in it. Safe to re-run.
//
// Super admin sits above administrator because of what the staffing tab shows:
// every employee's pay rate beside their name, across the whole estate. That is
// a different disclosure from the user register an administrator already
// manages, so it gets a different door.
//
// The new position carries the same tabs the administrator position has, so
// moving somebody into it takes nothing away.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const email = process.argv[2] ?? "josh@hudsonrestaurantgroup.com";

await sql`
  ALTER TABLE app_positions
    ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE
`;

// Inherit the administrator tab list rather than hardcoding one, so this does
// not drift from whatever the admin position is allowed to see.
const [admin] = await sql`SELECT tabs FROM app_positions WHERE id = 'administrator'`;
const tabs = admin?.tabs ?? [];

await sql`
  INSERT INTO app_positions (id, label, tabs, is_admin, is_super_admin)
  VALUES ('super_administrator', 'Super Administrator', ${tabs}::text[], TRUE, TRUE)
  ON CONFLICT (id) DO UPDATE SET
    label = EXCLUDED.label, is_admin = TRUE, is_super_admin = TRUE
`;

const [user] = await sql`SELECT id, name, position_id FROM app_users WHERE email = ${email}`;
if (!user) {
  console.error(`No app_users row for ${email} — nobody was promoted.`);
  process.exit(1);
}

await sql`UPDATE app_users SET position_id = 'super_administrator' WHERE id = ${user.id}`;

/*
 * Exactly one super admin, as asked.
 *
 * Demoting anybody else back to administrator rather than leaving a second one
 * in place: "I want to be the only super admin" is a statement about the whole
 * set, not just about this row, and a script that only ever adds would quietly
 * fail to keep it true on a re-run.
 */
const demoted = await sql`
  UPDATE app_users SET position_id = 'administrator'
  WHERE position_id = 'super_administrator' AND id <> ${user.id}
  RETURNING email
`;

const rows = await sql`
  SELECT p.id, p.label, p.is_admin, p.is_super_admin,
         (SELECT count(*)::int FROM app_users u WHERE u.position_id = p.id) AS users
  FROM app_positions p ORDER BY p.is_super_admin DESC, p.is_admin DESC, p.id
`;

console.log(`${user.name} <${email}> is now Super Administrator.`);
if (demoted.length) {
  console.log(`Demoted to administrator: ${demoted.map((d) => d.email).join(", ")}`);
}
console.log("\nposition               admin  super  users");
for (const r of rows) {
  console.log(
    `${String(r.id).padEnd(23)}${String(r.is_admin).padEnd(7)}${String(r.is_super_admin).padEnd(7)}${r.users}`,
  );
}
