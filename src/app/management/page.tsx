import ManagementClient from "@/components/ManagementClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function ManagementPage() {
  const viewer = await requireTab("/management");
  const leaders = await listLeaders();
  return <ManagementClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} leaders={leaders} />;
}
