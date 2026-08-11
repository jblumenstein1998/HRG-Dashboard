import { NextRequest, NextResponse } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { ingestRecentPeriods, ingestSnapshot, type SnapshotKey } from "@/lib/smgStore";
import { smgLogin, type LevelKey } from "@/lib/smgTrend";

// Measured locally: the period cut is ~5s and the five snapshots ~11s, so a
// level costs ~16s. Well under this, but SMG is the slow part and it varies.
export const maxDuration = 300;

/**
 * On-demand SMG pull for the Survey Data tab's Refresh button.
 *
 * The crons own the routine ingest; this is the "I don't want to wait until
 * tomorrow" path. It re-pulls exactly what the tab reads for one level — the
 * period-grain trend plus the rolling/to-date snapshots — rather than the
 * cron's full six cuts, which would spend 27s refreshing weekly data and two
 * levels the tab isn't showing.
 *
 * Deliberately not called on page load, unlike the ZCase refresh: this costs
 * ~16s against SMG, and survey scores move over days, not minutes.
 */

/**
 * Matches the snapshots cron. "today" matters most here — it's the one window
 * that's still filling, so an on-demand pull is the only way to see it current.
 */
const SNAPSHOT_KEYS: SnapshotKey[] = ["today", "yesterday", "t7", "wtd", "last_week", "ptd"];

const LEVELS: LevelKey[] = ["store", "regionManager", "districtManager"];

/** Levels the snapshot cron populates; the tab has no tiles for the others. */
const SNAPSHOT_LEVELS: LevelKey[] = ["store", "regionManager"];

/** Same window the smg-sync cron uses for period grain. */
const PERIODS = 6;

export async function GET(req: NextRequest) {
  // `/api/smg/` is public so the tab can paint before auth resolves (see
  // proxy.ts), but this hits SMG and writes — it stays behind the session.
  const { token } = await getBerryAuth();
  if (!token) {
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  }

  const levelParam = req.nextUrl.searchParams.get("level") ?? "store";
  if (!LEVELS.includes(levelParam as LevelKey)) {
    return NextResponse.json({ error: `unknown level "${levelParam}"` }, { status: 400 });
  }
  const level = levelParam as LevelKey;

  const t0 = Date.now();
  const results: Record<string, unknown>[] = [];

  try {
    // One login shared by every pull below, same as the crons.
    const session = await smgLogin();

    try {
      const r = await ingestRecentPeriods({
        level,
        dateType: "period",
        periods: PERIODS,
        dateBasis: "visit",
        session,
      });
      results.push({ kind: "scores", level, ...r });
    } catch (err) {
      results.push({ kind: "scores", level, error: err instanceof Error ? err.message : String(err) });
    }

    if (SNAPSHOT_LEVELS.includes(level)) {
      for (const key of SNAPSHOT_KEYS) {
        try {
          const r = await ingestSnapshot({ key, level, session, dateBasis: "visit" });
          // null = the window has no complete days yet (WTD on a Monday).
          results.push(r ? { kind: "snapshot", key, ...r } : { kind: "snapshot", key, skipped: true });
        } catch (err) {
          results.push({ kind: "snapshot", key, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  } catch (err) {
    // A failed login means nothing below could run; the tab keeps its stored data.
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[SMG] refresh failed at login: ${message}`);
    return NextResponse.json({ ok: false, error: message, ms: Date.now() - t0 }, { status: 502 });
  }

  const failed = results.filter((r) => r.error);
  return NextResponse.json(
    { ok: failed.length === 0, level, ms: Date.now() - t0, results },
    { status: failed.length ? 207 : 200 },
  );
}
