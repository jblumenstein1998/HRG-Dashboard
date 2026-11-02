import { requireAdmin } from "@/lib/users/access";
import { listPositions, listUsers, usesLast30Days } from "@/lib/users/store";
import { listLeaders } from "@/lib/users/leaders";
import { ALL_TABS } from "@/lib/users/tabs";
import AdminClient from "@/components/AdminClient";

/**
 * Users and access. Guarded server-side: requireAdmin redirects anyone whose
 * position doesn't carry admin rights, so the page never renders for them and
 * the data below is never fetched.
 */
export default async function AdminPage() {
  const viewer = await requireAdmin();
  const [users, positions, leaders, uses] = await Promise.all([
    listUsers(),
    listPositions(),
    listLeaders(),
    usesLast30Days(),
  ]);

  return (
    <AdminClient
      initialUsers={users}
      initialPositions={positions}
      initialLeaders={leaders}
      uses={uses}
      allTabs={[...ALL_TABS]}
      viewerId={viewer.user.id}
      viewerTabs={viewer.position.tabs}
    />
  );
}
