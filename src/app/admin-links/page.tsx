import AdminLinksClient from "@/components/AdminLinksClient";
import { requireTab } from "@/lib/users/access";

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
 */
export default async function AdminLinksPage() {
  const viewer = await requireTab("/admin-links");
  return <AdminLinksClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
