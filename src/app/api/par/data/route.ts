import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { getDailyRowsForRange, type PARDailyRow } from "@/lib/parRollup";

export type { PARDailyRow };

export type PARLocationResult = {
  storeId:   string;
  name:      string;
  state:     "TN" | "VA";
  startDate: string;
  endDate:   string;
  daily:     PARDailyRow[];
};

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const storeId = searchParams.get("storeId");
  const start   = searchParams.get("start");
  const end     = searchParams.get("end");

  if (!storeId || !start || !end) {
    return NextResponse.json({ error: "storeId, start, end required" }, { status: 400 });
  }

  const loc = PAR_LOCATIONS.find(l => l.storeId === storeId);
  if (!loc) return NextResponse.json({ error: "Unknown storeId" }, { status: 404 });

  const daily = await getDailyRowsForRange(storeId, start, end);

  const result: PARLocationResult = {
    storeId:   loc.storeId,
    name:      loc.name,
    state:     loc.state,
    startDate: start,
    endDate:   end,
    daily,
  };

  return NextResponse.json(result);
}
