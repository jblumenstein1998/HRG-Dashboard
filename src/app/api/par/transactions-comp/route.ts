import { NextResponse } from "next/server";
import { getTransactionsComp } from "@/lib/netSalesComp";

export async function GET() {
  const stores = await getTransactionsComp();
  return NextResponse.json({ stores });
}
