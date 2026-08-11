/**
 * Reads and writes for accounts and positions.
 *
 * Everything that can fail a login returns the same shape, so the route can't
 * accidentally leak which half was wrong — see `findByEmail`, which is happy to
 * return a disabled user and leaves the decision to the caller.
 */

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { hashPassword } from "./password";
import { ALL_TABS, ensureUserSchema, OWNER_POSITION_ID, type Tab } from "./schema";

export type Position = {
  id: string;
  label: string;
  tabs: Tab[];
  isAdmin: boolean;
};

export type User = {
  id: string;
  email: string;
  name: string;
  positionId: string;
  mustReset: boolean;
  disabledAt: string | null;
  tokenVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
};

type UserRow = User & { passwordHash: string };

/**
 * Drops the password hash.
 *
 * Declaring a return type of `User` does **not** remove it — TypeScript's
 * structural typing is happy with the extra property and `JSON.stringify` then
 * serialises it straight to the browser. Anything that leaves the server goes
 * through here. A hash is not a password, but it is offline-crackable, and it
 * has no business in a response, a log or a cache.
 */
export const publicUser = ({ passwordHash: _drop, ...rest }: UserRow): User => rest;

const toPosition = (r: Record<string, unknown>): Position => ({
  id: String(r.id),
  label: String(r.label),
  tabs: ((r.tabs as string[]) ?? []).filter((t): t is Tab => (ALL_TABS as readonly string[]).includes(t)),
  isAdmin: Boolean(r.is_admin),
});

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: String(r.id),
  email: String(r.email),
  name: String(r.name),
  positionId: String(r.position_id),
  passwordHash: String(r.password_hash),
  mustReset: Boolean(r.must_reset),
  disabledAt: r.disabled_at === null ? null : String(r.disabled_at),
  tokenVersion: Number(r.token_version),
  createdAt: String(r.created_at),
  lastLoginAt: r.last_login_at === null ? null : String(r.last_login_at),
});

// ── positions ────────────────────────────────────────────────────────────────

export async function listPositions(): Promise<Position[]> {
  await ensureUserSchema();
  const rows = await sql`SELECT * FROM app_positions ORDER BY label`;
  return (rows as Record<string, unknown>[]).map(toPosition);
}

export async function getPosition(id: string): Promise<Position | null> {
  await ensureUserSchema();
  const rows = await sql`SELECT * FROM app_positions WHERE id = ${id}`;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? toPosition(r) : null;
}

export async function upsertPosition(p: {
  id: string;
  label: string;
  tabs: string[];
  isAdmin?: boolean;
}): Promise<void> {
  await ensureUserSchema();
  const tabs = p.tabs.filter((t) => (ALL_TABS as readonly string[]).includes(t));
  await sql`
    INSERT INTO app_positions (id, label, tabs, is_admin)
    VALUES (${p.id}, ${p.label}, ${tabs}::text[], ${p.isAdmin ?? false})
    ON CONFLICT (id) DO UPDATE SET
      label = EXCLUDED.label,
      tabs  = EXCLUDED.tabs,
      -- is_admin is not updatable through the normal path: losing it by
      -- accident would leave nobody able to reach the admin screens.
      is_admin = app_positions.is_admin
  `;
}

/**
 * Refuses to delete a position that still has people in it, or the owner
 * position. Postgres' FK would reject the first case anyway; catching it here
 * turns a 500 into a sentence the UI can show.
 */
export async function deletePosition(id: string): Promise<string | null> {
  await ensureUserSchema();
  if (id === OWNER_POSITION_ID) return "The owner position can't be deleted.";

  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM app_users WHERE position_id = ${id}
  `) as { n: number }[];
  if ((rows[0]?.n ?? 0) > 0) {
    return `That position still has ${rows[0].n} user(s). Move them first.`;
  }

  await sql`DELETE FROM app_positions WHERE id = ${id}`;
  return null;
}

// ── users ────────────────────────────────────────────────────────────────────

export async function listUsers(): Promise<User[]> {
  await ensureUserSchema();
  const rows = await sql`
    SELECT * FROM app_users ORDER BY disabled_at NULLS FIRST, name
  `;
  return (rows as Record<string, unknown>[]).map((r) => publicUser(toUser(r)));
}

export async function findByEmail(email: string): Promise<UserRow | null> {
  await ensureUserSchema();
  const rows = await sql`
    SELECT * FROM app_users WHERE lower(email) = lower(${email})
  `;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? toUser(r) : null;
}

export async function findById(id: string): Promise<UserRow | null> {
  await ensureUserSchema();
  const rows = await sql`SELECT * FROM app_users WHERE id = ${id}`;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? toUser(r) : null;
}

export async function countUsers(): Promise<number> {
  await ensureUserSchema();
  const rows = (await sql`SELECT COUNT(*)::int AS n FROM app_users`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function createUser(u: {
  email: string;
  name: string;
  positionId: string;
  password: string;
  mustReset?: boolean;
}): Promise<User> {
  await ensureUserSchema();
  const id = randomUUID();
  const hash = await hashPassword(u.password);

  const rows = await sql`
    INSERT INTO app_users (id, email, name, position_id, password_hash, must_reset)
    VALUES (${id}, ${u.email.trim().toLowerCase()}, ${u.name.trim()}, ${u.positionId},
            ${hash}, ${u.mustReset ?? true})
    RETURNING *
  `;
  return publicUser(toUser((rows as Record<string, unknown>[])[0]));
}

export async function updateUser(
  id: string,
  patch: { name?: string; email?: string; positionId?: string },
): Promise<void> {
  await ensureUserSchema();
  await sql`
    UPDATE app_users SET
      name        = COALESCE(${patch.name ?? null}, name),
      email       = COALESCE(${patch.email ? patch.email.trim().toLowerCase() : null}, email),
      position_id = COALESCE(${patch.positionId ?? null}, position_id)
    WHERE id = ${id}
  `;
}

/**
 * Sets a password and bumps token_version, which invalidates every session the
 * user currently holds. That's the point on a reset — an admin issuing a new
 * password because someone lost theirs should end whatever sessions exist.
 */
export async function setPassword(id: string, password: string, mustReset: boolean): Promise<void> {
  await ensureUserSchema();
  const hash = await hashPassword(password);
  await sql`
    UPDATE app_users
    SET password_hash = ${hash},
        must_reset    = ${mustReset},
        token_version = token_version + 1
    WHERE id = ${id}
  `;
}

/** Disabling also bumps token_version, so an active session dies immediately. */
export async function setDisabled(id: string, disabled: boolean): Promise<void> {
  await ensureUserSchema();
  await sql`
    UPDATE app_users
    SET disabled_at   = ${disabled ? new Date().toISOString() : null}::timestamptz,
        token_version = token_version + 1
    WHERE id = ${id}
  `;
}

export async function recordLogin(id: string): Promise<void> {
  await sql`UPDATE app_users SET last_login_at = now() WHERE id = ${id}`;
}
