import { NextRequest, NextResponse } from "next/server";
import { businessDateISO } from "@/lib/businessDay";
import { addDays } from "@/lib/slackReports";
import { runNightlyChecks } from "@/lib/slackAccuracy";
import { KEEP_DAYS, pruneChecks } from "@/lib/slackAccuracyStore";

/**
 * Nightly: check the numbers in the last two days' Slack reports and store the
 * results (lib/slackAccuracyStore.ts), so the admin table can show accuracy for
 * any range without pulling PAR orders on page load.
 *
 * Two days, not one, so a report posted a day late is still checked. Anything
 * older than Slack's 90-day history is pruned.
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
  const pruned = await pruneChecks(addDays(today, -KEEP_DAYS));

  const failed = results.filter((r) => r.error);
  const saved = results.reduce((n, r) => n + r.saved, 0);
  console.log(`[slack-accuracy] ${start}..${end}: ${saved} reports checked, ${failed.length} stores failed, ${pruned} pruned`);
  for (const f of failed) console.log(`[slack-accuracy] ${f.store}: ${f.error}`);
  return NextResponse.json({ ok: failed.length === 0, start, end, saved, pruned, results });
}
