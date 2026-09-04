import { NextRequest, NextResponse } from "next/server";
import { apiViewer } from "@/lib/users/access";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { BONUS_STORE_IDS } from "@/lib/bonus/storeMap";
import { getAllLinkViews, getStoreLinkView } from "@/lib/workstreamRoster";
import {
  clearDecision,
  confirmLink,
  markAbsent,
  rejectPair,
} from "@/lib/workstreamLinkStore";

/**
 * The PAR ↔ Workstream employee link queue.
 *
 * GET  /api/workstream/links              → every store
 * GET  /api/workstream/links?store=36001  → one store
 * POST /api/workstream/links              → record one decision
 *
 * Admin-only, in both directions. Reading the queue means reading everybody's
 * pay rate next to their name, and writing to it decides whose hours get
 * attributed to whose rate — neither is a thing a store manager needs, and the
 * app already has a guard that says who is trusted with the user register.
 *
 * A decision is recorded against the signed-in person's email, because the
 * question a wrong link raises six months later is "who said these were the
 * same person, and what did they see?".
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const store = req.nextUrl.searchParams.get("store");
  // The corroborating pay rates come off recent shifts, so the queue needs a
  // "today" to look back from. Overridable for the same reason the staffing tab
  // takes an `at`: so a question about a past week can be asked.
  const today = req.nextUrl.searchParams.get("today") ?? new Date().toISOString().slice(0, 10);

  if (store && !BONUS_STORE_IDS.includes(store)) {
    return NextResponse.json({ error: `Unknown store ${store}` }, { status: 400 });
  }

  try {
    const stores = store
      ? [await getStoreLinkView(store, today)]
      : await getAllLinkViews(today);
    return NextResponse.json({ today, stores });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-links] read failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

type Action = "confirm" | "absent" | "reject" | "clear";

const ACTIONS = new Set<Action>(["confirm", "absent", "reject", "clear"]);

export async function POST(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const viewer = await apiViewer();
  const decidedBy = viewer?.user.email ?? viewer?.user.name ?? "";

  const body = (await req.json().catch(() => ({}))) as {
    storeId?: string;
    parEmployeeId?: string;
    workstreamUuid?: string;
    action?: string;
    note?: string;
  };

  const { storeId, parEmployeeId, workstreamUuid, note } = body;
  const action = body.action as Action | undefined;

  if (!storeId || !BONUS_STORE_IDS.includes(storeId)) {
    return NextResponse.json({ error: "A known storeId is required" }, { status: 400 });
  }
  if (!parEmployeeId) {
    return NextResponse.json({ error: "parEmployeeId is required" }, { status: 400 });
  }
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of ${[...ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }
  if ((action === "confirm" || action === "reject") && !workstreamUuid) {
    return NextResponse.json(
      { error: `${action} needs a workstreamUuid` },
      { status: 400 },
    );
  }

  try {
    const input = { parStoreId: storeId, parEmployeeId, workstreamUuid, decidedBy, note };
    if (action === "confirm") await confirmLink(input);
    else if (action === "absent") await markAbsent(input);
    else if (action === "reject") await rejectPair(input);
    else await clearDecision(storeId, parEmployeeId, workstreamUuid);

    console.log(
      `[workstream-links] ${action} store=${storeId} par=${parEmployeeId} ws=${workstreamUuid ?? "-"} by=${decidedBy || "unknown"}`,
    );

    const today = new Date().toISOString().slice(0, 10);
    return NextResponse.json({ ok: true, store: await getStoreLinkView(storeId, today) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-links] write failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
