"use client";

import { useEffect, useState } from "react";
import { BranchStore, StoreMetrics, parseMMSS, laneColor, windowColor } from "@/lib/berry";
import { getStoreLabel } from "@/lib/stores";
import { formatRangeDates, getLastWeekRange } from "@/lib/fiscal";

type Metric = "lane_total" | "window_service";

type Props = {
  branches: BranchStore[];
  metric: Metric;
  stores?: StoreMetrics[]; // pre-fetched data; if omitted the component fetches itself
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

export default function Leaderboard({ branches, metric, stores: prefetched }: Props) {
  const [ranked, setRanked] = useState<RankedStore[]>([]);
  const [loading, setLoading] = useState(!prefetched);
  const config = METRIC_CONFIG[metric];
  const dateLabel = formatRangeDates(getLastWeekRange().range);

  useEffect(() => {
    function rank(stores: StoreMetrics[]) {
      const rows: RankedStore[] = stores.map((s) => {
        const branch = findBranch(branches, s.store_name_and_id);
        const label = branch ? getStoreLabel(branch) : s.store_name_and_id;
        const val = config.getValue(s);
        return { label, val, secs: parseMMSS(val) };
      });
      rows.sort((a, b) => {
        if (a.secs == null && b.secs == null) return 0;
        if (a.secs == null) return 1;
        if (b.secs == null) return -1;
        return b.secs - a.secs;
      });
      setRanked(rows);
    }

    if (prefetched) {
      rank(prefetched);
      setLoading(false);
      return;
    }

    fetch("/api/berry/data?range=last_week")
      .then((r) => r.json())
      .then(({ stores }: { stores: StoreMetrics[] }) => {
        if (Array.isArray(stores)) rank(stores);
      })
      .finally(() => setLoading(false));
  }, [branches, metric, prefetched]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-gray-900">Last Week · {config.title}</h2>
        <p className="text-xs text-gray-400">{dateLabel} · slowest first</p>
      </div>

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
