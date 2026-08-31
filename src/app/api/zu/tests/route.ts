import { NextResponse } from "next/server";
import { fetchZuTestReport } from "@/lib/schoox";

/**
 * The certification grid: every store against every test, people included.
 *
 * Served whole rather than per store because the people come back in the same
 * upstream responses as the rates — splitting the drill-down into its own route
 * would mean making all sixty calls a second time. The payload is a few
 * hundred rows.
 *
 * Signing in is already enforced by proxy.ts; the tab guard runs on the page.
 */
export async function GET() {
  try {
    return NextResponse.json(await fetchZuTestReport());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ZU] test grid fetch failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
