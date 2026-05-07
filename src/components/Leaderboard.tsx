"use client";

import { useEffect, useState } from "react";
import { BranchStore, StoreMetrics, parseMMSS, laneColor, windowColor } from "@/lib/berry";
import { getStoreLabel } from "@/lib/stores";
import { formatRangeDates, getLastWeekRange, resolveRange, RangeKey } from "@/lib/fiscal";

type Metric = "lane_total" | "window_service";

type Props = {
  branches: BranchStore[];
  metric: Metric;
  stores?: StoreMetrics[];
  rangeKey: RangeKey;
  onRangeChange: (key: RangeKey) => void;
};

const METRIC_CONFIG: Record<Metric, {
  title: string;
  getValue: (s: StoreMetrics) => string | null;
  colorFn: (secs: number | null) => string;
}> = {
  lane_total: {
    title: "Lane Total",
    getValue: (s) => s.overall.lane_total,
    colorFn: laneColor,
  },
  window_service: {
    title: "Window",
    getValue: (s) => s.overall.window_service,
    colorFn: windowColor,
  },
};

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "today",     label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "wtd",       label: "WTD" },
  { key: "last_week", label: "Last Week" },
  { key: "mtd",       label: "PTD" },
  { key: "ytd",       label: "YTD" },
];

type RankedStore = {
  label: string;
  val: string | null;
  secs: number | null;
};

function findBranch(branches: BranchStore[], storeNameAndId: string): BranchStore | null {
  for (const b of branches) {
    if (`${b.name} - ${b.client_branch_id}` === storeNameAndId) return b;
    if (b.client_branch_id && storeNameAndId.includes(b.client_branch_id)) return b;
  }
  return null;
}

export default function Leaderboard({ branches, metric, stores: prefetched, rangeKey, onRangeChange }: Props) {
  const [ranked, setRanked] = useState<RankedStore[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateLabel, setDateLabel] = useState("");
  const config = METRIC_CONFIG[metric];

  useEffect(() => {
    function rank(stores: StoreMetrics[], range: string) {
      const rows: RankedStore[] = stores.map((s) => {
        const branch = findBranch(branches, s.store_name_and_id);
        const label = branch ? getStoreLabel(branch) : s.store_name_and_id;
        const val = config.getValue(s);
        return { label, val, secs: parseMMSS(val) };
      });
      // Fastest (lowest seconds) at the top
      rows.sort((a, b) => {
        if (a.secs == null && b.secs == null) return 0;
        if (a.secs == null) return 1;
        if (b.secs == null) return -1;
        return a.secs - b.secs;
      });
      setRanked(rows);
      setDateLabel(formatRangeDates(range));
      setLoading(false);
    }

    // Use prefetched data for last_week to avoid a duplicate fetch on initial load
    if (rangeKey === "last_week" && prefetched) {
      rank(prefetched, getLastWeekRange().range);
      return;
    }

    setLoading(true);
    fetch(`/api/berry/data?range=${rangeKey}`)
      .then((r) => r.json())
      .then(({ stores, time_range }: { stores: StoreMetrics[]; time_range: string }) => {
        if (Array.isArray(stores)) rank(stores, time_range ?? resolveRange(rangeKey).range);
      })
      .catch(() => setLoading(false));
  }, [branches, metric, rangeKey, prefetched]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-900">{config.title}</h2>
        <select
          value={rangeKey}
          onChange={(e) => onRangeChange(e.target.value as RangeKey)}
          className="text-xs text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 bg-white focus:outline-none focus:ring-1 focus:ring-red-600 cursor-pointer"
        >
          {RANGE_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
      </div>
      {dateLabel && (
        <p className="text-xs text-gray-400 mb-3">{dateLabel}</p>
      )}

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 13 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="w-5 h-3 bg-gray-100 rounded animate-pulse shrink-0" />
              <div className="flex-1 h-3 bg-gray-100 rounded animate-pulse" />
              <div className="w-10 h-3 bg-gray-100 rounded animate-pulse shrink-0" />
            </div>
          ))}
        </div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {ranked.map((store, i) => (
            <li key={store.label} className="flex items-center gap-2 min-w-0">
              <span className="text-xs text-gray-400 tabular-nums w-5 shrink-0 text-right">
                {i + 1}.
              </span>
              <span className="text-xs text-gray-700 flex-1 truncate">{store.label}</span>
              <span className={`text-xs font-semibold tabular-nums shrink-0 ${config.colorFn(store.secs)}`}>
                {store.val ?? "—"}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
