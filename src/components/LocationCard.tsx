"use client";

import { Branch } from "@/lib/berry";

type DriveThruMetrics = {
  avg_time?: number | null;
  total_cars?: number | null;
  target_time?: number | null;
  [key: string]: unknown;
};

type Props = {
  branch: Branch;
  metrics: DriveThruMetrics | null;
  loading: boolean;
};

function formatSeconds(secs: number | null | undefined): string {
  if (secs == null) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function getTimeColor(avg: number | null | undefined, target: number | null | undefined): string {
  if (avg == null) return "text-gray-400";
  if (target == null) return "text-gray-900";
  if (avg <= target) return "text-green-600";
  if (avg <= target * 1.15) return "text-yellow-600";
  return "text-red-600";
}

function getBadgeColor(avg: number | null | undefined, target: number | null | undefined): string {
  if (avg == null) return "bg-gray-100 text-gray-500";
  if (target == null) return "bg-gray-100 text-gray-700";
  if (avg <= target) return "bg-green-50 text-green-700";
  if (avg <= target * 1.15) return "bg-yellow-50 text-yellow-700";
  return "bg-red-50 text-red-700";
}

function getStatusLabel(avg: number | null | undefined, target: number | null | undefined): string {
  if (avg == null) return "No data";
  if (target == null) return "Active";
  if (avg <= target) return "On Target";
  if (avg <= target * 1.15) return "Near Target";
  return "Over Target";
}

export default function LocationCard({ branch, metrics, loading }: Props) {
  const avg = metrics?.avg_time;
  const target = metrics?.target_time;
  const totalCars = metrics?.total_cars;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 truncate">{branch.name}</h3>
          {branch.location && (
            <p className="text-xs text-gray-500 mt-0.5 truncate">{branch.location}</p>
          )}
        </div>
        {!loading && (
          <span
            className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${getBadgeColor(avg, target)}`}
          >
            {getStatusLabel(avg, target)}
          </span>
        )}
        {loading && (
          <span className="shrink-0 h-5 w-20 bg-gray-100 rounded-full animate-pulse" />
        )}
      </div>

      {/* Main metric */}
      <div className="flex items-end gap-3">
        {loading ? (
          <div className="h-9 w-24 bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <span className={`text-3xl font-bold tabular-nums ${getTimeColor(avg, target)}`}>
            {formatSeconds(avg)}
          </span>
        )}
        <div className="pb-1 text-xs text-gray-500">
          {loading ? (
            <div className="h-3 w-16 bg-gray-100 rounded animate-pulse" />
          ) : (
            <>avg MTD</>
          )}
        </div>
      </div>

      {/* Secondary metrics */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-gray-100">
        <div>
          <p className="text-xs text-gray-500">Target</p>
          {loading ? (
            <div className="h-4 w-12 bg-gray-100 rounded animate-pulse mt-0.5" />
          ) : (
            <p className="text-sm font-medium text-gray-700">{formatSeconds(target)}</p>
          )}
        </div>
        <div>
          <p className="text-xs text-gray-500">Cars MTD</p>
          {loading ? (
            <div className="h-4 w-12 bg-gray-100 rounded animate-pulse mt-0.5" />
          ) : (
            <p className="text-sm font-medium text-gray-700">
              {totalCars != null ? totalCars.toLocaleString() : "—"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
