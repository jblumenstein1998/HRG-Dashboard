import { requireAdmin } from "@/lib/users/access";
import { listPositions, listUsers } from "@/lib/users/store";
import { ALL_TABS } from "@/lib/users/schema";
import AdminClient from "@/components/AdminClient";

/**
 * Users and access. Guarded server-side: requireAdmin redirects anyone whose
 * position doesn't carry admin rights, so the page never renders for them and
 * the data below is never fetched.
 */
export default async function AdminPage() {
  const viewer = await requireAdmin();
  const [users, positions] = await Promise.all([listUsers(), listPositions()]);

  return (
    <AdminClient
      initialUsers={users}
      initialPositions={positions}
      allTabs={[...ALL_TABS]}
      viewerId={viewer.user.id}
      viewerTabs={viewer.position.tabs}
    />
  );
}
