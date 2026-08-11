import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/users/session";

/**
 * Authentication only — is this request signed in?
 *
 * Authorization (may this position reach this tab?) deliberately lives
 * elsewhere, in lib/users/access.ts, and runs inside the pages. Positions are
 * editable in the admin UI, so the tab list has to be read from Postgres; this
 * runs on the Edge runtime on every single request, where a database round trip
 * would be both unavailable and far too expensive. The signed cookie is
 * self-contained, so the check here is an HMAC verify and nothing else.
 *
 * That split means the cookie alone never grants access to a tab — it only
 * establishes who is asking. A user whose position lost a tab, or whose account
 * was disabled, still passes here and is stopped by the page guard, which reads
 * live state. The window is one request, not one session.
 */

// /api/cron/ is invoked by Vercel Cron, which sends no session cookie — those
// routes authenticate themselves with CRON_SECRET. /api/smg/ is reachable
// unauthenticated so the SMG tab can paint before auth resolves; the routes
// under it that write or hit SMG check the session themselves.
const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/smg/",
  "/api/cron/",
  "/api/slack",
];

/** Reachable while signed in but still owing a password change. */
const RESET_PATHS = ["/change-password", "/api/auth/change-password", "/api/auth/logout"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    // An API call gets a 401 rather than a redirect — a fetch following a 302
    // to the login page would parse HTML as JSON and report a confusing error.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // A temporary password gets you exactly one screen until it's changed.
  if (session.rst && !RESET_PATHS.some((p) => pathname.startsWith(p))) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Password change required" }, { status: 403 });
    }
    const url = request.nextUrl.clone();
    url.pathname = "/change-password";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png|.*\\.jpg|.*\\.jpeg|.*\\.svg|.*\\.ico|.*\\.webp).*)"],
};
