/**
 * The return leg of "Save to Google Drive": Google has sent the browser back to
 * the sign-in callback with a "d_" state. Verify it, build the store
 * presentation, upload it to the person's Drive as Google Slides, and land them
 * back on the Management tab with the link.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/users/access";
import { DRIVE_COOKIE, exchangeDriveCode, saveDeckToDrive } from "@/lib/google/drive";
import { generateStoreDeck, resolveDeckTarget } from "@/lib/wbr/generateStore";

export async function finishDriveSave(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const stash = request.cookies.get(DRIVE_COOKIE)?.value ?? "";
  const [expectedState, verifier, payload] = stash.split(".");
  let wanted: { target?: string; weekEnd?: string } = {};
  try {
    wanted = JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8") || "{}");
  } catch {
    // Left empty; caught below as an expired request.
  }

  const done = (q: Record<string, string>) => {
    const url = request.nextUrl.clone();
    url.pathname = "/management";
    url.search = `?${new URLSearchParams({ ...q, target: wanted.target ?? "", weekEnd: wanted.weekEnd ?? "" })}`;
    const res = NextResponse.redirect(url);
    res.cookies.delete(DRIVE_COOKIE);
    return res;
  };
  const fail = (msg: string) => done({ drive: "error", msg });

  if (params.get("error")) return fail(params.get("error") === "access_denied" ? "Google Drive access wasn't allowed." : params.get("error")!);
  const code = params.get("code");
  if (!code || !expectedState || !verifier || params.get("state") !== expectedState || typeof wanted.target !== "string") {
    return fail("That save expired or couldn't be verified. Please try again.");
  }

  const viewer = await getViewer();
  if (!viewer?.user.email || !viewer.position.tabs.includes("/management")) return fail("Please sign in again.");

  try {
    const { accessToken, email } = await exchangeDriveCode({ code, verifier, origin: request.nextUrl.origin });
    // The Drive must be the signed-in person's own, not whoever else this browser can reach.
    if (email !== viewer.user.email.toLowerCase()) {
      return fail(`Google returned ${email}, but you're signed in as ${viewer.user.email}.`);
    }
    // Resolved again rather than carried from the start leg: a leader's stores
    // may have changed on Users & Access in between.
    const target = await resolveDeckTarget(wanted.target);
    if (!target) return fail("That selection no longer exists.");
    if (!target.stores.length) return fail(`${target.name}: none of these stores are on PAR yet.`);
    const deck = await generateStoreDeck({ ...target, weekEnd: wanted.weekEnd || undefined });
    const name = deck.fileName.replace(/\.pptx$/i, "");
    const saved = await saveDeckToDrive(accessToken, name, deck.file);
    return done({ drive: "saved", url: saved.url, name, warn: JSON.stringify(deck.warnings) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[drive] save failed: ${msg}`);
    return fail(msg);
  }
}
