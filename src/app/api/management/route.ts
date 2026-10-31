import { NextResponse, type NextRequest } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { getManagementReport } from "@/lib/management";
import { getSalesTierData } from "@/lib/salesTierData";
import { resolveDateBounds } from "@/lib/tools/dateRange";
import type { RangeKey } from "@/lib/fiscal";

/**
 * GET /api/management?range=<RangeKey> — every leader's counts for the range.
 *
 * The first look at a range reads Slack for every store and any drive-thru
 * days not cached yet, so it can take a minute; finished days are cached by
 * the sources themselves, so repeats are quick.
 */
export const maxDuration = 300;

const RANGES: RangeKey[] = ["yesterday", "wtd", "last_week", "t7", "mtd", "last_period"];

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/management");
  if (denied) return denied;

  const range = (req.nextUrl.searchParams.get("range") ?? "last_week") as RangeKey;
  if (!RANGES.includes(range)) {
    return NextResponse.json({ error: `Unknown range "${range}"` }, { status: 400 });
  }

  try {
    const { start, end, label } = resolveDateBounds(range);
    // The drive-thru tab's own goal tier for this range, so "slower than goal"
    // means the same thing on both tabs.
    const { salesByStoreId } = await getSalesTierData(range);
    const report = await getManagementReport(start, end, salesByStoreId);
    return NextResponse.json({ ...report, label });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[management] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
