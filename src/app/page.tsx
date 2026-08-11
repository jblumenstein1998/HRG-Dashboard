import { redirect } from "next/navigation";
import { getViewer } from "@/lib/users/access";
import { landingTab } from "@/lib/users/tabs";

/**
 * The root resolves where someone should start, rather than any caller naming
 * a tab, so the landing rule lives in one place and always reflects the
 * viewer's position.
 */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  redirect(landingTab(viewer.position.tabs));
}
