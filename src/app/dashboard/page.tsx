import DashboardClient from "@/components/DashboardClient";
import { requireTab } from "@/lib/users/access";

export default async function DashboardPage() {
  const viewer = await requireTab("/dashboard");
  return <DashboardClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
