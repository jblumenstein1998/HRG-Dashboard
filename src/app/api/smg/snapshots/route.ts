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
/**
 * "today" used to be excluded here: every other window ends yesterday, so the
 * once-daily cron captures them whole, while today's was still filling when the
 * cron ran and then sat frozen for the rest of the day.
 *
 * It's back because Refresh now re-pulls from SMG on demand, so today's window
 * can be brought current whenever it's asked for. Two caveats stand, and the
 * tab's own footnote already explains the first: scores count on **visit date**
 * and guests answer days after visiting, so today's survey numbers are thin by
 * nature — and between refreshes they're only as fresh as the last pull. The
 * ZCases section is the one that genuinely moves intraday.
 */
const ORDER: SnapshotKey[] = ["today", "yesterday", "t7", "wtd", "last_week", "ptd"];

export async function GET(req: NextRequest) {
  const level = (req.nextUrl.searchParams.get("level") ?? "store") as LevelKey;
  const dateBasis = (req.nextUrl.searchParams.get("dateBasis") ?? "visit") as DateBasis;

  try {
    const rows = await querySnapshots(level, dateBasis);

    const present = ORDER.filter((k) => rows.some((r) => r.rangeKey === k));
    const ranges = present.map((key) => {
      // The dates on this row are what the picker labels the window with, so
      // take the most recently written row rather than whichever one the query
      // happens to return first — that way a straggler left over from an older
      // run can't caption the window with a stale date range.
      const sample = rows
        .filter((r) => r.rangeKey === key)
        .reduce((newest, r) => (new Date(r.asOf) > new Date(newest.asOf) ? r : newest));
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
