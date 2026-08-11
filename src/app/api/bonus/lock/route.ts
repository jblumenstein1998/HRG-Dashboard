import { NextRequest, NextResponse } from "next/server";
import { listLocks, lockPeriod, unlockPeriod } from "@/lib/bonus/store";
import { resolveBonusWindow } from "@/lib/bonus/periods";

/**
 * Freezing an approved period.
 *
 * POST /api/bonus/lock   { period, lockedBy?, note? }
 * POST /api/bonus/lock   { period, unlock: true }
 *
 * SMG keeps revising closed periods for weeks — the sync cron re-pulls a
 * rolling 12-week window because survey responses keep arriving after the visit
 * they describe. Without a lock, the attainment someone was paid on in P6
 * quietly stops matching what the tab shows in P8. Locking snapshots the
 * results as approved and stops the cron recomputing them.
 */
export async function POST(req: NextRequest) {
  let body: { period?: string; lockedBy?: string; note?: string; unlock?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { period, lockedBy, note, unlock } = body;
  if (!period) return NextResponse.json({ error: "period is required" }, { status: 400 });
  if (!resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }

  try {
    if (unlock) {
      await unlockPeriod(period);
      return NextResponse.json({ ok: true, period, locked: false, locks: await listLocks() });
    }

    const snapshotted = await lockPeriod(period, lockedBy ?? null, note ?? null);
    if (snapshotted === 0) {
      // Locking an unscored period would freeze an empty snapshot as the record
      // of what was approved — refuse rather than record nothing.
      await unlockPeriod(period);
      return NextResponse.json(
        { error: `${period} has no computed results to lock yet` },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, period, locked: true, snapshotted, locks: await listLocks() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] /api/bonus/lock failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json({ locks: await listLocks() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "bonus_period_locks" does not exist/i.test(msg)) {
      return NextResponse.json({ locks: [] });
    }
    console.error("[Bonus] GET /api/bonus/lock failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
