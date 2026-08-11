import { NextRequest, NextResponse } from "next/server";
import { lastScoreSyncAt, listStoredMetrics, queryScores, type DateBasis } from "@/lib/smgStore";
import type { DateTypeKey, LevelKey } from "@/lib/smgTrend";

/**
 * Reads stored SMG scores. Serves the Survey Data tab.
 *
 * GET /api/smg/scores?level=store&periodType=weekly&dateBasis=visit&limit=12
 *                    &units=36001,57004&metrics=Overall%20Satisfaction
 *
 * Rows come back long (unit × period × metric); the client pivots. Nothing here
 * touches SMG — the daily cron owns ingestion, so this stays fast and keeps
 * working when SMG is slow or down.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;

  const csv = (key: string) =>
    p.get(key)?.split(",").map((s) => s.trim()).filter(Boolean) ?? undefined;

  const level = (p.get("level") ?? "store") as LevelKey;
  const periodType = (p.get("periodType") ?? "weekly") as DateTypeKey;
  const dateBasis = (p.get("dateBasis") ?? "visit") as DateBasis;
  const limit = Math.max(1, Math.min(Number(p.get("limit") ?? 12) || 12, 260));

  try {
    const [rows, metrics, syncedAt] = await Promise.all([
      queryScores({ level, periodType, dateBasis, units: csv("units"), metrics: csv("metrics"), limit }),
      listStoredMetrics(level, periodType),
      lastScoreSyncAt(level, periodType, dateBasis),
    ]);

    // Period ordering is defined by the data, not by the client re-deriving it.
    const seen = new Set<string>();
    const periods: string[] = [];
    for (const r of rows) {
      if (!seen.has(r.periodLabel)) {
        seen.add(r.periodLabel);
        periods.push(r.periodLabel);
      }
    }

    const units = [...new Map(rows.map((r) => [r.unitKey, { key: r.unitKey, name: r.unitName }])).values()];

    return NextResponse.json({
      level,
      periodType,
      dateBasis,
      periods,
      units,
      availableMetrics: metrics,
      syncedAt,
      rows,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // An empty/missing table just means the cron hasn't run yet.
    if (/relation "smg_scores" does not exist/i.test(msg)) {
      return NextResponse.json({
        level, periodType, dateBasis,
        periods: [], units: [], availableMetrics: [], syncedAt: null, rows: [],
      });
    }
    console.error("[SMG] /api/smg/scores failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
