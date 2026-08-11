import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { verifyPassword } from "@/lib/users/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/users/session";
import { findByEmail, recordLogin } from "@/lib/users/store";

/**
 * Signs in against the dashboard's own account table.
 *
 * This used to forward the email and password to BerryAI and keep its token as
 * the session, which meant a dashboard account *was* a BerryAI account: no way
 * to give someone access without a vendor seat, no way to tell two people
 * apart, and no way to take access away without changing a shared credential.
 * Vendor logins are now service credentials held in the environment and used
 * server-side; see lib/berryAuth.ts.
 */

/**
 * Every failure returns the same message and status. Distinguishing "no such
 * account" from "wrong password" tells an attacker which emails are real, and
 * saying "your account is disabled" confirms it just as well.
 */
const GENERIC = "Email or password is incorrect.";

export async function POST(request: NextRequest) {
  const { email, password } = (await request.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
  };

  if (!email || !password) {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  const user = await findByEmail(email);

  // Hash even when the user doesn't exist, so a missing account and a wrong
  // password take the same time. Without it, response timing leaks which
  // emails are registered.
  const hash = user?.passwordHash ?? "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const ok = await verifyPassword(password, hash);

  if (!user || !ok || user.disabledAt) {
    return Response.json({ error: GENERIC }, { status: 401 });
  }

  const token = await signSession({
    uid: user.id,
    pos: user.positionId,
    ver: user.tokenVersion,
    rst: user.mustReset,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);

  // Clear the old BerryAI cookies if this browser still carries them, so a
  // stale token can't satisfy anything that hasn't been migrated yet.
  jar.delete("berry_token");
  jar.delete("berry_corp");

  await recordLogin(user.id);

  return Response.json({ ok: true, mustReset: user.mustReset });
}
