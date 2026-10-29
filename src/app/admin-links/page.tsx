import AdminTabClient from "@/components/AdminTabClient";
import { requireTab } from "@/lib/users/access";

/**
 * The Admin tab.
 *
 * Routed at /admin-links rather than /admin because /admin is already Users &
 * Access. The route name is a leftover from when this tab was a directory of
 * links (removed 2026-10-29); renaming it would break bookmarks for a cosmetic
 * gain, and the tab *label* — what anyone actually sees — is "Admin".
 */
export default async function AdminTabPage() {
  const viewer = await requireTab("/admin-links");
  return <AdminTabClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
