import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { storeById } from "@/lib/bonus/storeMap";
import { businessDateISO } from "@/lib/businessDay";
import { getStoreInventoryCounts } from "@/lib/netchefInventory";

/**
 * One store's inventory counts for a bonus period, day by day — what sits
 * behind the Quality Director's two inventory criteria.
 *
 * GET /api/bonus/inventory?period=P10%20FY2026&store=36001
 *
 * Read live from Net-Chef (one login, one report) rather than from the stored
 * metrics, because the screen exists to show which days were missed, and the
 * scorecard only keeps the two totals.
 */

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period") ?? "";
  const storeId = req.nextUrl.searchParams.get("store") ?? "";
  const window = resolveBonusWindow(period);
  const store = storeById(storeId);
  if (!window) return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  if (!store) return NextResponse.json({ error: `Unknown store "${storeId}"` }, { status: 400 });

  try {
    const counts = await getStoreInventoryCounts(store.netchefLocationId, window.start, window.end, businessDateISO());
    return NextResponse.json({ period, storeId, ...counts });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] GET /api/bonus/inventory failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
