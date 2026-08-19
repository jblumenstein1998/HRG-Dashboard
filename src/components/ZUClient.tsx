"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { CopyableTitle } from "@/components/CopyImageButton";
import type { Tab } from "@/lib/users/tabs";
import { TN_STORES, VA_STORES } from "@/lib/surveyMeta";

/**
 * Zaxby's University — training compliance out of Schoox.
 *
 * The headline is Average Compliance Rate, the tile the Schoox compliance
 * dashboard leads with, for whichever store is selected. "All Stores" is the
 * unfiltered academy figure Schoox reports itself, not an average of the rows
 * below: a mean of twelve store percentages would weight a 30-person store the
 * same as a 60-person one and quietly disagree with Schoox's own number.
 */

const ALL_STORES = "";

type ZuStats = {
  complianceRate: number | null;
  people: number;
  compliant: number;
  noncompliant: number;
  complianceScore: number | null;
  averageCourses: number;
  totalTime: string;
};

type ZuStore = ZuStats & { unitId: string; storeId: string; label: string };

type ZuReport = { total: ZuStats; stores: ZuStore[]; fetchedAt: number };

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

/** Schoox sends "522:38:34" for a store and a bare hour count for the academy. */
function fmtHours(totalTime: string): string {
  if (!totalTime) return "—";
  const hours = Number(totalTime.split(":")[0]);
  return Number.isFinite(hours) ? `${hours.toLocaleString("en-US")} hrs` : totalTime;
}

/**
 * The same thresholds the Schoox gauge paints: red below 60, amber to 80, green
 * above. Kept here rather than in surveyMeta because they score compliance, not
 * a survey metric, and the two scales have no reason to move together.
 */
function rateColor(v: number | null): string {
  if (v === null) return "text-gray-400";
  if (v >= 80) return "text-green-600";
  if (v >= 60) return "text-yellow-600";
  return "text-red-600";
}

function rateBg(v: number | null): string {
  if (v === null) return "";
  if (v >= 80) return "bg-green-50";
  if (v >= 60) return "bg-yellow-50";
  return "bg-red-50";
}

