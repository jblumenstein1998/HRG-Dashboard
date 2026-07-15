"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { BranchStore } from "@/lib/berry";
import { groupBranches, getStoreLabel, SectionedBranches } from "@/lib/stores";

type WeeklyStorePoint = {
  lane_total_secs: number | null;
  window_service_secs: number | null;
  menu_board_secs: number | null;
  flagged_pull_forward: number | null;
};

type WeeklyHistoryPoint = {
  weekKey: string;
  label: string;
  start: string;
  end: string;
  stores: Record<string, WeeklyStorePoint>;
};

// Canonical per-store colors — kept identical across SMG, Drive-Thru trend, and Food Cost variance charts.
const STORE_COLOR: Record<string, string> = {
  "Columbia":       "#dc2626",
  "Springfield":    "#2563eb",
  "White House":    "#16a34a",
  "Brentwood":      "#d97706",
  "Spring Hill":    "#7c3aed",
  "Jefferson":      "#0891b2",
  "Oyster":         "#db2777",
  "Hampton":        "#65a30d",
  "College":        "#ea580c",
  "Chesapeake":     "#0284c7",
  "Hillcrest":      "#9333ea",
  "Beach":          "#0d9488",
};

const axisStyle = { fontSize: 10, fill: "#9ca3af" };

function niceStep(range: number, targetCount = 5): number {
  if (range <= 0) return 5;
  const raw = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return norm < 1.5 ? 1 * mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
}

