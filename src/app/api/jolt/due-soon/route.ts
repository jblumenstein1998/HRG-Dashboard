import { NextRequest, NextResponse } from "next/server";
import { fetchDueSoon } from "@/lib/jolt";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const hours = Math.min(Math.max(Number(searchParams.get("hours") ?? 24), 1), 168);
  try {
    return NextResponse.json(await fetchDueSoon(hours, { bust: searchParams.get("bust") === "1" }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jolt] fetchDueSoon failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
