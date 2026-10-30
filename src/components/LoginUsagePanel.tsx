"use client";

import { useState } from "react";
import { formatSyncStamp } from "@/lib/surveyMeta";
import { TAB_LABELS, type Tab } from "@/lib/users/tabs";

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
  minutes7: number;
  minutes30: number;
  tabs: { tab: string; minutes: number; views: number }[];
  lastActiveAt: string | null;
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

const tabLabel = (tab: string) =>
  tab === "/admin" ? "Users & Access" : (TAB_LABELS[tab as Tab] ?? tab);

/** "2h 15m", "45m", or a dash for none. */
function duration(minutes: number): string {
  if (minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * How often people use the dashboard.
 *
 * Built on the activity tracker (components/ActivityTracker): a person is
 * active in a five-minute block when they open a page or click, scroll or type
 * with the dashboard in front. That counts someone who keeps a tab open all
 * day and checks it now and then, which sign-ins can't — a session lasts
 * twelve hours, so that person signs in once. Sign-ins stay as a cross-check.
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
  const active7 = usage.filter((u) => u.minutes7 > 0).length;
  const active30 = usage.filter((u) => u.minutes30 > 0).length;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-start gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-800">Usage</div>
          <div className="text-xs text-gray-400">
            {active7} of {usage.length} active this week · {active30} in the last 30 days · active
            time counts 5-minute blocks with a click, scroll or keypress
          </div>
        </div>
        <button
          onClick={() => setShowLog((v) => !v)}
          className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
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
                <th className="px-4 py-2 text-right font-semibold" title="Days with any activity, last 30 days">
                  Active days (30d)
                </th>
                <th className="px-4 py-2 text-right font-semibold">Active time (7d)</th>
                <th className="px-4 py-2 text-right font-semibold">Active time (30d)</th>
                <th className="px-4 py-2 text-left font-semibold">Most used (30d)</th>
                <th className="px-4 py-2 text-right font-semibold">Sign-ins (30d)</th>
                <th className="px-4 py-2 text-left font-semibold">Last active</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((u) => (
                <tr key={u.userId} className="border-b border-gray-100 last:border-b-0 align-top">
                  <td className="px-4 py-2">
                    <div className="font-medium text-gray-900">{u.name}</div>
                    <div className="text-[11px] text-gray-400">{u.handle}</div>
                  </td>
                  <td className="px-4 py-2 text-gray-600">{positionLabels[u.positionId] ?? u.positionId}</td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">
                    {u.days30}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{duration(u.minutes7)}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{duration(u.minutes30)}</td>
                  <td className="px-4 py-2 text-xs text-gray-600">
                    {u.tabs.length === 0 ? (
                      <span className="text-gray-400">—</span>
                    ) : (
                      u.tabs.slice(0, 3).map((t) => (
                        <div key={t.tab} className="whitespace-nowrap">
                          {tabLabel(t.tab)}{" "}
                          <span className="text-gray-400">
                            {duration(t.minutes)} · {t.views} {t.views === 1 ? "open" : "opens"}
                          </span>
                        </div>
                      ))
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-gray-600">{u.logins30}</td>
                  <td className="px-4 py-2 text-xs text-gray-600 whitespace-nowrap">
                    {u.lastActiveAt ? (
                      formatSyncStamp(u.lastActiveAt)
                    ) : u.lastLoginAt ? (
                      <span className="text-gray-400">Signed in {formatSyncStamp(u.lastLoginAt)}</span>
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
