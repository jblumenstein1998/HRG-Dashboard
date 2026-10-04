import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { getDuplicateAudit, countBySeverity } from "@/lib/workstreamAudit";

/**
 * People who exist more than once, in either system.
 *
 * GET /api/workstream/audit              → every store
 * GET /api/workstream/audit?store=36001  → one store
 *
 * The screen asks for the whole estate once and narrows in the browser, because
 * the audit reads every store's roster and a month of shifts whatever is asked
 * for — one store costs the same as twelve. The `store` parameter is kept for
 * anything calling this directly, where a smaller payload is worth more than
 * the round trip saved.
 *
 * Admin-only, like the rest of the reconciliation surface: it lists names
 * against pay rates.
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const store = req.nextUrl.searchParams.get("store");
  const today = req.nextUrl.searchParams.get("today") ?? new Date().toISOString().slice(0, 10);

  try {
    const report = await getDuplicateAudit(today);

    // Counts describe what the caller is looking at, so they are recomputed
    // after the filter rather than carried over from the whole estate.
    const rows = store ? report.rows.filter((r) => r.storeId === store) : report.rows;
    return NextResponse.json({ ...report, rows, counts: countBySeverity(rows) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-audit] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
