import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { getDuplicateAudit, auditToCsv, countBySeverity } from "@/lib/workstreamAudit";

/**
 * People who exist more than once, in either system.
 *
 * GET /api/workstream/audit              → JSON, every store
 * GET /api/workstream/audit?format=csv   → the same thing as a download
 * GET /api/workstream/audit?store=36001  → one store
 *
 * The CSV is the point of the feature as much as the screen is: the person who
 * can actually fix a duplicate is a GM with access to PAR, not whoever is
 * reading this dashboard. So it has to leave the building, and it carries a
 * recommended action per record so it can be forwarded without a covering note.
 *
 * Admin-only, like the rest of the reconciliation surface — it lists names
 * against pay rates.
 */

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const store = params.get("store");
  const format = params.get("format");
  const today = params.get("today") ?? new Date().toISOString().slice(0, 10);

  try {
    const report = await getDuplicateAudit(today);

    // Filtering here rather than inside the builder: the counts in the header
    // should describe what the viewer is looking at, so they are recomputed
    // after the filter rather than carried over from the whole estate.
    const rows = store ? report.rows.filter((r) => r.storeId === store) : report.rows;
    const filtered = {
      ...report,
      rows,
      counts: countBySeverity(rows),
    };

    if (format === "csv") {
      const stamp = today.replace(/-/g, "");
      const name = store ? `duplicate-audit-${store}-${stamp}.csv` : `duplicate-audit-${stamp}.csv`;
      return new NextResponse(auditToCsv(filtered.rows), {
        headers: {
          // text/csv with a filename, so the browser saves it instead of
          // rendering a wall of commas.
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
        },
      });
    }

    return NextResponse.json(filtered);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-audit] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
