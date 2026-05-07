import { NextRequest, NextResponse } from "next/server";
import { fetchHistory } from "@/lib/netchef";

export async function GET(req: NextRequest) {
  const start = req.nextUrl.searchParams.get("start") ?? undefined;
  const end   = req.nextUrl.searchParams.get("end")   ?? undefined;
  try {
    const points = await fetchHistory(start, end);
    return NextResponse.json(points);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchHistory failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
