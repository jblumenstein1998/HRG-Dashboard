import { revalidateTag } from "next/cache";
import { requireAdminApi } from "@/lib/users/adminGuard";

/**
 * Drop the cached Workstream roster.
 *
 * The roster is cached for an hour (workstreamRoster.ts), which is right for a
 * list that changes when somebody is hired. It is wrong for the ten minutes
 * after you have just fixed something in Workstream and want to see it: a
 * terminated employee keeps appearing in the reconciliation list, which reads
 * as the app ignoring the change rather than as a cache.
 *
 * So there is a button. It expires the tag every Workstream read is filed
 * under.
 *
 * `revalidateTag` is stale-while-revalidate in this version of Next — it hands
 * back the old roster once more while fetching the new one behind it, and the
 * whole company takes about 35 seconds to re-read. So the screen can still
 * show the previous answer immediately after pressing the button, and be right
 * a few seconds later. `updateTag` is the read-your-own-writes version and
 * cannot be used here: it only works inside a Server Action.
 *
 * Admin-only, like everything else that touches this data.
 */
export async function POST() {
  const denied = await requireAdminApi();
  if (denied) return denied;

  revalidateTag("workstream-data", "max");
  console.log("[workstream] roster cache expired by hand");
  return Response.json({ ok: true });
}
