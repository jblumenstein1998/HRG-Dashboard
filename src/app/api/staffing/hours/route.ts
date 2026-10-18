import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdminApi } from "@/lib/users/adminGuard";
import { getOvertimeReport, overtimeColumns, type HoursGrain } from "@/lib/staffing";
import { PAR_PRIORITY, withParPriority } from "@/lib/par";
import { todayCentralISO } from "@/lib/parRollup";

/**
 * Regular and overtime hours, per store, for the overtime table and chart.
 *
 * GET /api/staffing/hours?grain=week        last 4 weeks, then WTD
 * GET /api/staffing/hours?grain=payPeriod   last 4 pay fortnights, then PPTD
 * GET /api/staffing/hours?grain=period      last 4 fiscal periods, then PTD
 * GET /api/staffing/hours?grain=quarter     last 4 fiscal quarters, then QTD
 *
 * Five columns whichever grain, added up in Postgres (getOvertimeReport), so a
 * quarter costs about what a week does.
 */
export const maxDuration = 300;

const GRAINS: HoursGrain[] = ["week", "payPeriod", "period", "quarter"];

export async function GET(req: NextRequest) {
  // Admin-only, matching the page. These answer with every employee's name,
  // hours and pay rate, so gating the screen while leaving the data open
  // would be a lock on a door beside an open window.
  const denied = await requireSuperAdminApi();
  if (denied) return denied;

  const p = req.nextUrl.searchParams;
  const rawGrain = p.get("grain") ?? "week";
  const grain = GRAINS.find((g) => g === rawGrain);
  if (!grain) {
    return NextResponse.json({ error: `grain must be one of ${GRAINS.join(", ")}` }, { status: 400 });
  }
  const rawToday = p.get("today");
  const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    // Central, not UTC: at 11pm in Tennessee the UTC date has already rolled
    // over, which asked for a business date that had barely started and dropped
    // the day everyone actually wanted to see.
    : todayCentralISO();

  const columns = overtimeColumns(grain, today);

  try {
    // Logged because Vercel's request logs carry no duration.
    const started = Date.now();
    const report = await withParPriority(PAR_PRIORITY.hours, () => getOvertimeReport(columns));
    console.log(
      `[staffing/hours] ${grain} ${columns[0]?.start}..${columns.at(-1)?.end} in ${Date.now() - started}ms`,
    );
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/hours] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
