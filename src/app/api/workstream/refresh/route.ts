import { requireAdminApi } from "@/lib/users/adminGuard";
import { syncWorkstreamEmployees, workstreamSyncStatus } from "@/lib/workstreamStore";

/**
 * Re-read Workstream now, instead of waiting for tomorrow's cron.
 *
 * The roster is synced once a morning (api/cron/workstream-sync) and read from
 * Postgres. That is right for a list that changes when somebody is hired, and
 * wrong for the ten minutes after you have fixed a record by hand and want to
 * see it — a terminated employee still showing in the list reads as the app
 * ignoring you rather than as yesterday's copy.
 *
 * This is a real re-read, not a cache expiry: it pages the vendor and writes
 * the table, so when it returns the change is already visible. It takes about
 * 35 seconds.
 *
 * Deliberately the only path that hits Workstream on demand. Every other read
 * in the app goes to Postgres, which is what keeps us inside the vendor's rate
 * limit — one sync a morning plus the occasional button, rather than the whole
 * company once per store per page load.
 */

export const maxDuration = 300;

export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  try {
    const result = await syncWorkstreamEmployees();
    const status = await workstreamSyncStatus();
    console.log(`[workstream] manual sync: ${result.fetched} fetched, ${status.rows} rows`);
    return Response.json({ ok: true, ...result, ...status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[workstream] manual sync failed:", msg);
    return Response.json({ error: msg }, { status: 502 });
  }
}
