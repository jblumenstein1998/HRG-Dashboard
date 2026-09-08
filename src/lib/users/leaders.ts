/**
 * Above-store leaders and the stores they cover.
 *
 * One table, `app_leaders`, one row per leader, with the stores they own held
 * as an array of display labels on that row. Deliberately not a join table:
 * nothing else in the schema refers to a store — there is no store entity to
 * point at, only the labels in lib/stores.ts — so a second table would buy
 * referential integrity against a catalog that lives in code anyway.
 *
 * The labels are the same ones `getStoreLabel` puts on a card, which is what
 * lets the Drive-Thru filter compare a leader's list against the branches
 * BerryAI returned with no mapping step in between. `isKnownStoreLabel` screens
 * writes and reads, so renaming a store in STORE_CONFIG leaves stale labels
 * that stop matching rather than filtering the wrong restaurant.
 *
 * Schema creation follows the users/schema.ts pattern: an idempotent ensure*
 * memoised per process, called before every read and write.
 */

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { isKnownStoreLabel } from "@/lib/stores";

export type Leader = {
  id: string;
  name: string;
  /** Store display labels, e.g. ["Columbia", "Brentwood"]. */
  stores: string[];
};

let schemaReady: Promise<void> | null = null;

export function ensureLeaderSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createLeaderSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createLeaderSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS app_leaders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      stores     TEXT[] NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // Two leaders with the same name would be indistinguishable in the
  // Drive-Thru dropdown, which is the only place this data is ever read.
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS app_leaders_name_key ON app_leaders (lower(name))
  `;
}

const toLeader = (r: Record<string, unknown>): Leader => ({
  id: String(r.id),
  name: String(r.name),
  stores: ((r.stores as string[]) ?? []).filter(isKnownStoreLabel),
});

export async function listLeaders(): Promise<Leader[]> {
  await ensureLeaderSchema();
  const rows = await sql`SELECT * FROM app_leaders ORDER BY name`;
  return (rows as Record<string, unknown>[]).map(toLeader);
}

/**
 * Returns null when the name is already taken, rather than letting the unique
 * index throw — the caller turns that into a sentence instead of a 500.
 */
export async function createLeader(name: string): Promise<Leader | null> {
  await ensureLeaderSchema();
  const rows = await sql`
    INSERT INTO app_leaders (id, name)
    VALUES (${randomUUID()}, ${name.trim()})
    ON CONFLICT (lower(name)) DO NOTHING
    RETURNING *
  `;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? toLeader(r) : null;
}

/**
 * Patch semantics: an omitted field is left alone. `stores` is replaced whole
 * rather than added to, because the UI sends the checkbox set it is showing —
 * an unchecked box has to be able to mean "no longer theirs".
 *
 * Returns a sentence to show, or null on success. A rename can collide with the
 * unique index the same way a create can, and that has to read as a message
 * rather than as a 500 with a Postgres error code in it.
 */
export async function updateLeader(
  id: string,
  patch: { name?: string; stores?: string[] },
): Promise<string | null> {
  await ensureLeaderSchema();
  const stores = patch.stores?.filter(isKnownStoreLabel) ?? null;
  try {
    await sql`
      UPDATE app_leaders SET
        name   = COALESCE(${patch.name?.trim() ?? null}, name),
        stores = COALESCE(${stores}::text[], stores)
      WHERE id = ${id}
    `;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") {
      return "There's already a leader with that name.";
    }
    throw err;
  }
  return null;
}

/**
 * Deleting outright, not disabling. Nothing references a leader — no audit
 * trail, no historical record — so a removed one leaves nothing dangling, and
 * a tombstoned row would only clutter the dropdown it exists to populate.
 */
export async function deleteLeader(id: string): Promise<void> {
  await ensureLeaderSchema();
  await sql`DELETE FROM app_leaders WHERE id = ${id}`;
}
