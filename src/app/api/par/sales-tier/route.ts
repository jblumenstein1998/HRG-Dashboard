import { NextRequest, NextResponse } from "next/server";
import { parseCustomRangeKey, type RangeKey } from "@/lib/fiscal";
import { getSalesTierData } from "@/lib/salesTierData";

export async function GET(request: NextRequest) {
  const rangeKey = (request.nextUrl.searchParams.get("range") ?? "mtd") as RangeKey;
  if (rangeKey.startsWith("custom:") && !parseCustomRangeKey(rangeKey)) {
    return NextResponse.json({ error: `invalid custom range "${rangeKey}"` }, { status: 400 });
  }
  const data = await getSalesTierData(rangeKey);
  return NextResponse.json(data);
}
