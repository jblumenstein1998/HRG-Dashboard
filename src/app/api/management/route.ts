import { NextResponse, type NextRequest } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { getManagementReport, SLACK_HISTORY_DAYS } from "@/lib/management";
import { getTierSalesForDates } from "@/lib/salesTierData";
import { businessDateISO } from "@/lib/businessDay";
import { addDays } from "@/lib/slackReports";

/**
 * GET /api/management?start=YYYY-MM-DD&end=YYYY-MM-DD — every leader's counts.
 *
 * The same date bounds as the Admin tab's Slack reports: back as far as Slack
 * keeps (90 days), up to today. The first look at a range reads Slack for
 * every store and any drive-thru days not cached yet, so it can take a while;
 * finished days are cached by the sources themselves, so repeats are quick.
 */
export const maxDuration = 300;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/management");
  if (denied) return denied;

  const qs = req.nextUrl.searchParams;
  const reqStart = qs.get("start") ?? "";
  const reqEnd = qs.get("end") ?? "";
  if (!ISO.test(reqStart) || !ISO.test(reqEnd)) {
    return NextResponse.json({ error: "start and end are required, as YYYY-MM-DD" }, { status: 400 });
  }
  const today = businessDateISO();
  const oldest = addDays(today, -(SLACK_HISTORY_DAYS - 1));
  const start = reqStart < oldest ? oldest : reqStart;
  const end = reqEnd > today ? today : reqEnd;
  if (start > end) {
    return NextResponse.json({ error: `Nothing to show: the range runs ${oldest} to ${today}` }, { status: 400 });
  }

  try {
    // The drive-thru tab's goal tier for these dates (weekly-equivalent
    // sales), so "slower than the 100% goal" means the same on both tabs.
    const tierSales = await getTierSalesForDates(start, end);
    const report = await getManagementReport(start, end, tierSales);
    return NextResponse.json({ ...report, clampedFrom: start !== reqStart ? reqStart : null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[management] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
