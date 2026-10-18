import { NextRequest, NextResponse } from "next/server";
import { syncStoreHours } from "@/lib/storeHours";

/**
 * Refreshes every store's opening hours from its Google listing.
 *
 * Daily (vercel.json), so a change to a listing — holiday hours, a new closing
 * time — is in the dashboard the next morning. Thirteen Places requests a day.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await syncStoreHours();
  const failed = results.filter((r) => !r.ok);
  console.log(`[store-hours] ${results.length - failed.length}/${results.length} stores refreshed`);
  for (const f of failed) console.log(`[store-hours] ${f.storeId} failed: ${f.error}`);
  return NextResponse.json({ ok: failed.length === 0, results });
}
