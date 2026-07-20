import { NextResponse } from "next/server";
import { PAR_LOCATIONS, getWeeklyNetSales } from "@/lib/par";

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
    PAR_LOCATIONS.map(async loc => ({
      storeId: loc.storeId,
      name: loc.name,
      netSales: await getWeeklyNetSales(loc.storeId, start, end),
    }))
  );

  const salesByStoreId: Record<string, number> = {};
  const salesByLocationName: Record<string, number> = {};
  for (const r of results) {
    salesByStoreId[r.storeId] = r.netSales;
    salesByLocationName[r.name] = r.netSales;
  }

  return NextResponse.json({ weekStart: start, weekEnd: end, salesByStoreId, salesByLocationName });
}
