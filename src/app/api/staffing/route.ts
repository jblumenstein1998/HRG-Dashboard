import { NextRequest, NextResponse } from "next/server";
import { getStaffingAt } from "@/lib/staffing";

/**
 * Who was on the clock, every store, at one instant.
 *
 * GET /api/staffing            → now
 * GET /api/staffing?at=<ISO>   → that moment
 *
 * Ten PAR calls per store on a cold cache — the roster, the job list, two
 * business dates of shifts and seven more for the trailing total — so twelve
 * stores is a couple of minutes the first time and near-instant after, since
 * every underlying fetcher is cached and a past date never changes.
 *
 * Signing in is enforced by proxy.ts; the tab guard runs on the page.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("at");
  const at = raw ? new Date(raw) : new Date();

  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: `Could not read "${raw}" as a date and time` }, { status: 400 });
  }

  try {
    return NextResponse.json(await getStaffingAt(at));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
