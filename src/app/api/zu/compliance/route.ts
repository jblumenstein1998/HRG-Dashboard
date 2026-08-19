import { NextRequest, NextResponse } from "next/server";
import { fetchZuReport, fetchZuReportFresh } from "@/lib/schoox";

/**
 * The whole ZU tab in one response: the all-stores totals plus a row per store.
 *
 * One route rather than one per store because the client needs every store to
 * populate the filter anyway, and Schoox is slow enough that thirteen separate
 * round trips from the browser would be visible.
 *
 * Signing in is already enforced by proxy.ts; the tab guard runs on the page.
 */
export async function GET(req: NextRequest) {
  const fresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    const report = fresh ? await fetchZuReportFresh() : await fetchZuReport();
    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ZU] compliance fetch failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
