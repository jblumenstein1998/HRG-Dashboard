import { NextRequest, NextResponse } from "next/server";
import { fetchZuMembers } from "@/lib/schoox";

/**
 * One store's roster, for the row a viewer just expanded.
 *
 * Fetched on demand rather than bundled into /api/zu/compliance: that would be
 * thirteen more upstream calls and four hundred–odd rows on every page load, to
 * populate lists most viewers never open.
 */
export async function GET(req: NextRequest) {
  const unitId = req.nextUrl.searchParams.get("unitId");
  if (!unitId || !/^\d+$/.test(unitId)) {
    return NextResponse.json({ error: "unitId query param required" }, { status: 400 });
  }

  try {
    return NextResponse.json({ members: await fetchZuMembers(unitId) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ZU] members fetch failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
