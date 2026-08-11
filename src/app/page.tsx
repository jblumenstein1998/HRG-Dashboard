import { redirect } from "next/navigation";
import { getViewer } from "@/lib/users/access";
import { landingTab } from "@/lib/users/tabs";

/**
 * The root resolves where someone should start. Both the login page and the
 * change-password page send you here rather than naming a tab themselves, so
 * the landing rule lives in one place and always reflects the viewer's
 * position.
 */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.user.mustReset) redirect("/change-password");
  redirect(landingTab(viewer.position.tabs));
}
