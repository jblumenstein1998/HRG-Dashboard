import { NextRequest, NextResponse } from "next/server";
import { loginBerryService } from "@/lib/berryAuth";
import { computePeriod, type ComputeReport } from "@/lib/bonus/compute";
import { currentPeriodLabel, listBonusPeriods } from "@/lib/bonus/periods";

/**
 * Nightly bonus attainment rollup (see vercel.json).
 *
 * Recomputes the period in progress plus the one before it. Not the whole
 * fiscal year: closed periods only move when someone edits a manual input, and
 * that path rescores on save. The previous period is included because it stays
 * genuinely unsettled for a few weeks — SMG survey responses keep arriving
 * after the visit they describe, and the Net-Chef window for a period isn't
 * final the moment the period ends.
 *
 * `?periods=P5 FY2026,P6 FY2026` recomputes an explicit list, for backfilling
 * history. `?all=1` does every period of the fiscal year — expensive the first
 * time (one Superset query per day per period) so it's opt-in.
 *
 * Locked periods are skipped: they're what people were actually paid on.
 */
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const p = req.nextUrl.searchParams;
  const explicit = p.get("periods")?.split(",").map((s) => s.trim()).filter(Boolean);
  const all = p.get("all") === "1";
  const refreshCosts = p.get("refreshCosts") === "1";

  const targets = explicit?.length
    ? explicit
    : all
      ? listBonusPeriods().map((x) => x.label)
      : currentAndPrevious();

  // A Superset session is worth having but not worth failing over: without it
  // the drive-thru criteria come back pending and everything else still scores.
  const token = await loginBerryService().catch((err) => {
    console.error("[Bonus] BerryAI login failed, drive-thru criteria will be pending:", err);
    return null;
  });

  const reports: (ComputeReport & { error?: string })[] = [];
  for (const period of targets) {
    try {
      reports.push(await computePeriod(period, token, { refreshCosts }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Bonus] computePeriod(${period}) failed:`, msg);
      reports.push({
        periodLabel: period, windowStart: "", windowEnd: "", isPartial: false,
        stores: 0, positions: 0, warnings: [], error: msg,
      });
    }
  }

  const failed = reports.filter((r) => r.error);
  return NextResponse.json(
    { ok: failed.length === 0, berry: token ? "ok" : "unavailable", reports },
    { status: failed.length ? 207 : 200 }
  );
}

/** The period in progress and the one before it, skipping P0 at the year start. */
function currentAndPrevious(): string[] {
  const current = currentPeriodLabel();
  const all = listBonusPeriods().map((x) => x.label);
  const index = all.indexOf(current);
  return index >= 0 ? all.slice(index, index + 2) : [current];
}
