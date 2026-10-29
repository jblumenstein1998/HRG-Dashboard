import { NextRequest, NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { apiViewer } from "@/lib/users/access";
import { getTeam, listCandidates, saveTeam, type TeamMember } from "@/lib/bonus/assignments";
import { resolveBonusWindow } from "@/lib/bonus/periods";
import { isLocked } from "@/lib/bonus/store";
import { storeById } from "@/lib/bonus/storeMap";
import { POSITION_ORDER, type PositionId } from "@/lib/bonus/types";

/**
 * The people on a store's scorecard — see lib/bonus/assignments.ts.
 *
 * GET  /api/bonus/assignments?period=P10%20FY2026&store=36001
 *      → { team: { members, fromPeriod }, candidates }
 * POST /api/bonus/assignments
 *      { period, storeId, members: [{ positionId, name, workstreamUuid }] }
 *      replaces the period's whole team, in the order sent.
 *
 * Refused under the pay lock and nothing else: the scorecard's edit lock
 * guards scoring entries, and a name is not one.
 */

/** Rows a team may hold — six positions with room for shared ones, and a cap on junk. */
const MAX_MEMBERS = 24;

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
    const [team, candidates] = await Promise.all([
      getTeam(period!, storeId!),
      // The suggestions are a convenience. An unsynced roster leaves the names
      // typed by hand rather than the whole card failing.
      listCandidates(storeId!).catch((err) => {
        console.error("[Bonus] team candidates failed:", err instanceof Error ? err.message : err);
        return [];
      }),
    ]);
    return NextResponse.json({ period, storeId, team, candidates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] GET /api/bonus/assignments failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PostBody = {
  period?: string;
  storeId?: string;
  members?: { positionId?: string; name?: string; workstreamUuid?: string | null }[];
};

export async function POST(req: NextRequest) {
  const denied = await requireTabApi("/bonus");
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as PostBody;
  const { period, storeId, members } = body;
  const problem = checkTarget(period, storeId)
    ?? (Array.isArray(members) ? null : "members is required")
    ?? (members!.length > MAX_MEMBERS ? `A team holds at most ${MAX_MEMBERS} people` : null)
    ?? (members!.every((m) => (POSITION_ORDER as string[]).includes(m.positionId ?? ""))
      ? null
      : "Every row needs a known position");
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const team: TeamMember[] = members!.map((m) => ({
    positionId: m.positionId as PositionId,
    name: (m.name ?? "").trim().slice(0, 120),
    workstreamUuid: m.workstreamUuid ?? null,
  }));

  try {
    if (await isLocked(period!)) {
      return NextResponse.json({ error: `${period} is approved and locked for pay.` }, { status: 409 });
    }
    const viewer = await apiViewer();
    await saveTeam(period!, storeId!, team, viewer?.user.email ?? viewer?.user.name ?? null);
    return NextResponse.json({ ok: true, team: await getTeam(period!, storeId!) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Bonus] POST /api/bonus/assignments failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
