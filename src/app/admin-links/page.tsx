import AdminLinksClient from "@/components/AdminLinksClient";
import { requireTab } from "@/lib/users/access";
import { listAdminLinkGroups, listAdminLinkGroupTitles } from "@/lib/adminLinksStore";

/**
 * The Admin tab.
 *
 * Routed at /admin-links rather than /admin because /admin is already Users &
 * Access. Two different screens both called "admin" is a naming problem, but
 * the alternative — renaming the live users screen to free up the word — moves
 * a URL people have bookmarked for a cosmetic gain. The tab *label* is what
 * anyone actually sees, and that is "Admin".
 *
 * Guarded like every other tab: the position has to carry it. Nothing here is
 * secret on its own, but the list is a map of every system the company signs
 * into, which is not something to hand to an account that shouldn't have it.
 *
 * The directory is read here, on the server, and passed down — so the page
 * paints complete rather than empty-then-populated, and the write route can
 * stay write-only. `isAdmin` decides whether the client offers the add and
 * remove controls; the API re-checks it, because a prop is a UI hint and not a
 * permission.
 */
export default async function AdminLinksPage() {
  const viewer = await requireTab("/admin-links");
  const [groups, groupTitles] = await Promise.all([
    listAdminLinkGroups(),
    listAdminLinkGroupTitles(),
  ]);

  return (
    <AdminLinksClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      groups={groups}
      groupTitles={groupTitles}
    />
  );
}
