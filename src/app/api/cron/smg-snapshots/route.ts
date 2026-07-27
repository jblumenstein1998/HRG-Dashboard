import { NextRequest, NextResponse } from "next/server";
import { ingestSnapshot, type SnapshotKey } from "@/lib/smgStore";
import { smgLogin } from "@/lib/smgTrend";

export const maxDuration = 300;

const KEYS: SnapshotKey[] = ["today", "yesterday", "t7", "wtd", "ptd"];

/**
 * Refreshes the rolling / to-date tiles. Runs several times a day (see
 * vercel.json) rather than daily, because these windows keep moving: Today and
 * WTD change through the day, and every window keeps filling in for days
 * afterwards as guests submit surveys for visits already past.
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
