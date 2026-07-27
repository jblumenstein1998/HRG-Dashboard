import { NextRequest, NextResponse } from "next/server";
import { ingestRecentPeriods } from "@/lib/smgStore";
import { smgLogin } from "@/lib/smgTrend";

// SMG pulls are slow (four sequential requests per report, several reports).
export const maxDuration = 300;

/**
 * Vercel Cron hits this daily (see vercel.json).
 *
 * Re-pulls a rolling window rather than only the newest period: survey
 * responses keep arriving for weeks after the visit they describe, so an
 * already-ingested week's scores and response counts keep moving. Twelve weeks
 * is comfortably past the point where they settle.
 *
 * Everything is stored on a visit-date basis — the date the guest actually came
 * in, not the date they filled the survey out.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // One login reused across every cut below.
  const session = await smgLogin();

  // Period grain drives the Survey Data tab's period picker, so every level
  // needs it; weekly is kept for trend/backfill use.
  const cuts = [
    { level: "store" as const, dateType: "period" as const, periods: 6 },
    { level: "regionManager" as const, dateType: "period" as const, periods: 6 },
    { level: "districtManager" as const, dateType: "period" as const, periods: 6 },
    { level: "store" as const, dateType: "weekly" as const, periods: 12 },
    { level: "regionManager" as const, dateType: "weekly" as const, periods: 12 },
    { level: "districtManager" as const, dateType: "weekly" as const, periods: 12 },
  ];

  const results: Record<string, unknown>[] = [];
  for (const cut of cuts) {
    try {
      const r = await ingestRecentPeriods({ ...cut, session, dateBasis: "visit" });
      results.push({ ...cut, ...r });
    } catch (err) {
      results.push({ ...cut, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json({ ok: failed.length === 0, results }, { status: failed.length ? 207 : 200 });
}
