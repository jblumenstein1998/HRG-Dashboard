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

/**
 * The same, one rank up, for the routes behind a super-admin screen.
 *
 * A separate function rather than an argument, so a route cannot be downgraded
 * by passing the wrong flag, and so grepping for the name finds every endpoint
 * at this level.
 */
export async function requireSuperAdminApi(): Promise<Response | null> {
  const viewer = await apiViewer();
  if (!viewer) return Response.json({ error: "Not signed in" }, { status: 401 });
  if (!viewer.position.isSuperAdmin) {
    return Response.json({ error: "Not allowed" }, { status: 403 });
  }
  return null;
}
