import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { DUMMY_HASH, verifyPassword } from "@/lib/users/password";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "@/lib/users/session";
import { findByUsername, recordLogin } from "@/lib/users/store";

/**
 * Username and password sign-in, for shared device accounts only.
 *
 * Deliberately narrower than the route this replaces, which took an email and
 * was removed with "Remove password sign-in". It looks accounts up by
 * `username`, and a person's row has none — so no Google-authenticated account
 * is reachable from here no matter what is posted. Delegated identity stays
 * the only way in for a human; this is the exception for a machine that isn't
 * one, and the shape of the lookup is what enforces that rather than a check
 * somebody could forget to write.
 */

/**
 * Every failure returns the same message and status. Distinguishing "no such
 * account" from "wrong password" tells an attacker which usernames are real,
 * and saying "your account is disabled" confirms it just as well.
 */
const GENERIC = "Username or password is incorrect.";

export async function POST(request: NextRequest) {
  const { username, password } = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    return Response.json({ error: "Username and password are required" }, { status: 400 });
  }

  // An email address can never sign in here — store accounts have a username and
  // people authenticate with Google — so say that instead of "incorrect".
  //
  // Worth the special case because the browser causes it: Chrome sees a
  // username/password pair, offers a saved work login, and fills an address into
  // a field that cannot accept one. Without this the person is told their
  // password is wrong, which is both unhelpful and untrue.
  //
  // Leaks nothing. This is a property of the string that was typed, not of any
  // account — the reply is identical whether or not that address is on the
  // roster, so it can't be used to test who exists.
  if (username.includes("@")) {
    return Response.json(
      { error: "That's an email address — use Sign in with Google above. Store accounts sign in with a username." },
      { status: 400 },
    );
  }

  const user = await findByUsername(username);

  // Hash even when the account doesn't exist, so a missing username and a wrong
  // password take the same time. Without it, response timing leaks which
  // usernames are real.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !ok || user.disabledAt) {
    return Response.json({ error: GENERIC }, { status: 401 });
  }

  const token = await signSession({
    uid: user.id,
    pos: user.positionId,
    ver: user.tokenVersion,
  });

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, sessionCookieOptions);

  await recordLogin(user.id);

  return Response.json({ ok: true });
}
