/**
 * Reads and writes for accounts and positions.
 *
 * Everything that can fail a login returns the same shape, so the route can't
 * accidentally leak which half was wrong — see `findByEmail`, which is happy to
 * return a disabled user and leaves the decision to the caller.
 */

import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { ensureUserSchema } from "./schema";
import { ALL_TABS, type Tab } from "./tabs";

export type Position = {
  id: string;
  label: string;
  tabs: Tab[];
  isAdmin: boolean;
};

export type User = {
  id: string;
  /** Null for a shared device account; see lib/users/schema.ts. */
  email: string | null;
  /** Null for a person, who signs in with Google. */
  username: string | null;
  name: string;
  positionId: string;
  disabledAt: string | null;
  tokenVersion: number;
  createdAt: string;
  lastLoginAt: string | null;
};

/**
 * The hash never leaves this module's callers by accident: it's on the row type
 * the lookups return, not on `User`, so anything handed to a component or a
 * JSON response can't carry it.
 */
type UserRow = User & { passwordHash: string | null };

/** What to show for an account in a list: whichever handle it signs in with. */
export const loginHandle = (u: Pick<User, "email" | "username">): string =>
  u.email ?? u.username ?? "—";

/**
 * A row with the password digest dropped, for everything that isn't the login
 * route — which is everything but `findByUsername`.
 *
 * Names the fields it keeps rather than spreading and deleting the hash. A
 * column added to the table later is then invisible here until someone chooses
 * to expose it, instead of arriving in every JSON response by default.
 */
const publicUser = (u: UserRow): User => ({
  id: u.id,
  email: u.email,
  username: u.username,
  name: u.name,
  positionId: u.positionId,
  disabledAt: u.disabledAt,
  tokenVersion: u.tokenVersion,
  createdAt: u.createdAt,
  lastLoginAt: u.lastLoginAt,
});

const toPosition = (r: Record<string, unknown>): Position => ({
  id: String(r.id),
  label: String(r.label),
  tabs: ((r.tabs as string[]) ?? []).filter((t): t is Tab => (ALL_TABS as readonly string[]).includes(t)),
  isAdmin: Boolean(r.is_admin),
});

