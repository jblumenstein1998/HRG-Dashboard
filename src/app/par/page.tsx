import PARClient from "@/components/PARClient";
import { PAR_LOCATIONS } from "@/lib/par";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function PARPage() {
  const viewer = await requireTab("/par");
  const leaders = await listLeaders();
  return (
    <PARClient
      locations={PAR_LOCATIONS}
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
