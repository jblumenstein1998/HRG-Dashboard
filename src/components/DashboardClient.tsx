"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import LocationCard from "./LocationCard";
import DriveThruTrendCharts from "./DriveThruTrendCharts";
import { BranchStore, StoreMetrics, parseMMSS } from "@/lib/berry";
import { RangeKey, PERIODS } from "@/lib/fiscal";
import { groupBranches, getStoreLabel, getStoreSection } from "@/lib/stores";
import { CopyableTitle } from "@/components/CopyImageButton";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS, fmtGoalSecs, goalColor, lookupMetric } from "@/lib/salesTierGoals";

const QUICK_TOGGLE: { key: RangeKey; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "wtd",       label: "WTD" },
  { key: "last_week", label: "Last Week" },
  { key: "t7",        label: "T7" },
  { key: "mtd",       label: "PTD" },
  { key: "ytd",       label: "YTD" },
];

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "last_period", label: "Last Period" },
  { key: "qtd",         label: "Quarter to Date" },
  ...PERIODS.map((p) => ({ key: `p${p.period}` as RangeKey, label: `P${p.period} (Full)` })),
];

export default function DashboardClient() {
  const router = useRouter();
  const latestFetchId = useRef(0);
  const branchesLoaded = useRef(false);
  const [rangeKey, setRangeKey] = useState<RangeKey>("yesterday");
  const [rangeLabel, setRangeLabel] = useState("");
  const [viewMode, setViewMode] = useState<"summary" | "daypart">("summary");
  const [branches, setBranches] = useState<BranchStore[]>([]);
  const [metricsMap, setMetricsMap] = useState<Map<string, StoreMetrics>>(new Map());
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(true);
  const [revealedCount, setRevealedCount] = useState(0);
  const revealTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [salesByStoreId, setSalesByStoreId] = useState<Record<string, number>>({});
  const [productivityByStoreId, setProductivityByStoreId] = useState<Record<string, number | null>>({});
  const [driveThruLabel, setDriveThruLabel] = useState("");
  const [salesLabel, setSalesLabel] = useState("");
  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);

  const fetchData = useCallback(async (key: RangeKey, bust = false) => {
    const fetchId = ++latestFetchId.current;
    setDataLoading(true);
    setError(null);

    const bustParam = bust ? "&bust=1" : "";
    const needsBranches = !branchesLoaded.current || bust;
    if (needsBranches) setBranchesLoading(true);

    const tasks: Promise<void>[] = [
      fetch(`/api/berry/data?range=${key}${bustParam}`).then(async res => {
        if (fetchId !== latestFetchId.current) return; // superseded by a newer selection
        if (res.status === 401) { router.push("/login"); return; }
        if (res.ok) {
          const payload = await res.json() as { stores: StoreMetrics[]; range_label: string };
          const { stores, range_label } = payload;
          console.log("[HRG] data fetch", key, "stores:", stores?.length, "keys:", stores?.slice(0,3).map(s=>s.store_name_and_id));
          setRangeLabel(range_label);
          const map = new Map<string, StoreMetrics>();
          for (const s of stores) {
            if (s.store_name_and_id) map.set(s.store_name_and_id, s);
          }
          console.log("[HRG] metricsMap size:", map.size);
          setMetricsMap(map);
        } else {
          const d = await res.json().catch(() => ({}));
          console.error("[HRG] data fetch error:", res.status, d);
          setError(d.error ?? "Failed to load metrics");
        }
        setDataLoading(false);
      }),
    ];

    if (needsBranches) {
      tasks.push(
        fetch("/api/berry/branches").then(async res => {
          if (fetchId !== latestFetchId.current) return;
          if (res.status === 401) { router.push("/login"); return; }
          if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setError(d.error ?? "Failed to load locations");
            setBranchesLoading(false);
            return;
          }
          const branchList: BranchStore[] = await res.json();
          setBranches(branchList);
          branchesLoaded.current = true;
          setBranchesLoading(false);
        })
      );
    }

    await Promise.all(tasks);
  }, [router]);

  useEffect(() => { fetchData(rangeKey); }, [rangeKey, fetchData]);

  // Net sales / productivity per store, keyed to the selected range — feeds both
  // the sales-tier cards and the sales-volume-based coloring on each location card.
  useEffect(() => {
    fetch(`/api/par/sales-tier?range=${rangeKey}`)
      .then(r => r.json())
      .then(d => {
        setSalesByStoreId(d.salesByStoreId ?? {});
        setProductivityByStoreId(d.productivityByStoreId ?? {});
        setDriveThruLabel(d.driveThruLabel ?? "");
        setSalesLabel(d.salesLabel ?? "");
      })
      .catch(err => console.error("[DriveThru] sales-tier fetch failed", err));
  }, [rangeKey]);

  const visibleBranches = branches.filter(b => {
    const section = getStoreSection(b);
    return (section === "Virginia" && showVA) || (section === "Tennessee" && showTN);
  });

  // Stagger card reveal after data loads — cards pop in one-by-one at 60ms each
  useEffect(() => {
    if (revealTimer.current) { clearInterval(revealTimer.current); revealTimer.current = null; }
    if (dataLoading || visibleBranches.length === 0) { setRevealedCount(0); return; }
    let count = 0;
    revealTimer.current = setInterval(() => {
      count++;
      setRevealedCount(count);
      if (count >= visibleBranches.length) { clearInterval(revealTimer.current!); revealTimer.current = null; }
    }, 60);
    return () => { if (revealTimer.current) { clearInterval(revealTimer.current); revealTimer.current = null; } };
  }, [dataLoading, visibleBranches.length]);

  function handleRangeChange(key: RangeKey) {
    setRangeKey(key);
    // state update triggers the useEffect above — no direct fetchData call needed
  }

  function getMetrics(branch: BranchStore): StoreMetrics | null {
    const key = `${branch.name} - ${branch.client_branch_id}`;
    if (metricsMap.has(key)) return metricsMap.get(key)!;
    if (branch.client_branch_id) {
      for (const [k, v] of metricsMap) {
        if (k.includes(branch.client_branch_id)) return v;
      }
    }
    return null;
  }

  // Debug: log first branch key vs first map key once both are loaded
  if (branches.length > 0 && metricsMap.size > 0) {
    const b = branches[0];
    const constructed = `${b.name} - ${b.client_branch_id}`;
    const firstMapKey = metricsMap.keys().next().value;
    if (!metricsMap.has(constructed) && !Array.from(metricsMap.keys()).some(k => b.client_branch_id && k.includes(b.client_branch_id))) {
      console.warn("[HRG] KEY MISMATCH — branch key:", constructed, "| map key sample:", firstMapKey);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  function handleExport() {
    const DP_INDICES = [1, 2, 3, 4, 5, 6];
    const headers = [
      "Store",
      "Range",
      "Overall Lane",
      "Peak Lane",
      "Nonpeak Lane",
      ...DP_INDICES.map((i) => `DP${i} Lane`),
      "Overall Pre-Menu",
      "Peak Pre-Menu",
      "Nonpeak Pre-Menu",
      ...DP_INDICES.map((i) => `DP${i} Pre-Menu`),
      "Overall Window",
      "Peak Window",
      "Nonpeak Window",
      ...DP_INDICES.map((i) => `DP${i} Window`),
      "Total Cars",
      ...DP_INDICES.map((i) => `DP${i} Cars`),
    ];

    const rows = Array.from(metricsMap.values()).map((s) => {
      const dpMap = new Map(s.dayparts.map((d) => [d.index, d]));
      return [
        s.store_name_and_id,
        rangeLabel,
        // Lane
        s.overall.lane_total ?? "",
        s.peak.lane_total ?? "",
        s.nonpeak.lane_total ?? "",
        ...DP_INDICES.map((i) => dpMap.get(i)?.lane_total ?? ""),
        // Pre-menu
        s.overall.pre_menu_queue ?? "",
        s.peak.pre_menu_queue ?? "",
        s.nonpeak.pre_menu_queue ?? "",
        ...DP_INDICES.map((i) => dpMap.get(i)?.pre_menu_queue ?? ""),
        // Window
        s.overall.window_service ?? "",
        s.peak.window_service ?? "",
        s.nonpeak.window_service ?? "",
        ...DP_INDICES.map((i) => dpMap.get(i)?.window_service ?? ""),
        // Cars
        s.overall.total_cars != null ? Math.round(s.overall.total_cars) : "",
        ...DP_INDICES.map((i) => {
          const dp = dpMap.get(i);
          return dp?.total_cars != null ? Math.round(dp.total_cars) : "";
        }),
      ];
    });

    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hrg-audit-${rangeLabel.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-10">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="flex flex-col">
              <div className="relative w-fit">
                <select
                  value="/dashboard"
                  onChange={e => router.push(e.target.value)}
                  className="text-base font-semibold text-gray-900 leading-tight bg-transparent border-0 p-0 m-0 pr-5 w-full appearance-none cursor-pointer focus:outline-none focus:ring-0 [text-align-last:center]"
                >
                  <option value="/dashboard">Drive-Thru</option>
                  <option value="/food-cost">Food Cost</option>
                  <option value="/par">POS Sales</option>
                  <option value="/smg">SMG</option>
                </select>
                <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            {/* WTD / PTD quick toggle */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {QUICK_TOGGLE.map(o => (
                <button
                  key={o.key}
                  onClick={() => handleRangeChange(o.key)}
                  className={`text-xs px-3 py-1.5 transition ${
                    rangeKey === o.key
                      ? "bg-red-700 text-white font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {/* Historical range dropdown */}
            <select
              value={RANGE_OPTIONS.some(o => o.key === rangeKey) ? rangeKey : ""}
              onChange={(e) => { if (e.target.value) handleRangeChange(e.target.value as RangeKey); }}
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              <option value="">Period…</option>
              {RANGE_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => fetchData(rangeKey, true)}
              disabled={dataLoading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              {dataLoading ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={handleLogout}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {!branchesLoading && branches.length > 0 && (
        <div className="bg-gray-50 border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-xs">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-500">
              {driveThruLabel && <span>Drive-thru / Productivity: <span className="font-medium text-gray-700">{driveThruLabel}</span></span>}
              {driveThruLabel && salesLabel && <span className="text-gray-300">·</span>}
              {salesLabel && <span>Sales: <span className="font-medium text-gray-700">{salesLabel}</span></span>}
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2.5">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showVA} onChange={e => setShowVA(e.target.checked)} className="rounded border-gray-300" />
                  VA
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showTN} onChange={e => setShowTN(e.target.checked)} className="rounded border-gray-300" />
                  TN
                </label>
              </div>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
                {(["summary", "daypart"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    className={`text-xs px-3 py-1.5 transition ${
                      viewMode === mode
                        ? "bg-gray-800 text-white font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {mode === "summary" ? "Summary" : "By Daypart"}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        )}
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-xs text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => fetchData(rangeKey)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        <SalesTierTable
          branches={visibleBranches}
          getMetrics={getMetrics}
          loading={dataLoading || branchesLoading}
          salesByStoreId={salesByStoreId}
          productivityByStoreId={productivityByStoreId}
        />

        <div className="flex flex-col gap-6 items-start">
          {/* Cards grid */}
          <div className="flex-1 min-w-0 w-full">
            {branchesLoading && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                    <div className="flex justify-between mb-3">
                      <div className="h-4 bg-gray-100 rounded w-1/2" />
                      <div className="h-5 bg-gray-100 rounded-full w-20" />
                    </div>
                    <div className="h-9 bg-gray-100 rounded w-1/2 mb-4" />
                    <div className="grid grid-cols-4 gap-2 pt-3 border-t border-gray-100">
                      {[0,1,2,3].map(j => <div key={j} className="h-3 bg-gray-100 rounded" />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!branchesLoading && visibleBranches.length > 0 && (() => {
              let gIdx = 0;
              return (
                <div className="flex flex-col gap-8">
                  {groupBranches(visibleBranches).map(({ section, branches: sectionBranches }) =>
                    sectionBranches.length > 0 ? (
                      <div key={section}>
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
                          {section}
                        </h2>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {sectionBranches.map(branch => {
                            const visible = gIdx++ < revealedCount;
                            const salesForTier = lookupMetric(branch, getMetrics(branch), salesByStoreId) ?? null;
                            return (
                              <LocationCard
                                key={branch.id}
                                branch={branch}
                                metrics={visible ? getMetrics(branch) : null}
                                loading={!visible}
                                rangeLabel={rangeLabel}
                                viewMode={viewMode}
                                salesForTier={visible ? salesForTier : null}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              );
            })()}

            {!branchesLoading && visibleBranches.length === 0 && !error && (
              <div className="text-center py-20 text-gray-400">
                <p className="text-lg font-medium">No locations found</p>
              </div>
            )}
          </div>
        </div>

        <DriveThruTrendCharts branches={visibleBranches} />
      </main>
    </div>
  );
}

// ── Sales tier table ──────────────────────────────────────────────────────────
// Sales/productivity are pulled live from PAR (see /api/par/sales-tier), keyed
// to whichever range is selected at the top of the page — see getSalesTierData
// for the weekly-equivalent sales rule and why productivity always uses the
// raw drive-thru range instead. Tier thresholds live in @/lib/salesTierGoals so
// LocationCard can reuse the same goals to color the overall lane/window times.

function SalesTierTable({
  branches,
  getMetrics,
  loading,
  salesByStoreId,
  productivityByStoreId,
}: {
  branches: BranchStore[];
  getMetrics: (b: BranchStore) => StoreMetrics | null;
  loading: boolean;
  salesByStoreId: Record<string, number>;
  productivityByStoreId: Record<string, number | null>;
}) {
  const gridRef = useRef<HTMLDivElement>(null);

  if (loading || branches.length === 0) return null;

  function buildTiers(
    tiers: { label: string; test: (v: number) => boolean; greenMax: number; yellowMax: number }[],
    metricField: "lane_total" | "window_service",
  ) {
    return tiers
      .map(tier => ({
        label: tier.label,
        metricField,
        greenMax: tier.greenMax,
        yellowMax: tier.yellowMax,
        branches: branches
          .filter(b => {
            const sales = lookupMetric(b, getMetrics(b), salesByStoreId);
            return sales != null && tier.test(sales);
          })
          .sort((a, b) => {
            const ta = parseMMSS(getMetrics(a)?.overall[metricField]);
            const tb = parseMMSS(getMetrics(b)?.overall[metricField]);
            if (ta == null && tb == null) return 0;
            if (ta == null) return 1;
            if (tb == null) return -1;
            return ta - tb;
          }),
      }));
  }

  const totalTimeTiered = buildTiers(TOTAL_TIME_TIERS, "lane_total");
  const windowTimeTiered = buildTiers(WINDOW_TIME_TIERS, "window_service");

  return (
    <div className="mb-6">
      <div ref={gridRef} className="flex flex-col sm:flex-row items-start gap-6">
        {totalTimeTiered.length > 0 && (
          <div className="flex-1 min-w-0 w-full">
            <CopyableTitle title="Total Time" targetRef={gridRef} className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-2" heightBufferPx={40} />
            <div className="flex flex-wrap items-start gap-4">
              {totalTimeTiered.map(tier => (
                <SalesTierCard key={`lane_total-${tier.label}`} tier={tier} getMetrics={getMetrics} salesByStoreId={salesByStoreId} productivityByStoreId={productivityByStoreId} />
              ))}
            </div>
          </div>
        )}
        {windowTimeTiered.length > 0 && (
          <div className="flex-1 min-w-0 w-full">
            <CopyableTitle title="Window Time" targetRef={gridRef} className="text-xs font-bold uppercase tracking-widest text-gray-700 mb-2" heightBufferPx={40} />
            <div className="flex flex-wrap items-start gap-4">
              {windowTimeTiered.map(tier => (
                <SalesTierCard key={`window_service-${tier.label}`} tier={tier} getMetrics={getMetrics} salesByStoreId={salesByStoreId} productivityByStoreId={productivityByStoreId} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SalesTierCard({
  tier,
  getMetrics,
  salesByStoreId,
  productivityByStoreId,
}: {
  tier: { label: string; metricField: "lane_total" | "window_service"; greenMax: number; yellowMax: number; branches: BranchStore[] };
  getMetrics: (b: BranchStore) => StoreMetrics | null;
  salesByStoreId: Record<string, number>;
  productivityByStoreId: Record<string, number | null>;
}) {
  return (
    <div className="w-[calc(50%-8px)] bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50">
        <p className="text-sm font-bold uppercase tracking-widest text-gray-900">{tier.label}</p>
        <p className="text-xs text-gray-600 mt-0.5">
          Goal: <span className="text-green-600 font-semibold">≤{fmtGoalSecs(tier.greenMax)}</span>
          {" · "}
          <span className="text-yellow-600 font-semibold">≤{fmtGoalSecs(tier.yellowMax)}</span>
        </p>
      </div>
      <div className="divide-y divide-gray-50">
        {tier.branches.length === 0 && (
          <div className="px-4 py-3 text-[13px] text-gray-400">No stores</div>
        )}
        {tier.branches.map(branch => {
          const m = getMetrics(branch);
          const sales = lookupMetric(branch, m, salesByStoreId);
          const productivity = lookupMetric(branch, m, productivityByStoreId);
          const metricValue = m?.overall[tier.metricField] ?? null;
          return (
            <div key={branch.id} className="flex items-center justify-between px-4 py-2 hover:bg-gray-50 transition-colors">
              <div>
                <p className="text-[13px] font-medium text-gray-900 leading-tight">{getStoreLabel(branch)}</p>
                {sales != null && (
                  <p className="text-[11px] text-gray-600 tabular-nums">
                    Net Sales: ${Math.round(sales).toLocaleString()}
                  </p>
                )}
                {productivity != null && (
                  <p className="text-[11px] text-gray-600 tabular-nums">
                    Productivity: ${productivity.toFixed(2)}
                  </p>
                )}
              </div>
              <span className={`text-[15px] font-semibold tabular-nums ${goalColor(parseMMSS(metricValue), tier.greenMax, tier.yellowMax)}`}>
                {metricValue ?? "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

