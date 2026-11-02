import SlackTabClient from "@/components/SlackTabClient";
import { requireTab } from "@/lib/users/access";
import { listLeaders } from "@/lib/users/leaders";

/** The Slack tab: each store's daily reports — on time, late, missed and accurate. */
export default async function SlackTabPage() {
  const viewer = await requireTab("/slack");
  const leaders = await listLeaders();
  return <SlackTabClient tabs={viewer.position.tabs} isAdmin={viewer.position.isAdmin} leaders={leaders} />;
}
