"use client";

import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Customized, LabelList, usePlotArea, useXAxisTicks, useYAxisScale } from "recharts";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";
import { FISCAL_YEAR_START, currentPeriod, PERIODS, resolveRange, type RangeKey } from "@/lib/fiscal";
import { STORE_COLOR } from "@/lib/surveyMeta";
import { CopyableTitle } from "@/components/CopyImageButton";

const LOCATION_IDS = [425, 868, 869, 689, 901, 950, 886, 771, 632, 465, 1137, 1002];
const TN_STORES = ["Springfield", "White House", "Brentwood", "Spring Hill", "Columbia"];
const VA_STORES = ["Jefferson", "Oyster", "Hampton", "College", "Chesapeake", "Hillcrest", "Beach"];

// Weekly sales are pulled live from PAR (see /api/par/weekly-sales, salesByLocationName)
// instead of this hand-maintained map — PAR and Net-Chef use identical location names.

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

// ── Date helpers ──────────────────────────────────────────────────────────────

function lastCompletedWeekEndDate(): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastSun = new Date(today);
  lastSun.setDate(today.getDate() - today.getDay()); // go back to Sunday (0 = stay, 1 = back 1, etc.)
  const y = lastSun.getFullYear();
  const m = String(lastSun.getMonth() + 1).padStart(2, "0");
  const d = String(lastSun.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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

// ── Recent weeks table ────────────────────────────────────────────────────────

type RecentWeeksData = {
  weeks: string[];
  weekRanges: { start: string; end: string }[];
  stores: { locationId: number; name: string; values: (number | null)[] }[];
};

type WeekItemPair = { prev: ItemData[] | "loading" | "error"; curr: ItemData[] | "loading" | "error" };

function RecentWeeksTable({ showVA, showTN }: { showVA: boolean; showTN: boolean }) {
  const [data, setData] = useState<RecentWeeksData | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [itemsCache, setItemsCache] = useState<Record<number, WeekItemPair>>({});
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/netchef/recent-weeks")
      .then(r => r.json())
      .then((d: unknown) => {
        if (d && typeof d === "object" && "weeks" in d && "stores" in d) {
          setData(d as RecentWeeksData);
          setStatus("done");
        } else {
          setStatus("error");
        }
      })
      .catch(() => setStatus("error"));
  }, []);

  const handleToggle = (locationId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(locationId)) { next.delete(locationId); return next; }
      next.add(locationId);
      return next;
    });
    if (!data || itemsCache[locationId]) return;
    const [prevRange, currRange] = data.weekRanges;
    setItemsCache(prev => ({ ...prev, [locationId]: { prev: "loading", curr: "loading" } }));
    const base = `/api/netchef/items?locationId=${locationId}&mode=variance`;
    fetch(`${base}&start=${prevRange.start}&end=${prevRange.end}&limit=200`)
      .then(r => r.json())
      .then((d: ItemData[]) => setItemsCache(prev => ({ ...prev, [locationId]: { ...prev[locationId], prev: d } })))
      .catch(() => setItemsCache(prev => ({ ...prev, [locationId]: { ...prev[locationId], prev: "error" } })));
    fetch(`${base}&start=${currRange.start}&end=${currRange.end}`)
      .then(r => r.json())
      .then((d: ItemData[]) => setItemsCache(prev => ({ ...prev, [locationId]: { ...prev[locationId], curr: d } })))
      .catch(() => setItemsCache(prev => ({ ...prev, [locationId]: { ...prev[locationId], curr: "error" } })));
  };

  if (status === "loading") return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 h-20 flex items-center justify-center">
      <span className="text-xs text-gray-400 animate-pulse">Loading recent weeks…</span>
    </div>
  );

  if (status === "error" || !data) return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 h-14 flex items-center justify-center">
      <span className="text-xs text-gray-400">Recent weeks failed to load — check server logs</span>
    </div>
  );

  const fmtWow = (v: number | null) => {
    if (v === null) return "—";
    if (v < 0) return `(${Math.abs(v).toFixed(2)}%)`;
    if (v > 0) return `+${v.toFixed(2)}%`;
    return `${v.toFixed(2)}%`;
  };

  const COL_COUNT = 2 + data.weeks.length + 1; // rank + location + weeks + wow

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <CopyableTitle title="Variance — Recent Weeks" targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
            {data.weeks.map(w => (
              <th key={w} className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-40">{w}</th>
            ))}
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-40">W/W Change</th>
          </tr>
        </thead>
        <tbody>
          {data.stores.filter(s =>
            (VA_STORES.includes(s.name) && showVA) ||
            (TN_STORES.includes(s.name) && showTN)
          ).map((store, i) => {
            const prev = store.values[0];
            const curr = store.values[1];
            const wow = prev !== null && curr !== null ? curr - prev : null;
            const absDelta = prev !== null && curr !== null ? Math.abs(curr) - Math.abs(prev) : null;
            const rowBg = absDelta === null ? "" : absDelta > 0 ? "bg-red-50" : absDelta < 0 ? "bg-green-50" : "";
            const isOpen = expandedIds.has(store.locationId);
            const cache = itemsCache[store.locationId];
            const isLoading = !cache || cache.prev === "loading" || cache.curr === "loading";
            const isError = cache?.prev === "error" || cache?.curr === "error";
            const currItems = Array.isArray(cache?.curr) ? (cache.curr as ItemData[]) : [];
            const prevItems = Array.isArray(cache?.prev) ? (cache.prev as ItemData[]) : [];
            const prevMap = new Map(prevItems.map(item => [item.name, item.variancePct]));

            return (
              <Fragment key={store.locationId}>
                <tr className={`border-b border-[#ececec] ${rowBg} cursor-pointer hover:brightness-95`} onClick={() => handleToggle(store.locationId)}>
                  <td className="px-3 py-3 text-right text-xs text-gray-400 tabular-nums">{i + 1}.</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{store.name}</td>
                  {store.values.map((v, j) => (
                    <td key={j} className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtPct(v, 2)}</td>
                  ))}
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${absDelta === null ? "text-gray-400" : absDelta > 0 ? "text-red-600" : absDelta < 0 ? "text-green-600" : "text-gray-500"}`}>{fmtWow(wow)}</td>
                </tr>
                {isOpen && isLoading && (
                  <tr className="bg-gray-50"><td colSpan={COL_COUNT} className="px-4 py-2 text-xs text-gray-400 animate-pulse">Loading…</td></tr>
                )}
                {isOpen && isError && (
                  <tr className="bg-gray-50"><td colSpan={COL_COUNT} className="px-4 py-2 text-xs text-red-500">Failed to load items</td></tr>
                )}
                {isOpen && !isLoading && !isError && currItems.length === 0 && (
                  <tr className="bg-gray-50"><td colSpan={COL_COUNT} className="px-4 py-2 text-xs text-gray-400">No item data for this period</td></tr>
                )}
                {isOpen && !isLoading && !isError && currItems.map((item, j) => {
                  const itemPrev = prevMap.get(item.name) ?? null;
                  const itemWow = item.variancePct !== null && itemPrev !== null ? item.variancePct - itemPrev : null;
                  return (
                    <tr key={`item-${j}`} className="bg-gray-50 border-t border-gray-100">
                      <td className="px-3 py-1.5" />
                      <td className="px-4 py-1.5 text-xs text-gray-600">{item.name}</td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">{fmtPct(itemPrev, 2)}</td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">{fmtPct(item.variancePct, 2)}</td>
                      <td className="px-4 py-1.5 text-right text-xs tabular-nums text-gray-600">{fmtWow(itemWow)}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Variance YoY ─────────────────────────────────────────────────────────────

const WEEK_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 26, 52];

function computeRangeFromWeeks(endDate: string, nWeeks: number, opts: DateOption[]): { start: string; end: string } | null {
  const available = opts
    .filter(o => o.endDate <= endDate)
    .sort((a, b) => b.endDate.localeCompare(a.endDate));
  if (available.length < nWeeks) return null;
  return { start: available[nWeeks - 1].startDate, end: available[0].endDate };
}

function computePriorYearRange(start: string, end: string, opts: DateOption[]): { start: string; end: string } | null {
  if (!opts.length) return null;
  const DAY_MS = 86_400_000;
  const tStart = new Date(start).getTime() - 52 * 7 * DAY_MS;
  const tEnd   = new Date(end).getTime()   - 52 * 7 * DAY_MS;
  const closest = (arr: DateOption[], target: number, key: "startDate" | "endDate") =>
    arr.reduce((b, o) => Math.abs(new Date(o[key]).getTime() - target) < Math.abs(new Date(b[key]).getTime() - target) ? o : b)[key];
  return { start: closest(opts, tStart, "startDate"), end: closest(opts, tEnd, "endDate") };
}

type YoyMetric = "variance" | "cogs";

function fmtYoyChange(v: number | null) {
  if (v === null) return "—";
  if (v < 0) return `(${Math.abs(v).toFixed(2)}%)`;
  if (v > 0) return `+${v.toFixed(2)}%`;
  return "0.00%";
}

function YoyMetricTable({
  title,
  metric,
  rows,
  priorLocMap,
  currRange,
  priorRange,
  isLoading,
}: {
  title: string;
  metric: YoyMetric;
  rows: LocationData[];
  priorLocMap: Record<number, LocationData | null>;
  currRange: { start: string; end: string } | null;
  priorRange: { start: string; end: string } | null;
  isLoading: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const pctKey  = metric === "cogs" ? "actualCostPct" : "variancePct";
  const colorFn = metric === "cogs" ? actualColor : varianceColor;

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden w-fit">
      <div className="px-4 py-3 border-b border-gray-100">
        <CopyableTitle title={title} targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
      </div>
      <table className="w-auto text-sm">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {priorRange ? `${fmtDate(priorRange.start)} – ${fmtDate(priorRange.end)}` : "Prior Year"}
            </th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {currRange ? `${fmtDate(currRange.start)} – ${fmtDate(currRange.end)}` : "Current"}
            </th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">YoY Change</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0 ? (
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-50 animate-pulse">
                <td className="px-3 py-3"><div className="h-4 bg-gray-100 rounded w-6 ml-auto" /></td>
                <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-24" /></td>
                <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></td>
                <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></td>
                <td className="px-4 py-3"><div className="h-4 bg-gray-100 rounded w-16 ml-auto" /></td>
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No data</td></tr>
          ) : (
            rows.map((row, i) => {
              const curr = row[pctKey];
              const priorEntry = priorLocMap[row.locationId];
              const prior = priorEntry === undefined ? undefined : (priorEntry?.[pctKey] ?? null);
              const change   = curr !== null && prior != null ? curr - prior : null;
              const absDelta = curr !== null && prior != null ? Math.abs(curr) - Math.abs(prior) : null;
              const changeColor =
                absDelta === null ? "text-gray-400" :
                absDelta < 0 ? "text-green-600" :
                absDelta > 0 ? "text-red-600" : "text-gray-500";
              return (
                <tr key={row.locationId} className="border-b border-gray-50">
                  <td className="px-3 py-3 text-right text-xs text-gray-400 tabular-nums">{i + 1}.</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{row.locationName}</td>
                  <td className={`px-4 py-3 text-right tabular-nums ${prior === undefined ? "text-gray-300 animate-pulse" : colorFn(prior)}`}>
                    {prior === undefined ? "—" : fmtPct(prior, 2)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${colorFn(curr)}`}>{fmtPct(curr, 2)}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${changeColor}`}>{fmtYoyChange(change)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function VarianceYoyTable({
  dateOptions,
  reportMeta,
  showVA,
  showTN,
}: {
  dateOptions: DateOption[];
  reportMeta: { startDate: string; endDate: string } | null;
  showVA: boolean;
  showTN: boolean;
}) {
  const [currEnd,   setCurrEnd]   = useState("");
  const [priorEnd,  setPriorEnd]  = useState("");
  const [nWeeks,    setNWeeks]    = useState(1);

  const [currLocMap,  setCurrLocMap]  = useState<Record<number, LocationData>>({});
  const [priorLocMap, setPriorLocMap] = useState<Record<number, LocationData | null>>({});
  const [currLoading,  setCurrLoading]  = useState(false);
  const [priorLoading, setPriorLoading] = useState(false);

  // Sync when main page fetches
  useEffect(() => {
    if (!reportMeta || !dateOptions.length) return;
    setCurrEnd(reportMeta.endDate);
    const weeksInRange = dateOptions.filter(o => o.endDate >= reportMeta.startDate && o.endDate <= reportMeta.endDate).length;
    setNWeeks(weeksInRange || 1);
    const pyEnd = computePriorYearRange(reportMeta.startDate, reportMeta.endDate, dateOptions)?.end ?? "";
    setPriorEnd(pyEnd);
  }, [reportMeta?.startDate, reportMeta?.endDate, dateOptions]);

  // Fetch current
  useEffect(() => {
    if (!currEnd || !dateOptions.length) return;
    const range = computeRangeFromWeeks(currEnd, nWeeks, dateOptions);
    if (!range) return;
    setCurrLocMap({});
    setCurrLoading(true);
    let cancelled = false;
    Promise.all(LOCATION_IDS.map(async id => {
      try {
        const res = await fetch(`/api/netchef/data?start=${range.start}&end=${range.end}&locationId=${id}`);
        const json = await res.json();
        if (!cancelled) setCurrLocMap(prev => ({ ...prev, [id]: json as LocationData }));
      } catch { /* skip */ }
    })).finally(() => { if (!cancelled) setCurrLoading(false); });
    return () => { cancelled = true; };
  }, [currEnd, nWeeks, dateOptions]);

  // Fetch prior
  useEffect(() => {
    if (!priorEnd || !dateOptions.length) return;
    const range = computeRangeFromWeeks(priorEnd, nWeeks, dateOptions);
    if (!range) return;
    setPriorLocMap({});
    setPriorLoading(true);
    let cancelled = false;
    Promise.all(LOCATION_IDS.map(async id => {
      try {
        const res = await fetch(`/api/netchef/data?start=${range.start}&end=${range.end}&locationId=${id}`);
        const json = await res.json();
        if (!cancelled) setPriorLocMap(prev => ({ ...prev, [id]: json as LocationData }));
      } catch {
        if (!cancelled) setPriorLocMap(prev => ({ ...prev, [id]: null }));
      }
    })).finally(() => { if (!cancelled) setPriorLoading(false); });
    return () => { cancelled = true; };
  }, [priorEnd, nWeeks, dateOptions]);

  const currRange  = currEnd  && dateOptions.length ? computeRangeFromWeeks(currEnd,  nWeeks, dateOptions) : null;
  const priorRange = priorEnd && dateOptions.length ? computeRangeFromWeeks(priorEnd, nWeeks, dateOptions) : null;

  const rowsFor = (metric: YoyMetric) => {
    const pctKey = metric === "cogs" ? "actualCostPct" : "variancePct";
    return Object.values(currLocMap)
      .filter(l =>
        (VA_STORES.includes(l.locationName) && showVA) ||
        (TN_STORES.includes(l.locationName) && showTN)
      )
      .sort((a, b) => {
        const aCurr  = a[pctKey];
        const aPrior = (priorLocMap[a.locationId] as LocationData | null | undefined)?.[pctKey] ?? null;
        const bCurr  = b[pctKey];
        const bPrior = (priorLocMap[b.locationId] as LocationData | null | undefined)?.[pctKey] ?? null;
        const aDelta = aCurr !== null && aPrior !== null ? Math.abs(aCurr) - Math.abs(aPrior) : null;
        const bDelta = bCurr !== null && bPrior !== null ? Math.abs(bCurr) - Math.abs(bPrior) : null;
        if (aDelta === null && bDelta === null) return 0;
        if (aDelta === null) return 1;
        if (bDelta === null) return -1;
        return aDelta - bDelta;
      });
  };

  const selectCls = "text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300 w-full";
  const isLoading = currLoading || priorLoading;

  return (
    <div className="flex items-start gap-4">
      <YoyMetricTable
        title="Variance — Comparison"
        metric="variance"
        rows={rowsFor("variance")}
        priorLocMap={priorLocMap}
        currRange={currRange}
        priorRange={priorRange}
        isLoading={isLoading}
      />
      <YoyMetricTable
        title="COGS — Comparison"
        metric="cogs"
        rows={rowsFor("cogs")}
        priorLocMap={priorLocMap}
        currRange={currRange}
        priorRange={priorRange}
        isLoading={isLoading}
      />

      <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-4 shrink-0">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Weeks</p>
          <select value={nWeeks} onChange={e => setNWeeks(Number(e.target.value))} className={selectCls}>
            {WEEK_OPTIONS.map(n => <option key={n} value={n}>{n} {n === 1 ? "week" : "weeks"}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Current — End Date</p>
          <select value={currEnd} onChange={e => setCurrEnd(e.target.value)} className={selectCls}>
            {dateOptions.map(o => <option key={o.endDate} value={o.endDate}>{fmtDate(o.endDate)}</option>)}
          </select>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Prior Year — End Date</p>
          <select value={priorEnd} onChange={e => setPriorEnd(e.target.value)} className={selectCls}>
            {dateOptions.map(o => <option key={o.endDate} value={o.endDate}>{fmtDate(o.endDate)}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

// ── History chart ─────────────────────────────────────────────────────────────

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

function buildYTicks(visibleMax: number): { yMax: number; ticks: number[] } {
  const yMax = Math.max(2, Math.ceil(visibleMax + 0.25));
  const step = [0.5, 1, 2].find(s => {
    const n = yMax / s;
    return Number.isInteger(n) && n >= 4 && n <= 7;
  }) ?? 1;
  const ticks: number[] = [];
  for (let v = step; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  return { yMax, ticks };
}

function PeriodTooltip({ active, payload, label }: { active?: boolean; payload?: {dataKey: string; value: number | null; color: string}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload]
    .filter(p => p.value != null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
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
  const [visibleAverages, setVisibleAverages] = useState(new Set(["TN Avg", "VA Avg", "HRG Avg"]));
  const [periodRange, setPeriodRange] = useState<{ start: number; end: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/netchef/period-history")
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data) && data.length) {
          const arr = data as PeriodPoint[];
          setPoints(arr);
          setStatus("done");
          setVisibleStores(new Set(Object.keys(arr[0]).filter(k => k !== "label")));
          setPeriodRange({ start: 0, end: arr.length - 1 });
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

  const tnNames = TN_STORES.filter(n => storeNames.includes(n));
  const vaNames = VA_STORES.filter(n => storeNames.includes(n));

  const range = periodRange ?? { start: 0, end: points.length - 1 };
  const visiblePoints = points.slice(range.start, range.end + 1);

  const avgVals = (names: string[], pt: PeriodPoint) => {
    const vals = names.map(n => pt[n]).filter((v): v is number => typeof v === "number");
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const pointsWithAverages: PeriodPoint[] = visiblePoints.map(pt => ({
    ...pt,
    "TN Avg": avgVals(tnNames, pt),
    "VA Avg": avgVals(vaNames, pt),
    "HRG Avg": avgVals(storeNames, pt),
  }));

  const AVG_KEYS = ["TN Avg", "VA Avg", "HRG Avg"] as const;
  const AVG_COLORS: Record<string, string> = { "TN Avg": "#f97316", "VA Avg": "#a855f7", "HRG Avg": "#374151" };
  const AVG_ACCENT: Record<string, string>  = { "TN Avg": "#c2410c", "VA Avg": "#a855f7", "HRG Avg": "#374151" };

  const visibleMax = pointsWithAverages.reduce((max, pt) => {
    for (const name of storeNames) {
      if (visibleStores.has(name)) {
        const v = pt[name];
        if (typeof v === "number" && v > max) max = v;
      }
    }
    for (const key of AVG_KEYS) {
      if (visibleAverages.has(key)) {
        const v = pt[key];
        if (typeof v === "number" && v > max) max = v;
      }
    }
    return max;
  }, 0);
  const { yMax, ticks: yTicks } = buildYTicks(visibleMax);

  const renderDot = (color: string) => (props: { cx?: number; cy?: number; index?: number }) => {
    const { cx, cy, index } = props;
    if (cx == null || cy == null) return <g/>;
    const isLast = index === visiblePoints.length - 1;
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

  const tnAll = tnNames.length > 0 && tnNames.every(n => visibleStores.has(n));
  const vaAll = vaNames.length > 0 && vaNames.every(n => visibleStores.has(n));

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 p-4 mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <CopyableTitle title="Variance Trend — by Store — Absolute Value" targetRef={cardRef} />
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <span>From</span>
          <select
            value={range.start}
            onChange={e => setPeriodRange({ start: Number(e.target.value), end: Math.max(Number(e.target.value), range.end) })}
            className="border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            {points.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          </select>
          <span>To</span>
          <select
            value={range.end}
            onChange={e => setPeriodRange({ start: Math.min(range.start, Number(e.target.value)), end: Number(e.target.value) })}
            className="border border-gray-200 rounded px-1.5 py-0.5 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-400"
          >
            {points.map((p, i) => <option key={i} value={i}>{p.label}</option>)}
          </select>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={pointsWithAverages} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <ReferenceLine y={1} stroke="#16a34a" strokeDasharray="5 3" strokeWidth={1.5} ifOverflow="visible" label={<RefLineLabel color="#16a34a" text="1.0%" />} />
          <ReferenceLine y={1.5} stroke="#dc2626" strokeDasharray="5 3" strokeWidth={1.5} ifOverflow="visible" label={<RefLineLabel color="#dc2626" text="1.5%" />} />
          <XAxis dataKey="label" tick={axisStyle} />
          <YAxis tick={<YTick />} domain={[0, yMax]} ticks={yTicks} width={40} interval={0} />
          <Tooltip content={<PeriodTooltip />} />
          {storeNames.map((name) =>
            visibleStores.has(name) ? (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                stroke={STORE_COLOR[name] ?? "#6b7280"}
                strokeWidth={1.5}
                dot={renderDot(STORE_COLOR[name] ?? "#6b7280")}
                connectNulls
              />
            ) : null
          )}
          {AVG_KEYS.map(key =>
            visibleAverages.has(key) ? (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={AVG_COLORS[key]}
                strokeWidth={1.5}
                dot={renderDot(AVG_COLORS[key])}
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
          {tnNames.map(name => (
            <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleStores.has(name)}
                onChange={() => toggleStore(name)}
                style={{ accentColor: STORE_COLOR[name] ?? "#6b7280" }}
                className="rounded border-gray-300"
              />
              {name}
            </label>
          ))}
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
          {vaNames.map(name => (
            <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={visibleStores.has(name)}
                onChange={() => toggleStore(name)}
                style={{ accentColor: STORE_COLOR[name] ?? "#6b7280" }}
                className="rounded border-gray-300"
              />
              {name}
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 border-t border-gray-100">
          {AVG_KEYS.map(key => (
            <label key={key} className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none" style={{ color: AVG_COLORS[key] }}>
              <input
                type="checkbox"
                checked={visibleAverages.has(key)}
                onChange={() => setVisibleAverages(prev => {
                  const s = new Set(prev);
                  if (s.has(key)) s.delete(key); else s.add(key);
                  return s;
                })}
                style={{ accentColor: AVG_ACCENT[key] }}
                className="rounded border-gray-300"
              />
              {key}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Rank table ────────────────────────────────────────────────────────────────

type SortCol = "location" | "sales" | "dollars" | "pct";

// Which way a column reads on the first click: names A-Z, money biggest first,
// percentages best first. A second click reverses it, a third clears the sort and
// hands the table back to the ranking it arrived in.
const FIRST_SORT_DIR: Record<SortCol, "asc" | "desc"> = {
  location: "asc",
  sales: "desc",
  dollars: "desc",
  pct: "asc",
};

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
  marketGroups,
  salesByName,
  sortByMagnitude,
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
  marketGroups?: { label: string; rows: LocationData[] }[];
  /** Net sales for the same window as the costs, keyed by location name. Omit to
   *  drop the Sales column entirely rather than show a column of dashes. */
  salesByName?: Record<string, number>;
  /** Rank the metric columns by distance from zero rather than by signed value.
   *  Variance is a deviation - being 2% under is as far off plan as 2% over, and
   *  the table's default order already says so - so sorting it signed would file
   *  the worst underages where the best rows belong. Costs are not a deviation
   *  and stay signed. Only affects ordering; the cells still show the sign. */
  sortByMagnitude?: boolean;
}) {
  const green  = rows.filter(r => colorFn(r[pctKey] as number | null).includes("green")).length;
  const yellow = rows.filter(r => colorFn(r[pctKey] as number | null).includes("yellow")).length;
  const red    = rows.filter(r => colorFn(r[pctKey] as number | null).includes("red")).length;
  const cardRef = useRef<HTMLDivElement>(null);
  const colCount = salesByName ? 5 : 4;

  // Null means the order the rows came in with, which is the meaningful default -
  // best COGS first, smallest variance first. Sorting is a detour from that, so a
  // third click on the active column returns to it rather than stranding the
  // reader in a column order they have to undo by reloading.
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" } | null>(null);

  const toggleSort = (col: SortCol) => {
    setSort(prev => {
      if (!prev || prev.col !== col) return { col, dir: FIRST_SORT_DIR[col] };
      if (prev.dir === FIRST_SORT_DIR[col]) return { col, dir: prev.dir === "asc" ? "desc" : "asc" };
      return null;
    });
  };

  // Sales are a level, not a deviation, so they rank by their own value even on a
  // magnitude table.
  const metricOrder = (v: number | null) => (v === null ? null : sortByMagnitude ? Math.abs(v) : v);

  const sortValue = (row: LocationData, col: SortCol): string | number | null => {
    switch (col) {
      case "location": return row.locationName;
      case "sales":    return salesByName?.[row.locationName] ?? null;
      case "dollars":  return metricOrder(row[dollarsKey] as number | null);
      case "pct":      return metricOrder(row[pctKey] as number | null);
    }
  };

  const applySort = (list: LocationData[]): LocationData[] => {
    if (!sort) return list;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = sortValue(a, sort.col);
      const vb = sortValue(b, sort.col);
      // Missing figures sink to the bottom whichever way the column is pointing -
      // a store with no sales on file is not the best or the worst, it is absent.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" || typeof vb === "string") return String(va).localeCompare(String(vb)) * dir;
      return (va - vb) * dir;
    });
  };

  const sortHeader = (col: SortCol, label: string, align: "left" | "right" = "right") => {
    const active = sort?.col === col;
    return (
      <th className={`${align === "right" ? "text-right" : "text-left"} px-4 py-2 text-xs font-semibold uppercase tracking-wide ${active ? "text-gray-600" : "text-gray-400"}`}>
        <button
          type="button"
          onClick={() => toggleSort(col)}
          title={`Sort by ${label}`}
          className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 transition ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {label}
          {/* Fixed width so the header does not shift as the arrow appears. */}
          <span className="w-2 text-[9px] leading-none">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
        </button>
      </th>
    );
  };

  const renderRow = (row: LocationData, rank: number) => {
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
          <td className="px-3 py-3 text-right text-xs text-gray-400 tabular-nums">{rank}.</td>
          <td className="px-4 py-3 font-medium text-gray-900">{row.locationName}</td>
          {salesByName && (
            <td className="px-4 py-3 text-right tabular-nums text-gray-700">
              {salesByName[row.locationName] != null ? fmtDollars(salesByName[row.locationName]) : "—"}
            </td>
          )}
          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtDollars(dollars)}</td>
          <td className={`px-4 py-3 text-right font-semibold tabular-nums ${colorFn(pct)}`}>{fmtPct(pct, pctDecimals)}</td>
        </tr>
        {isOpen && rowItems === "loading" && (
          <tr className="bg-gray-50"><td colSpan={colCount} className="px-4 py-2 text-xs text-gray-400 animate-pulse">Loading…</td></tr>
        )}
        {isOpen && rowItems === "error" && (
          <tr className="bg-gray-50"><td colSpan={colCount} className="px-4 py-2 text-xs text-red-500">Failed to load items</td></tr>
        )}
        {isOpen && Array.isArray(rowItems) && rowItems.length === 0 && (
          <tr className="bg-gray-50"><td colSpan={colCount} className="px-4 py-2 text-xs text-gray-400">No item data for this period</td></tr>
        )}
        {isOpen && Array.isArray(rowItems) && rowItems.map((item, j) => (
          <tr key={`item-${j}`} className="bg-gray-50 border-t border-gray-100">
            <td className="px-3 py-1.5" />
            <td className="pl-4 pr-4 py-1.5 text-xs text-gray-600">{item.name}</td>
            {salesByName && <td className="px-4 py-1.5" />}
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
  };

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <CopyableTitle title={title} targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
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
              {salesByName && <div className="h-4 bg-gray-100 rounded w-20" />}
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
              {sortHeader("location", "Location", "left")}
              {salesByName && sortHeader("sales", "Sales")}
              {sortHeader("dollars", "$")}
              {sortHeader("pct", "%")}
            </tr>
          </thead>
          <tbody>
            {marketGroups ? (
              <>
                {marketGroups.map((group, gi) => (
                  <Fragment key={group.label}>
                    <tr className={`border-b border-gray-200 ${gi > 0 ? "border-t-2 border-t-gray-200" : ""}`}>
                      <td colSpan={colCount} className="px-4 py-1.5 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {group.label}
                      </td>
                    </tr>
                    {applySort(group.rows).map((row, i) => renderRow(row, i + 1))}
                    {group.rows.length === 0 && !loading && (
                      <tr><td colSpan={colCount} className="px-4 py-3 text-center text-xs text-gray-400">No data</td></tr>
                    )}
                  </Fragment>
                ))}
                {loading && (loadingCount ?? 0) > 0 && (
                  <tr className="border-b border-gray-50">
                    <td colSpan={colCount} className="px-4 py-2.5 text-xs text-gray-400 animate-pulse text-center">
                      Loading {loadingCount} more…
                    </td>
                  </tr>
                )}
              </>
            ) : (
              <>
                {applySort(rows).map((row, i) => renderRow(row, i + 1))}
                {loading && (loadingCount ?? 0) > 0 && (
                  <tr className="border-b border-gray-50">
                    <td colSpan={colCount} className="px-4 py-2.5 text-xs text-gray-400 animate-pulse text-center">
                      Loading {loadingCount} more…
                    </td>
                  </tr>
                )}
                {rows.length === 0 && !loading && (
                  <tr><td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-400">No data</td></tr>
                )}
              </>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Sales for the reported window ─────────────────────────────────────────────

/** Stable empty map so a pending range change does not churn referential equality. */
const EMPTY_SALES: Record<string, number> = {};

/**
 * Net sales per location name for a date range.
 *
 * Sales have to cover the same window as the costs they sit beside, so this
 * follows the page date selectors rather than the endpoint default of last week.
 * The window that produced the figures is stored with them and checked on read,
 * so the previous window sales never sit next to the new window rows while a
 * fetch is in flight - cheaper than clearing state and re-rendering on every
 * range change. Lives in the page component so the tables that need it share one
 * request instead of each firing their own.
 */
function useSalesForRange(dateRange: { start: string; end: string } | null | undefined): Record<string, number> {
  const rangeStart = dateRange?.start;
  const rangeEnd = dateRange?.end;
  const rangeKey = `${rangeStart ?? ""}__${rangeEnd ?? ""}`;
  const [sales, setSales] = useState<{ key: string; byName: Record<string, number> }>({ key: "", byName: {} });

  useEffect(() => {
    if (!rangeStart || !rangeEnd) return;
    let cancelled = false;
    const key = `${rangeStart}__${rangeEnd}`;
    const qs = new URLSearchParams({ start: rangeStart, end: rangeEnd }).toString();
    fetch(`/api/par/weekly-sales?${qs}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSales({ key, byName: d.salesByLocationName ?? {} }); })
      .catch(err => console.error("[FoodCost] sales fetch failed", err));
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  return sales.key === rangeKey ? sales.byName : EMPTY_SALES;
}

