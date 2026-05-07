"use client";

import { useState, useCallback, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from "recharts";
import { FISCAL_YEAR_START, currentPeriod, PERIODS, resolveRange, type RangeKey } from "@/lib/fiscal";

const LOCATION_IDS = [425, 868, 869, 689, 901, 950, 886, 771, 632, 465, 1137, 1002];
const TN_STORES = ["Springfield", "White House", "Brentwood", "Spring Hill", "Columbia"];
const VA_STORES = ["Jefferson", "Oyster", "Hampton", "College", "Chesapeake", "Hillcrest", "Beach"];

type LocationData = {
  locationName: string;
  locationId: number;
  actualCostPct: number | null;
  actualCostDollars: number | null;
  variancePct: number | null;
  varianceDollars: number | null;
};

type ItemData = {
  name: string;
  actualCostDollars: number | null;
  actualCostPct: number | null;
  varianceDollars: number | null;
  variancePct: number | null;
};

type DateOption = {
  label: string;
  startDate: string;
  endDate: string;
};

type PeriodPoint = Record<string, number | null | string>;

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null, decimals = 1): string {
  if (v === null) return "—";
  if (v < 0) return `(${Math.abs(v).toFixed(decimals)}%)`;
  return `${v.toFixed(decimals)}%`;
}

function fmtDollars(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return v < 0 ? `(${abs})` : abs;
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

// ── Color helpers ─────────────────────────────────────────────────────────────

function actualColor(v: number | null): string {
  if (v === null) return "text-gray-400";
  if (v <= 28.5) return "text-green-600";
  if (v <= 30.0) return "text-yellow-600";
  return "text-red-600";
}

function actualBg(v: number | null): string {
  if (v === null) return "";
  if (v <= 28.5) return "bg-green-50";
  if (v <= 30.0) return "bg-yellow-50";
  return "bg-red-50";
}

function varianceColor(v: number | null): string {
  if (v === null) return "text-gray-400";
  if (v >= -1.0 && v <= 1.0) return "text-green-600";
  if (v >= -1.5 && v <= 1.5) return "text-yellow-600";
  return "text-red-600";
}

function varianceBg(v: number | null): string {
  if (v === null) return "";
  if (v >= -1.0 && v <= 1.0) return "bg-green-50";
  if (v >= -1.5 && v <= 1.5) return "bg-yellow-50";
  return "bg-red-50";
}

// ── Period dropdown options ────────────────────────────────────────────────────

const HISTORY_RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "last_period", label: "Last Period" },
  { key: "qtd",         label: "Quarter to Date" },
  ...PERIODS.map(p => ({ key: `p${p.period}` as RangeKey, label: `P${p.period} (Full)` })),
];

function rangeToHistoryParams(key: RangeKey): { start: string; end?: string } {
  const { range } = resolveRange(key);
  const [startPart, endPart] = range.split(" : ").map(s => s.trim());
  const start = startPart.split("T")[0];
  if (endPart === "now") return { start };
  const endDate = endPart.split("T")[0];
  const endTime = endPart.split("T")[1] ?? "";
  if (endTime.startsWith("00:00:00")) {
    const [y, m, d] = endDate.split("-").map(Number);
    const adj = new Date(y, m - 1, d - 1);
    return { start, end: `${adj.getFullYear()}-${String(adj.getMonth()+1).padStart(2,"0")}-${String(adj.getDate()).padStart(2,"0")}` };
  }
  return { start, end: endDate };
}

// ── History chart ─────────────────────────────────────────────────────────────

const STORE_COLORS = [
  "#dc2626","#2563eb","#16a34a","#d97706","#7c3aed","#0891b2",
  "#db2777","#65a30d","#ea580c","#0284c7","#9333ea","#0d9488",
];

function YTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {v.toFixed(1)}%
    </text>
  );
}

function RefLineLabel({ viewBox, color, text }: { viewBox?: { x: number; y: number; width: number }; color: string; text: string }) {
  if (!viewBox) return null;
  return (
    <text x={(viewBox.x + viewBox.width) + 10} y={viewBox.y} fill={color} fontWeight={600} fontSize={10} textAnchor="start" dominantBaseline="middle">
      {text}
    </text>
  );
}

