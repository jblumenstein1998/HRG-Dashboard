import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { getNetSalesForRange, getLaborHoursForRange } from "@/lib/parRollup";

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Most recent completed Mon–Sun week, matching the convention used across the PAR tab.
function lastCompletedWeek(): { start: string; end: string } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - end.getDay());
  const start = new Date(end);
  start.setDate(end.getDate() - 6);
  return { start: toISO(start), end: toISO(end) };
}

/**
 * Net sales per location for a date range.
 *
 * The range is optional and defaults to the last completed week, which is what
 * every caller wanted until the food-cost COGS-by-sales table started following
 * the page date selectors and needed sales for the same window as its costs.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const qStart = searchParams.get("start");
  const qEnd = searchParams.get("end");
  const isISO = (v: string | null): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

  if ((qStart && !isISO(qStart)) || (qEnd && !isISO(qEnd))) {
    return NextResponse.json({ error: "Dates must be in YYYY-MM-DD format" }, { status: 400 });
  }

  const fallback = lastCompletedWeek();
  const start = isISO(qStart) && isISO(qEnd) ? qStart : fallback.start;
  const end = isISO(qStart) && isISO(qEnd) ? qEnd : fallback.end;

  const results = await Promise.all(
    PAR_LOCATIONS.map(async loc => {
      const [netSales, laborHours] = await Promise.all([
        getNetSalesForRange(loc.storeId, start, end),
        getLaborHoursForRange(loc.storeId, start, end),
      ]);
      return {
        storeId: loc.storeId,
        name: loc.name,
        netSales,
        productivity: laborHours > 0 ? Math.round((netSales / laborHours) * 100) / 100 : null,
      };
    })
  );

  const salesByStoreId: Record<string, number> = {};
  const salesByLocationName: Record<string, number> = {};
  const productivityByStoreId: Record<string, number | null> = {};
  for (const r of results) {
    salesByStoreId[r.storeId] = r.netSales;
    salesByLocationName[r.name] = r.netSales;
    productivityByStoreId[r.storeId] = r.productivity;
  }

  return NextResponse.json({ weekStart: start, weekEnd: end, salesByStoreId, salesByLocationName, productivityByStoreId });
}
