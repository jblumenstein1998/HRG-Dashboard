import { NextResponse } from "next/server";
import { getNetSalesComp } from "@/lib/netSalesComp";

export async function GET() {
  const stores = await getNetSalesComp();
  return NextResponse.json({ stores });
}
