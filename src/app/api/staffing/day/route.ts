import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { requireSuperAdminApi } from "@/lib/users/adminGuard";
import { getStaffingDays } from "@/lib/staffing";
import { expireEditWindow } from "@/lib/parShiftStore";

/**
 * Every store's whole day, for the On the clock slider.
 *
 * GET /api/staffing/day?date=YYYY-MM-DD                 one local date
 * GET /api/staffing/day?from=YYYY-MM-DD&to=YYYY-MM-DD   each date in between
 * ...&fresh=1                                           after Refresh
 *
 * Answers { days: StaffingDay[] }, oldest first. The page computes each slider
 * position itself from these (lib/staffingRoster), and after "Now" it preloads
 * the last seven days in one call — one batched Postgres read per store — so
 * the slider and date picker are instant across the week. Admin-only, like the
 * rest of the tab: it carries names, hours and pay rates.
 */
export const maxDuration = 300;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 14;

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

export async function GET(req: NextRequest) {
  const denied = await requireSuperAdminApi();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const date = params.get("date");
  const from = params.get("from") ?? date ?? "";
  const to = params.get("to") ?? date ?? "";
  if (!ISO.test(from) || !ISO.test(to) || from > to) {
    return NextResponse.json({ error: "Expected date=YYYY-MM-DD, or from and to" }, { status: 400 });
  }
  const dates = datesBetween(from, to);
  if (dates.length > MAX_DAYS) {
    return NextResponse.json({ error: `At most ${MAX_DAYS} days at once` }, { status: 400 });
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
    const days = await getStaffingDays(dates, { fresh });
    console.log(`[staffing/day] ${from}..${to}${fresh ? " fresh" : ""} in ${Date.now() - started}ms`);
    return NextResponse.json({ days });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing/day] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
