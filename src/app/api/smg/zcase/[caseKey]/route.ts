import { NextResponse, type NextRequest } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { caseDeepLink, getCaseToken } from "@/lib/smgCases";

// A v5 login plus the SSO handoff, ~3s. Well inside the default, but the SMG
// login is the slow part and it's worth the headroom.
export const maxDuration = 60;

/**
 * Opens a ZCase in smg360, signing the browser in on the way.
 *
 * A bare deep link to `360.smg.com/#/card/.../case-detail/...` only works if
 * the browser already holds an smg360 session. Without one the SPA doesn't
 * redirect to a login — it silently discards the route, rewrites the URL to
 * `#/` and renders a blank page. Since v5 sessions expire on their own, that's
 * what a ZCase link does most of the time.
 *
 * smg360's own SSO fixes it by putting the token in the URL fragment
 * (`<route>#access_token=…&refresh_token=…`), which the SPA parses on boot and
 * turns into its `authorizationData` cookie. This route does exactly that,
 * except the route half is the case instead of the card list — v5's own
 * `/360/report=…` entry point only accepts a `view` name, so it can't be
 * pointed at a single case.
 *
 * Two consequences worth knowing:
 *   - The token lands in the browser's history, same as SMG's own SSO redirect.
 *     It expires in ~40 minutes.
 *   - It's a session on the shared SMG account, so this is gated on the
 *     dashboard cookie — `/api/smg/` is otherwise public (see proxy.ts).
 */

/** SMG case keys are GUIDs. Anything else isn't ours to redirect to. */
const CASE_KEY = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/smg/zcase/[caseKey]">) {
  const { caseKey } = await ctx.params;

  const { token } = await getBerryAuth();
  if (!token) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  if (!CASE_KEY.test(caseKey)) {
    return NextResponse.json({ error: "bad case key" }, { status: 400 });
  }

  let auth;
  try {
    auth = await getCaseToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ZCase] SSO redirect failed for ${caseKey}: ${message}`);
    // Better a working case list than a dead tab: the user is at least signed
    // in and one search away from the case.
    return NextResponse.redirect("https://reporting.smg.com/360/report=caselist", 302);
  }

  const fragment = new URLSearchParams({ access_token: auth.token });
  if (auth.refreshToken) fragment.set("refresh_token", auth.refreshToken);

  const res = NextResponse.redirect(`${caseDeepLink(caseKey)}#${fragment}`, 302);
  // The URL carries a live credential — it must never sit in a shared cache.
  res.headers.set("Cache-Control", "no-store, private");
  return res;
}
