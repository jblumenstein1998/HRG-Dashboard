import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/users/session";
import { recordActivity } from "@/lib/users/store";

/**
 * Heartbeats from components/ActivityTracker.
 *
 * Checks the signed token only, not the user row: this is fired every few
 * minutes by every open page, and a stale or deleted account's rows are
 * harmless — they match no one in the People table. The proxy has
 * already turned away requests with no session at all.
 */
export async function POST() {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });

  await recordActivity(session.uid);
  return new Response(null, { status: 204 });
}
