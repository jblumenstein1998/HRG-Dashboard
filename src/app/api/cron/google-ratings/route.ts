import { NextRequest, NextResponse } from "next/server";
import { syncGoogleRatings } from "@/lib/googleRatings";

/**
 * Records every store's Google rating and review count for the day.
 *
 * Daily (vercel.json) — Google keeps no history, so these rows are what the
 * SMG tab's Google Reviews card measures change against. Thirteen Places
 * requests a day.
 */
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const results = await syncGoogleRatings();
  const failed = results.filter((r) => !r.ok);
  console.log(`[google-ratings] ${results.length - failed.length}/${results.length} stores recorded`);
  for (const f of failed) console.log(`[google-ratings] ${f.storeId} failed: ${f.error}`);
  return NextResponse.json({ ok: failed.length === 0, results });
}
