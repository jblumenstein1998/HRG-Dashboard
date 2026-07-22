import { NextResponse } from "next/server";
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

export async function GET() {
  const { start, end } = lastCompletedWeek();

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
