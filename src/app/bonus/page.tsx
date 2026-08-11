import BonusClient from "@/components/BonusClient";
import { requireTab } from "@/lib/users/access";

export default async function BonusPage() {
  const viewer = await requireTab("/bonus");
  return <BonusClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
