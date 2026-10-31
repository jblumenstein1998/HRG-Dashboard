import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { parsePnl } from "@/lib/bonus/pnl";
import { applyLaborToMetrics, getFinancials, saveFinancials } from "@/lib/bonus/financials";
import { rescoreFromStored } from "@/lib/bonus/compute";
import { FIRST_BONUS_PERIOD, resolveBonusWindow } from "@/lib/bonus/periods";
import { isLocked } from "@/lib/bonus/store";

/**
 * The period P&L for bonus — see lib/bonus/pnl.ts and financials.ts.
 *
 * GET  /api/bonus/pnl?period=P10%20FY2026        → { financials }
 * POST /api/bonus/pnl   multipart: file, period, mode = "preview" | "save"
 *
 * Preview reads the file and stores nothing, so what was understood — which
 * columns became which stores, what each figure came to — is checked before it
 * counts. Save stores it, puts Labor % into the GM's scorecard and rescores.
 *
 * Admin-only, reads included: Controllable Income and EBITDA are the
 * company's financials, not something every Bonus-tab viewer should see.
 */

export const maxDuration = 60;

/** An export of every store for one period is ~40 KB; this is generous. */
const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const period = req.nextUrl.searchParams.get("period");
  if (!period || !resolveBonusWindow(period)) {
    return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  }
  try {
    return NextResponse.json({ period, financials: await getFinancials(period) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] GET /api/bonus/pnl failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const period = String(form?.get("period") ?? "");
  const mode = String(form?.get("mode") ?? "preview");
  if (!(file instanceof File)) return NextResponse.json({ error: "Attach the P&L as an .xlsx file." }, { status: 400 });
  if (!resolveBonusWindow(period)) return NextResponse.json({ error: `Unknown period "${period}"` }, { status: 400 });
  if (mode !== "preview" && mode !== "save") return NextResponse.json({ error: "mode must be preview or save" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That file is larger than a P&L export should be (5 MB max)." }, { status: 400 });
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json(
      { error: `${file.name} isn't an .xlsx file. Export the P&L to Excel (.xlsx) — older .xls and CSV aren't read.` },
      { status: 400 }
    );
  }

  let parsed;
  try {
    parsed = await parsePnl(await file.arrayBuffer());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  // Why this file can't be saved to this period, if it can't. Shown on the
  // preview too, so the problem is visible before anyone presses Save.
  const blockers: string[] = [];
  if (parsed.looksMultiPeriod) {
    blockers.push("The title says this covers a quarter or a year. Bonus is paid per period — export the P&L for one period.");
  }
  if (parsed.periodFromFile && parsed.periodFromFile !== period) {
    // Only point at a period the tab actually offers.
    const offered = resolveBonusWindow(parsed.periodFromFile) !== null;
    blockers.push(
      `This P&L ends ${parsed.endingDate}, which is the end of ${parsed.periodFromFile}, not ${period}.` +
        (offered ? ` Switch the tab to ${parsed.periodFromFile} to load it.` : ` The Bonus tab starts at P${FIRST_BONUS_PERIOD}.`)
    );
  }
  if (parsed.stores.length === 0) blockers.push("No column matched a store.");

  if (mode === "preview" || blockers.length > 0) {
    return NextResponse.json({ period, fileName: file.name, parsed, blockers, saved: false });
  }

  try {
    if (await isLocked(period)) {
      return NextResponse.json({ error: `${period} is approved and locked for pay.` }, { status: 409 });
    }
    const viewer = await apiViewer();
    await saveFinancials(period, parsed.stores, file.name, viewer?.user.email ?? viewer?.user.name ?? null);

    // Labor % scores the GM's card straight away. A failure here doesn't undo
    // the save — the nightly run reads the stored figures either way.
    let rescored = false;
    try {
      if (await applyLaborToMetrics(period, parsed.stores)) {
        await rescoreFromStored(period);
        rescored = true;
      }
    } catch (err) {
      console.error("[Bonus] rescore after P&L failed:", err instanceof Error ? err.message : err);
    }

    return NextResponse.json({
      period, fileName: file.name, parsed, blockers, saved: true, rescored,
      financials: await getFinancials(period),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/pnl failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
