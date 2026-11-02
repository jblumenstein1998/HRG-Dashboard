import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { LOCATION_NAMES } from "@/lib/netchef";
import { businessDateISO } from "@/lib/businessDay";
import { getStoreInventoryCounts } from "@/lib/netchefInventory";

/**
 * Inventory count completion for one store over a date range — the Food Cost
 * tab's completion table.
 *
 * GET /api/netchef/inventory-counts?locationId=771&start=2026-09-28&end=2026-10-25
 *
 * One store per request, like /api/netchef/data, so the table fills in store by
 * store: each store needs its own Net-Chef login (see netchefInventory.ts).
 * Totals only — the day-by-day detail is on the Bonus tab.
 */

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/food-cost");
  if (denied) return denied;

  const { searchParams } = req.nextUrl;
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const id = Number(searchParams.get("locationId"));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "start and end are required (YYYY-MM-DD)" }, { status: 400 });
  }
  const name = LOCATION_NAMES[id];
  if (!name) return NextResponse.json({ error: "Unknown locationId" }, { status: 400 });

  try {
    const c = await getStoreInventoryCounts(id, start, end, businessDateISO());
    return NextResponse.json({
      locationId: id,
      locationName: name,
      criticalDone: c.criticalDone,
      criticalSlots: c.criticalSlots,
      criticalPct: c.criticalPct,
      weeksOnTime: c.weeksOnTime,
      weeksJudged: c.weeksJudged,
      // Late counts are still counts — named here so the table can say which.
      lateWeeks: c.weeks.filter((w) => w.judged && !w.onTime && w.enteredAt).map((w) => w.weekStart),
      missedWeeks: c.weeks.filter((w) => w.judged && !w.enteredAt).map((w) => w.weekStart),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] inventory counts failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
