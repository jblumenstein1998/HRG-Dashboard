import { NextResponse } from "next/server";
import { requireTabApi } from "@/lib/users/adminGuard";
import { getProjections } from "@/lib/salesProjections";

/**
 * Yesterday's projected vs actual sales and productivity, and today's
 * projections, per store — from the morning Slack reports and PAR.
 *
 * GET /api/staffing/projections
 *
 * Gated on the Staffing tab like the rest of /api/staffing.
 */
export const maxDuration = 60;

export async function GET() {
  const denied = await requireTabApi("/staffing");
  if (denied) return denied;
  try {
    return NextResponse.json(await getProjections());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[staffing] projections failed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
