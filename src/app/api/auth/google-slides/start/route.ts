import { NextRequest, NextResponse } from "next/server";
import { createPkce, randomToken } from "@/lib/users/google";
import { buildWorkspaceAuthUrl, WORKSPACE_OAUTH_COOKIE } from "@/lib/google/workspace";
import { requireAdminApi } from "@/lib/users/adminGuard";

/**
 * Begins connecting a Google account for the WBR deck (Slides + Drive, offline).
 * Same state/PKCE cookie scheme as sign-in — see /api/auth/google/start.
 */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const state = randomToken(16);
  const { verifier, challenge } = await createPkce();
  const res = NextResponse.redirect(buildWorkspaceAuthUrl({ origin: request.nextUrl.origin, state, challenge }));
  res.cookies.set(WORKSPACE_OAUTH_COOKIE, `${state}.${verifier}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return res;
}
