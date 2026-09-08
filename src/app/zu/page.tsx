import ZUClient from "@/components/ZUClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function ZUPage() {
  const viewer = await requireTab("/zu");
  const leaders = await listLeaders();
  return (
    <ZUClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
