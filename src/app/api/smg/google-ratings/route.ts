import { NextRequest, NextResponse } from "next/server";
import { googleRatingsFor } from "@/lib/googleRatings";

/**
 * Google ratings for the SMG tab, read from the daily readings — never calls
 * Google.
 *
 * GET /api/smg/google-ratings?start=2026-09-28&end=2026-10-25
 *
 * start/end are optional; without them only the current readings come back.
 */
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const isDate = (s: string | null) => s === null || /^\d{4}-\d{2}-\d{2}$/.test(s);
  if (!isDate(start) || !isDate(end)) {
    return NextResponse.json({ error: "start and end must be YYYY-MM-DD" }, { status: 400 });
  }

  try {
    return NextResponse.json(await googleRatingsFor(start, end));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SMG] /api/smg/google-ratings failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
