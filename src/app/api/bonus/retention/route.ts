import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { isLocked } from "@/lib/bonus/store";
import { storeById } from "@/lib/bonus/storeMap";
import { refreshRetention } from "@/lib/bonus/compute";
import { getRetention } from "@/lib/workstreamRetention";
import { clearRetentionReview, saveRetentionReview } from "@/lib/retentionReviewStore";

/**
 * Who is in each store's new-hire retention figure, and the review of the
 * people PAR could not confirm.
 *
 * GET  /api/bonus/retention?period=P11%20FY2026&store=36001
 * POST /api/bonus/retention  { period, workstreamUuid, outcome: "worked"|"never_worked"|"clear", storeId?, note? }
 *
 * A POST rescores every open period retention is computed for, because one
 * answer settles a person's 30-, 60- and 90-day anniversaries at once.
 *
 * Gated on the Bonus tab: the list is names and leave dates, which is what the
 * Training Directors are being asked to check.
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period") ?? "";
  const storeId = req.nextUrl.searchParams.get("store") ?? "";
  const window = resolveBonusWindow(period);
  if (!window) return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  if (!storeById(storeId)) return NextResponse.json({ error: `Unknown store "${storeId}"` }, { status: 400 });

  try {
    const report = await getRetention(window.start, window.end);
    return NextResponse.json({
      period,
      start: report.start,
      end: report.end,
      store: report.stores.find((s) => s.storeId === storeId) ?? null,
      unattributed: report.unattributed,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] GET /api/bonus/retention failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const viewer = await apiViewer();
  const decidedBy = viewer?.user.email ?? viewer?.user.name ?? "";

  const body = (await req.json().catch(() => ({}))) as {
    period?: string;
    workstreamUuid?: string;
    outcome?: string;
    storeId?: string | null;
    note?: string;
  };
  const { period, workstreamUuid, outcome, storeId, note } = body;

  if (!workstreamUuid || !outcome || !["worked", "never_worked", "clear"].includes(outcome)) {
    return NextResponse.json({ error: "workstreamUuid and outcome (worked | never_worked | clear) are required" }, { status: 400 });
  }
  if (storeId && !storeById(storeId)) {
    return NextResponse.json({ error: `Unknown store "${storeId}"` }, { status: 400 });
  }
  // The period being looked at, if it is locked, is what someone was paid on —
  // refuse rather than let the answer land in other periods and look ignored here.
  if (period && (await isLocked(period))) {
    return NextResponse.json({ error: `${period} is locked and cannot be edited. Unlock it first.` }, { status: 409 });
  }

  try {
    if (outcome === "clear") {
      await clearRetentionReview(workstreamUuid);
    } else {
      await saveRetentionReview({
        workstreamUuid,
        outcome: outcome as "worked" | "never_worked",
        storeId: storeId ?? null,
        decidedBy,
        note,
      });
    }

    let rescored: string[] = [];
    let rescoreError: string | null = null;
    try {
      rescored = await refreshRetention();
    } catch (err) {
      // The answer is saved; the scores catch up on the next cron run.
      rescoreError = err instanceof Error ? err.message : String(err);
      console.error("[Bonus] retention rescore failed:", rescoreError);
    }
    return NextResponse.json({ ok: true, rescored, rescoreError });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/retention failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
