"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { SMG_TREND_DATA, SMG_METRICS, SMG_STORES, type SmgMetricKey, type SmgWeekPoint } from "@/lib/smgTrendData";
import { SMG_TREND_DATA_MONTHLY } from "@/lib/smgTrendDataMonthly";

const STORE_COLORS = [
  "#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed",
];
const COMBINED_COLOR = "#374151";

const DASH_BY_METRIC: Record<SmgMetricKey, string | undefined> = {
  overall: undefined,
  temperature: "6 3",
  accuracy: "2 2",
  friendliness: "8 3 2 3",
  cleanliness: "1 3",
  problem: "10 3",
  count: "4 2 1 2",
};

const axisStyle = { fontSize: 10, fill: "#9ca3af" };

function DashSwatch({ color, dash }: { color: string; dash?: string }) {
  return (
    <svg width="20" height="8" className="shrink-0">
      <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth={2} strokeDasharray={dash} />
    </svg>
  );
}

function YTick({ x, y, payload, isPercent }: { x?: number; y?: number; payload?: { value: number }; isPercent: boolean }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {isPercent ? `${v.toFixed(0)}%` : v.toFixed(0)}
    </text>
  );
}

function fmtMetric(v: number | null, isPercent: boolean): string {
  if (v === null || v === undefined) return "—";
  return isPercent ? `${v.toFixed(1)}%` : v.toFixed(0);
}

function SmgTooltip({ active, payload, label, isPercentByName }: {
  active?: boolean;
  payload?: { name?: string; value: number | null; color: string }[];
  label?: string;
  isPercentByName: Record<string, boolean>;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 flex-1">{p.name}</span>
          <span className="font-medium tabular-nums text-gray-800">{fmtMetric(p.value, p.name ? isPercentByName[p.name] ?? true : true)}</span>
        </div>
      ))}
    </div>
  );
}

