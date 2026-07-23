import { NextResponse } from "next/server";
import { getAvgCheckRawComp } from "@/lib/netSalesComp";

export async function GET() {
  const stores = await getAvgCheckRawComp();
  return NextResponse.json({ stores });
}