const toUser = (r: Record<string, unknown>): UserRow => ({
  id: String(r.id),
  email: r.email == null ? null : String(r.email),
  username: r.username == null ? null : String(r.username),
  passwordHash: r.password_hash == null ? null : String(r.password_hash),
  name: String(r.name),
  positionId: String(r.position_id),
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
 * Refuses to delete a position that still has people in it, or the last one
 * carrying admin rights.
 *
 * Postgres' foreign key would reject the first case anyway; catching it here
 * turns a 500 into a sentence the UI can show. The second is the one that
 * matters: deleting the only admin position would leave nobody able to reach
 * the user list, and no way back in short of a database console.
 */
export async function deletePosition(id: string): Promise<string | null> {
  await ensureUserSchema();

  const [counts] = (await sql`
    SELECT
      (SELECT COUNT(*)::int FROM app_users WHERE position_id = ${id}) AS users,
      (SELECT COUNT(*)::int FROM app_positions WHERE is_admin) AS admin_positions,
      (SELECT is_admin FROM app_positions WHERE id = ${id}) AS is_admin
  `) as { users: number; admin_positions: number; is_admin: boolean | null }[];

  if (counts?.is_admin === null) return "No such position.";
  if (counts.users > 0) {
    return `That position still has ${counts.users} user${counts.users === 1 ? "" : "s"}. Move them first.`;
  }
  if (counts.is_admin && counts.admin_positions <= 1) {
    return "That's the only position with admin rights — it can't be deleted.";
  }

  await sql`DELETE FROM app_positions WHERE id = ${id}`;
  return null;
}

// ── users ────────────────────────────────────────────────────────────────────

/**
 * Returns `User`, not `UserRow` — the hash is dropped here rather than at the
 * caller, because this feeds the admin API and a spread of the raw row would
 * put a password digest in a JSON response.
 */
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

/**
 * The username lookup, for password sign-in.
 *
 * Trimmed but not otherwise normalised: "HRGSTORE" is stored with its capitals
 * and the index matches case-insensitively, so a manager typing "hrgstore" on a
 * tablet keyboard gets in. The trim matters more than it looks — a handle read
 * off a card and pasted usually arrives with a trailing space.
 */
export async function findByUsername(username: string): Promise<UserRow | null> {
  await ensureUserSchema();
  const rows = await sql`
    SELECT * FROM app_users WHERE lower(username) = lower(${username.trim()})
  `;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? toUser(r) : null;
}

/**
 * Also drops the hash: this one backs `getViewer`, whose result reaches server
 * components that pass pieces of it to the client. Only the login route has any
 * business seeing a digest, and it looks accounts up by username.
 */
export async function findById(id: string): Promise<User | null> {
  await ensureUserSchema();
  const rows = await sql`SELECT * FROM app_users WHERE id = ${id}`;
  const r = (rows as Record<string, unknown>[])[0];
  return r ? publicUser(toUser(r)) : null;
}

export async function countUsers(): Promise<number> {
  await ensureUserSchema();
  const rows = (await sql`SELECT COUNT(*)::int AS n FROM app_users`) as { n: number }[];
  return rows[0]?.n ?? 0;
}

/**
 * Creates a Google account (email) or a shared device account (username and
 * password). The CHECK constraint rejects a call that supplies neither, so a
 * caller that forgets both gets a database error rather than a silently
 * unusable row.
 */
export async function createUser(u: {
  email?: string;
  username?: string;
  passwordHash?: string;
  name: string;
  positionId: string;
}): Promise<User> {
  await ensureUserSchema();
  const rows = await sql`
    INSERT INTO app_users (id, email, username, password_hash, name, position_id)
    VALUES (
      ${randomUUID()},
      ${u.email ? u.email.trim().toLowerCase() : null},
      ${u.username ? u.username.trim() : null},
      ${u.passwordHash ?? null},
      ${u.name.trim()},
      ${u.positionId}
    )
    RETURNING *
  `;
  return publicUser(toUser((rows as Record<string, unknown>[])[0]));
}

/**
 * Rotating a shared credential. Bumps token_version with it, so changing the
 * password signs out every device still holding the old one — which is the
 * entire point of changing it.
 */
export async function setPassword(id: string, passwordHash: string): Promise<void> {
  await ensureUserSchema();
  await sql`
    UPDATE app_users
    SET password_hash = ${passwordHash},
        token_version = token_version + 1
    WHERE id = ${id}
  `;
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
 * No setDisabled: removing someone is `deleteUser` now.
 *
 * Disabling was retired because an account that exists but is refused is a
 * state nobody wanted to manage — if they shouldn't get in, the row goes.
 *
 * `disabled_at` itself stays, and so do the checks in access.ts and the two
 * login routes that read it. Rows disabled before this change are still out,
 * which is the point; dropping the column would silently let them back in, and
 * on a live database it is one-way besides. Nothing sets it any more, so for
 * every account created from here on it is simply null.
 */

export async function recordLogin(id: string): Promise<void> {
  await sql`UPDATE app_users SET last_login_at = now() WHERE id = ${id}`;
}

/**
 * Removes an account outright. Returns a sentence to show, or null on success.
 *
 * `disabled_at` exists because this table was assumed to be referenced by audit
 * trails — the schema comment names bonus_inputs.entered_by. It isn't: no
 * foreign key points at app_users, and entered_by is a nullable TEXT column
 * that nothing in the app ever writes (the bonus UI doesn't send it). So a
 * delete orphans nothing today, and disabling stays the right default for
 * someone who has merely left — this is for rows that should never have
 * existed, like a typo'd address.
 *
 * If entered_by is ever populated, this becomes a real trade and the guard
 * below should grow a check for it rather than this comment going stale.
 *
 * Mirrors deletePosition: refuses the case that would lock everyone out. The
 * last active admin can't be deleted, or the user list becomes unreachable
 * short of a database console. Self-deletion is refused in the route, which is
 * where the viewer's identity is known.
 */
export async function deleteUser(id: string): Promise<string | null> {
  await ensureUserSchema();

  const [counts] = (await sql`
    SELECT
      (SELECT COUNT(*)::int
         FROM app_users u JOIN app_positions p ON p.id = u.position_id
        WHERE p.is_admin AND u.disabled_at IS NULL) AS active_admins,
      (SELECT p.is_admin
         FROM app_users u JOIN app_positions p ON p.id = u.position_id
        WHERE u.id = ${id}) AS is_admin,
      (SELECT disabled_at IS NULL FROM app_users WHERE id = ${id}) AS is_active
  `) as { active_admins: number; is_admin: boolean | null; is_active: boolean | null }[];

  if (counts?.is_admin === null) return "No such user.";
  if (counts.is_admin && counts.is_active && counts.active_admins <= 1) {
    return "That's the only active admin — deleting them would lock everyone out.";
  }

  await sql`DELETE FROM app_users WHERE id = ${id}`;
  return null;
}
