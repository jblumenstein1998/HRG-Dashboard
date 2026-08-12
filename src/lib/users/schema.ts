/**
 * Postgres persistence for dashboard accounts.
 *
 * Two tables:
 *
 *   app_positions  a job title and the tabs it may reach. Editable from the
 *                  admin UI, so it lives in the database rather than in code.
 *   app_users      one row per person. `position_id` is the only thing that
 *                  grants access; there are no per-user overrides on purpose,
 *                  so "who can see Bonus" has exactly one answer per position.
 *
 * An account signs in one of two ways, and the columns say which:
 *
 *   email                       a person, authenticated by Google.
 *   username + password_hash    a shared device account, authenticated here.
 *
 * The second exists for a store's back-office machine, where there is no one
 * person to hold a Google identity. Every human still uses Google. A CHECK
 * enforces that a row has one route in or the other, so an account can't exist
 * that nothing can authenticate — and `email` is nullable rather than a
 * synthetic address, because a fake @hudsonrestaurantgroup.com value would
 * become a real one the day Workspace created that mailbox, and the Google
 * callback would then let it in.
 *
 * Note what is *not* here: nothing from BerryAI, NetChef, PAR or SMG. Those are
 * back-end service credentials in the environment. A dashboard account is only
 * a dashboard account — revoking one costs nobody their vendor access, and
 * adding a user needs no vendor seat.
 *
 * Schema creation follows the smgStore.ts / bonus store pattern: an idempotent
 * ensure* memoised per process, called before any read or write.
 */

import { sql } from "@/lib/db";

/**
 * The tab constants live in ./tabs, which imports nothing server-only.
 *
 * They are NOT re-exported from here on purpose: a client component importing
 * them through this module would pull in `sql` — and therefore `neon()` — and
 * blow up in the browser, which is exactly what happened once already.
 */

/**
 * Admin rights come from `app_positions.is_admin`, not from a magic id.
 *
 * An earlier version protected a hardcoded "owner" row, which would have
 * broken the moment the position was renamed. The rule enforced in
 * deletePosition is behavioural instead: a position can't be deleted while it
 * has users, and the last admin position can't be deleted at all — so there is
 * always someone who can reach the user list.
 */

let schemaReady: Promise<void> | null = null;

export function ensureUserSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createUserSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createUserSchema(): Promise<void> {
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
      -- Null for a shared device account, which signs in by username instead.
      email         TEXT,
      -- Null for a person, who signs in with Google instead.
      username      TEXT,
      password_hash TEXT,
      name          TEXT NOT NULL,
      position_id   TEXT NOT NULL REFERENCES app_positions(id),
      -- Disabling rather than deleting: bonus_inputs.entered_by and similar
      -- audit trails reference people who have left.
      disabled_at   TIMESTAMPTZ,
      -- Bumped when an account is disabled. Sessions carry the value they were
      -- minted with, so bumping it signs the person out everywhere.
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ,
      -- A row nothing can authenticate is a bug, not a state worth allowing:
      -- it would sit in the admin list looking like access that works.
      CONSTRAINT app_users_has_login CHECK (
        email IS NOT NULL OR (username IS NOT NULL AND password_hash IS NOT NULL)
      )
    )
  `;

  // Everything below this line brings an *existing* table up to the definition
  // above. `CREATE TABLE IF NOT EXISTS` does nothing at all when the table is
  // already there, so a database created before username/password_hash existed
  // would never gain them — and the username index at the bottom would then
  // fail on every request, taking down every authenticated page with
  // `column "username" does not exist`. That is not a hypothetical: it is what
  // happened locally in the window between this file changing and the migration
  // being run.
  //
  // So the ensure* has to be able to reach the current shape from any earlier
  // one on its own, which is what the rest of this module already assumes when
  // it calls ensureUserSchema() before every read and write. The migration
  // script stays useful for doing it deliberately and reporting what changed;
  // it just isn't load-bearing any more.
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username TEXT`;
  await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS password_hash TEXT`;
  // No-op once already nullable.
  await sql`ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL`;

  // Added only when absent. `DROP CONSTRAINT IF EXISTS` followed by `ADD` would
  // be simpler, but this runs on cold start in every serverless instance, and
  // that pair leaves a window in which the table has no constraint at all.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_users_has_login') THEN
        ALTER TABLE app_users ADD CONSTRAINT app_users_has_login CHECK (
          email IS NOT NULL OR (username IS NOT NULL AND password_hash IS NOT NULL)
        );
      END IF;
    END $$
  `;

  // Both handles are unique case-insensitively — "Josh@" and "josh@" must not
  // be two accounts, and neither must "HRGSTORE" and "hrgstore". Stored
  // lowercased (email) or trimmed (username) on write; the indexes enforce it
  // regardless. Postgres allows many NULLs in a unique index, which is what
  // lets every Google user share a null username and vice versa.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (lower(email))
  `;
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS app_users_username_key ON app_users (lower(username))
  `;
}
