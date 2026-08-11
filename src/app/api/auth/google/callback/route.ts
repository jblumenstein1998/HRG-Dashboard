import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, OAUTH_COOKIE } from "@/lib/users/google";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/users/session";
import { findByEmail, recordLogin, clearMustReset } from "@/lib/users/store";

/**
 * Where Google sends the browser back.
 *
 * Signing in with a valid work account is necessary but not sufficient: the
 * address must also be on the roster. Someone at the company who hasn't been
 * added gets told to ask an administrator rather than being let in, so the
 * dashboard's access list stays the access list.
 */

/** Back to /login with a message, rather than a raw error page. */
function fail(request: NextRequest, message: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?error=${encodeURIComponent(message)}`;
  const res = NextResponse.redirect(url);
  res.cookies.delete(OAUTH_COOKIE);
  return res;
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The user pressed Cancel, or Google refused (commonly a personal account
  // caught by the `hd` hint).
  const oauthError = params.get("error");
  if (oauthError) {
    return fail(request, oauthError === "access_denied" ? "Sign-in cancelled." : oauthError);
  }

  const code = params.get("code");
  const state = params.get("state");
  const stash = request.cookies.get(OAUTH_COOKIE)?.value;

  if (!code || !state || !stash) return fail(request, "Sign-in expired. Please try again.");

  const [expectedState, verifier] = stash.split(".");
  // Not constant-time, but the state is a fresh 128-bit random value the
  // attacker never sees; there is nothing to learn from timing.
  if (!expectedState || !verifier || state !== expectedState) {
    return fail(request, "Sign-in couldn't be verified. Please try again.");
  }

  let identity;
  try {
    identity = await exchangeCode({ code, verifier, origin: request.nextUrl.origin });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auth] Google sign-in failed: ${message}`);
    return fail(request, message);
  }

  const user = await findByEmail(identity.email);
  if (!user) {
    return fail(
      request,
      `${identity.email} isn't set up on the dashboard. Ask an administrator to add you.`,
    );
  }
  if (user.disabledAt) {
    return fail(request, "That account has been disabled.");
  }

  // A Google account has no dashboard password, so there is nothing to force a
  // change of. Anyone still flagged from the password era is cleared here.
  if (user.mustReset) await clearMustReset(user.id);

  const token = await signSession({
    uid: user.id,
    pos: user.positionId,
    ver: user.tokenVersion,
    rst: false,
  });

  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  const res = NextResponse.redirect(url);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  res.cookies.delete(OAUTH_COOKIE);
  // Legacy BerryAI cookies, if this browser still carries them.
  res.cookies.delete("berry_token");
  res.cookies.delete("berry_corp");

  await recordLogin(user.id);
  return res;
}
