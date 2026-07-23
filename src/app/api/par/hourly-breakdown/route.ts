import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { getHourlyBreakdown } from "@/lib/parRollup";

function todayCentralISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// For auditing against Brink's own hourly sales report in the PAR back-office
// portal — returns the exact per-hour orders/labor our dashboard is using so
// it can be checked line-by-line against PAR's report for the same store/day.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const storeId = searchParams.get("store");
  const date = searchParams.get("date") ?? todayCentralISO();

  const loc = PAR_LOCATIONS.find(l => l.storeId === storeId);
  if (!loc) {
    return NextResponse.json(
      { error: `Unknown store "${storeId}". Valid IDs: ${PAR_LOCATIONS.map(l => l.storeId).join(", ")}` },
      { status: 400 }
    );
  }

  const hours = await getHourlyBreakdown(loc.storeId, date);
  return NextResponse.json({ store: loc.name, storeId: loc.storeId, date, hours });
}
