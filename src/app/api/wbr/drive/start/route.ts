import { NextRequest, NextResponse } from "next/server";
import { getViewer } from "@/lib/users/access";
import { createPkce, googleConfigured, randomToken } from "@/lib/users/google";
import { buildDriveAuthUrl, DRIVE_COOKIE, DRIVE_STATE_PREFIX } from "@/lib/google/drive";
import { storeDeckOptions } from "@/lib/wbr/storeData";

/**
 * GET /api/wbr/drive/start?store=<label>&weekEnd=YYYY-MM-DD
 *
 * Begins "Save to Google Drive" for the store presentation: checks the person
 * may make decks (the Management tab) and signs in with Google (a shared store login
 * has no Drive), remembers what to build, and sends them to Google to allow
 * drive.file. Google returns to the sign-in callback, which hands a "d_" state
 * to lib/wbr/driveSave.
 */
export async function GET(request: NextRequest) {
  const back = (msg: string) => {
    const url = request.nextUrl.clone();
    url.pathname = "/management";
    url.search = `?drive=error&msg=${encodeURIComponent(msg)}`;
    return NextResponse.redirect(url);
  };

  const viewer = await getViewer();
  if (!viewer) return NextResponse.redirect(new URL("/login", request.url));
  if (!viewer.position.tabs.includes("/management")) return back("Your position can't make presentations.");
  if (!viewer.user.email) return back("Store logins can't save to Google Drive — use Download.");
  if (!googleConfigured()) return back("Google isn't configured on this deployment.");

  const p = request.nextUrl.searchParams;
  const store = storeDeckOptions().find((s) => s.label === p.get("store"))?.label;
  if (!store) return back("Pick a store.");
  const weekEnd = /^\d{4}-\d{2}-\d{2}$/.test(p.get("weekEnd") ?? "") ? p.get("weekEnd")! : "";

  const state = DRIVE_STATE_PREFIX + randomToken(16);
  const { verifier, challenge } = await createPkce();
  const res = NextResponse.redirect(buildDriveAuthUrl({ origin: request.nextUrl.origin, state, challenge, email: viewer.user.email }));
  // What to build rides with the state; httpOnly, lax (the return is a cross-site redirect), ten minutes.
  res.cookies.set(DRIVE_COOKIE, `${state}.${verifier}.${Buffer.from(JSON.stringify({ store, weekEnd })).toString("base64url")}`, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
