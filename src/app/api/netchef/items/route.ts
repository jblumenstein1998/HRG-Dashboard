import { NextRequest, NextResponse } from "next/server";
import { fetchLocationItems } from "@/lib/netchef";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const locationId = searchParams.get("locationId");
  const start      = searchParams.get("start");
  const end        = searchParams.get("end");
  const mode       = searchParams.get("mode") === "actual" ? "actual" : "variance";
  const limit      = Math.min(Number(searchParams.get("limit") ?? 5), 200);

  if (!locationId || !start || !end) {
    return NextResponse.json({ error: "locationId, start, and end required" }, { status: 400 });
  }

  try {
    const items = await fetchLocationItems(Number(locationId), start, end, mode, limit);
    return NextResponse.json(items);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchLocationItems failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
