import StaffingClient from "@/components/StaffingClient";
import { requireTab } from "@/lib/users/access";

export default async function StaffingPage() {
  const viewer = await requireTab("/staffing");
  return <StaffingClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} />;
}
