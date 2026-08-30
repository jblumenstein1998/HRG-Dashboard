import JoltClient from "@/components/JoltClient";
import { requireTab } from "@/lib/users/access";

export default async function JoltPage() {
  const viewer = await requireTab("/jolt");
  return <JoltClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
