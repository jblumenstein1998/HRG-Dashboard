import { NextRequest, NextResponse } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { filterOutstandingKeys } from "@/lib/smgCaseStore";
import { fetchCaseDetail, getCaseToken, type ZCaseDetail } from "@/lib/smgCases";

// A v5 login (~3s) plus one detail call per case. The cap below keeps the
// second half bounded.
export const maxDuration = 60;

/**
 * Incident descriptions for open ZCases.
 *
 * GET /api/smg/zcases/details?keys=<guid>,<guid>
 *
 * Live-only by design, in both directions: nothing here is written to the
 * database, and the route refuses any case that isn't currently outstanding.
 * The description is what you read while deciding what to do about a case; once
 * it's resolved it's SMG's record to keep, not ours. That's also why this is a
 * separate call rather than a field on /api/smg/zcases — the case list is
 * served from Postgres and has to stay fast and offline-able, while this always
 * costs a round trip to SMG.
 *
 * Batched rather than one-per-case because the cost is nearly all in the login:
 * fetching four descriptions together is barely slower than fetching one, and
 * the open list is a handful of cases at most.
 */

/** SMG case keys are GUIDs. Anything else isn't ours to look up. */
const CASE_KEY = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/**
 * Ceiling on one request. The open list is normally under ten; anything near
 * this is a caller doing something the tab doesn't do.
 */
const MAX_KEYS = 25;

export async function GET(req: NextRequest) {
  // `/api/smg/` is public in proxy.ts so the tab can paint before auth
  // resolves. Guest verbatims are not part of that, so this checks the session
  // itself — and checks it against the tab the ZCases live on, so reading them
  // needs the same entitlement as seeing the section they came from.
  const viewer = await apiViewer();
  if (!viewer?.position.tabs.includes("/survey-data")) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const keys = (req.nextUrl.searchParams.get("keys") ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (keys.some((k) => !CASE_KEY.test(k))) {
    return NextResponse.json({ error: "bad case key" }, { status: 400 });
  }
  if (keys.length > MAX_KEYS) {
    return NextResponse.json({ error: `at most ${MAX_KEYS} keys` }, { status: 400 });
  }

  const noStore = (res: NextResponse) => {
    // Guest free text: never cached by a proxy, never held past the response.
    res.headers.set("Cache-Control", "no-store, private");
    return res;
  };

  if (keys.length === 0) {
    return noStore(NextResponse.json({ details: {} }));
  }

  try {
    const open = await filterOutstandingKeys(keys);
    if (open.length === 0) {
      return noStore(NextResponse.json({ details: {} }));
    }

    const auth = await getCaseToken();
    const settled = await Promise.allSettled(open.map((k) => fetchCaseDetail(auth, k)));

    // One case failing shouldn't blank the rest — the client renders a per-row
    // fallback for anything missing from the map.
    const details: Record<string, ZCaseDetail> = {};
    for (const result of settled) {
      if (result.status === "fulfilled") details[result.value.caseKey] = result.value;
      else console.error(`[ZCase] detail fetch failed: ${result.reason}`);
    }

    return noStore(NextResponse.json({ details }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ZCase] /api/smg/zcases/details failed:", message);
    return noStore(NextResponse.json({ error: message }, { status: 500 }));
  }
}
