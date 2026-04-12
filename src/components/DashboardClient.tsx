"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import LocationCard from "./LocationCard";
import { Branch } from "@/lib/berry";

type Metrics = {
  avg_time?: number | null;
  total_cars?: number | null;
  target_time?: number | null;
  [key: string]: unknown;
};

type ChartResult = {
  branch_id?: number;
  data?: Metrics;
  [key: string]: unknown;
};

function parseMetricsFromChart(raw: unknown, branchId: number): Metrics | null {
  if (!raw || typeof raw !== "object") return null;

  // Handle array of results (one per branch)
  if (Array.isArray(raw)) {
    const match = (raw as ChartResult[]).find(
      (r) => r.branch_id === branchId || r.id === branchId
    );
    if (match) return (match.data ?? match) as Metrics;
    // If single-element array and no branch_id, return first
    if (raw.length === 1) return (raw[0] as Metrics);
    return null;
  }

  // If the root object has a "data" array or "results" array
  const obj = raw as Record<string, unknown>;
  const items: unknown[] =
    (obj.data as unknown[]) ??
    (obj.results as unknown[]) ??
    (obj.branches as unknown[]) ??
    [];

  if (items.length > 0) {
    const match = (items as ChartResult[]).find(
      (r) => r.branch_id === branchId || r.id === branchId
    );
    if (match) return (match.data ?? match) as Metrics;
    return null;
  }

  // Flat object — assume it is the metrics directly
  return obj as Metrics;
}

export default function DashboardClient() {
  const router = useRouter();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [chartData, setChartData] = useState<unknown>(null);
  const [branchesLoading, setBranchesLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchData = useCallback(async () => {
    setBranchesLoading(true);
    setChartLoading(true);
    setError(null);

    try {
      const [branchesRes, chartRes] = await Promise.all([
        fetch("/api/berry/branches"),
        fetch("/api/berry/chart"),
      ]);

      if (branchesRes.status === 401 || chartRes.status === 401) {
        router.push("/login");
        return;
      }

      if (!branchesRes.ok) {
        const d = await branchesRes.json();
        throw new Error(d.error ?? "Failed to load branches");
      }

      const branchData = await branchesRes.json();
      // branches may be returned as array or wrapped in object
      const branchList: Branch[] = Array.isArray(branchData)
        ? branchData
        : (branchData.data ?? branchData.branches ?? []);
      setBranches(branchList);
      setBranchesLoading(false);

      if (chartRes.ok) {
        const cData = await chartRes.json();
        setChartData(cData);
      }
      setChartLoading(false);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setBranchesLoading(false);
      setChartLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const now = lastRefresh.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-700 flex items-center justify-center">
              <span className="text-white text-base font-bold">H</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-gray-900 leading-tight">
                HRG Dashboard
              </h1>
              <p className="text-xs text-gray-500 leading-tight hidden sm:block">
                Drive-Thru Performance · MTD
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">
              Updated {now}
            </span>
            <button
              onClick={fetchData}
              disabled={branchesLoading || chartLoading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              Refresh
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* Error banner */}
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button
              onClick={fetchData}
              className="text-xs font-medium underline underline-offset-2 shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {/* Summary bar */}
        {!branchesLoading && branches.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-4 text-sm text-gray-600">
            <span>
              <strong className="text-gray-900">{branches.length}</strong> locations
            </span>
            {!chartLoading && chartData != null && (
              <>
                <span>·</span>
                <span className="text-green-600 font-medium">
                  {
                    branches.filter((b) => {
                      const m = parseMetricsFromChart(chartData, b.id);
                      return m?.avg_time != null && m?.target_time != null && m.avg_time <= m.target_time;
                    }).length
                  }{" "}
                  on target
                </span>
                <span>·</span>
                <span className="text-red-600 font-medium">
                  {
                    branches.filter((b) => {
                      const m = parseMetricsFromChart(chartData, b.id);
                      return m?.avg_time != null && m?.target_time != null && m.avg_time > m.target_time * 1.15;
                    }).length
                  }{" "}
                  over target
                </span>
              </>
            )}
          </div>
        )}

        {/* Skeleton when loading branches */}
        {branchesLoading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-gray-200 p-5 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-3/4 mb-3" />
                <div className="h-9 bg-gray-100 rounded w-1/2 mb-4" />
                <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                  <div className="h-3 bg-gray-100 rounded" />
                  <div className="h-3 bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Locations grid */}
        {!branchesLoading && branches.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {branches.map((branch) => (
              <LocationCard
                key={branch.id}
                branch={branch}
                metrics={parseMetricsFromChart(chartData, branch.id)}
                loading={chartLoading}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!branchesLoading && branches.length === 0 && !error && (
          <div className="text-center py-20 text-gray-400">
            <p className="text-lg font-medium">No locations found</p>
            <p className="text-sm mt-1">The BerryAI API returned no branches for this account.</p>
          </div>
        )}
      </main>
    </div>
  );
}
