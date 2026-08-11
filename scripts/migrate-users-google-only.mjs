// Run with:  node --env-file=.env.local scripts/migrate-users-google-only.mjs
//
// Drops the password columns now that Google Sign-In is the only way in.
// Safe to re-run (IF EXISTS).
//
// This is deliberately one-way. The hashes it removes are scrypt digests of
// temporary passwords that were, in the end, never used — but even the one that
// was is worthless now, because nothing reads password_hash any more. Going
// back to password login means restoring the code from git history and issuing
// fresh passwords to everyone, which is the correct amount of friction for a
// decision that was made on purpose.
//
// Mirrors ensureUserSchema() in src/lib/users/schema.ts, which no longer
// creates these columns for a fresh database.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const before = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'app_users' ORDER BY ordinal_position
`;
console.log("app_users columns before:");
console.log("  " + before.map((r) => r.column_name).join(", "));

await sql`ALTER TABLE app_users DROP COLUMN IF EXISTS password_hash`;
await sql`ALTER TABLE app_users DROP COLUMN IF EXISTS must_reset`;

const after = await sql`
  SELECT column_name FROM information_schema.columns
  WHERE table_name = 'app_users' ORDER BY ordinal_position
`;
console.log("\napp_users columns after:");
console.log("  " + after.map((r) => r.column_name).join(", "));

const users = await sql`
  SELECT u.name, u.email, p.label, u.last_login_at
  FROM app_users u JOIN app_positions p ON p.id = u.position_id
  ORDER BY p.label, u.name
`;
console.log(`\n${users.length} accounts, all signing in with Google:`);
for (const u of users) {
  console.log(
    `  ${u.name.padEnd(20)} ${u.label.padEnd(24)} ${u.last_login_at ? "has signed in" : "not yet"}`,
  );
}
