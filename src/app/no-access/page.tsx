import { getViewer } from "@/lib/users/access";
import { redirect } from "next/navigation";

/**
 * Reached only when a position has no tabs at all — a configuration mistake
 * rather than a normal state. Without this the redirect would land on a 404,
 * which reads like the app is broken rather than like nobody has granted this
 * position anything yet.
 */
export default async function NoAccessPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.position.tabs.length > 0) redirect(viewer.position.tabs[0]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-gray-50">
      <div className="w-full max-w-sm text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/hrglogo.png" alt="HRG" className="h-20 w-auto mx-auto mb-4" />
        <h1 className="text-xl font-semibold text-gray-900">No tabs yet</h1>
        <p className="text-sm text-gray-500 mt-2">
          You&apos;re signed in as {viewer.user.name}, but the{" "}
          {viewer.position.label} position hasn&apos;t been given access to any
          tabs. Ask an administrator to grant some.
        </p>
      </div>
    </div>
  );
}
