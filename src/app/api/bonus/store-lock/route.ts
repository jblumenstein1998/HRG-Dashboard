import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { rescoreFromStored } from "@/lib/bonus/compute";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { clearInputs, isLocked, isStoreLocked, setStoreLocked } from "@/lib/bonus/store";
import { storeById } from "@/lib/bonus/storeMap";

/**
 * The edit lock on one store's bonus scorecard for one period.
 *
 * POST /api/bonus/store-lock  { period, storeId, action: "open" | "lock" | "unlock" }
 *
 *   open    what the tab calls when it loads a scorecard. Rescores from the
 *           latest nightly metrics, so computed values and rules are current.
 *           If the scorecard is unlocked, every manual entry for it is cleared
 *           first — Josh's rule (2026-10-28): opening an unlocked scorecard
 *           starts again from computed values. Locking is what keeps entries.
 *   unlock  allow entries to be typed.
 *   lock    keep them. The tab saves the entries (/api/bonus/inputs) first.
 *
 * A period under the pay lock (/api/bonus/lock) is frozen as approved: open
 * neither clears nor rescores it, and it cannot be unlocked.
 */

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as { period?: string; storeId?: string; action?: string };
  const { period, storeId, action } = body;
  if (!period || !resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }
  if (!storeId || !storeById(storeId)) {
    return NextResponse.json({ error: `Unknown store "${storeId}"` }, { status: 400 });
  }
  if (action !== "open" && action !== "lock" && action !== "unlock") {
    return NextResponse.json({ error: "action must be open, lock or unlock" }, { status: 400 });
  }

  try {
    if (await isLocked(period)) {
      if (action === "unlock") {
        return NextResponse.json({ error: `${period} is approved and locked for pay.` }, { status: 409 });
      }
      return NextResponse.json({ locked: true, payLocked: true, cleared: 0 });
    }

    if (action === "lock" || action === "unlock") {
      const viewer = await apiViewer();
      await setStoreLocked(period, storeId, action === "lock", viewer?.user.email ?? viewer?.user.name ?? null);
      return NextResponse.json({ locked: action === "lock", payLocked: false, cleared: 0 });
    }

    const locked = await isStoreLocked(period, storeId);
    const cleared = locked ? 0 : await clearInputs(period, storeId);
    await rescoreFromStored(period, storeId);
    return NextResponse.json({ locked, payLocked: false, cleared });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/store-lock failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
