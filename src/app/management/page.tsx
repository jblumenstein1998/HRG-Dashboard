import ManagementClient from "@/components/ManagementClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";
import { todayCentralISO } from "@/lib/parRollup";
import { recentWbrWeeks } from "@/lib/wbr/weeks";
import { driveResultOf, one, type Search } from "@/lib/wbr/driveResult";

export default async function ManagementPage({ searchParams }: { searchParams: Promise<Search> }) {
  const viewer = await requireTab("/management");
  const leaders = await listLeaders();
  const q = await searchParams;
  return (
    <ManagementClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
      // The store presentation saves to the person's own Google Drive, so only
      // someone signed in with Google sees it — never a shared store login.
      deck={
        viewer.user.email
          ? {
              weeks: recentWbrWeeks(todayCentralISO(), 26),
              driveResult: driveResultOf(q),
              // Absent unless coming back from a save; "" there means All stores.
              initialTarget: q.target === undefined ? undefined : one(q.target),
              initialWeekEnd: one(q.weekEnd),
            }
          : null
      }
    />
  );
}
