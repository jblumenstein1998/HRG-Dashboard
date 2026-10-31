import { NextRequest, NextResponse } from "next/server";
import { businessDateISO } from "@/lib/businessDay";
import { addDays } from "@/lib/slackReports";
import { runNightlyChecks } from "@/lib/slackAccuracy";
import { KEEP_DAYS, pruneSourceCache } from "@/lib/sourceCache";

/**
 * Nightly: check the last two days' Slack reports, which reads every figure
 * they need from its source and stores it (lib/sourceCache.ts, the rollup, the
 * drive-thru cache), so the admin table can recompute accuracy for any range
 * from the database without pulling PAR orders on page load.
 *
 * Runs at 12:15 UTC (7:15 AM Central), just after par-rollup writes the day's
 * PAR totals at 12:00 — earlier and getTotalsForRange would rebuild each store's
 * day from PAR live, doing the rollup's work twice.
 *
 * Two days, not one, so a report posted a day late is still checked. Anything
 * stored more than KEEP_DAYS ago is pruned.
 *
 * ?date=YYYY-MM-DD checks that one day instead — for backfilling, a day per
 * call to stay well inside the time limit.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = businessDateISO();
  const date = req.nextUrl.searchParams.get("date");
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }
  const start = date ?? addDays(today, -2);
  const end = date ?? addDays(today, -1);

  const results = await runNightlyChecks(start, end);
  const pruned = await pruneSourceCache(addDays(today, -KEEP_DAYS));

  const failed = results.filter((r) => r.error);
  const checked = results.reduce((n, r) => n + r.checked, 0);
  console.log(`[slack-accuracy] ${start}..${end}: ${checked} reports checked, ${failed.length} stores failed, ${pruned} pruned`);
  for (const f of failed) console.log(`[slack-accuracy] ${f.store}: ${f.error}`);
  return NextResponse.json({ ok: failed.length === 0, start, end, checked, pruned, results });
}