function SmgTrendChart({ title, points }: { title: string; points: SmgWeekPoint[] }) {
  const [activeMetrics, setActiveMetrics] = useState<Set<SmgMetricKey>>(new Set(["overall"]));
  const [visibleStores, setVisibleStores] = useState<Set<string>>(new Set(SMG_STORES));
  const [showCombined, setShowCombined] = useState(true);

  const selectedMetrics = SMG_METRICS.filter(m => activeMetrics.has(m.key));
  const multiMetric = selectedMetrics.length > 1;
  const isPercent = selectedMetrics.length > 0 ? selectedMetrics.every(m => m.isPercent) : true;

  const seriesNames = [...SMG_STORES, "Combined"];

  let visibleMin = Infinity;
  let visibleMax = -Infinity;
  for (const pt of points) {
    for (const name of seriesNames) {
      if (name === "Combined" ? !showCombined : !visibleStores.has(name)) continue;
      for (const m of selectedMetrics) {
        const v = pt.stores[name]?.[m.key];
        if (typeof v === "number") {
          if (v < visibleMin) visibleMin = v;
          if (v > visibleMax) visibleMax = v;
        }
      }
    }
  }
  const hasVisibleData = Number.isFinite(visibleMin) && Number.isFinite(visibleMax);
  const yMin = hasVisibleData ? visibleMin - 5 : 0;
  const yMax = hasVisibleData ? visibleMax + 5 : isPercent ? 10 : 5;

  const renderDot = (color: string) => (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g />;
    const isLast = index === points.length - 1;
    return <circle key={index} cx={cx} cy={cy} r={isLast ? 4 : 3} fill={isLast ? color : "white"} stroke={color} strokeWidth={2} />;
  };

  const toggleStore = (name: string) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });
  };

  const toggleMetric = (key: SmgMetricKey) => {
    setActiveMetrics(prev => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key); else s.add(key);
      return s;
    });
  };

  const allSeriesChecked = visibleStores.size === SMG_STORES.length && showCombined;
  const toggleAllSeries = (checked: boolean) => {
    setVisibleStores(checked ? new Set(SMG_STORES) : new Set());
    setShowCombined(checked);
  };

  const lineName = (store: string, metricLabel: string) => (multiMetric ? `${store} — ${metricLabel}` : store);

  type LineSpec = { key: string; store: string; metric: SmgMetricKey; name: string; color: string };
  const lineSpecs: LineSpec[] = [];
  SMG_STORES.forEach((name, i) => {
    if (!visibleStores.has(name)) return;
    selectedMetrics.forEach(m => {
      lineSpecs.push({ key: `${name}-${m.key}`, store: name, metric: m.key, name: lineName(name, m.label), color: STORE_COLORS[i % STORE_COLORS.length] });
    });
  });
  if (showCombined) {
    selectedMetrics.forEach(m => {
      lineSpecs.push({ key: `combined-${m.key}`, store: "Combined", metric: m.key, name: lineName("Combined", m.label), color: COMBINED_COLOR });
    });
  }
  const isPercentByName: Record<string, boolean> = Object.fromEntries(
    lineSpecs.map(spec => [spec.name, SMG_METRICS.find(m => m.key === spec.metric)!.isPercent])
  );

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{title}</p>
        <div className="flex flex-wrap rounded-lg border border-gray-200 overflow-hidden">
          {SMG_METRICS.map(m => (
            <button
              key={m.key}
              onClick={() => toggleMetric(m.key)}
              className={`text-xs px-3 py-1.5 transition ${
                activeMetrics.has(m.key) ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={points} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} />
          <YAxis tick={<YTick isPercent={isPercent} />} domain={[yMin, yMax]} width={40} />
          <Tooltip content={<SmgTooltip isPercentByName={isPercentByName} />} />
          {lineSpecs.map(spec => (
            <Line
              key={spec.key}
              type="monotone"
              dataKey={(d: SmgWeekPoint) => d.stores[spec.store]?.[spec.metric] ?? null}
              name={spec.name}
              stroke={spec.color}
              strokeWidth={1.5}
              strokeDasharray={DASH_BY_METRIC[spec.metric]}
              dot={renderDot(spec.color)}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      {multiMetric && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {selectedMetrics.map(m => (
            <div key={m.key} className="flex items-center gap-1.5 text-xs text-gray-500">
              <DashSwatch color="#6b7280" dash={DASH_BY_METRIC[m.key]} />
              {m.label}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allSeriesChecked}
            onChange={e => toggleAllSeries(e.target.checked)}
            className="rounded border-gray-300"
          />
          All
        </label>
        {SMG_STORES.map((name, i) => (
          <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visibleStores.has(name)}
              onChange={() => toggleStore(name)}
              style={{ accentColor: STORE_COLORS[i % STORE_COLORS.length] }}
              className="rounded border-gray-300"
            />
            {name}
          </label>
        ))}
        <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none" style={{ color: COMBINED_COLOR }}>
          <input
            type="checkbox"
            checked={showCombined}
            onChange={() => setShowCombined(v => !v)}
            style={{ accentColor: COMBINED_COLOR }}
            className="rounded border-gray-300"
          />
          Combined
        </label>
      </div>
    </div>
  );
}

export default function SMGClient() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="relative w-fit">
              <select
                value="/smg"
                onChange={e => router.push(e.target.value)}
                className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
              >
                <option value="/dashboard">Drive-Thru</option>
                <option value="/guest-satisfaction">Guest Scores</option>
                <option value="/food-cost">Food Cost</option>
                <option value="/par">POS Sales</option>
                <option value="/smg">SMG</option>
              </select>
              <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            <button
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-6">
        <SmgTrendChart title="SMG Trend — by Store — Weekly" points={SMG_TREND_DATA} />
        <SmgTrendChart title="SMG Trend — by Store — Monthly" points={SMG_TREND_DATA_MONTHLY} />
      </main>
    </div>
  );
}
