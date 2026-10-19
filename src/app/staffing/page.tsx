import StaffingClient from "@/components/StaffingClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

/**
 * Staffing — for positions with the tab ticked.
 *
 * Every employee's name sits beside their pay rate here, so ticking Staffing on
 * a position is a decision about who sees pay, and is made in Admin → Positions
 * with that in mind. It was once gated on super-admin instead, which left the
 * tab in the menus of people the page then silently bounced to POS.
 *
 * The admin-only sections (the duplicate audit and Workstream reconciliation)
 * are still hidden from non-admins, and their /api/workstream routes check
 * admin. The /api/staffing routes check this same tab, since a screen nobody
 * can open is not the same as data nobody can fetch.
 */
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
