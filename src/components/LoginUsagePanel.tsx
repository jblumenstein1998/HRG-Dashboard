"use client";

import { formatSyncStamp } from "@/lib/surveyMeta";

/**
 * Declared here rather than imported from lib/users/store, which pulls in
 * `sql` — the same reason AdminClient spells out its own types.
 */
export type LoginUsage = {
  userId: string;
  name: string;
  handle: string;
  positionId: string;
  uses30: number;
  lastLoginAt: string | null;
};

/**
 * How often people use the dashboard: uses in the last 30 days, and when they
 * last signed in. See lib/users/store loginUsage for what counts as a use.
 */
export default function LoginUsagePanel({
  usage,
  positionLabels,
}: {
  usage: LoginUsage[];
  positionLabels: Record<string, string>;
}) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="text-sm font-semibold text-gray-800">Usage</div>
        <div className="text-xs text-gray-400">
          {usage.filter((u) => u.uses30 > 0).length} of {usage.length} used it in the last 30 days ·
          a use ends after 30 minutes without a click, scroll or keypress
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
              <th className="px-4 py-2 text-left font-semibold">Name</th>
              <th className="px-4 py-2 text-left font-semibold">Position</th>
              <th className="px-4 py-2 text-right font-semibold">Uses (30d)</th>
              <th className="px-4 py-2 text-left font-semibold">Last sign-in</th>
            </tr>
          </thead>
          <tbody>
            {usage.map((u) => (
              <tr key={u.userId} className="border-b border-gray-100 last:border-b-0">
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-900">{u.name}</div>
                  <div className="text-[11px] text-gray-400">{u.handle}</div>
                </td>
                <td className="px-4 py-2 text-gray-600">{positionLabels[u.positionId] ?? u.positionId}</td>
                <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{u.uses30}</td>
                <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                  {u.lastLoginAt ? (
                    formatSyncStamp(u.lastLoginAt)
                  ) : (
                    <span className="text-gray-400">Never signed in</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
