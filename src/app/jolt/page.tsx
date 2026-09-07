import JoltClient from "@/components/JoltClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function JoltPage() {
  const viewer = await requireTab("/jolt");
  const leaders = await listLeaders();
  return (
    <JoltClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
