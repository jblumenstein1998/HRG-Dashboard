import { NextRequest, NextResponse } from "next/server";
import { getResults, listLocks } from "@/lib/bonus/store";
import { listBonusPeriods, resolveBonusWindow, currentPeriodLabel } from "@/lib/bonus/periods";

/**
 * Reads stored bonus attainment. Serves the Bonus tab.
 *
 * GET /api/bonus/attainment?period=P7%20FY2026[&store=36001]
 *
 * Never recomputes. Building a period costs one Superset query per day of that
 * period the first time round — the cron owns that, so a page load stays a
 * single SELECT and keeps working when a vendor is slow or down.
 */
export async function GET(req: NextRequest) {
  const period = req.nextUrl.searchParams.get("period") ?? currentPeriodLabel();
  const store = req.nextUrl.searchParams.get("store") ?? undefined;

  const window = resolveBonusWindow(period);
  if (!window && period !== currentPeriodLabel()) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }

  try {
    const [results, locks] = await Promise.all([getResults(period, store), listLocks()]);
    return NextResponse.json({
      period,
      store: store ?? null,
      window: window
        ? { start: window.start, end: window.end, isPartial: window.isPartial, label: window.label }
        : null,
      periods: listBonusPeriods(),
      locked: locks.some((l) => l.periodLabel === period),
      locks,
      results,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // An empty/missing table just means the cron hasn't run yet — render the
    // tab rather than an error page.
    if (/relation "bonus_\w+" does not exist/i.test(msg)) {
      return NextResponse.json({
        period,
        store: store ?? null,
        window: null,
        periods: listBonusPeriods(),
        locked: false,
        locks: [],
        results: [],
      });
    }
    console.error("[Bonus] /api/bonus/attainment failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
