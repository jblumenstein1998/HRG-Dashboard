import { NextRequest, NextResponse } from "next/server";
import { getDaypartProductivity } from "@/lib/staffing";
import { todayCentralISO } from "@/lib/parRollup";

/**
 * Sales and transactions per labor hour, by daypart, for one business date.
 *
 * GET /api/staffing/dayparts              today
 * GET /api/staffing/dayparts?date=…       that business date
 *
 * Today is the default and is read live, not from cache: the point of looking
 * at this morning's lunch is to see what has just happened, and an hour-old
 * answer would be the wrong one.
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("date");
  const date = raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : todayCentralISO();

  try {
    return NextResponse.json(await getDaypartProductivity(date));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/dayparts] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
