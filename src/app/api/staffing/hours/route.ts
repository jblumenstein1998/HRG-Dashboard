import { NextRequest, NextResponse } from "next/server";
import { getStoreHours, recentCompleteWeeks, recentCompletePeriods } from "@/lib/staffing";

/**
 * Regular and overtime hours, per store, per complete week.
 *
 * GET /api/staffing/hours?weeks=4          the last 4 complete Mon–Sun weeks
 * GET /api/staffing/hours?periods=2        the last 2 complete pay periods
 *
 * Seven cached GetShifts calls per store per week, so four weeks across twelve
 * stores is 336 calls on a cold cache and nothing on a warm one — past business
 * dates never change.
 */
export const maxDuration = 300;

const MAX_WEEKS = 8;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const rawToday = p.get("today");
  const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    : new Date().toISOString().slice(0, 10);

  // A pay period is four or five weeks, so two of them is roughly eight weeks of
  // shifts per store — cached, but a cold run is not cheap.
  const periods = Number(p.get("periods") ?? 0);
  const spans = periods > 0
    ? recentCompletePeriods(today, Math.min(4, Math.max(1, periods)))
    : recentCompleteWeeks(today, Math.min(MAX_WEEKS, Math.max(1, Number(p.get("weeks") ?? 4) || 4)));

  try {
    return NextResponse.json(await getStoreHours(spans));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/hours] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
