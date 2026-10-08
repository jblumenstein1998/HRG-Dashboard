import StaffingClient from "@/components/StaffingClient";
import { requireSuperAdmin } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

/**
 * Staffing — super administrators only.
 *
 * Gated on the super-admin flag rather than on the tab list, because of what is on
 * the screen rather than who asked for it: every employee's name beside their
 * pay rate, the whole estate's wage run rate, and a reconciliation surface
 * whose decisions determine whose hours are costed at whose rate.
 *
 * A tab entry is a convenience — it says where somebody usually goes. This is a
 * permission. The matching guard is on every /api/staffing route too, since a
 * screen nobody can open is not the same as data nobody can fetch.
 */
export default async function StaffingPage() {
  const viewer = await requireSuperAdmin();
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
