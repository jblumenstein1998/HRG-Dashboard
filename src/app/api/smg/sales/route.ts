import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { getNetSalesForRange } from "@/lib/parRollup";

/**
 * Net sales by PAR store id over a calendar range, for the Survey Data tab's
 * sales column.
 *
 * GET /api/smg/sales?start=2026-06-29&end=2026-07-25
 *
 * Reads the same `par_daily_metrics` rollup the POS tab uses, so the figures
 * agree with it. SMG labels its stores with PAR store ids, which is what makes
 * the join to survey scores possible without a mapping table.
 */
export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  if (!start || !end) {
    return NextResponse.json({ error: "start and end (YYYY-MM-DD) are required" }, { status: 400 });
  }

  try {
    const entries = await Promise.all(
      PAR_LOCATIONS.map(async (loc) => [loc.storeId, await getNetSalesForRange(loc.storeId, start, end)] as const),
    );

    const salesByStoreId: Record<string, number> = {};
    for (const [storeId, sales] of entries) {
      // Omit zeros rather than showing $0 — a store with no rolled-up days in
      // range has no sales *recorded*, which is not the same as no sales.
      if (sales > 0) salesByStoreId[storeId] = sales;
    }

    return NextResponse.json({ start, end, salesByStoreId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[SMG] /api/smg/sales failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
