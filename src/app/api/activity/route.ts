import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "@/lib/users/session";
import { activityTab } from "@/lib/users/activityTab";
import { recordActivity } from "@/lib/users/store";

/**
 * Heartbeats from components/ActivityTracker.
 *
 * Checks the signed token only, not the user row: this is fired every few
 * minutes by every open page, and a stale or deleted account's rows are
 * harmless — the usage view joins to app_users and drops them. The proxy has
 * already turned away requests with no session at all.
 */
export async function POST(request: NextRequest) {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { path?: string; kind?: string };
  const tab = activityTab(body.path);
  const kind = body.kind === "view" ? "view" : body.kind === "active" ? "active" : null;
  if (!tab || !kind) return Response.json({ error: "Bad heartbeat" }, { status: 400 });

  await recordActivity(session.uid, tab, kind);
  return new Response(null, { status: 204 });
}
