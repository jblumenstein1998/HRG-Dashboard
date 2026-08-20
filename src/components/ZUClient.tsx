"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { CopyableTitle } from "@/components/CopyImageButton";
import type { Tab } from "@/lib/users/tabs";
import { TN_STORES, VA_STORES } from "@/lib/surveyMeta";

/**
 * Zaxby's University — training compliance out of Schoox.
 *
 * One table, one row per store, sorted TN then VA the way every other tab
 * orders them. Opening a row lists that store's people worst-rate-first, which
 * is the question a store row raises: not "how bad", but "who".
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

type ZuStore = ZuStats & {
  unitId: string;
  storeId: string;
  label: string;
  /** Unrounded rate, for subtotals. See the note in lib/schoox.ts. */
  exactRate: number | null;
};

type ZuReport = { total: ZuStats; stores: ZuStore[]; fetchedAt: number };

type ZuMember = {
  id: string;
  name: string;
  complianceRate: number | null;
  totalCourses: number;
  completions: number;
};

type MemberState = "loading" | "error" | ZuMember[];

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

function num(v: number): string {
  return v.toLocaleString("en-US");
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

// ── Store ordering and grouping ───────────────────────────────────────────────

function marketOf(label: string): "TN" | "VA" | null {
  if (TN_STORES.includes(label)) return "TN";
  if (VA_STORES.includes(label)) return "VA";
  return null;
}

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

/**
 * A subtotal for whatever subset is on screen.
 *
 * Average Compliance Rate is the mean of each person's rate, so rolling stores
 * up means weighting each store's rate by its headcount — a plain mean of the
 * store percentages would let an 18-person store pull as hard as a 51-person
 * one.
 *
 * The weight is applied to `exactRate`, not to the rounded percentage the row
 * displays. Using the rounded figure runs about a third of a point low, which
 * printed Tennessee as 88% when its people average 89% — small, but wrong in a
 * way nobody would catch by eye.
 */
function subtotal(stores: ZuStore[]): ZuStats {
  const people = stores.reduce((t, s) => t + s.people, 0);
  const weighted = (pick: (s: ZuStore) => number | null) => {
    if (people === 0) return null;
    const sum = stores.reduce((t, s) => t + (pick(s) ?? 0) * s.people, 0);
    return sum / people;
  };
  return {
    complianceRate: weighted((s) => s.exactRate ?? s.complianceRate),
    people,
    compliant: stores.reduce((t, s) => t + s.compliant, 0),
    noncompliant: stores.reduce((t, s) => t + s.noncompliant, 0),
    complianceScore: null,
    averageCourses: Math.round(weighted((s) => s.averageCourses) ?? 0),
    totalTime: "",
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZUClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

  const [report, setReport] = useState<ZuReport | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<string>("");
  const [storeId, setStoreId] = useState<string>(ALL_STORES);
  const [showTN, setShowTN] = useState(true);
  const [showVA, setShowVA] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Record<string, MemberState>>({});

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
      // A refresh re-reads Schoox, so any roster already on screen is stale.
      if (refresh) setMembers({});
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

  const toggleRow = useCallback(
    (store: ZuStore) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(store.unitId)) next.delete(store.unitId);
        else next.add(store.unitId);
        return next;
      });

      // Fetched once per store and kept, so collapsing and reopening a row is
      // instant rather than another round trip to Schoox.
      setMembers((prev) => {
        if (prev[store.unitId]) return prev;
        void (async () => {
          try {
            const res = await fetch(`/api/zu/members?unitId=${encodeURIComponent(store.unitId)}`);
            const data = (await res.json()) as { members?: ZuMember[]; error?: string };
            setMembers((m) => ({
              ...m,
              [store.unitId]: res.ok && data.members ? data.members : "error",
            }));
          } catch {
            setMembers((m) => ({ ...m, [store.unitId]: "error" }));
          }
        })();
        return { ...prev, [store.unitId]: "loading" };
      });
    },
    [],
  );

  const allStores = report ? sortStores(report.stores) : [];
  const visible = allStores.filter((s) => {
    const market = marketOf(s.label);
    if (market === "TN" && !showTN) return false;
    if (market === "VA" && !showVA) return false;
    return storeId === ALL_STORES || s.storeId === storeId;
  });

  // Schoox's own academy figure when everything is on screen; a weighted
  // subtotal otherwise, so the bottom row always describes the rows above it.
  const showingEverything = report !== null && visible.length === allStores.length;
  const totals = report
    ? showingEverything
      ? report.total
      : subtotal(visible)
    : null;
  const totalsLabel = showingEverything
    ? "All Stores"
    : showTN && !showVA
      ? "Tennessee"
      : showVA && !showTN
        ? "Virginia"
        : "Selected";

  const COLUMNS = 6;

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

          <div className="flex flex-wrap items-center justify-end gap-3 flex-1 min-w-0">
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
              {allStores.map((s) => (
                <option key={s.storeId || s.unitId} value={s.storeId}>
                  {s.label}
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showVA}
                onChange={(e) => setShowVA(e.target.checked)}
                className="rounded border-gray-300"
              />
              VA
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTN}
                onChange={(e) => setShowTN(e.target.checked)}
                className="rounded border-gray-300"
              />
              TN
            </label>

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

        {status === "done" && report && (
          <section>
            <CopyableTitle title="AVERAGE COMPLIANCE RATE BY STORE" targetRef={tableRef} />
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
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Noncompliant</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500">Avg Courses</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS} className="px-4 py-6 text-center text-sm text-gray-500">
                        No stores match the current filters.
                      </td>
                    </tr>
                  )}

                  {visible.map((s, i) => {
                    const prev = visible[i - 1];
                    const newMarket = i > 0 && marketOf(s.label) !== marketOf(prev.label);
                    const isOpen = expanded.has(s.unitId);
                    const roster = members[s.unitId];

                    return (
                      <Fragment key={s.storeId || s.unitId}>
                        <tr
                          onClick={() => toggleRow(s)}
                          className={`cursor-pointer hover:bg-gray-50 ${
                            newMarket ? "border-t-2 border-gray-300" : "border-t border-gray-100"
                          } ${isOpen ? "bg-gray-50" : ""}`}
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
                            {num(s.people)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.compliant)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.noncompliant)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.averageCourses)}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="border-t border-gray-100">
                            <td colSpan={COLUMNS} className="bg-gray-50 px-4 py-3">
                              {roster === "loading" && (
                                <p className="text-xs text-gray-500">Loading {s.label}&apos;s team…</p>
                              )}
                              {roster === "error" && (
                                <p className="text-xs text-red-700">
                                  Couldn&apos;t load {s.label}&apos;s team.
                                </p>
                              )}
                              {Array.isArray(roster) && roster.length === 0 && (
                                <p className="text-xs text-gray-500">No people at {s.label}.</p>
                              )}
                              {Array.isArray(roster) && roster.length > 0 && (
                                <table className="w-full border-collapse text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <th className="px-2 py-1 text-left font-medium text-gray-500">
                                        Name
                                      </th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">
                                        Courses
                                      </th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">
                                        Completions
                                      </th>
                                      <th className="px-2 py-1 text-right font-medium text-gray-500">
                                        Compliance Rate
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {roster.map((m) => (
                                      <tr key={m.id} className="border-t border-gray-100">
                                        <td className="px-2 py-1 whitespace-nowrap text-gray-800">
                                          {m.name}
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                                          {num(m.totalCourses)}
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                                          {num(m.completions)}
                                        </td>
                                        <td
                                          className={`px-2 py-1 text-right tabular-nums font-medium ${rateColor(
                                            m.complianceRate,
                                          )}`}
                                        >
                                          {fmtPct(m.complianceRate)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {totals && visible.length > 0 && (
                    <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                      <td className="px-4 py-2 whitespace-nowrap">{totalsLabel}</td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${rateColor(
                          totals.complianceRate,
                        )}`}
                      >
                        {fmtPct(totals.complianceRate)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(totals.people)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(totals.compliant)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(totals.noncompliant)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(totals.averageCourses)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
