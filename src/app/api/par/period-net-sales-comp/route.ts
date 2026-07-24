import { NextRequest, NextResponse } from "next/server";
import { getPeriodNetSalesComp } from "@/lib/periodNetSalesComp";

export async function GET(req: NextRequest) {
  const periodsParam = req.nextUrl.searchParams.get("periods") ?? "";
  const periodNums = periodsParam
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

  if (periodNums.length === 0) {
    return NextResponse.json({ error: "periods query param required, e.g. ?periods=4,5,6" }, { status: 400 });
  }

  const stores = await getPeriodNetSalesComp(periodNums);
  return NextResponse.json({ stores, periods: periodNums });
}
