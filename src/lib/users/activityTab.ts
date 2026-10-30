/**
 * Which tab a path belongs to, for activity tracking. No server-only imports:
 * the tracker (client) and the API route (server) both use it, and the route
 * relies on it to refuse anything that isn't a real tab.
 */

import { ALL_TABS } from "./tabs";

/** Every tab plus Users & Access, which isn't in ALL_TABS because no position ticks it. */
const TRACKED = [...ALL_TABS, "/admin"] as const;

export function activityTab(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  // Longest first, so "/admin-links" wins over "/admin".
  const match = [...TRACKED]
    .sort((a, b) => b.length - a.length)
    .find((t) => pathname === t || pathname.startsWith(`${t}/`));
  return match ?? null;
}
