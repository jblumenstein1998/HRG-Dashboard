import { NextRequest, NextResponse } from "next/server";
import { fetchCategoryMatrix } from "@/lib/netchef";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get("start");
  const end   = searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end query params required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "Dates must be in YYYY-MM-DD format" }, { status: 400 });
  }

  try {
    return NextResponse.json(await fetchCategoryMatrix(start, end));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchCategoryMatrix failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
