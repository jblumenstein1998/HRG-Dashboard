/**
 * The one live Workstream API token, kept in Postgres.
 *
 * Workstream tokens expire seven days after issue and the lifetime is fixed
 * platform-wide — there is no perpetual token to ask for. What does not expire
 * is the client id and secret, which can mint a new token or refresh the
 * current one indefinitely.
 *
 * ── Why this is stored rather than held in memory ────────────────────────────
 *
 * workstream.ts used to keep its token in module memory, deliberately, to stay
 * database-free like par.ts. That is the right call when minting is cheap and
 * private. It is the wrong one here, because refreshing is neither:
 *
 *   A refresh retires the previous token at that moment. Verified against the
 *   live API: the token we had been using returned 401 the instant a refresh
 *   issued its replacement. So two instances holding their own tokens are two
 *   instances taking turns invalidating each other.
 *
 *   Minting instead of refreshing avoids that by creating a *new* token each
 *   time — and on a serverless host that means a new credential per cold start,
 *   piling up live tokens in the company's dashboard with nothing to prune
 *   them.
 *
 * One row, shared by every instance, is the only shape where "the current
 * token" is a fact rather than an opinion each process holds separately.
 *
 * Follows the smgStore.ts / workstreamLinkStore.ts pattern: an idempotent
 * ensure* memoised per process, called before every read and write.
 */

import { sql } from "@/lib/db";

/** The table holds exactly one row, under this key. */
const ROW_ID = "current";

export type StoredToken = {
  token: string;
  /** When Workstream says it stops working. */
  expiresAt: Date;
  refreshedAt: Date;
};

let schemaReady: Promise<void> | null = null;

export function ensureWorkstreamTokenSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS workstream_token (
      -- Always 'current'. A primary key on a constant is how a table holds
      -- exactly one row without a second mechanism to enforce it.
      id           TEXT PRIMARY KEY,
      token        TEXT NOT NULL,
      expires_at   TIMESTAMPTZ NOT NULL,
      refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Workstream's own name for the token, echoed back by every refresh.
      -- Stored so a person reading the table can find it in the dashboard.
      name         TEXT NOT NULL DEFAULT ''
    )
  `;
}

type Row = {
  token: string;
  expires_at: string;
  refreshed_at: string;
};

export async function readStoredToken(): Promise<StoredToken | null> {
  await ensureWorkstreamTokenSchema();
  const rows = (await sql`
    SELECT token, expires_at, refreshed_at FROM workstream_token WHERE id = ${ROW_ID}
  `) as Row[];
  const row = rows[0];
  if (!row) return null;
  return {
    token: row.token,
    expiresAt: new Date(row.expires_at),
    refreshedAt: new Date(row.refreshed_at),
  };
}

/**
 * Record the token that is live now.
 *
 * Last write wins, which is the correct resolution: whoever refreshed most
 * recently holds the only token Workstream still honours, so their value is
 * the one every other instance should pick up.
 */
export async function writeStoredToken(
  token: string,
  expiresAt: Date,
  name = "",
): Promise<void> {
  await ensureWorkstreamTokenSchema();
  await sql`
    INSERT INTO workstream_token (id, token, expires_at, refreshed_at, name)
    VALUES (${ROW_ID}, ${token}, ${expiresAt.toISOString()}, now(), ${name})
    ON CONFLICT (id) DO UPDATE SET
      token        = EXCLUDED.token,
      expires_at   = EXCLUDED.expires_at,
      refreshed_at = now(),
      name         = EXCLUDED.name
  `;
}

/** When the token was last renewed and when it runs out. For the status line. */
export async function workstreamTokenStatus(): Promise<{
  hasToken: boolean;
  expiresAt: string | null;
  daysRemaining: number | null;
}> {
  const stored = await readStoredToken();
  if (!stored) return { hasToken: false, expiresAt: null, daysRemaining: null };
  const ms = stored.expiresAt.getTime() - Date.now();
  return {
    hasToken: true,
    expiresAt: stored.expiresAt.toISOString(),
    daysRemaining: Math.round((ms / 86_400_000) * 10) / 10,
  };
}
