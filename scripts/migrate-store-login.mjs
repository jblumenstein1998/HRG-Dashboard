// Run with:  node --env-file=.env.local scripts/migrate-store-login.mjs
//
// Adds the shared store account: a "Store" position, a username/password login
// route for accounts that have no person behind them, and the HRG Store user.
//
// This partly reverses migrate-users-google-only.mjs, which dropped the
// password columns — but only partly, and on purpose. Google stays the only way
// a *person* signs in. What comes back is a second identity shape for a device:
// `username` + `password_hash`, with `email` now nullable so a store account
// isn't forced to carry a fake address. The login route resolves usernames
// only, so no Google account is reachable through it.
//
// Safe to re-run. Columns use IF NOT EXISTS, the position and user are
// upserted, and an existing store row is renamed and has its password reset to
// the values below rather than being duplicated.
//
// Mirrors ensureUserSchema() in src/lib/users/schema.ts.
import { neon } from "@neondatabase/serverless";
import { randomBytes, randomUUID, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";

const sql = neon(process.env.DATABASE_URL);
const scrypt = promisify(scryptCb);

// ── the account ──────────────────────────────────────────────────────────────

const POSITION = {
  id: "store",
  label: "Store",
  // The four operating tabs. Bonus is deliberately excluded: it takes manual
  // score entry and period locking, and a password shared across a store would
  // put those behind a credential many people know, with an audit trail that
  // could only ever say "HRG Store".
  tabs: ["/dashboard", "/food-cost", "/par", "/survey-data"],
};

// The login handle. No space: it gets typed on a back-office keyboard, often by
// someone reading it off a card. `NAME` is separate and keeps the space — that
// is what the admin list displays, and it never gets typed.
const USERNAME = "HRGSTORE";
const NAME = "HRG Store";
const PASSWORD = "HRGSTORE123!";

// The handle this account was first created with. Kept so a re-run renames that
// row instead of inserting a second account beside it — the lookup below is by
// username, and without this it would simply not find the old one.
const PREVIOUS_USERNAME = "HRG Store";

// ── hashing ──────────────────────────────────────────────────────────────────
//
// Same scheme and parameters as src/lib/users/password.ts, restated because a
// .mjs script can't import the TypeScript module. `scrypt$N$r$p$salt$hash`,
// all base64url.
const N = 65536;
const R = 8;
const P = 1;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, {
    N,
    r: R,
    p: P,
    maxmem: 128 * N * R * 2,
  });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

// ── schema ───────────────────────────────────────────────────────────────────

await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT`;
await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
await sql`ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL`;

// Dropped and re-added rather than IF NOT EXISTS: Postgres has no such clause
// for constraints, and re-running should end at the same definition either way.
await sql`ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_has_login`;
await sql`
  ALTER TABLE app_users ADD CONSTRAINT app_users_has_login CHECK (
    email IS NOT NULL OR (username IS NOT NULL AND password_hash IS NOT NULL)
  )
`;

await sql`
  CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (lower(username))
`;

const cols = await sql`
  SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name = 'app_users' ORDER BY ordinal_position
`;
console.log("app_users columns:");
for (const c of cols) {
  console.log(`  ${c.column_name.padEnd(15)} ${c.is_nullable === "YES" ? "nullable" : "not null"}`);
}

// ── position ─────────────────────────────────────────────────────────────────
//
// DO NOTHING on conflict, matching seed-roster.mjs: if someone has already
// adjusted this position's tabs in the admin screen, re-running must not
// silently undo it.
await sql`
  INSERT INTO app_positions (id, label, tabs, is_admin)
  VALUES (${POSITION.id}, ${POSITION.label}, ${POSITION.tabs}::text[], FALSE)
  ON CONFLICT (id) DO NOTHING
`;

const [pos] = await sql`SELECT label, tabs FROM app_positions WHERE id = ${POSITION.id}`;
console.log(`\nposition: ${pos.label}  ${pos.tabs.join(" ")}`);

// ── user ─────────────────────────────────────────────────────────────────────

const hash = await hashPassword(PASSWORD);

// Rename first, so the lookup that follows finds the account under either
// handle. Guarded on the new name being free: if both rows somehow exist, this
// does nothing rather than colliding with the unique index.
const renamed = await sql`
  UPDATE app_users SET username = ${USERNAME}
  WHERE lower(username) = lower(${PREVIOUS_USERNAME})
    AND NOT EXISTS (SELECT 1 FROM app_users WHERE lower(username) = lower(${USERNAME}))
  RETURNING id
`;
if (renamed.length) console.log(`renamed:  "${PREVIOUS_USERNAME}" -> "${USERNAME}"`);

const [existing] = await sql`
  SELECT id FROM app_users WHERE lower(username) = lower(${USERNAME})
`;

if (existing) {
  // token_version bumps with the password, so any device still signed in on the
  // old credential is signed out — the point of setting it again.
  await sql`
    UPDATE app_users
    SET password_hash = ${hash},
        name          = ${NAME},
        disabled_at   = NULL,
        token_version = token_version + 1
    WHERE id = ${existing.id}
  `;
  console.log(`user:     ${USERNAME} — password reset, other sessions signed out`);
} else {
  await sql`
    INSERT INTO app_users (id, email, username, password_hash, name, position_id)
    VALUES (${randomUUID()}, NULL, ${USERNAME}, ${hash}, ${NAME}, ${POSITION.id})
  `;
  console.log(`user:     ${USERNAME} — created`);
}

// ── summary ──────────────────────────────────────────────────────────────────

const summary = await sql`
  SELECT p.label, COUNT(u.id)::int AS n, p.tabs, p.is_admin
  FROM app_positions p LEFT JOIN app_users u ON u.position_id = p.id
  GROUP BY p.id, p.label, p.tabs, p.is_admin ORDER BY p.label
`;
console.log("\npositions now:");
for (const r of summary) {
  console.log(
    `  ${r.label.padEnd(24)} ${String(r.n).padStart(2)} user(s)  ${r.is_admin ? "[admin] " : "        "}${r.tabs.join(" ")}`,
  );
}