function fmtFetched(at: number): string {
  return `Updated ${new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// ── Store ordering ────────────────────────────────────────────────────────────

/**
 * TN then VA, in the order every other tab lists them. Stores Schoox knows
 * about but the shared list doesn't — a new opening, before surveyMeta catches
 * up — fall to the end rather than disappearing.
 */
function sortStores(stores: ZuStore[]): ZuStore[] {
  const order = [...TN_STORES, ...VA_STORES];
  return [...stores].sort((a, b) => {
    const ia = order.indexOf(a.label);
    const ib = order.indexOf(b.label);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

function marketOf(label: string): "TN" | "VA" | null {
  if (TN_STORES.includes(label)) return "TN";
  if (VA_STORES.includes(label)) return "VA";
  return null;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZUClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

  const [report, setReport] = useState<ZuReport | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<string>("");
  const [storeId, setStoreId] = useState<string>(ALL_STORES);
  const [refreshing, setRefreshing] = useState(false);

  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setStatus("loading");
    try {
      const res = await fetch(`/api/zu/compliance${refresh ? "?refresh=1" : ""}`);
      const data = (await res.json()) as ZuReport | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      setReport(data);
      setStatus("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const stores = report ? sortStores(report.stores) : [];
  const selected = storeId === ALL_STORES ? null : stores.find((s) => s.storeId === storeId) ?? null;

  // A selected store that vanished from a refreshed report would otherwise
  // leave the headline blank with the picker still naming it.
  const scope: ZuStats | null = selected ?? report?.total ?? null;
  const scopeLabel = selected ? selected.label : "All Stores";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="flex flex-col">
              <div className="relative w-fit">
                <select
                  value="/zu"
                  onChange={(e) => router.push(e.target.value)}
                  aria-label="Switch tab"
                  className="text-base font-semibold text-gray-900 leading-tight bg-transparent border-0 p-0 m-0 pr-5 w-full appearance-none cursor-pointer focus:outline-none focus:ring-0 [text-align-last:center]"
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
              {report && (
                <p className="text-xs text-gray-400 leading-tight">{fmtFetched(report.fetchedAt)}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            <label className="sr-only" htmlFor="zu-store">
              Filter by store
            </label>
            <select
              id="zu-store"
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              disabled={status !== "done"}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-gray-700 disabled:opacity-50 cursor-pointer focus:outline-none"
            >
              <option value={ALL_STORES}>All Stores</option>
              {stores.map((s) => (
                <option key={s.storeId || s.unitId} value={s.storeId}>
                  {s.label}
                </option>
              ))}
            </select>

            <button
              onClick={() => void load(true)}
              disabled={refreshing || status === "loading"}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {status === "loading" && (
          <p className="text-sm text-gray-500">Loading Zaxby&apos;s University compliance…</p>
        )}

        {status === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-800">Couldn&apos;t load ZU compliance</p>
            <p className="text-xs text-red-700 mt-1">{error}</p>
          </div>
        )}

        {status === "done" && scope && (
          <>
            <section className="rounded-lg border border-gray-200 bg-white px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Average Compliance Rate — {scopeLabel}
              </p>
              <p className={`mt-2 text-5xl font-semibold tabular-nums ${rateColor(scope.complianceRate)}`}>
                {fmtPct(scope.complianceRate)}
              </p>

              <dl className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-4 border-t border-gray-100 pt-4">
                {[
                  { label: "People", value: scope.people.toLocaleString("en-US") },
                  { label: "Compliant", value: scope.compliant.toLocaleString("en-US") },
                  { label: "Noncompliant", value: scope.noncompliant.toLocaleString("en-US") },
                  { label: "Avg Courses", value: scope.averageCourses.toLocaleString("en-US") },
                ].map((s) => (
                  <div key={s.label}>
                    <dt className="text-xs text-gray-500">{s.label}</dt>
                    <dd className="text-lg font-medium tabular-nums text-gray-900">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section>
              <CopyableTitle title="BY STORE" targetRef={tableRef} />
              <div
                ref={tableRef}
                className="mt-2 rounded-lg border border-gray-200 bg-white overflow-x-auto"
              >
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Store</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">
                        Avg Compliance
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">People</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Compliant</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">
                        Noncompliant
                      </th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Avg Courses</th>
                      <th className="px-4 py-2 text-right font-medium text-gray-500">Total Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stores.map((s, i) => {
                      const prev = stores[i - 1];
                      const newMarket = i > 0 && marketOf(s.label) !== marketOf(prev.label);
                      return (
                        <tr
                          key={s.storeId || s.unitId}
                          onClick={() => setStoreId(s.storeId)}
                          className={`cursor-pointer hover:bg-gray-50 ${
                            newMarket ? "border-t-2 border-gray-300" : "border-t border-gray-100"
                          } ${s.storeId === storeId ? "bg-gray-50" : ""}`}
                        >
                          <td className="px-4 py-2 whitespace-nowrap text-gray-900">{s.label}</td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-medium ${rateColor(
                              s.complianceRate,
                            )} ${rateBg(s.complianceRate)}`}
                          >
                            {fmtPct(s.complianceRate)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {s.people.toLocaleString("en-US")}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {s.compliant.toLocaleString("en-US")}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {s.noncompliant.toLocaleString("en-US")}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {s.averageCourses.toLocaleString("en-US")}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {fmtHours(s.totalTime)}
                          </td>
                        </tr>
                      );
                    })}

                    {report && (
                      <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                        <td className="px-4 py-2 whitespace-nowrap">All Stores</td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${rateColor(
                            report.total.complianceRate,
                          )}`}
                        >
                          {fmtPct(report.total.complianceRate)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {report.total.people.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {report.total.compliant.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {report.total.noncompliant.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {report.total.averageCourses.toLocaleString("en-US")}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {fmtHours(report.total.totalTime)}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
