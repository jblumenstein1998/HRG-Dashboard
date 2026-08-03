import { NextRequest, NextResponse } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import {
  ingestSnapshot,
  ingestTrend,
  type DateBasis,
  type SnapshotKey,
} from "@/lib/smgStore";
import { listPeriodsOfType, smgLogin, type LevelKey } from "@/lib/smgTrend";

export const maxDuration = 300;

/**
 * Pulls one window straight from SMG, on demand, for the Fetch button on the
 * Survey Data tab.
 *
 * POST /api/smg/refresh  { "selection": "snap:ptd" | "period:Period 7, 2026" }
 *
 * The daily cron is the normal path; this exists because it can't be enough on
 * its own. Scores are counted on visit date and SMG accepts responses for 14
 * days afterwards, so every window younger than that keeps moving all day —
 * a store gaining two surveys mid-morning shifts its market's pooled total by
 * a point, and until the next cron run the tab disagrees with the portal with
 * no way to catch up. Hobby-plan crons are capped at once a day, so the manual
 * pull is the only way to close that gap.
 *
 * Both levels are refreshed together. The market rows are read from SMG's
 * region-manager rows but only when their response counts match the store rows
 * exactly (see `publishedMarketCells`), so refreshing one level and not the
 * other would break that match and silently drop the tab back to pooling.
 */

/** Levels the tab reads. Kept in step with the two cron jobs. */
const LEVELS: LevelKey[] = ["store", "regionManager"];

const SNAPSHOT_KEYS = new Set<string>(["today", "yesterday", "last_week", "t7", "wtd", "ptd"]);

/**
 * One pull at a time, process-wide.
 *
 * A pull is several multi-second round trips to SMG under a single login, and
 * the button is the kind of thing that gets clicked twice. Concurrent runs
 * would race on the same rows and double the load on SMG for no benefit, so
 * later callers join the run already in flight instead of starting another.
 */
let inFlight: Promise<RefreshResult> | null = null;

type RefreshResult = { ok: boolean; results: Record<string, unknown>[] };

export async function POST(req: NextRequest) {
  // `/api/smg/` is exempt from the auth proxy so the cron can reach its
  // siblings, which means this route has to check the session itself — without
  // it, an unauthenticated caller could drive SMG traffic and database writes.
  const { token } = await getBerryAuth();
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    selection?: string;
    dateBasis?: DateBasis;
  };
  const selection = body.selection ?? "";
  const dateBasis = body.dateBasis ?? "visit";

  const joined = Boolean(inFlight);
  inFlight ??= run(selection, dateBasis).finally(() => {
    inFlight = null;
  });

  try {
    const result = await inFlight;
    return NextResponse.json({ ...result, joined }, { status: result.ok ? 200 : 207 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SMG] /api/smg/refresh failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function run(selection: string, dateBasis: DateBasis): Promise<RefreshResult> {
  const results: Record<string, unknown>[] = [];

  if (selection.startsWith("snap:")) {
    const key = selection.slice(5);
    if (!SNAPSHOT_KEYS.has(key)) throw new Error(`unknown snapshot window "${key}"`);

    const session = await smgLogin();
    for (const level of LEVELS) {
      try {
        const r = await ingestSnapshot({ key: key as SnapshotKey, level, session, dateBasis });
        results.push(r ? { level, key, ...r } : { level, key, skipped: "no complete days yet" });
      } catch (err) {
        results.push({ level, key, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } else if (selection.startsWith("period:")) {
    const label = selection.slice(7);
    const session = await smgLogin();

    // Period ids aren't derivable from the label — they don't extrapolate
    // across year boundaries — so resolve against SMG's own list.
    const periods = await listPeriodsOfType(session, "period");
    const period = periods.find((p) => p.label === label);
    if (!period) throw new Error(`SMG doesn't list a period called "${label}"`);

    for (const level of LEVELS) {
      try {
        const rows = await ingestTrend({
          level,
          dateType: "period",
          dateBasis,
          session,
          startPeriodId: period.id,
          endPeriodId: period.id,
          periods: 1,
        });
        results.push({ level, period: label, rows });
      } catch (err) {
        results.push({ level, period: label, error: err instanceof Error ? err.message : String(err) });
      }
    }
  } else {
    throw new Error(`unrecognised selection "${selection}"`);
  }

  return { ok: !results.some((r) => r.error), results };
}
