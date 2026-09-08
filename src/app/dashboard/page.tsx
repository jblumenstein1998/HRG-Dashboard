import DashboardClient from "@/components/DashboardClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function DashboardPage() {
  const viewer = await requireTab("/dashboard");
  // Read here rather than fetched by the client: a dozen rows that change a few
  // times a year, so shipping them with the page means the leader dropdown is
  // populated on first paint instead of arriving a beat later.
  const leaders = await listLeaders();
  return (
    <DashboardClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
