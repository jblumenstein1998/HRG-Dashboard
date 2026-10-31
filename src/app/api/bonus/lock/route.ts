import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { listLocks, listUnlockedStores, lockPeriod, unlockPeriod } from "@/lib/bonus/store";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { BONUS_STORE_IDS, storeById } from "@/lib/bonus/storeMap";
import { materializeTeam } from "@/lib/bonus/assignments";

/**
 * Freezing an approved period — the pay lock.
 *
 * POST /api/bonus/lock   { period, note? }
 * POST /api/bonus/lock   { period, unlock: true }
 *
 * SMG keeps revising closed periods for weeks — the sync cron re-pulls a
 * rolling 12-week window because survey responses keep arriving after the visit
 * they describe. Without a lock, the attainment someone was paid on in P6
 * quietly stops matching what the tab shows in P8. Locking snapshots the
 * results as approved and stops the cron recomputing them.
 *
 * Admin-only. This route existed with no guard and nothing on the tab calling
 * it; the Bonus tab's "Approve & lock period" button is its first caller. The
 * approver is the signed-in admin, never a name sent in the body.
 *
 * Refused while any store's scorecard for the period is unlocked for editing
 * (bonus_store_locks): its entries are a draft that the next open would clear,
 * so they are not something to pay on.
 */
export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  let body: { period?: string; note?: string; unlock?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { period, note, unlock } = body;
  if (!period) return NextResponse.json({ error: "period is required" }, { status: 400 });
  if (!resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }

  try {
    if (unlock) {
      await unlockPeriod(period);
      return NextResponse.json({ ok: true, period, locked: false, locks: await listLocks() });
    }

    const unlocked = await listUnlockedStores(period);
    if (unlocked.length > 0) {
      const names = unlocked.map((id) => storeById(id)?.name ?? id).join(", ");
      return NextResponse.json(
        { error: `Lock these scorecards first — they are still unlocked for editing: ${names}.` },
        { status: 409 }
      );
    }

    const viewer = await apiViewer();
    const lockedBy = viewer?.user.email ?? viewer?.user.name ?? null;
    const snapshotted = await lockPeriod(period, lockedBy, note ?? null);
    if (snapshotted === 0) {
      // Locking an unscored period would freeze an empty snapshot as the record
      // of what was approved — refuse rather than record nothing.
      await unlockPeriod(period);
      return NextResponse.json(
        { error: `${period} has no computed results to lock yet` },
        { status: 409 }
      );
    }
    // The names carried into this period from earlier ones become its own
    // rows, so the approved record of who held each job stands alone.
    await materializeTeam(period, BONUS_STORE_IDS);
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
