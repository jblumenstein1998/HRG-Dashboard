"use client";

import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import AdminSlackReports from "@/components/AdminSlackReports";
import type { Tab } from "@/lib/users/tabs";
import type { Leader } from "@/components/StoreFilter";

/**
 * The Admin tab: back-office tools that sit behind the scorecards.
 *
 * It used to be a directory of links to every back-office system; nobody used
 * it, and it was removed on 2026-10-29 (Josh). Its rows are left in the
 * admin_links table, unread.
 *
 * Today it holds the Slack reporting table. Anyone whose position has the tab
 * ticked sees it (Josh, 2026-10-30 — it had been admin-only, which left
 * Directors of Operations looking at an empty tab); its route checks the same
 * tick.
 */
export default function AdminTabClient({
  tabs, isAdmin, leaders,
}: { tabs: Tab[]; isAdmin: boolean; leaders: Leader[] }) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/admin-links"
                  onChange={(e) => router.push(e.target.value)}
                  aria-label="Switch tab"
                  className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
                >
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
                </select>
                <svg
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </div>
          </div>
        </header>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        <AdminSlackReports leaders={leaders} />
      </main>
    </div>
  );
}
