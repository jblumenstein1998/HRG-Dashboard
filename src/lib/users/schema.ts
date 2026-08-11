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
 * Note what is *not* here: nothing from BerryAI, NetChef, PAR or SMG. Those are
 * back-end service credentials in the environment. A dashboard account is only
 * a dashboard account — revoking one costs nobody their vendor access, and
 * adding a user needs no vendor seat.
 *
 * Schema creation follows the smgStore.ts / bonus store pattern: an idempotent
 * ensure* memoised per process, called before any read or write.
 */

import { sql } from "@/lib/db";

/** Every tab the nav can offer. Positions hold a subset of these. */
export const ALL_TABS = ["/dashboard", "/food-cost", "/par", "/survey-data", "/bonus"] as const;
export type Tab = (typeof ALL_TABS)[number];

export const TAB_LABELS: Record<Tab, string> = {
  "/dashboard": "Drive-Thru",
  "/food-cost": "Food Cost",
  "/par": "POS Sales",
  "/survey-data": "SMG",
  "/bonus": "Bonus",
};

/**
 * The position that can reach the admin screens. Seeded on first run and
 * protected from deletion, so the estate can't be locked out of its own user
 * list by an edit in the UI.
 */
export const OWNER_POSITION_ID = "owner";

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
      email         TEXT NOT NULL,
      name          TEXT NOT NULL,
      position_id   TEXT NOT NULL REFERENCES app_positions(id),
      password_hash TEXT NOT NULL,
      -- Set when an admin issues a temporary password. The app refuses to serve
      -- anything but the change-password screen until the user clears it.
      must_reset    BOOLEAN NOT NULL DEFAULT TRUE,
      -- Disabling rather than deleting: bonus_inputs.entered_by and similar
      -- audit trails reference people who have left.
      disabled_at   TIMESTAMPTZ,
      -- Bumped on password change or disable. Sessions carry the value they
      -- were minted with, so bumping it signs the person out everywhere.
      token_version INTEGER NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_login_at TIMESTAMPTZ
    )
  `;

  // Email is the login handle, so it has to be unique case-insensitively —
  // "Josh@" and "josh@" must not be two accounts. Stored lowercased on write;
  // the index enforces it regardless.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_key ON app_users (lower(email))
  `;
}
