import { NextRequest, NextResponse } from "next/server";
import { getStoreHours } from "@/lib/staffing";

/**
 * Regular and overtime hours, per store, per complete week.
 *
 * GET /api/staffing/hours?weeks=4&today=2026-09-04
 *
 * Seven cached GetShifts calls per store per week, so four weeks across twelve
 * stores is 336 calls on a cold cache and nothing on a warm one — past business
 * dates never change.
 */
export const maxDuration = 300;

const MAX_WEEKS = 8;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const weeks = Math.min(MAX_WEEKS, Math.max(1, Number(p.get("weeks") ?? 4) || 4));

  const rawToday = p.get("today");
  const today = rawToday && /^\d{4}-\d{2}-\d{2}$/.test(rawToday)
    ? rawToday
    : new Date().toISOString().slice(0, 10);

  try {
    return NextResponse.json(await getStoreHours(today, weeks));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/hours] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
