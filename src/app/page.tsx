import { redirect } from "next/navigation";
import { getViewer } from "@/lib/users/access";

/**
 * The root sends you to the first tab your position can reach, rather than
 * assuming /dashboard — a position without Drive-Thru would otherwise land on
 * a redirect loop through a tab it isn't allowed to see.
 */
export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.user.mustReset) redirect("/change-password");
  redirect(viewer.position.tabs[0] ?? "/no-access");
}
