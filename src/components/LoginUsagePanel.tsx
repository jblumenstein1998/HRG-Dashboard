"use client";

import { useState } from "react";
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
  logins7: number;
  logins30: number;
  days30: number;
  lastLoginAt: string | null;
};

export type LoginEvent = {
  id: string;
  userId: string;
  name: string;
  handle: string;
  at: string;
  method: "google" | "password";
};

/**
 * How often people use the dashboard, from the sign-in log.
 *
 * Sessions last twelve hours, so one sign-in is roughly one working day — a
 * person who keeps the tab open all day still counts once. "Days" is therefore
 * the headline number and raw sign-ins sit beside it.
 */
export default function LoginUsagePanel({
  usage,
  events,
  positionLabels,
}: {
  usage: LoginUsage[];
  events: LoginEvent[];
  positionLabels: Record<string, string>;
}) {
  const [showLog, setShowLog] = useState(false);
  const active7 = usage.filter((u) => u.logins7 > 0).length;
  const active30 = usage.filter((u) => u.logins30 > 0).length;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">Usage</div>
          <div className="text-xs text-gray-400">
            {active7} of {usage.length} signed in this week · {active30} in the last 30 days
          </div>
        </div>
        <button
          onClick={() => setShowLog((v) => !v)}
          className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
        >
          {showLog ? "Show summary" : "Show sign-in log"}
        </button>
      </div>

      {showLog ? (
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 text-left font-semibold">When</th>
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Signs in as</th>
                <th className="px-4 py-2 text-left font-semibold">Method</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-xs text-gray-400">
                    No sign-ins recorded yet.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b border-gray-100 last:border-b-0">
                  <td className="px-4 py-2 text-gray-600 whitespace-nowrap">{formatSyncStamp(e.at)}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{e.name}</td>
                  <td className="px-4 py-2 text-gray-600">{e.handle}</td>
                  <td className="px-4 py-2 text-xs text-gray-500">
                    {e.method === "google" ? "Google" : "Store password"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 text-left font-semibold">Name</th>
                <th className="px-4 py-2 text-left font-semibold">Position</th>
                <th className="px-4 py-2 text-right font-semibold">Days (30d)</th>
                <th className="px-4 py-2 text-right font-semibold">Sign-ins (7d)</th>
                <th className="px-4 py-2 text-right font-semibold">Sign-ins (30d)</th>
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
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                    {u.days30}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{u.logins7}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{u.logins30}</td>
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
      )}
    </section>
  );
}
