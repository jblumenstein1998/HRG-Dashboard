import { NextRequest, NextResponse } from "next/server";
import { businessDateISO } from "@/lib/businessDay";
import { addDays } from "@/lib/slackReports";
import { syncTeamworx, weekEndingOf } from "@/lib/teamworx";

/**
 * Pulls each store's sales forecast and scheduled hours from Teamworx.
 *
 * Daily (vercel.json), this week and next — schedules for next week are
 * written during this one. 26 Net-Chef logins a run, a few at a time.
 * `?week=YYYY-MM-DD` (any date in the week) pulls one other week, for a
 * backfill.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const week = req.nextUrl.searchParams.get("week");
  const thisWeek = weekEndingOf(businessDateISO());
  const weeks = week ? [weekEndingOf(week)] : [thisWeek, addDays(thisWeek, 7)];

  const results = await syncTeamworx(weeks);
  const failed = results.filter((r) => !r.ok);
  console.log(`[teamworx] ${results.length - failed.length}/${results.length} store-weeks synced (${weeks.join(", ")})`);
  for (const f of failed) console.log(`[teamworx] ${f.storeId} ${f.weekEnding} failed: ${f.error}`);
  return NextResponse.json({ ok: failed.length === 0, weeks, results });
}
