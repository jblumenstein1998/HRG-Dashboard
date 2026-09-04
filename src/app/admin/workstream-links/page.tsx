import { requireAdmin } from "@/lib/users/access";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import WorkstreamLinksClient from "@/components/WorkstreamLinksClient";

/**
 * Confirming which PAR employee is which Workstream employee.
 *
 * Admin-only for the same reason the API route is: the screen shows everyone's
 * pay rate beside their name, and the decisions made here determine whose hours
 * are costed at whose rate.
 *
 * Nothing is fetched server-side. Each store's queue costs a PAR roster and a
 * week of shifts, and this page is opened to work through one store — so the
 * shell renders immediately and the client asks for the store it's showing.
 */
export default async function WorkstreamLinksPage() {
  const viewer = await requireAdmin();
  return <WorkstreamLinksClient tabs={viewer.position.tabs} stores={BONUS_STORES} />;
}
