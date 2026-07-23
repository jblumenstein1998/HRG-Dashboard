"use client";

import { BranchStore, StoreMetrics, parseMMSS } from "@/lib/berry";
import { salesTierColor } from "@/lib/salesTierGoals";
import { getStoreLabel } from "@/lib/stores";

type Props = {
  branch: BranchStore;
  metrics: StoreMetrics | null;
  loading: boolean;
  rangeLabel: string;
  viewMode: "summary" | "daypart";
  salesForTier: number | null;
};

function Skeleton({ w = "w-10", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-gray-100 rounded animate-pulse`} />;
}

export default function LocationCard({ branch, metrics, loading, rangeLabel, viewMode, salesForTier }: Props) {
  const label = getStoreLabel(branch);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-gray-900 truncate">{label}</h3>
        {branch.location && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{branch.location}</p>
        )}
      </div>

      {viewMode === "summary" ? (
        <SummaryView metrics={metrics} loading={loading} salesForTier={salesForTier} />
      ) : (
        <DaypartView metrics={metrics} loading={loading} salesForTier={salesForTier} />
      )}
    </div>
  );
}

function SummaryView({
  metrics,
  loading,
  salesForTier,
}: {
  metrics: StoreMetrics | null;
  loading: boolean;
  salesForTier: number | null;
}) {
  const overallSecs = parseMMSS(metrics?.overall.lane_total);
  const windowSecs = parseMMSS(metrics?.overall.window_service);

  return (
    <>
      {/* Overall hero */}
      <div className="flex items-end gap-4">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Lane Total</p>
          {loading
            ? <Skeleton w="w-20" h="h-8" />
            : <span className={`text-2xl font-bold tabular-nums ${salesTierColor(salesForTier, overallSecs, "lane_total")}`}>
                {metrics?.overall.lane_total ?? "—"}
              </span>
          }
        </div>
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Window</p>
          {loading
            ? <Skeleton w="w-16" h="h-8" />
            : <span className={`text-2xl font-bold tabular-nums ${salesTierColor(salesForTier, windowSecs, "window_service")}`}>
                {metrics?.overall.window_service ?? "—"}
              </span>
          }
        </div>
        <div className="pb-0.5">
          <p className="text-xs text-gray-400 mb-0.5">Cars</p>
          {loading
            ? <Skeleton w="w-10" h="h-5" />
            : <span className="text-base font-semibold text-gray-700 tabular-nums">
                {metrics?.overall.total_cars != null
                  ? Math.round(metrics.overall.total_cars).toLocaleString()
                  : "—"}
              </span>
          }
        </div>
        <div className="pb-0.5">
          <p className="text-xs text-gray-400 mb-0.5">Flagged</p>
          {loading
            ? <Skeleton w="w-10" h="h-5" />
            : <span className="text-base font-semibold text-gray-700 tabular-nums">
                {metrics?.overall.flagged_pull_forward != null
                  ? Math.round(metrics.overall.flagged_pull_forward).toLocaleString()
                  : "—"}
              </span>
          }
        </div>
        <div className="pb-0.5">
          <p className="text-xs text-gray-400 mb-0.5">Net Sales</p>
          {loading
            ? <Skeleton w="w-14" h="h-5" />
            : <span className="text-base font-semibold text-gray-700 tabular-nums">
                {salesForTier != null ? `$${Math.round(salesForTier).toLocaleString()}` : "—"}
              </span>
          }
        </div>
      </div>

      {/* Peak / Non-peak breakdown */}
      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
        {(["peak", "nonpeak"] as const).map((tier) => {
          const isPeak = tier === "peak";
          const data = metrics?.[tier];
          return (
            <div key={tier}>
              <p className="text-xs font-semibold mb-1.5 text-gray-700">
                {isPeak ? "Peak" : "Non-Peak"}
              </p>
              <div className="flex flex-col gap-1">
                <MetricRow
                  label="Lane"
                  val={data?.lane_total}
                  color={salesTierColor(salesForTier, parseMMSS(data?.lane_total), "lane_total")}
                  loading={loading}
                />
                <MetricRow
                  label="Window"
                  val={data?.window_service}
                  color={salesTierColor(salesForTier, parseMMSS(data?.window_service), "window_service")}
                  loading={loading}
                />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function DaypartView({
  metrics,
  loading,
  salesForTier,
}: {
  metrics: StoreMetrics | null;
  loading: boolean;
  salesForTier: number | null;
}) {
  // Use whatever dayparts Superset returned, sorted ascending
  const dayparts = [...(metrics?.dayparts ?? [])].sort((a, b) => a.index - b.index);
  const dpIndices = dayparts.length > 0 ? dayparts.map((d) => d.index) : [1, 2, 3, 4, 5];

  return (
    <div className="pt-1">
      <div className="grid grid-cols-5 gap-1 mb-1">
        <p className="text-xs text-gray-400">DP</p>
        <p className="text-xs text-gray-400 text-right">Lane</p>
        <p className="text-xs text-gray-400 text-right">Cars</p>
        <p className="text-xs text-gray-400 text-right">Window</p>
        <p className="text-xs text-gray-400 text-right">Flagged</p>
      </div>
      <div className="flex flex-col gap-1.5 border-t border-gray-100 pt-2">
        {dpIndices.map((dp) => {
          const isPeak = dp === 2 || dp === 4;
          const row = metrics?.dayparts.find((d) => d.index === dp);
          return (
            <div
              key={dp}
              className={`grid grid-cols-5 gap-1 rounded px-1 py-0.5 ${isPeak ? "bg-gray-50" : ""}`}
            >
              <p className={`text-xs font-medium ${isPeak ? "text-gray-700" : "text-gray-400"}`}>
                DP {dp}{isPeak ? " ★" : ""}
              </p>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex justify-end"><Skeleton w="w-8" /></div>
                ))
              ) : (
                <>
                  <p className={`text-xs font-semibold tabular-nums text-right ${salesTierColor(salesForTier, parseMMSS(row?.lane_total), "lane_total")}`}>
                    {row?.lane_total ?? "—"}
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-right text-gray-700">
                    {row?.total_cars != null ? Math.round(row.total_cars).toLocaleString() : "—"}
                  </p>
                  <p className={`text-xs font-semibold tabular-nums text-right ${salesTierColor(salesForTier, parseMMSS(row?.window_service), "window_service")}`}>
                    {row?.window_service ?? "—"}
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-right text-gray-700">
                    {row?.flagged_pull_forward != null ? Math.round(row.flagged_pull_forward).toLocaleString() : "—"}
                  </p>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MetricRow({
  label,
  val,
  color,
  loading,
}: {
  label: string;
  val: string | null | undefined;
  color: string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-gray-400">{label}</p>
      {loading
        ? <Skeleton w="w-10" />
        : <p className={`text-xs font-semibold tabular-nums ${color}`}>{val ?? "—"}</p>
      }
    </div>
  );
}