// ── Category × location matrix ────────────────────────────────────────────────

type CategoryCell = {
  cogsPct: number | null;
  cogsDollars: number | null;
  variancePct: number | null;
  varianceDollars: number | null;
};

type CategoryRow = {
  name: string;
  group: string;
  sort: string;
  cells: Record<number, CategoryCell>;
};

type CategoryMatrix = {
  categories: CategoryRow[];
  locations: { locationId: number; locationName: string }[];
  salesByLocation: Record<number, number | null>;
  startDate: string;
  endDate: string;
};

type MatrixMetric = "cogs" | "variance";
type LoadStatus = "loading" | "done" | "error";

// Title-case the SHOUTED gl descriptions Net-Chef returns.
function prettyCategory(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\bAnd\b/g, "and");
}

// One fetch feeds both the exceptions list and the grid below it.
function useCategoryMatrix(startDate: string, endDate: string): { data: CategoryMatrix | null; status: LoadStatus } {
  // Keyed by range so a stale result never paints over a newer one — and so the
  // loading state is derived rather than set synchronously inside the effect.
  const [loaded, setLoaded] = useState<{ key: string; data: CategoryMatrix | null } | null>(null);
  const rangeKey = `${startDate}__${endDate}`;

  useEffect(() => {
    const [start, end] = rangeKey.split("__");
    if (!start || !end) return;
    let cancelled = false;
    fetch(`/api/netchef/categories?start=${start}&end=${end}`)
      .then(r => r.json())
      .then((d: unknown) => {
        if (cancelled) return;
        if (d && typeof d === "object" && "categories" in d) {
          setLoaded({ key: rangeKey, data: d as CategoryMatrix });
        } else {
          console.warn("[CategoryMatrix] unexpected:", d);
          setLoaded({ key: rangeKey, data: null });
        }
      })
      .catch(() => { if (!cancelled) setLoaded({ key: rangeKey, data: null }); });
    return () => { cancelled = true; };
  }, [rangeKey]);

  const current = loaded?.key === rangeKey ? loaded : null;
  const data = current?.data ?? null;
  return { data, status: !current ? "loading" : data ? "done" : "error" };
}

