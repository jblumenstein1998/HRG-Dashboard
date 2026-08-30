import { NextRequest, NextResponse } from "next/server";
import { fetchListCompletion } from "@/lib/jolt";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  if (!start || !end) return NextResponse.json({ error: "start and end required" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json({ error: "Dates must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    return NextResponse.json(await fetchListCompletion(start, end, { bust: searchParams.get("bust") === "1" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jolt] fetchListCompletion failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
