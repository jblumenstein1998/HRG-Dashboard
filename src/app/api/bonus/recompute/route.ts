import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { loginBerryService } from "@/lib/berryAuth";
import { computePeriod } from "@/lib/bonus/compute";
import { resolveBonusWindow } from "@/lib/bonus/periods";

/**
 * Recompute one period's bonus attainment now — the Bonus tab's Refresh button
 * for admins (Josh, 2026-10-29: "refresh it from the dashboard manually").
 *
 * POST /api/bonus/recompute  { period: "P11 FY2026" }
 *
 * What the early-morning bonus-rollup does for a period — rescore all six
 * positions for every store and store the results — except that Jolt, Slack
 * and Net-Chef inventory counts are kept from that run rather than pulled live
 * (reuseSlowSources): they are ~17 of the ~20 seconds a full run takes, and
 * nothing else stores them. A locked period is left as approved. Admin-only,
 * because it rewrites the scores everyone sees.
 */
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const { period } = (await req.json().catch(() => ({}))) as { period?: string };
  if (!period || !resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }

  // As in the cron: drive-thru goes pending without BerryAI, everything else still scores.
  const token = await loginBerryService().catch(() => null);
  const started = Date.now();
  try {
    const report = await computePeriod(period, token, { reuseSlowSources: true });
    return NextResponse.json({
      ok: true,
      skipped: report.skipped ?? null,
      warnings: report.warnings,
      berry: token ? "ok" : "unavailable",
      seconds: Math.round((Date.now() - started) / 1000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Bonus] manual recompute of ${period} failed:`, msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
