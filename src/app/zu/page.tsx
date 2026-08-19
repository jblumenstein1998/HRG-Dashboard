import ZUClient from "@/components/ZUClient";
import { requireTab } from "@/lib/users/access";

export default async function ZUPage() {
  const viewer = await requireTab("/zu");
  return <ZUClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
