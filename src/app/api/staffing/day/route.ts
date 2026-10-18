import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireSuperAdminApi } from "@/lib/users/adminGuard";
import { getStaffingDay } from "@/lib/staffing";
import { expireEditWindow } from "@/lib/parShiftStore";

/**
 * Every store's whole day, for the On the clock slider.
 *
 * GET /api/staffing/day?date=YYYY-MM-DD           that local date, every store
 * GET /api/staffing/day?date=YYYY-MM-DD&fresh=1   the same, after Refresh
 *
 * The page answers each slider position itself from this (lib/staffingRoster),
 * so moving through a day costs one request rather than one per quarter-hour.
 * Admin-only, like the rest of the tab: it carries names, hours and pay rates.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireSuperAdminApi();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const date = params.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: `Could not read "${date}" as a date (expected YYYY-MM-DD)` }, { status: 400 });
  }

  // Refresh, as on /api/staffing: re-read the staff lists, and flag the last
  // 14 days so the next read of each re-reads PAR.
  const fresh = params.get("fresh") === "1";
  if (fresh) {
    revalidateTag("par-employees", { expire: 0 });
    await expireEditWindow().catch((err) => console.error("[staffing/day] expireEditWindow failed:", err));
  }

  try {
    const started = Date.now();
    const day = await getStaffingDay(date, { fresh });
    console.log(`[staffing/day] ${date}${fresh ? " fresh" : ""} in ${Date.now() - started}ms`);
    return NextResponse.json(day);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/day] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
