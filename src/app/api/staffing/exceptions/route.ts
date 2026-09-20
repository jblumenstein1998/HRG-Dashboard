import { NextRequest, NextResponse } from "next/server";
import { dateRange } from "@/lib/par";
import { getMissedPunches, payPeriodFor, recentPayPeriods } from "@/lib/staffing";
import { todayCentralISO } from "@/lib/parRollup";

/**
 * Shifts nobody clocked out of.
 *
 * GET /api/staffing/exceptions                 yesterday
 * GET /api/staffing/exceptions?payDate=        the fortnight that pay date covers
 * GET /api/staffing/exceptions?from=&to=       a range of business dates
 *
 * Only completed business dates are examined. A shift open on today's date is
 * somebody still working, not a mistake, and flagging it would bury the real
 * ones under the whole estate's current roster every afternoon.
 */

export const maxDuration = 300;

/** A month is plenty for a pay period, and stops a typo costing 300 PAR reads. */
const MAX_DAYS = 35;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ISO = /^\d{4}-\d{2}-\d{2}$/;

  // Central, like the rest of this screen: at 11pm in Tennessee the UTC date
  // has already rolled over, which would ask for a business date that had
  // barely started.
  const today = todayCentralISO();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000)
    .toISOString().slice(0, 10);

  const rawFrom = p.get("from");
  const rawTo = p.get("to");
  const rawPayDate = p.get("payDate");

  let dates: string[];
  let payPeriod = null;

  if (rawPayDate && ISO.test(rawPayDate)) {
    // The period that pay date covers, clipped at yesterday — the run being
    // prepared is usually still open, and asking PAR about tomorrow is an
    // error rather than an empty answer.
    const period = payPeriodFor(rawPayDate);
    payPeriod = period;
    const to = period.end > yesterday ? yesterday : period.end;
    dates = period.start > to ? [] : dateRange(period.start, to).slice(-MAX_DAYS);
  } else if (rawFrom && rawTo && ISO.test(rawFrom) && ISO.test(rawTo)) {
    const to = rawTo > yesterday ? yesterday : rawTo;
    const from = rawFrom > to ? to : rawFrom;
    dates = dateRange(from, to).slice(-MAX_DAYS);
  } else {
    dates = [yesterday];
  }

  try {
    const report = await getMissedPunches(dates);
    // The calendar travels with the report so the selector does not have to
    // rebuild it, and cannot drift from what was actually queried.
    return NextResponse.json({ ...report, payPeriod, payPeriods: recentPayPeriods(today) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/exceptions] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
