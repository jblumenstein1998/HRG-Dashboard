import { NextRequest, NextResponse } from "next/server";
import {
  currentWeekDays,
  getStoreHours,
  recentCompleteDays,
  recentCompleteWeeks,
  recentCompletePeriods,
  weekToDateSpan,
} from "@/lib/staffing";
import { todayCentralISO } from "@/lib/parRollup";

/**
 * Regular and overtime hours, per store, per complete week.
 *
 * GET /api/staffing/hours?weeks=4          the last 4 complete Mon–Sun weeks
 * GET /api/staffing/hours?periods=2        the last 2 complete pay periods
 * GET /api/staffing/hours?days=14          the last 14 complete business dates
 * GET /api/staffing/hours?weeks=3&wtd=1    3 complete weeks, then this week so far
 * GET /api/staffing/hours?wtdDays=1        this week, Monday through yesterday
 *
 * Seven cached GetShifts calls per store per week, so four weeks across twelve
 * stores is 336 calls on a cold cache and nothing on a warm one — past business
 * dates never change.
 */
export const maxDuration = 300;

const MAX_WEEKS = 8;
const MAX_DAYS = 21;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const rawToday = p.get("today");
  const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    // Central, not UTC: at 11pm in Tennessee the UTC date has already rolled
    // over, which asked for a business date that had barely started and dropped
    // the day everyone actually wanted to see.
    : todayCentralISO();

  // A pay period is four or five weeks, so two of them is roughly eight weeks of
  // shifts per store — cached, but a cold run is not cheap.
  const periods = Number(p.get("periods") ?? 0);
  // Days are for the overtime chart, where a week is too coarse to show which
  // shift tipped the week over. Capped at three weeks: each day is twelve more
  // cached GetShifts calls, and a line chart past about twenty points stops
  // being readable anyway.
  const days = Number(p.get("days") ?? 0);

  // This week broken into days, Monday through yesterday.
  const wtdDays = p.get("wtdDays") === "1";
  // Append the running week, so completed weeks and "so far" sit on one axis.
  const withWtd = p.get("wtd") === "1";

  const weeks = recentCompleteWeeks(today, Math.min(MAX_WEEKS, Math.max(1, Number(p.get("weeks") ?? 4) || 4)));
  const wtd = weekToDateSpan(today);

  const spans = wtdDays
    ? currentWeekDays(today)
    : periods > 0
      ? recentCompletePeriods(today, Math.min(4, Math.max(1, periods)))
      : days > 0
        ? recentCompleteDays(today, Math.min(MAX_DAYS, Math.max(1, days)))
        : withWtd && wtd
          ? [...weeks, wtd]
          : weeks;

  try {
    return NextResponse.json(await getStoreHours(spans));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/hours] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
