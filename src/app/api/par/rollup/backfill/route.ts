import { NextRequest, NextResponse } from "next/server";
import { backfillRange } from "@/lib/parRollup";

// Manual trigger for backfilling the PAR rollup table over a date range.
// POST /api/par/rollup/backfill { "start": "2026-07-15", "end": "2026-07-21" }
export async function POST(req: NextRequest) {
  const { start, end } = await req.json();
  if (!start || !end) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const done = await backfillRange(start, end);
  return NextResponse.json({ ok: true, rowsWritten: done.length, start, end });
}
