import StaffingClient from "@/components/StaffingClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

export default async function StaffingPage() {
  const viewer = await requireTab("/staffing");
  // Read server-side like every other tab, so the picker never briefly offers a
  // leader the viewer would then be bounced out of.
  const leaders = await listLeaders();
  return (
    <StaffingClient
      tabs={viewer.position.tabs}
      isAdmin={viewer.position.isAdmin}
      leaders={leaders}
    />
  );
}
