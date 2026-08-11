import { apiViewer } from "./access";

/**
 * Admin check for API routes.
 *
 * Returns a Response to send when the caller isn't allowed, or null when they
 * are — so a route reads `const denied = await requireAdminApi(); if (denied)
 * return denied;` and can't forget to act on the result the way a boolean
 * return invites.
 *
 * Separate from access.ts's requireAdmin, which redirects: a redirect is right
 * for a page and wrong for a fetch.
 */
export async function requireAdminApi(): Promise<Response | null> {
  const viewer = await apiViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.position.isAdmin) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  return null;
}