function fmtSecs(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function findWeekValue(branch: BranchStore, stores: Record<string, WeeklyStorePoint>): WeeklyStorePoint | null {
  const key = `${branch.name} - ${branch.client_branch_id}`;
  if (stores[key]) return stores[key];
  if (branch.client_branch_id) {
    for (const k of Object.keys(stores)) {
      if (k.includes(branch.client_branch_id)) return stores[k];
    }
  }
  return null;
}

function YTickTime({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {fmtSecs(v)}
    </text>
  );
}

function YTickCount({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {v.toFixed(0)}
    </text>
  );
}

function TrendTooltip({ active, payload, label, isTime }: {
  active?: boolean;
  payload?: { name?: string; value: number | null; color: string }[];
  label?: string;
  isTime: boolean;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.value != null).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 flex-1">{p.name}</span>
          <span className="font-medium tabular-nums text-gray-800">
            {p.value == null ? "—" : isTime ? fmtSecs(p.value) : p.value.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({
  title,
  points,
  sections,
  storeColor,
  metric,
  isTime,
}: {
  title: string;
  points: WeeklyHistoryPoint[];
  sections: SectionedBranches;
  storeColor: (branch: BranchStore) => string;
  metric: keyof WeeklyStorePoint;
  isTime: boolean;
}) {
  const storeOrder = sections.flatMap(s => s.branches);
  const [visibleStores, setVisibleStores] = useState<Set<string>>(
    new Set(storeOrder.map(b => getStoreLabel(b)))
  );

  const rows = points.map(pt => {
    const row: Record<string, string | number | null> = { label: pt.label };
    for (const b of storeOrder) {
      const v = findWeekValue(b, pt.stores);
      row[getStoreLabel(b)] = v?.[metric] ?? null;
    }
    return row;
  });

  let visibleMin = Infinity;
  let visibleMax = -Infinity;
  for (const row of rows) {
    for (const b of storeOrder) {
      const name = getStoreLabel(b);
      if (!visibleStores.has(name)) continue;
      const v = row[name];
      if (typeof v === "number") {
        if (v < visibleMin) visibleMin = v;
        if (v > visibleMax) visibleMax = v;
      }
    }
  }
  const hasVisibleData = Number.isFinite(visibleMin) && Number.isFinite(visibleMax);
  const floorAtZero = !isTime;

  // Time metrics zoom to fit the visible data (a tight 180-240s cluster shouldn't be
  // squashed against a 0-anchored axis); the count metric floors at 0 since it can't be negative.
  const rawRange = hasVisibleData ? Math.max(visibleMax - visibleMin, 1) : isTime ? 60 : 10;
  const step = niceStep(rawRange);
  const yMin = floorAtZero
    ? 0
    : hasVisibleData ? Math.floor(visibleMin / step) * step : 0;
  const target = hasVisibleData ? visibleMax : step * 5;
  const yMax = Math.max(Math.ceil(target / step) * step, yMin + step);
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);

  const renderDot = (color: string) => (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g />;
    const isLast = index === rows.length - 1;
    return <circle key={index} cx={cx} cy={cy} r={isLast ? 4 : 3} fill={isLast ? color : "white"} stroke={color} strokeWidth={2} />;
  };

  const toggleStore = (name: string) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });
  };

  const toggleGroup = (group: BranchStore[], checked: boolean) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      for (const b of group) {
        const name = getStoreLabel(b);
        if (checked) s.add(name); else s.delete(name);
      }
      return s;
    });
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{title}</p>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} />
          <YAxis
            tick={isTime ? <YTickTime /> : <YTickCount />}
            domain={[yMin, yMax]}
            ticks={yTicks}
            width={isTime ? 44 : 36}
          />
          <Tooltip content={<TrendTooltip isTime={isTime} />} />
          {storeOrder.map(b => {
            const name = getStoreLabel(b);
            if (!visibleStores.has(name)) return null;
            const color = storeColor(b);
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                strokeWidth={1.5}
                dot={renderDot(color)}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        {sections.map(({ section, branches: sectionBranches }) => {
          if (sectionBranches.length === 0) return null;
          const groupLabel = section === "Tennessee" ? "TN" : "VA";
          const groupChecked = sectionBranches.every(b => visibleStores.has(getStoreLabel(b)));
          return (
            <div key={section} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
                <input
                  type="checkbox"
                  checked={groupChecked}
                  onChange={e => toggleGroup(sectionBranches, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {groupLabel}
              </label>
              {sectionBranches.map(b => {
                const name = getStoreLabel(b);
                const color = storeColor(b);
                return (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleStores.has(name)}
                      onChange={() => toggleStore(name)}
                      style={{ accentColor: color }}
                      className="rounded border-gray-300"
                    />
                    {name}
                  </label>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DriveThruTrendCharts({ branches }: { branches: BranchStore[] }) {
  const [points, setPoints] = useState<WeeklyHistoryPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/berry/weekly-history")
      .then(async r => {
        if (!r.ok) { setError("Failed to load weekly history"); return; }
        setPoints(await r.json());
      })
      .catch(() => setError("Failed to load weekly history"));
  }, []);

  if (branches.length === 0) return null;

  const sections = groupBranches(branches);
  const storeColor = (b: BranchStore) => STORE_COLOR[getStoreLabel(b)] ?? "#6b7280";

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 mt-6 text-center text-sm text-gray-400">
        {error}
      </div>
    );
  }

  if (!points) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-4 mt-6 h-20 flex items-center justify-center">
        <span className="text-xs text-gray-400 animate-pulse">Loading weekly trend (2026 P1–P6)…</span>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      <TrendChart title="Lane Total — Weekly, 2026 P1–P6" points={points} sections={sections} storeColor={storeColor} metric="lane_total_secs" isTime />
      <TrendChart title="Window Time — Weekly, 2026 P1–P6" points={points} sections={sections} storeColor={storeColor} metric="window_service_secs" isTime />
      <TrendChart title="Menu Time — Weekly, 2026 P1–P6" points={points} sections={sections} storeColor={storeColor} metric="menu_board_secs" isTime />
      <TrendChart title="Flagged Pull-Forward Cars — Weekly, 2026 P1–P6" points={points} sections={sections} storeColor={storeColor} metric="flagged_pull_forward" isTime={false} />
    </div>
  );
}
