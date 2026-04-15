"use client";

import { BranchStore, StoreMetrics, parseMMSS, laneColor, preMenuColor, windowColor } from "@/lib/berry";
import { getStoreLabel } from "@/lib/stores";

type Props = {
  branch: BranchStore;
  metrics: StoreMetrics | null;
  loading: boolean;
  rangeLabel: string;
  viewMode: "summary" | "daypart";
};

function badge(secs: number | null) {
  if (secs == null) return { label: "No data", cls: "bg-gray-100 text-gray-400" };
  if (secs <= 210) return { label: "On Target", cls: "bg-green-50 text-green-700" };
  if (secs <= 240) return { label: "Near Target", cls: "bg-yellow-50 text-yellow-700" };
  return { label: "Over Target", cls: "bg-red-50 text-red-700" };
}

function Skeleton({ w = "w-10", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} bg-gray-100 rounded animate-pulse`} />;
}

export default function LocationCard({ branch, metrics, loading, rangeLabel, viewMode }: Props) {
  const overallSecs = parseMMSS(metrics?.overall.lane_total);
  const b = badge(overallSecs);
  const label = getStoreLabel(branch);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{label}</h3>
          {branch.location && (
            <p className="text-xs text-gray-400 mt-0.5 truncate">{branch.location}</p>
          )}
        </div>
        {loading
          ? <Skeleton w="w-20" h="h-5" />
          : <span className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${b.cls}`}>{b.label}</span>
        }
      </div>

      {viewMode === "summary" ? (
        <SummaryView metrics={metrics} loading={loading} overallSecs={overallSecs} />
      ) : (
        <DaypartView metrics={metrics} loading={loading} />
      )}
    </div>
  );
}

function SummaryView({
  metrics,
  loading,
  overallSecs,
}: {
  metrics: StoreMetrics | null;
  loading: boolean;
  overallSecs: number | null;
}) {
  return (
    <>
      {/* Overall hero */}
      <div className="flex items-end gap-4">
        <div>
          <p className="text-xs text-gray-400 mb-0.5">Lane Total</p>
          {loading
            ? <Skeleton w="w-24" h="h-9" />
            : <span className={`text-3xl font-bold tabular-nums ${laneColor(overallSecs)}`}>
                {metrics?.overall.lane_total ?? "—"}
              </span>
          }
        </div>
        <div className="pb-1">
          <p className="text-xs text-gray-400 mb-0.5">Cars</p>
          {loading
            ? <Skeleton w="w-14" h="h-6" />
            : <span className="text-xl font-semibold text-gray-700 tabular-nums">
                {metrics?.overall.total_cars != null
                  ? Math.round(metrics.overall.total_cars).toLocaleString()
                  : "—"}
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
                  colorFn={laneColor}
                  secs={parseMMSS(data?.lane_total)}
                  loading={loading}
                />
                <MetricRow
                  label="Pre-menu"
                  val={data?.pre_menu_queue}
                  colorFn={preMenuColor}
                  secs={parseMMSS(data?.pre_menu_queue)}
                  loading={loading}
                />
                <MetricRow
                  label="Window"
                  val={data?.window_service}
                  colorFn={windowColor}
                  secs={parseMMSS(data?.window_service)}
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
}: {
  metrics: StoreMetrics | null;
  loading: boolean;
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
        <p className="text-xs text-gray-400 text-right">Pre-menu</p>
        <p className="text-xs text-gray-400 text-right">Window</p>
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
                  <p className={`text-xs font-semibold tabular-nums text-right ${laneColor(parseMMSS(row?.lane_total))}`}>
                    {row?.lane_total ?? "—"}
                  </p>
                  <p className="text-xs font-semibold tabular-nums text-right text-gray-700">
                    {row?.total_cars != null ? Math.round(row.total_cars).toLocaleString() : "—"}
                  </p>
                  <p className={`text-xs font-semibold tabular-nums text-right ${preMenuColor(parseMMSS(row?.pre_menu_queue))}`}>
                    {row?.pre_menu_queue ?? "—"}
                  </p>
                  <p className={`text-xs font-semibold tabular-nums text-right ${windowColor(parseMMSS(row?.window_service))}`}>
                    {row?.window_service ?? "—"}
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
  secs,
  colorFn,
  loading,
}: {
  label: string;
  val: string | null | undefined;
  secs: number | null;
  colorFn: (secs: number | null) => string;
  loading: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs text-gray-400">{label}</p>
      {loading
        ? <Skeleton w="w-10" />
        : <p className={`text-xs font-semibold tabular-nums ${colorFn(secs)}`}>{val ?? "—"}</p>
      }
    </div>
  );
}
