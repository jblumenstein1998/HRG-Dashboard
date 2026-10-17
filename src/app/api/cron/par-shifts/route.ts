import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { businessDateISO } from "@/lib/businessDay";
import { sql } from "@/lib/db";
import { EARLIEST_FISCAL_YEAR_START } from "@/lib/fiscal";
import { REROLL_WINDOW_DAYS } from "@/lib/parRollup";
import { SHIFT_HISTORY_TAG, missingShiftDays, syncShiftDays } from "@/lib/parShiftStore";
import { shiftDate } from "@/lib/workstreamAuditFormat";

/**
 * Keeps the stored PAR shift history current, and fills it in.
 *
 * Nightly (vercel.json), two jobs in one run:
 *
 *   1. Re-read the trailing 14 days for every store. Timecards keep being
 *      edited and deleted for about that long after a day closes — par-rollup
 *      measured it — and a stored day is replaced whole, so deletions land.
 *   2. With whatever time is left, fill in store-days not yet held, newest
 *      first, back to the start of the dashboard's history (FY2025). The
 *      backfill is ~8,700 store-days; this chips at it until it is done and
 *      then costs nothing.
 *
 * GET ?backfillOnly=1&budget=<seconds> skips step 1 and runs the backfill for
 * longer — for walking the whole history by hand rather than over a week of
 * nights. Same CRON_SECRET either way.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const params = req.nextUrl.searchParams;
  const backfillOnly = params.get("backfillOnly") === "1";
  // Default leaves a minute of the 300s for the last batch and the response.
  const budgetSeconds = Math.min(Number(params.get("budget")) || 240, 3600);
  const deadline = Date.now() + budgetSeconds * 1000;

  // Yesterday is the last closed business date; today is still being worked.
  const end = shiftDate(businessDateISO(), -1);
  const windowStart = shiftDate(end, -(REROLL_WINDOW_DAYS - 1));

  let window = { ok: 0, failed: 0 };
  if (!backfillOnly) {
    const days = (await missingShiftDays(windowStart, end))
      .concat(await heldDays(windowStart, end));
    const { results } = await syncShiftDays(days, Number.POSITIVE_INFINITY);
    window = { ok: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
  }

  const backlog = await missingShiftDays(EARLIEST_FISCAL_YEAR_START, shiftDate(windowStart, -1));
  const { results, remaining } = await syncShiftDays(backlog, deadline);
  const failed = results.filter((r) => !r.ok);

  revalidateTag(SHIFT_HISTORY_TAG, { expire: 0 });

  const summary = {
    ok: true,
    window: backfillOnly ? null : { start: windowStart, end, ...window },
    backfill: {
      synced: results.length - failed.length,
      failed: failed.length,
      remaining: remaining + failed.length,
      oldestReached: results.at(-1)?.businessDate ?? null,
      shifts: results.reduce((n, r) => n + r.shifts, 0),
    },
    errors: failed.slice(0, 10).map((r) => `${r.storeId} ${r.businessDate}: ${r.error}`),
  };
  console.log(`[par-shifts] ${JSON.stringify({ window: summary.window, backfill: summary.backfill })}`);
  for (const e of summary.errors) console.log(`[par-shifts] error ${e}`);
  return NextResponse.json(summary);
}

/**
 * The window's store-days we already hold — re-read anyway, because the point
 * of the window is to pick up edits made since they were stored.
 */
async function heldDays(start: string, end: string) {
  const rows = await sql`
    SELECT store_id, business_date::text AS d FROM par_shift_days
    WHERE status = 'ok' AND business_date BETWEEN ${start} AND ${end}
    ORDER BY business_date DESC
  `;
  return rows.map((r) => ({ storeId: r.store_id as string, businessDate: r.d as string }));
}
