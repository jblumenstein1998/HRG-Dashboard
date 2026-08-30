import { NextRequest, NextResponse } from "next/server";
import { fetchToDo } from "@/lib/jolt";

// Deliberately takes no date range. This is "what needs doing right now", which
// the tab shows whatever period is selected elsewhere on the page.
export async function GET(req: NextRequest) {
  const bust = req.nextUrl.searchParams.get("bust") === "1";
  try {
    return NextResponse.json(await fetchToDo({ bust }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[jolt] fetchToDo failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
