import { NextResponse, type NextRequest } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { caseVisit } from "@/lib/smgCaseStore";
import { getTeamDuring } from "@/lib/staffing";

export const maxDuration = 60;

/**
 * Who was on the clock when the guest behind a ZCase visited.
 *
 * GET /api/smg/zcase/<caseKey>/team
 *
 * The visit time is the guest's own account, and on location surveys it comes
 * rounded to the hour (86 of 105 in the 120 days to 2026-10-30 were exactly on
 * one), which reads as "some time in the 6 o'clock hour". So a time on the
 * hour is taken as that whole hour and anyone on the clock during any of it is
 * listed; a time with minutes is taken as that minute.
 *
 * Gated on the SMG tab rather than Staffing: it answers with names, jobs and
 * shift times only — no pay — and `/api/smg/` is otherwise public (proxy.ts).
 */

const CASE_KEY = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/smg/zcase/[caseKey]/team">) {
  const { caseKey } = await ctx.params;

  const viewer = await apiViewer();
  if (!viewer?.position.tabs.includes("/survey-data")) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }
  if (!CASE_KEY.test(caseKey)) {
    return NextResponse.json({ error: "bad case key" }, { status: 400 });
  }

  try {
    const visit = await caseVisit(caseKey);
    if (!visit) return NextResponse.json({ error: "This case has no visit time." }, { status: 404 });
    if (!visit.store) return NextResponse.json({ error: "This case isn't matched to a store." }, { status: 404 });

    const wholeHour = visit.minutes % 60 === 0;
    const end = wholeHour ? Math.min(visit.minutes + 59, 1439) : visit.minutes;
    const result = await getTeamDuring(visit.store, visit.localDate, visit.minutes, end);
    return NextResponse.json({ ...result, wholeHour });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ZCase team] ${caseKey} failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
