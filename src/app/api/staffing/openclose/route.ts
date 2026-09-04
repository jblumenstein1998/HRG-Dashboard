import { NextRequest, NextResponse } from "next/server";
import { getOpenCloseReport } from "@/lib/staffing";
import { todayCentralISO } from "@/lib/parRollup";

/**
 * Labor before open and after close, per store, for the trailing days.
 *
 * GET /api/staffing/openclose?days=5
 *
 * Today is included: the morning has already happened by the time anyone looks
 * at this, and holding it back a day would make the screen useless for the one
 * thing it is for.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const days = Math.min(14, Math.max(1, Number(p.get("days") ?? 5) || 5));
  const rawToday = p.get("today");
  const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    // Central, not UTC: at 11pm in Tennessee the UTC date has already rolled
    // over, which asked for a business date that had barely started and dropped
    // the day everyone actually wanted to see.
    : todayCentralISO();

  try {
    return NextResponse.json(await getOpenCloseReport(today, days));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/openclose] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
