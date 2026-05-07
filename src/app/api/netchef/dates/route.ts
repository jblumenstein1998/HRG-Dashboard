import { NextResponse } from "next/server";
import { fetchAvailableDates } from "@/lib/netchef";

export async function GET() {
  try {
    const dates = await fetchAvailableDates();
    return NextResponse.json(dates);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[NC] fetchAvailableDates failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
