import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { getAssignments, listCandidates, saveAssignments, type AssignmentWrite } from "@/lib/bonus/assignments";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { isLocked } from "@/lib/bonus/store";
import { storeById } from "@/lib/bonus/storeMap";
import { POSITION_ORDER, type PositionId } from "@/lib/bonus/types";

/**
 * The people on a store's scorecard — see lib/bonus/assignments.ts.
 *
 * GET  /api/bonus/assignments?period=P10%20FY2026&store=36001
 *      → { assignments, candidates }
 * POST /api/bonus/assignments
 *      { period, storeId, team: { [positionId]: { name, workstreamUuid } } }
 *
 * Refused under the pay lock and nothing else: the scorecard's edit lock
 * guards scoring entries, and a name is not one.
 */

function checkTarget(period: string | null | undefined, storeId: string | null | undefined): string | null {
  if (!period || !resolveBonusWindow(period)) return `Unknown period "${period}"`;
  if (!storeId || !storeById(storeId)) return `Unknown store "${storeId}"`;
  return null;
}

export async function GET(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period");
  const storeId = req.nextUrl.searchParams.get("store");
  const problem = checkTarget(period, storeId);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const [assignments, candidates] = await Promise.all([
      getAssignments(period!, storeId!),
      // The suggestions are a convenience. An unsynced roster leaves the names
      // typed by hand rather than the whole card failing.
      listCandidates(storeId!).catch((err) => {
        console.error("[Bonus] assignment candidates failed:", err instanceof Error ? err.message : err);
        return [];
      }),
    ]);
    return NextResponse.json({ period, storeId, assignments, candidates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] GET /api/bonus/assignments failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PostBody = {
  period?: string;
  storeId?: string;
  team?: Partial<Record<PositionId, { name?: string; workstreamUuid?: string | null }>>;
};

export async function POST(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const { period, storeId, team } = body;
  const problem = checkTarget(period, storeId) ?? (team ? null : "team is required");
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  // Only the six positions, and only those sent: anything else in the body is
  // ignored rather than stored under an id nothing reads.
  const writes: AssignmentWrite[] = POSITION_ORDER.flatMap((positionId) => {
    const entry = team![positionId];
    if (!entry) return [];
    const name = (entry.name ?? "").trim().slice(0, 120);
    return [{ positionId, name, workstreamUuid: name ? entry.workstreamUuid ?? null : null }];
  });

  try {
    if (await isLocked(period!)) {
      return NextResponse.json({ error: `${period} is approved and locked for pay.` }, { status: 409 });
    }
    const viewer = await apiViewer();
    await saveAssignments(period!, storeId!, writes, viewer?.user.email ?? viewer?.user.name ?? null);
    return NextResponse.json({ ok: true, assignments: await getAssignments(period!, storeId!) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/assignments failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
