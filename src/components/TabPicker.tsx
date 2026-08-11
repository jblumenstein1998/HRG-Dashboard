"use client";

import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";

/**
 * The tab picker in the header.
 *
 * Previously five copies of the same hardcoded `<option>` list, one per client
 * component, which is how the Bonus entry ended up needing to be hidden in five
 * places. Now one component, and the options come from the signed-in user's
 * position — so a District Manager doesn't see Bonus rather than seeing it and
 * being bounced.
 *
 * The list is passed in from the server component that renders the page; it is
 * not fetched here, so the nav can't briefly show tabs the viewer can't reach.
 */
export default function TabPicker({
  tabs,
  current,
  isAdmin,
}: {
  tabs: Tab[];
  current: string;
  isAdmin: boolean;
}) {
  const router = useRouter();

  return (
    <div className="relative inline-flex items-center">
      <select
        value={current}
        onChange={(e) => router.push(e.target.value)}
        aria-label="Switch tab"
        className="appearance-none bg-transparent text-lg font-semibold text-gray-900 pr-6 cursor-pointer focus:outline-none"
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
  );
}
