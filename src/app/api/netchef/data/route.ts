import { NextRequest, NextResponse } from "next/server";
import { fetchNcReport, fetchLocationReport, LOCATION_NAMES, type LocationData, invalidateNcCache } from "@/lib/netchef";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  if (searchParams.get("bust") === "1") invalidateNcCache();

  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "Dates must be in YYYY-MM-DD format" }, { status: 400 });
  }

  const locationId = searchParams.get("locationId");
  if (locationId) {
    const id = Number(locationId);
    const name = LOCATION_NAMES[id];
    if (!name) return NextResponse.json({ error: "Unknown locationId" }, { status: 400 });
    try {
      const { actualCostPct, actualCostDollars, variancePct, varianceDollars } = await fetchLocationReport(id, start, end);
      const loc: LocationData = { locationId: id, locationName: name, actualCostPct, actualCostDollars, variancePct, varianceDollars };
      return NextResponse.json(loc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[NC] fetchLocationReport failed:", msg);
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  try {
    const report = await fetchNcReport(start, end);
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchNcReport failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
