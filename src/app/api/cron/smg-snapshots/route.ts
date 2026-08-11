import { NextRequest, NextResponse } from "next/server";
import { ingestSnapshot, type SnapshotKey } from "@/lib/smgStore";
import { smgLogin } from "@/lib/smgTrend";

export const maxDuration = 300;

// "today" is included so the tab has something to show before anyone presses
// Refresh; on a once-daily schedule it's only current as of this run, and the
// Refresh button (/api/smg/refresh) is what brings it up to the minute.
const KEYS: SnapshotKey[] = ["today", "yesterday", "t7", "wtd", "last_week", "ptd"];

/**
 * Refreshes the rolling / to-date tiles. Every window here ends yesterday, so
 * one daily run captures each of them whole. It still has to re-run daily
 * rather than once per window, because guests keep submitting surveys for
 * visits already past — a response filed today can change last week's numbers,
 * since scores are counted on visit date.
 *
 * Vercel Hobby caps crons at once a day; if the plan changes, running this more
 * often mainly buys faster pickup of those late-arriving responses.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const session = await smgLogin();
  const results: Record<string, unknown>[] = [];

  for (const level of ["store", "regionManager"] as const) {
    for (const key of KEYS) {
      try {
        const r = await ingestSnapshot({ key, level, session, dateBasis: "visit" });
        // null = window has no complete days yet (WTD on a Monday)
        results.push(r ? { level, key, ...r } : { level, key, skipped: "no complete days yet" });
      } catch (err) {
        results.push({ level, key, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 207 : 200 });
}