function visibleLocations(data: CategoryMatrix, showVA: boolean, showTN: boolean) {
  const visible = new Set([...(showVA ? VA_STORES : []), ...(showTN ? TN_STORES : [])]);
  return data.locations.filter(l => visible.has(l.locationName));
}

function MetricToggle({ metric, setMetric }: { metric: MatrixMetric; setMetric: (m: MatrixMetric) => void }) {
  return (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
      {([["cogs", "COGS"], ["variance", "Variance"]] as const).map(([key, label]) => (
        <button
          key={key}
          onClick={() => setMetric(key)}
          className={`text-xs px-3 py-1.5 transition ${
            metric === key ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Category bar chart ────────────────────────────────────────────────────────
// Categories across the x axis, one bar per store, and a dotted line per group
// at that category's straight (unweighted) average across the visible stores.
//
// Transportation In is dropped outright — it's 0.3% of COGS and varies 0.02pp
// across all twelve stores, and leaving it out makes the remaining 15 divide
// evenly into three pages of five.

const CHART_EXCLUDED_CATEGORY = "TRANSPORTATION IN";
const CATEGORIES_PER_TAB = 5;

/** Straight mean, ignoring stores with no figure. */
function straightMean(values: (number | null | undefined)[]): number | null {
  const v = values.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (v <= m * mag) return m * mag;
  }
  return 10 * mag;
}

type ChartRow = { category: string; __avg: number | null } & Record<string, number | null | string>;

// Rendered inside <Customized> so it can read the chart's own scales through
// Recharts' hooks — the band scale places each line over its category group and
// the y scale positions it, so the lines stay put whatever the axis does.
function AverageMarkers({ rows }: { rows?: ChartRow[] }) {
  const plot = usePlotArea();
  const ticks = useXAxisTicks() as { value?: unknown; coordinate?: number }[] | undefined;
  const yScale = useYAxisScale() as ((v: number) => number) | undefined;

  if (!rows?.length || !plot || !yScale) return null;

  // Categories are evenly spaced across the plot, so the band geometry is
  // knowable outright; the axis ticks are preferred when they line up.
  const band = plot.width / rows.length;

  return (
    <g>
      {rows.map((r, i) => {
        if (r.__avg == null) return null;
        const tick = ticks?.find(t => String(t.value) === r.category);
        const centre = Number.isFinite(tick?.coordinate)
          ? (tick!.coordinate as number)
          : plot.x + band * (i + 0.5);
        const y = yScale(r.__avg);
        if (!Number.isFinite(y)) return null;
        const half = band * 0.45;
        return (
          <line
            key={r.category}
            x1={centre - half}
            x2={centre + half}
            y1={y}
            y2={y}
            stroke="#111827"
            strokeWidth={2}
            strokeDasharray="6 4"
          />
        );
      })}
    </g>
  );
}

const TOOLTIP_WIDTH = 260;
// Enough to clear half a category's bars, so the group being read stays visible
// behind the popup rather than under it.
const TOOLTIP_CLEARANCE = 135;

function CategoryBarTooltip({
  active,
  payload,
  label,
  decimals,
  avg,
  coordinate,
  viewBox,
}: {
  active?: boolean;
  payload?: { dataKey: string; value: number | null; color: string }[];
  label?: string;
  decimals: number;
  avg?: number | null;
  coordinate?: { x?: number };
  viewBox?: { x?: number };
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.value != null && p.dataKey !== "__avg")
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  // Sit to the left of the cursor by default; flip right only when the left
  // side has no room, so the popup never lands on the bars it describes.
  const cx = coordinate?.x ?? 0;
  const plotLeft = viewBox?.x ?? 0;
  const fitsLeft = cx - TOOLTIP_CLEARANCE - TOOLTIP_WIDTH >= plotLeft - 48;
  const transform = fitsLeft
    ? `translateX(calc(-100% - ${TOOLTIP_CLEARANCE}px))`
    : `translateX(${TOOLTIP_CLEARANCE}px)`;

  return (
    <div
      style={{ transform, width: TOOLTIP_WIDTH }}
      className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs"
    >
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map(p => {
        // Both metrics are costs, so above the average is the bad direction.
        const rel = avg != null && p.value != null ? p.value - avg : null;
        return (
          <div key={p.dataKey} className="flex items-center gap-1.5 py-0.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className="text-gray-600 flex-1 truncate">{p.dataKey}</span>
            <span className="font-medium tabular-nums text-gray-800">{fmtPct(p.value ?? null, decimals)}</span>
            <span className="text-gray-300">/</span>
            <span
              className={`tabular-nums font-medium w-16 text-right ${
                rel == null ? "text-gray-400" : rel > 0 ? "text-red-600" : rel < 0 ? "text-green-600" : "text-gray-500"
              }`}
            >
              {rel == null ? "—" : fmtPct(rel, 2)}
            </span>
          </div>
        );
      })}
      {avg != null && (
        <div className="flex items-center gap-1.5 py-0.5 mt-1 pt-1.5 border-t border-gray-100">
          <span className="w-2 h-0.5 shrink-0 bg-gray-900" />
          <span className="text-gray-600 flex-1">Average</span>
          <span className="font-semibold tabular-nums text-gray-900">{fmtPct(avg, decimals)}</span>
          <span className="text-transparent">/</span>
          <span className="w-16" />
        </div>
      )}
    </div>
  );
}

// Two-line label over each bar of the highlighted store: the value, then its
// gap from that category's average, coloured the same way as the popup.
function HighlightLabel(props: {
  x?: number;
  y?: number;
  width?: number;
  value?: number | string;
  index?: number;
  rows?: ChartRow[];
}) {
  const { x, y, width, value, index, rows } = props;
  if (typeof value !== "number" || x == null || y == null || width == null) return null;
  const avg = index != null ? rows?.[index]?.__avg : null;
  const rel = avg != null ? value - avg : null;
  const cx = x + width / 2;
  // White halo keeps both lines readable where they cross the average line.
  const halo = { stroke: "#ffffff", strokeWidth: 3, paintOrder: "stroke" as const };
  return (
    <g>
      <text x={cx} y={y - 14} textAnchor="middle" fontSize={10} fontWeight={600} fill="#111827" {...halo}>
        {fmtPct(value, 2)}
      </text>
      {rel != null && (
        <text
          x={cx}
          y={y - 4}
          textAnchor="middle"
          fontSize={9}
          fontWeight={600}
          fill={rel > 0 ? "#dc2626" : rel < 0 ? "#16a34a" : "#6b7280"}
          {...halo}
        >
          {fmtPct(rel, 2)}
        </text>
      )}
    </g>
  );
}

function CategoryBarChart({
  startDate,
  endDate,
  showVA,
  showTN,
}: {
  startDate: string;
  endDate: string;
  showVA: boolean;
  showTN: boolean;
}) {
  const { data, status } = useCategoryMatrix(startDate, endDate);
  const [metric, setMetric] = useState<MatrixMetric>("cogs");
  const [tab, setTab] = useState(0);
  const [hoverStore, setHoverStore] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const shell = (body: React.ReactNode, controls?: React.ReactNode) => (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <CopyableTitle
            title={metric === "cogs" ? "COGS by Category — by Store" : "Variance by Category — by Store"}
            targetRef={cardRef}
            className="text-sm font-semibold text-gray-800"
          />
          {data && (
            <span className="ml-1.5 text-sm font-normal text-gray-400">
              {fmtDate(data.startDate)} – {fmtDate(data.endDate)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {controls}
          <MetricToggle metric={metric} setMetric={setMetric} />
        </div>
      </div>
      {body}
    </div>
  );

  if (status === "loading") return shell(
    <div className="h-72 flex items-center justify-center">
      <span className="text-xs text-gray-400 animate-pulse">Loading chart…</span>
    </div>
  );
  if (status === "error" || !data) return shell(
    <div className="h-20 flex items-center justify-center">
      <span className="text-xs text-gray-400">Chart failed to load — check server logs</span>
    </div>
  );

  const columns = visibleLocations(data, showVA, showTN);
  if (!columns.length) return shell(
    <div className="h-20 flex items-center justify-center">
      <span className="text-xs text-gray-400">Select VA or TN to show locations</span>
    </div>
  );

  // Paging is ordered by average COGS across *every* store and never by the
  // displayed metric, so a category keeps its page as the filters change.
  const ordered = data.categories
    .filter(c => c.name !== CHART_EXCLUDED_CATEGORY)
    .map(c => ({ cat: c, rank: straightMean(data.locations.map(l => c.cells[l.locationId]?.cogsPct)) ?? -1 }))
    .sort((a, b) => b.rank - a.rank)
    .map(x => x.cat);

  const tabs: CategoryRow[][] = [];
  for (let i = 0; i < ordered.length; i += CATEGORIES_PER_TAB) tabs.push(ordered.slice(i, i + CATEGORIES_PER_TAB));
  if (!tabs.length) return shell(
    <div className="h-20 flex items-center justify-center">
      <span className="text-xs text-gray-400">No category data for this range</span>
    </div>
  );

  const page = Math.min(tab, tabs.length - 1);
  const value = (cat: CategoryRow, locationId: number): number | null => {
    const cell = cat.cells[locationId];
    if (metric === "cogs") return cell?.cogsPct ?? null;
    return cell?.variancePct != null ? Math.abs(cell.variancePct) : null;
  };

  const rows: ChartRow[] = tabs[page].map(cat => {
    const row: ChartRow = { category: prettyCategory(cat.name), __avg: null };
    for (const c of columns) row[c.locationName] = value(cat, c.locationId);
    row.__avg = straightMean(columns.map(c => value(cat, c.locationId)));
    return row;
  });

  const allValues = rows.flatMap(r => columns.map(c => r[c.locationName]).filter((v): v is number => typeof v === "number"));
  const yMax = niceCeil(Math.max(...allValues, 0) * 1.08);
  const decimals = yMax < 1 ? 2 : 1;

  const controls = (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setTab(p => Math.max(0, p - 1))}
        disabled={page === 0}
        aria-label="Previous categories"
        className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition"
      >
        ←
      </button>
      <span className="text-xs text-gray-500 tabular-nums px-1">{page + 1} / {tabs.length}</span>
      <button
        onClick={() => setTab(p => Math.min(tabs.length - 1, p + 1))}
        disabled={page === tabs.length - 1}
        aria-label="Next categories"
        className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white transition"
      >
        →
      </button>
    </div>
  );

  return shell(
    <div className="p-4">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="16%" barGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
          <XAxis dataKey="category" tick={{ fontSize: 11, fill: "#6b7280" }} interval={0} tickLine={false} />
          <YAxis
            domain={[0, yMax]}
            tickCount={6}
            width={46}
            tickLine={false}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            tickFormatter={(v: number) => `${v.toFixed(decimals)}%`}
          />
          <Tooltip
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
            offset={0}
            isAnimationActive={false}
            // The popup places itself relative to the cursor, so Recharts must
            // not also clamp the wrapper or the two fight over the x position.
            allowEscapeViewBox={{ x: true, y: false }}
            content={(props) => {
              const { active, payload, label, coordinate, viewBox } = props as unknown as {
                active?: boolean;
                payload?: { dataKey: string; value: number | null; color: string }[];
                label?: string;
                coordinate?: { x?: number };
                viewBox?: { x?: number };
              };
              return (
                <CategoryBarTooltip
                  active={active}
                  payload={payload}
                  label={label}
                  decimals={2}
                  avg={rows.find(r => r.category === label)?.__avg}
                  coordinate={coordinate}
                  viewBox={viewBox}
                />
              );
            }}
          />
          {columns.map(c => (
            <Bar
              key={c.locationId}
              dataKey={c.locationName}
              fill={STORE_COLOR[c.locationName] ?? "#9ca3af"}
              // Hovering a store in the key fades the rest so its bars read as
              // one series across the categories.
              fillOpacity={hoverStore && hoverStore !== c.locationName ? 0.15 : 1}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            >
              {hoverStore === c.locationName && (
                <LabelList dataKey={c.locationName} content={<HighlightLabel rows={rows} />} />
              )}
            </Bar>
          ))}
          <Customized component={<AverageMarkers rows={rows} />} />
        </BarChart>
      </ResponsiveContainer>

      <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {columns.map(c => {
          const dimmed = hoverStore != null && hoverStore !== c.locationName;
          return (
            <button
              key={c.locationId}
              onMouseEnter={() => setHoverStore(c.locationName)}
              onMouseLeave={() => setHoverStore(null)}
              onFocus={() => setHoverStore(c.locationName)}
              onBlur={() => setHoverStore(null)}
              className={`flex items-center gap-1.5 text-xs transition cursor-default ${
                dimmed ? "text-gray-300" : hoverStore === c.locationName ? "text-gray-900 font-semibold" : "text-gray-600"
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm shrink-0 transition"
                style={{
                  background: STORE_COLOR[c.locationName] ?? "#9ca3af",
                  opacity: dimmed ? 0.25 : 1,
                }}
              />
              {c.locationName}
            </button>
          );
        })}
        <span className="flex items-center gap-1.5 text-xs text-gray-600 ml-auto">
          <svg width="20" height="4" className="shrink-0">
            <line x1="0" y1="2" x2="20" y2="2" stroke="#111827" strokeWidth={2} strokeDasharray="6 4" />
          </svg>
          Average
        </span>
      </div>
    </div>,
    controls
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function FoodCostClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
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
  // Why there is nothing to show, when that is a legitimate answer rather than a
  // failure - a period whose first week is still running, say.
  const [notice, setNotice] = useState<string | null>(null);

  const [expandedIds, setExpandedIds]       = useState<Set<number>>(new Set());
  const [cogsItemsCache, setCogsItemsCache] = useState<Record<number, ItemData[] | "loading" | "error">>({});
  const [varItemsCache,  setVarItemsCache]  = useState<Record<number, ItemData[] | "loading" | "error">>({});

  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);

  const fetchData = useCallback(async (start: string, end: string, bust = false) => {
    if (!start || !end) return;
    setLocMap({});
    setLoadingIds(new Set(LOCATION_IDS));
    setError(null);
    setNotice(null);
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
          const sunStr = lastCompletedWeekEndDate();
          const prior = data.find((o: DateOption) => o.endDate === sunStr) ?? data[1] ?? data[0];
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
    const sunStr = lastCompletedWeekEndDate();
    const opt = dateOptions.find(o => o.endDate === sunStr) ?? dateOptions[1] ?? dateOptions[0];
    if (opt) { setStartDate(opt.startDate); setEndDate(opt.endDate); setActiveQuick("last_week"); fetchData(opt.startDate, opt.endDate); }
  };

  const setYTD = () => {
    const ytdStart = [...dateOptions].reverse().find(o => o.startDate >= FISCAL_YEAR_START)?.startDate;
    const sunStr = lastCompletedWeekEndDate();
    const ytdEnd = (dateOptions.find(o => o.endDate === sunStr) ?? dateOptions[1] ?? dateOptions[0])?.endDate;
    if (ytdStart && ytdEnd) { setStartDate(ytdStart); setEndDate(ytdEnd); setActiveQuick("ytd"); fetchData(ytdStart, ytdEnd); }
  };

  const setPTD = () => {
    const cp = currentPeriod();
    const ptdStart = [...dateOptions].reverse().find(o => o.startDate >= cp.start)?.startDate;
    const sunStr = lastCompletedWeekEndDate();
    const ptdEnd = (dateOptions.find(o => o.endDate === sunStr) ?? dateOptions[1] ?? dateOptions[0])?.endDate;

    // Select the button whether or not there is anything behind it. A period that
    // has not banked a week yet is an answer; swallowing the click is not, and it
    // reads as a dead control.
    setActiveQuick("ptd");

    if (ptdStart && ptdEnd && ptdStart <= ptdEnd) {
      setStartDate(ptdStart);
      setEndDate(ptdEnd);
      fetchData(ptdStart, ptdEnd);
      return;
    }

    // Net-Chef reports by completed week, so a period still inside its first one
    // has nothing to total. Clear the previous window rather than leave it sitting
    // under a PTD heading it does not belong to.
    setLocMap({});
    setLoadingIds(new Set());
    setReportMeta(null);
    setError(null);
    setNotice(`P${cp.period} began ${fmtDate(cp.start)}. No completed weeks yet - PTD will fill in once the first week closes.`);
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
    const base = `/api/netchef/items?locationId=${id}&start=${startDate}&end=${endDate}&limit=10`;
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

  const vaActual = byActual.filter(l => VA_STORES.includes(l.locationName));
  const tnActual = byActual.filter(l => TN_STORES.includes(l.locationName));
  const cogsRows = byActual.filter(l =>
    (VA_STORES.includes(l.locationName) && showVA) ||
    (TN_STORES.includes(l.locationName) && showTN)
  );

  const byVariance = [...allLocations]
    .filter(l => l.variancePct !== null)
    .sort((a, b) => Math.abs(a.variancePct ?? 0) - Math.abs(b.variancePct ?? 0))
    .filter(l =>
      (VA_STORES.includes(l.locationName) && showVA) ||
      (TN_STORES.includes(l.locationName) && showTN)
    );

  const fetchedLabel = reportMeta
    ? `${fmtDate(reportMeta.startDate)} – ${fmtDate(reportMeta.endDate)} · ${new Date(reportMeta.fetchedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

  // Sales for the window the COGS and variance figures came from, shared by every
  // table that shows them so the range only gets fetched once.
  const salesRange = reportMeta ? { start: reportMeta.startDate, end: reportMeta.endDate } : null;
  const salesByName = useSalesForRange(salesRange);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
      <header className="bg-white border-b border-gray-200">
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
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
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

      <div className="bg-gray-50 border-b border-gray-200 shadow-sm">
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
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showVA} onChange={e => setShowVA(e.target.checked)} className="rounded border-gray-300" />
              VA
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showTN} onChange={e => setShowTN(e.target.checked)} className="rounded border-gray-300" />
              TN
            </label>
          </div>
        </div>
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
        {notice && (
          <div className="mb-6 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            {notice}
          </div>
        )}
        {allLocations.length === 0 && !loading && !error && !notice && (
          <div className="text-center py-20 text-gray-400 text-sm">Select a date range and click Fetch to load food cost data.</div>
        )}

        {(allLocations.length > 0 || loading) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RankTable
              title="COGS"
              rows={cogsRows}
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
              salesByName={salesByName}
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
              salesByName={salesByName}
              sortByMagnitude
            />
          </div>
        )}

        {(allLocations.length > 0 || loading) && startDate && endDate && (
          <div className="mt-6">
            <CategoryBarChart
              startDate={startDate}
              endDate={endDate}
              showVA={showVA}
              showTN={showTN}
            />
          </div>
        )}

        {(allLocations.length > 0 || loading) && (
          <div className="mt-6">
            <VarianceYoyTable
              dateOptions={dateOptions}
              reportMeta={reportMeta}
              showVA={showVA}
              showTN={showTN}
            />
          </div>
        )}

        <div className="mt-6">
          <RecentWeeksTable showVA={showVA} showTN={showTN} />
        </div>

        <HistoryChart />
      </main>
    </div>
  );
}
