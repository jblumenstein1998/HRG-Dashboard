import { NextRequest, NextResponse } from "next/server";
import { querySnapshots, SNAPSHOT_LABELS, type DateBasis, type SnapshotKey } from "@/lib/smgStore";
import type { LevelKey } from "@/lib/smgTrend";

/**
 * Rolling / to-date tiles for the Survey Data tab.
 * GET /api/smg/snapshots?level=store&dateBasis=visit
 *
 * Reads stored snapshots only — the cron owns fetching, since each window costs
 * a multi-second round trip to SMG.
 */
// "today" is deliberately absent. Every other window ends yesterday, so a
// once-daily cron captures them whole; today's is still filling when the cron
// runs and then sits frozen for the rest of the day, reading near-empty. It
// stays in SnapshotKey so it can be restored by adding it back here (and to
// the cron's KEYS) if the snapshot job ever runs more than once a day.
const ORDER: SnapshotKey[] = ["yesterday", "t7", "wtd", "ptd"];

export async function GET(req: NextRequest) {
  const level = (req.nextUrl.searchParams.get("level") ?? "store") as LevelKey;
  const dateBasis = (req.nextUrl.searchParams.get("dateBasis") ?? "visit") as DateBasis;

  try {
    const rows = await querySnapshots(level, dateBasis);

    const present = ORDER.filter((k) => rows.some((r) => r.rangeKey === k));
    const ranges = present.map((key) => {
      const sample = rows.find((r) => r.rangeKey === key)!;
      return {
        key,
        label: SNAPSHOT_LABELS[key],
        windowStart: sample.windowStart,
        windowEnd: sample.windowEnd,
        asOf: sample.asOf,
      };
    });

    const units = [...new Map(rows.map((r) => [r.unitKey, { key: r.unitKey, name: r.unitName }])).values()];
    const metrics = [...new Set(rows.map((r) => r.metric))].sort();

    return NextResponse.json({ level, dateBasis, ranges, units, metrics, rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "smg_snapshots" does not exist/i.test(msg)) {
      return NextResponse.json({ level, dateBasis, ranges: [], units: [], metrics: [], rows: [] });
    }
    console.error("[SMG] /api/smg/snapshots failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
