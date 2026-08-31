import { NextRequest, NextResponse } from "next/server";
import { rerollRange } from "@/lib/parRollup";

export const maxDuration = 300;

// Manual trigger for backfilling the PAR rollup table over a date range.
// POST /api/par/rollup/backfill { "start": "2026-07-15", "end": "2026-07-21" }
// Optional "dryRun": true reports what would change without writing.
//
// Shares rerollRange with the nightly cron rather than keeping a second write
// path: the guards that matter here — read live so a stale cache cannot be
// written back, skip on a PAR error, refuse to blank a day that had real
// numbers — are exactly the ones a bulk rewrite of settled history needs most.
//
// Keep ranges to a couple of weeks per request; 12 stores x 2 API calls per day
// adds up, and the summary makes it easy to walk a long span in chunks.
export async function POST(req: NextRequest) {
  const { start, end, dryRun } = await req.json();
  if (!start || !end) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) are required" }, { status: 400 });
  }

  const summary = await rerollRange(start, end, dryRun === true);
  console.log(
    `[par-backfill]${summary.dryRun ? " DRY RUN" : ""} ${start}..${end} ` +
    `storeDays=${summary.storeDays} written=${summary.written} changed=${summary.changed} ` +
    `skippedError=${summary.skippedError} skippedZero=${summary.skippedZero} ` +
    `laborMinutesDelta=${summary.laborMinutesDelta}`,
  );
  return NextResponse.json({
    ok: true,
    ...summary,
    laborHoursDelta: Math.round((summary.laborMinutesDelta / 60) * 100) / 100,
  });
}