function buildYTicks(yMax: number): number[] {
  // 5 evenly spaced ticks — reference values (1.0, 1.5) are handled by ReferenceLine labels
  const regular = Array.from({ length: 5 }, (_, i) => Math.round((i * yMax / 4) * 10) / 10);
  return [...new Set(regular)].sort((a, b) => a - b);
}

function PeriodTooltip({ active, payload, label }: { active?: boolean; payload?: {dataKey: string; value: number | null; color: string}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload]
    .filter(p => p.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs max-h-72 overflow-y-auto">
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 flex-1">{p.dataKey}</span>
          <span className="font-medium tabular-nums text-gray-800">{fmtPct(p.value, 2)}</span>
        </div>
      ))}
    </div>
  );
}

function HistoryChart() {
  const [points, setPoints] = useState<PeriodPoint[]>([]);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [visibleStores, setVisibleStores] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch("/api/netchef/period-history")
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length) {
          const arr = data as PeriodPoint[];
          setPoints(arr);
          setStatus("done");
          setVisibleStores(new Set(Object.keys(arr[0]).filter(k => k !== "label")));
        } else {
          console.warn("[HistoryChart] unexpected:", data);
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mt-6 h-20 flex items-center justify-center">
      <span className="text-xs text-gray-400 animate-pulse">Loading trend…</span>
    </div>
  );

  if (status === "error" || !points.length) return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mt-6 h-14 flex items-center justify-center">
      <span className="text-xs text-gray-400">{status === "error" ? "Trend failed to load — check server logs" : "No trend data"}</span>
    </div>
  );

  const storeNames = Object.keys(points[0]).filter(k => k !== "label");
  const axisStyle = { fontSize: 10, fill: "#9ca3af" };

  const visibleMax = points.reduce((max, pt) => {
    for (const name of storeNames) {
      if (visibleStores.has(name)) {
        const v = pt[name];
        if (typeof v === "number" && v > max) max = v;
      }
    }
    return max;
  }, 0);
  const yMax = Math.max(2, Math.ceil((visibleMax + 0.25) / 2) * 2);
  const yTicks = buildYTicks(yMax);

  const renderDot = (color: string) => (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g/>;
    const isLast = index === points.length - 1;
    return <circle key={index} cx={cx} cy={cy} r={isLast ? 4 : 3} fill={isLast ? color : "white"} stroke={color} strokeWidth={2} />;
  };

  const toggleStore = (name: string) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return new Set(s);
    });
  };

  const toggleGroup = (group: string[], checked: boolean) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      for (const name of group) {
        if (storeNames.includes(name)) {
          if (checked) s.add(name); else s.delete(name);
        }
      }
      return new Set(s);
    });
  };

  const tnNames = TN_STORES.filter(n => storeNames.includes(n));
  const vaNames = VA_STORES.filter(n => storeNames.includes(n));
  const tnAll = tnNames.length > 0 && tnNames.every(n => visibleStores.has(n));
  const vaAll = vaNames.length > 0 && vaNames.every(n => visibleStores.has(n));

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 mt-6">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Variance Trend — by Store — Absolute Value</p>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={points} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <ReferenceLine y={1} stroke="#16a34a" strokeDasharray="5 3" strokeWidth={1.5} label={<RefLineLabel color="#16a34a" text="1.0%" />} />
          <ReferenceLine y={1.5} stroke="#dc2626" strokeDasharray="5 3" strokeWidth={1.5} label={<RefLineLabel color="#dc2626" text="1.5%" />} />
          <XAxis dataKey="label" tick={axisStyle} />
          <YAxis tick={<YTick />} domain={[0, yMax]} ticks={yTicks} width={40} />
          <Tooltip content={<PeriodTooltip />} />
          {storeNames.map((name, i) =>
            visibleStores.has(name) ? (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={STORE_COLORS[i % STORE_COLORS.length]}
                strokeWidth={1.5}
                dot={renderDot(STORE_COLORS[i % STORE_COLORS.length])}
                connectNulls
              />
            ) : null
          )}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
            <input
              type="checkbox"
              checked={tnAll}
              onChange={e => toggleGroup(TN_STORES, e.target.checked)}
              className="rounded border-gray-300"
            />
            TN
          </label>
          {tnNames.map(name => {
            const idx = storeNames.indexOf(name);
            return (
              <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleStores.has(name)}
                  onChange={() => toggleStore(name)}
                  style={{ accentColor: STORE_COLORS[idx % STORE_COLORS.length] }}
                  className="rounded border-gray-300"
                />
                {name}
              </label>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
            <input
              type="checkbox"
              checked={vaAll}
              onChange={e => toggleGroup(VA_STORES, e.target.checked)}
              className="rounded border-gray-300"
            />
            VA
          </label>
          {vaNames.map(name => {
            const idx = storeNames.indexOf(name);
            return (
              <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={visibleStores.has(name)}
                  onChange={() => toggleStore(name)}
                  style={{ accentColor: STORE_COLORS[idx % STORE_COLORS.length] }}
                  className="rounded border-gray-300"
                />
                {name}
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Rank table ────────────────────────────────────────────────────────────────

function RankTable({
  title,
  rows,
  pctKey,
  dollarsKey,
  colorFn,
  bgFn,
  loading,
  loadingCount,
  expandable,
  itemMode = "variance",
  pctDecimals = 1,
  startDate,
  endDate,
  expandedIds,
  itemsCache,
  onToggle,
}: {
  title: string;
  rows: LocationData[];
  pctKey: keyof LocationData;
  dollarsKey: keyof LocationData;
  colorFn: (v: number | null) => string;
  bgFn: (v: number | null) => string;
  loading: boolean;
  loadingCount?: number;
  expandable?: boolean;
  itemMode?: "actual" | "variance";
  pctDecimals?: number;
  startDate?: string;
  endDate?: string;
  expandedIds?: Set<number>;
  itemsCache?: Record<number, ItemData[] | "loading" | "error">;
  onToggle?: (row: LocationData) => void;
}) {
  const green  = rows.filter(r => colorFn(r[pctKey] as number | null).includes("green")).length;
  const yellow = rows.filter(r => colorFn(r[pctKey] as number | null).includes("yellow")).length;
  const red    = rows.filter(r => colorFn(r[pctKey] as number | null).includes("red")).length;

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-800">{title}</h2>
        {rows.length > 0 && (
          <div className="flex items-center gap-2 text-xs shrink-0">
            <span className="text-green-600 font-medium">{green} beat</span>
            <span className="text-gray-300">·</span>
            <span className="text-yellow-600 font-medium">{yellow} on target</span>
            <span className="text-gray-300">·</span>
            <span className="text-red-600 font-medium">{red} over</span>
          </div>
        )}
      </div>
      {loading && rows.length === 0 ? (
        <div>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-gray-50 animate-pulse">
              <div className="h-4 bg-gray-100 rounded w-6" />
              <div className="h-4 bg-gray-100 rounded flex-1" />
              <div className="h-4 bg-gray-100 rounded w-16" />
              <div className="h-4 bg-gray-100 rounded w-16" />
            </div>
          ))}
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">$</th>
              <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const pct      = row[pctKey] as number | null;
              const dollars  = row[dollarsKey] as number | null;
              const isOpen   = expandedIds?.has(row.locationId) ?? false;
              const rowItems = itemsCache?.[row.locationId];
              return (
                <Fragment key={row.locationId}>
                  <tr
                    className={`border-b border-gray-50 ${bgFn(pct)} ${expandable ? "cursor-pointer hover:brightness-95" : ""}`}
                    onClick={() => expandable && onToggle?.(row)}
                  >
                    <td className="px-3 py-3 text-right text-xs text-gray-400 tabular-nums">{i + 1}.</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{row.locationName}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtDollars(dollars)}</td>
                    <td className={`px-4 py-3 text-right font-semibold tabular-nums ${colorFn(pct)}`}>{fmtPct(pct, pctDecimals)}</td>
                  </tr>
                  {isOpen && rowItems === "loading" && (
                    <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-2 text-xs text-gray-400 animate-pulse">Loading…</td></tr>
                  )}
                  {isOpen && rowItems === "error" && (
                    <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-2 text-xs text-red-500">Failed to load items</td></tr>
                  )}
                  {isOpen && Array.isArray(rowItems) && rowItems.length === 0 && (
                    <tr className="bg-gray-50"><td colSpan={4} className="px-4 py-2 text-xs text-gray-400">No item data for this period</td></tr>
                  )}
                  {isOpen && Array.isArray(rowItems) && rowItems.map((item, j) => (
                    <tr key={`item-${j}`} className="bg-gray-50 border-t border-gray-100">
                      <td className="px-3 py-1.5" />
                      <td className="pl-4 pr-4 py-1.5 text-xs text-gray-600">{item.name}</td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">
                        {itemMode === "actual" ? fmtDollars(item.actualCostDollars) : fmtDollars(item.varianceDollars)}
                      </td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">
                        {itemMode === "actual" ? fmtPct(item.actualCostPct) : fmtPct(item.variancePct, pctDecimals)}
                      </td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            {loading && (loadingCount ?? 0) > 0 && (
              <tr className="border-b border-gray-50">
                <td colSpan={4} className="px-4 py-2.5 text-xs text-gray-400 animate-pulse text-center">
                  Loading {loadingCount} more…
                </td>
              </tr>
            )}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">No data</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FoodCostClient() {
  const router = useRouter();
  const [dateOptions, setDateOptions] = useState<DateOption[]>([]);
  const [datesLoading, setDatesLoading] = useState(true);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [locMap, setLocMap]       = useState<Record<number, LocationData>>({});
  const [loadingIds, setLoadingIds] = useState<Set<number>>(new Set());
  const [reportMeta, setReportMeta] = useState<{ startDate: string; endDate: string; fetchedAt: number } | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [activeQuick, setActiveQuick] = useState<string | null>(null);

  const [expandedIds, setExpandedIds]       = useState<Set<number>>(new Set());
  const [cogsItemsCache, setCogsItemsCache] = useState<Record<number, ItemData[] | "loading" | "error">>({});
  const [varItemsCache,  setVarItemsCache]  = useState<Record<number, ItemData[] | "loading" | "error">>({});

  const fetchData = useCallback(async (start: string, end: string, bust = false) => {
    if (!start || !end) return;
    setLocMap({});
    setLoadingIds(new Set(LOCATION_IDS));
    setError(null);
    setExpandedIds(new Set());
    setCogsItemsCache({});
    setVarItemsCache({});
    setReportMeta({ startDate: start, endDate: end, fetchedAt: Date.now() });

    const bustParam = bust ? "&bust=1" : "";
    await Promise.all(LOCATION_IDS.map(async id => {
      try {
        const res = await fetch(`/api/netchef/data?start=${start}&end=${end}&locationId=${id}${bustParam}`);
        if (res.status === 401) { router.push("/login"); return; }
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load location");
        setLocMap(prev => ({ ...prev, [id]: json as LocationData }));
      } catch (err) {
        console.error("[FoodCost] failed loc", id, err);
      } finally {
        setLoadingIds(prev => {
          const n = new Set(prev);
          n.delete(id);
          if (n.size === 0) setReportMeta(m => m ? { ...m, fetchedAt: Date.now() } : m);
          return n;
        });
      }
    }));
  }, [router]);

  useEffect(() => {
    fetch("/api/netchef/dates")
      .then(async r => {
        const data = await r.json();
        if (!r.ok || !Array.isArray(data)) {
          setError(`Failed to load date options: ${data?.error ?? JSON.stringify(data)}`);
          return;
        }
        if (data.length) {
          setDateOptions(data);
          const prior = data[1] ?? data[0];
          setStartDate(prior.startDate);
          setEndDate(prior.endDate);
          setActiveQuick("last_week");
          fetchData(prior.startDate, prior.endDate);
        }
      })
      .catch(err => setError(`Network error loading dates: ${err?.message ?? err}`))
      .finally(() => setDatesLoading(false));
  }, [fetchData]);

  const startOptions = dateOptions.map(o => o.startDate);
  const endOptions   = dateOptions.map(o => o.endDate);

  const setLastWeek = () => {
    const opt = dateOptions[1] ?? dateOptions[0];
    if (opt) { setStartDate(opt.startDate); setEndDate(opt.endDate); setActiveQuick("last_week"); fetchData(opt.startDate, opt.endDate); }
  };

  const setYTD = () => {
    const ytdStart = [...dateOptions].reverse().find(o => o.startDate >= FISCAL_YEAR_START)?.startDate;
    const ytdEnd   = (dateOptions[1] ?? dateOptions[0])?.endDate;
    if (ytdStart && ytdEnd) { setStartDate(ytdStart); setEndDate(ytdEnd); setActiveQuick("ytd"); fetchData(ytdStart, ytdEnd); }
  };

  const setPTD = () => {
    const cp = currentPeriod();
    const ptdStart = [...dateOptions].reverse().find(o => o.startDate >= cp.start)?.startDate;
    const ptdEnd   = (dateOptions[1] ?? dateOptions[0])?.endDate;
    if (ptdStart && ptdEnd) { setStartDate(ptdStart); setEndDate(ptdEnd); setActiveQuick("ptd"); fetchData(ptdStart, ptdEnd); }
  };

  const handlePeriodSelect = (key: RangeKey) => {
    const { start, end } = rangeToHistoryParams(key);
    const resolvedEnd = end ?? (dateOptions[1] ?? dateOptions[0])?.endDate ?? "";
    if (start && resolvedEnd) {
      setStartDate(start);
      setEndDate(resolvedEnd);
      setActiveQuick(null);
      fetchData(start, resolvedEnd);
    }
  };

  const handleToggle = useCallback((row: LocationData) => {
    const id = row.locationId;
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); return next; }
      next.add(id);
      return next;
    });
    const base = `/api/netchef/items?locationId=${id}&start=${startDate}&end=${endDate}`;
    if (!cogsItemsCache[id]) {
      setCogsItemsCache(prev => ({ ...prev, [id]: "loading" }));
      fetch(`${base}&mode=actual`)
        .then(r => r.json())
        .then((d: ItemData[]) => setCogsItemsCache(prev => ({ ...prev, [id]: d })))
        .catch(() => setCogsItemsCache(prev => ({ ...prev, [id]: "error" })));
    }
    if (!varItemsCache[id]) {
      setVarItemsCache(prev => ({ ...prev, [id]: "loading" }));
      fetch(`${base}&mode=variance`)
        .then(r => r.json())
        .then((d: ItemData[]) => setVarItemsCache(prev => ({ ...prev, [id]: d })))
        .catch(() => setVarItemsCache(prev => ({ ...prev, [id]: "error" })));
    }
  }, [cogsItemsCache, varItemsCache, startDate, endDate]);

  const allLocations = Object.values(locMap);
  const loading = loadingIds.size > 0;

  const byActual = [...allLocations]
    .filter(l => l.actualCostPct !== null)
    .sort((a, b) => (a.actualCostPct ?? 0) - (b.actualCostPct ?? 0));

  const byVariance = [...allLocations]
    .filter(l => l.variancePct !== null)
    .sort((a, b) => Math.abs(a.variancePct ?? 0) - Math.abs(b.variancePct ?? 0));

  const fetchedLabel = reportMeta
    ? `${fmtDate(reportMeta.startDate)} – ${fmtDate(reportMeta.endDate)} · ${new Date(reportMeta.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="flex flex-col">
              <div className="relative w-fit">
                <select
                  value="/food-cost"
                  onChange={e => router.push(e.target.value)}
                  className="text-base font-semibold text-gray-900 leading-tight bg-transparent border-0 p-0 m-0 pr-5 w-full appearance-none cursor-pointer focus:outline-none focus:ring-0 [text-align-last:center]"
                >
                  <option value="/dashboard">Drive-Thru</option>
                  <option value="/food-cost">Food Cost</option>
                </select>
                <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {fetchedLabel && <p className="text-xs text-gray-400 leading-tight">{fetchedLabel}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {[
                { key: "last_week", label: "Last Week", fn: setLastWeek },
                { key: "ptd",       label: "PTD",       fn: setPTD },
                { key: "ytd",       label: "YTD",       fn: setYTD },
              ].map(o => (
                <button
                  key={o.key}
                  onClick={o.fn}
                  disabled={datesLoading}
                  className={`text-xs px-3 py-1.5 transition disabled:opacity-50 ${
                    activeQuick === o.key
                      ? "bg-red-700 text-white font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>

            <select
              value=""
              onChange={e => { if (e.target.value) handlePeriodSelect(e.target.value as RangeKey); }}
              disabled={loading || datesLoading}
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-600 disabled:opacity-50"
            >
              <option value="">Period…</option>
              {HISTORY_RANGE_OPTIONS.map(o => (
                <option key={o.key} value={o.key}>{o.label}</option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <select value={startDate} onChange={e => { setStartDate(e.target.value); setActiveQuick(null); }} disabled={loading || datesLoading}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-300">
                {datesLoading && <option>Loading…</option>}
                {startOptions.map(s => <option key={s} value={s}>{fmtDate(s)}</option>)}
              </select>
              <span className="text-xs text-gray-400">to</span>
              <select value={endDate} onChange={e => { setEndDate(e.target.value); setActiveQuick(null); }} disabled={loading || datesLoading}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-300">
                {datesLoading && <option>Loading…</option>}
                {endOptions.map(e => <option key={e} value={e}>{fmtDate(e)}</option>)}
              </select>
            </div>

            <button onClick={() => fetchData(startDate, endDate)} disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition">
              {loading ? "Fetching…" : "Fetch"}
            </button>
            {reportMeta && (
              <button onClick={() => fetchData(startDate, endDate, true)} disabled={loading}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition">
                Refresh
              </button>
            )}
            <button
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          {allLocations.length > 0 && (
            <>
              <span className="text-gray-600"><strong className="text-gray-900">{allLocations.length}</strong> locations</span>
              <span className="text-gray-300">·</span>
            </>
          )}
          <span className="text-gray-500">
            COGS&nbsp;
            <span className="text-green-600 font-medium">≤28.5%</span>
            {" / "}
            <span className="text-yellow-600 font-medium">≤30.0%</span>
            {" / "}
            <span className="text-red-600 font-medium">&gt;30.0%</span>
          </span>
          <span className="text-gray-300">·</span>
          <span className="flex items-center gap-1.5 text-gray-500">
            Variance
            <span className="flex text-xs font-medium rounded overflow-hidden border border-gray-200 leading-none">
              <span className="bg-red-100 text-red-700 px-1.5 py-1 whitespace-nowrap">&lt; (1.5%)</span>
              <span className="bg-yellow-100 text-yellow-700 px-1.5 py-1 whitespace-nowrap border-l border-gray-200">(1.5%) to (1.0%)</span>
              <span className="bg-green-100 text-green-700 px-2 py-1 whitespace-nowrap border-l border-gray-200">(1.0%) to 1.0%</span>
              <span className="bg-yellow-100 text-yellow-700 px-1.5 py-1 whitespace-nowrap border-l border-gray-200">1.0% to 1.5%</span>
              <span className="bg-red-100 text-red-700 px-1.5 py-1 whitespace-nowrap border-l border-gray-200">&gt; 1.5%</span>
            </span>
          </span>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading && (
          <div className="mb-6 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
            Loading {allLocations.length}/{LOCATION_IDS.length} locations…
          </div>
        )}
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => fetchData(startDate, endDate)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}
        {allLocations.length === 0 && !loading && !error && (
          <div className="text-center py-20 text-gray-400 text-sm">Select a date range and click Fetch to load food cost data.</div>
        )}

        {(allLocations.length > 0 || loading) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RankTable
              title="COGS"
              rows={byActual}
              pctKey="actualCostPct"
              dollarsKey="actualCostDollars"
              colorFn={actualColor}
              bgFn={actualBg}
              loading={loading}
              loadingCount={loadingIds.size}
              expandable
              itemMode="actual"
              startDate={startDate}
              endDate={endDate}
              expandedIds={expandedIds}
              itemsCache={cogsItemsCache}
              onToggle={handleToggle}
            />
            <RankTable
              title="Variance"
              rows={byVariance}
              pctKey="variancePct"
              dollarsKey="varianceDollars"
              colorFn={varianceColor}
              bgFn={varianceBg}
              loading={loading}
              loadingCount={loadingIds.size}
              expandable
              pctDecimals={2}
              startDate={startDate}
              endDate={endDate}
              expandedIds={expandedIds}
              itemsCache={varItemsCache}
              onToggle={handleToggle}
            />
          </div>
        )}

        <HistoryChart />
      </main>
    </div>
  );
}
