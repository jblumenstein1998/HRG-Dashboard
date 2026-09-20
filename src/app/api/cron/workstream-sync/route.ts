import { syncWorkstreamEmployees, workstreamSyncStatus } from "@/lib/workstreamStore";

/**
 * Read Workstream once a morning and store it.
 *
 * The staffing tab used to read the vendor live, which cost 32 seconds a call
 * and ended in `429 Too many requests. Try again after 69401 seconds.` Once a
 * day is the right frequency for a roster: people are hired and terminated on
 * working days, not on page loads, and the Reconciliation section has a
 * refresh button for the minutes after somebody fixes a record by hand.
 *
 * Runs at 11:00 UTC — ahead of the other six crons, because the staffing tab
 * is the first thing opened in the morning and PAR's rollups do not depend on
 * this.
 */

export const maxDuration = 300;

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncWorkstreamEmployees();
    const status = await workstreamSyncStatus();
    console.log(
      `[workstream-sync] ${result.fetched} fetched, ${result.written} written,`
        + ` ${result.withStore} carry a store, ${result.keptPriorStore} kept a store`
        + ` they would otherwise have lost; table now holds ${status.rows}`,
    );
    return Response.json({ ok: true, ...result, rows: status.rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream-sync] failed:", msg);
    // A failed sync leaves yesterday's roster in place, which is the right
    // outcome — the tab keeps working on slightly stale data rather than
    // emptying out.
    return Response.json({ ok: false, error: msg }, { status: 502 });
  }
}
