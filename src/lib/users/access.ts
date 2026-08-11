/**
 * Authorization: who may reach which tab.
 *
 * Split deliberately from the middleware, which only answers "is this request
 * signed in?". Positions are editable in the admin UI, so the answer to "may
 * this person see Bonus?" has to come from the database or an edit wouldn't
 * take effect until everyone signed in again. Server components can afford
 * that read; middleware — Edge runtime, every request — cannot.
 *
 * The read is cached per process for a few seconds. Positions change a handful
 * of times ever, page loads are constant, and a stale window measured in
 * seconds is the right trade. `invalidatePositions()` clears it on write so an
 * admin sees their own edit immediately.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySession } from "./session";
import { findById, getPosition, listPositions, type Position, type User } from "./store";
import { landingTab, type Tab } from "./tabs";

const CACHE_MS = 5000;
let cache: { at: number; byId: Map<string, Position> } | null = null;

export async function positionsById(): Promise<Map<string, Position>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.byId;
  const list = await listPositions();
  cache = { at: Date.now(), byId: new Map(list.map((p) => [p.id, p])) };
  return cache.byId;
}

export function invalidatePositions(): void {
  cache = null;
}

export type Viewer = { user: User; position: Position };

/**
 * The signed-in user, or null.
 *
 * Re-reads the user row rather than trusting the token's claims: the token says
 * who you are, the database says what you may do and whether you still exist.
 * `token_version` is compared here, which is what makes "sign out everywhere"
 * work — the middleware can't do this check, so it happens on the way into any
 * page that matters.
 */
export async function getViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  const payload = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await findById(payload.uid);
  if (!user || user.disabledAt) return null;
  if (user.tokenVersion !== payload.ver) return null;

  const position = (await positionsById()).get(user.positionId) ?? (await getPosition(user.positionId));
  if (!position) return null;

  return { user, position };
}

/**
 * Guard for a page. Redirects rather than throwing, so an unauthorised URL
 * behaves like a wrong turn instead of an error screen.
 *
 * Not signed in goes to /login; signed in but not entitled to this tab goes to
 * the first tab they *can* see, so they land somewhere useful rather than on a
 * dead end.
 */
export async function requireTab(tab: Tab): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");


  if (!viewer.position.tabs.includes(tab)) {
    redirect(landingTab(viewer.position.tabs));
  }
  return viewer;
}

/** Guard for the admin screens. */
export async function requireAdmin(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.position.isAdmin) redirect(landingTab(viewer.position.tabs));
  return viewer;
}

/** For API routes: the viewer, or null — no redirect, so callers can 401. */
export async function apiViewer(): Promise<Viewer | null> {
  return getViewer();
}
