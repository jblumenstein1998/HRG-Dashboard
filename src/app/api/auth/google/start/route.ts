import { NextRequest, NextResponse } from "next/server";
import {
  buildAuthUrl,
  createPkce,
  googleConfigured,
  OAUTH_COOKIE,
  randomToken,
} from "@/lib/users/google";

/**
 * Begins Google Sign-In.
 *
 * The CSRF state and the PKCE verifier are stashed in one short-lived httpOnly
 * cookie. The callback refuses to proceed unless the `state` Google hands back
 * matches the cookie, which is what stops someone feeding a victim's browser an
 * authorization code they obtained themselves.
 *
 * SameSite must be `lax`, not `strict`: the callback arrives as a cross-site
 * redirect from accounts.google.com, and `strict` would withhold the cookie and
 * break every sign-in.
 */
export async function GET(request: NextRequest) {
  if (!googleConfigured()) {
    return NextResponse.json(
      { error: "Google Sign-In isn't configured on this deployment." },
      { status: 503 },
    );
  }

  const state = randomToken(16);
  const { verifier, challenge } = await createPkce();
  const origin = request.nextUrl.origin;

  const res = NextResponse.redirect(buildAuthUrl({ origin, state, challenge }));
  res.cookies.set(OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
