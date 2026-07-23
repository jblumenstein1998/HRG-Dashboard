import { NextRequest, NextResponse } from "next/server";
import type { RangeKey } from "@/lib/fiscal";
import { getSalesTierData } from "@/lib/salesTierData";

export async function GET(request: NextRequest) {
  const rangeKey = (request.nextUrl.searchParams.get("range") ?? "mtd") as RangeKey;
  const data = await getSalesTierData(rangeKey);
  return NextResponse.json(data);
}
