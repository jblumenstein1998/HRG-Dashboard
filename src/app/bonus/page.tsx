import BonusClient from "@/components/BonusClient";
import { requireTab } from "@/lib/users/access";
import { canAssignTeam } from "@/lib/bonus/assignments";

export default async function BonusPage() {
  const viewer = await requireTab("/bonus");
  return (
    <BonusClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      canAssignTeam={canAssignTeam(viewer.position)}
    />
  );
}
