import { NextRequest, NextResponse } from "next/server";
import { loginBerryService } from "@/lib/berryAuth";
import { computePeriod, rescoreFromStored } from "@/lib/bonus/compute";
import { getInputs, isLocked, saveInputs, type InputWrite } from "@/lib/bonus/store";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { storeById } from "@/lib/bonus/storeMap";

/**
 * Manual bonus criteria — the two thirds of these scorecards that no connected
 * system measures (Living Our Values, Jolt, ZU, Z-Cases, retention, mock
 * Steritech, labor % of sales, and the rest).
 *
 * GET  /api/bonus/inputs?period=P7%20FY2026[&store=36001]
 * POST /api/bonus/inputs  { period, storeId, enteredBy, values: { criterionId: number|null } }
 *
 * A POST rescores that period on the way out, so the grid moves as soon as the
 * form is saved rather than waiting for the nightly cron.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const period = p.get("period");
  if (!period) {
    return NextResponse.json({ error: "period is required" }, { status: 400 });
  }

  try {
    const inputs = await getInputs(period, p.get("store") ?? undefined);
    return NextResponse.json({ period, store: p.get("store"), inputs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation "bonus_inputs" does not exist/i.test(msg)) {
      return NextResponse.json({ period, store: p.get("store"), inputs: [] });
    }
    console.error("[Bonus] GET /api/bonus/inputs failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PostBody = {
  period?: string;
  storeId?: string;
  enteredBy?: string;
  note?: string;
  values?: Record<string, number | null>;
};

export async function POST(req: NextRequest) {
  let body: PostBody;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const { period, storeId, enteredBy, note, values } = body;
  if (!period || !storeId || !values) {
    return NextResponse.json({ error: "period, storeId and values are required" }, { status: 400 });
  }
  if (!resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }
  if (!storeById(storeId)) {
    return NextResponse.json({ error: `Unknown store "${storeId}"` }, { status: 400 });
  }

  try {
    if (await isLocked(period)) {
      // Refusing here rather than in the UI alone: a locked period is what
      // someone was actually paid on, and an accepted-then-ignored save would
      // be worse than a visible rejection.
      return NextResponse.json(
        { error: `${period} is locked and cannot be edited. Unlock it first.` },
        { status: 409 }
      );
    }

    const writes: InputWrite[] = Object.entries(values).map(([criterionId, value]) => ({
      storeId,
      periodLabel: period,
      criterionId,
      value: value === null || Number.isNaN(value) ? null : Number(value),
      note: note ?? null,
      enteredBy: enteredBy ?? null,
    }));

    const saved = await saveInputs(writes);

    // Rescore so the grid reflects the entry immediately.
    //
    // The fast path reuses the metrics the cron already resolved, so this is
    // pure Postgres. Only when a period has never been computed does it fall
    // back to the full vendor pull — otherwise every save would trigger a
    // BerryAI login and a Superset round trip and take the better part of a
    // minute.
    //
    // A failure here is reported but doesn't fail the save: the scores are
    // recoverable on the next cron run, the typed values would not be.
    let recomputed = true;
    let recomputeError: string | null = null;
    try {
      const fast = await rescoreFromStored(period, storeId);
      if (!fast) {
        const token = await loginBerryService().catch(() => null);
        await computePeriod(period, token);
      }
    } catch (err) {
      recomputed = false;
      recomputeError = err instanceof Error ? err.message : String(err);
      console.error("[Bonus] rescore after save failed:", recomputeError);
    }

    return NextResponse.json({ ok: true, period, storeId, saved, recomputed, recomputeError });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/inputs failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
