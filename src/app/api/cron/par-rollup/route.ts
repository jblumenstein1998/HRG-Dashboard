import { NextRequest, NextResponse } from "next/server";
import { PAR_LOCATIONS } from "@/lib/par";
import { rerollRange, REROLL_WINDOW_DAYS } from "@/lib/parRollup";

// 12 stores × 14 days × 2 SOAP calls each, throttled to 5 concurrent by par.ts's
// semaphore. Measured around 100s; 300 leaves room for a slow PAR morning.
export const maxDuration = 300;

// Yesterday's business date in Central time (HRG's operating timezone — see
// the same convention in fiscal.ts's today()), since "today" isn't a closed
// business date yet when this runs.
function yesterdayCentral(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const d = new Date(get("year"), get("month") - 1, get("day") - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBefore(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d - n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Vercel Cron hits this daily (see vercel.json). Re-rolls a trailing window
// rather than yesterday alone: a day written the morning after it closed misses
// every timecard edit and deletion that lands later, which is what put
// productivity out by up to ~3% per store. See rerollRange for the measurements
// behind the window length. Re-running a settled day is an upsert, so this is
// safe to run as often as it fires.
//
// Historical backfill beyond the window is still POST /api/par/rollup/backfill.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ?dryRun=1 reports what the window would correct without writing — for
  // checking a change to this job before letting it near the table.
  const dryRun = req.nextUrl.searchParams.get("dryRun") === "1";

  const end = yesterdayCentral();
  const start = daysBefore(end, REROLL_WINDOW_DAYS - 1);
  const summary = await rerollRange(start, end, dryRun);

  // Logged as well as returned: cron responses aren't kept anywhere, and the
  // whole point of re-rolling daily is to watch how much drift it keeps finding.
  console.log(
    `[par-rollup]${summary.dryRun ? " DRY RUN" : ""} ${summary.windowStart}..${summary.windowEnd} ` +
    `storeDays=${summary.storeDays} written=${summary.written} changed=${summary.changed} ` +
    `skippedError=${summary.skippedError} skippedZero=${summary.skippedZero} ` +
    `laborMinutesDelta=${summary.laborMinutesDelta} netSalesDelta=${summary.netSalesDelta.toFixed(2)}`,
  );
  for (const c of summary.changes) {
    console.log(
      `[par-rollup] corrected ${c.storeId} ${c.businessDate} ` +
      `labor ${c.laborMinutesBefore}->${c.laborMinutesAfter} min, ` +
      `sales ${c.netSalesBefore?.toFixed(2)}->${c.netSalesAfter.toFixed(2)}`,
    );
  }

  return NextResponse.json({
    ok: true,
    ...summary,
    stores: PAR_LOCATIONS.length,
    laborHoursDelta: Math.round((summary.laborMinutesDelta / 60) * 100) / 100,
  });
}
