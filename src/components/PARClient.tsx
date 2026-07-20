"use client";

import { useState, useCallback, useEffect, useRef, Fragment } from "react";
import { useRouter } from "next/navigation";
import type { PARLocation } from "@/lib/par";
import type { PARLocationResult, PARDailyRow } from "@/app/api/par/data/route";
import { CopyableTitle } from "@/components/CopyImageButton";
import { PERIODS, currentPeriod, type FiscalPeriod } from "@/lib/fiscal";

// ── Date helpers ──────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}
function fmtDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${m}/${d}`;
}
function fmtDayLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleDateString("en-US", { weekday: "short" })} ${fmtDate(iso)}`;
}

// Mon–Sun business week, matching FoodCostClient's lastCompletedWeekEndDate convention:
// most recent Sunday on/before today (if today IS Sunday, that week counts as "completed").
function mostRecentSunday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

type Week = { start: string; end: string; label: string };

// Last n completed Mon–Sun weeks, oldest first.
function lastNWeeks(n: number): Week[] {
  const lastSun = mostRecentSunday();
  const weeks: Week[] = [];
  for (let i = 0; i < n; i++) {
    const end = new Date(lastSun);
    end.setDate(lastSun.getDate() - i * 7);
    const start = new Date(end);
    start.setDate(end.getDate() - 6);
    weeks.push({ start: toISO(start), end: toISO(end), label: `${fmtDate(toISO(start))}–${fmtDate(toISO(end))}` });
  }
  return weeks.reverse();
}

// Splits a Mon–Sun-aligned date range into consecutive 7-day weeks.
function weeksInRange(start: string, end: string): Week[] {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const totalDays = Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
  const numWeeks = Math.round(totalDays / 7);
  const weeks: Week[] = [];
  for (let i = 0; i < numWeeks; i++) {
    const wStart = new Date(s); wStart.setDate(s.getDate() + i * 7);
    const wEnd = new Date(s); wEnd.setDate(s.getDate() + i * 7 + 6);
    weeks.push({ start: toISO(wStart), end: toISO(wEnd), label: `${fmtDate(toISO(wStart))}–${fmtDate(toISO(wEnd))}` });
  }
  return weeks;
}

// Last n completed fiscal periods (excludes the current, in-progress period), oldest first.
function lastNPeriods(n: number): FiscalPeriod[] {
  const idx = PERIODS.findIndex(p => p.period === currentPeriod().period);
  const periods: FiscalPeriod[] = [];
  for (let i = 1; i <= n; i++) {
    const pIdx = idx - i;
    if (pIdx >= 0) periods.push(PERIODS[pIdx]);
  }
  return periods.reverse();
}
function periodLabel(p: FiscalPeriod): string {
  return `P${p.period} (${fmtDate(p.start)}–${fmtDate(p.end)})`;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtDollars(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtProductivity(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtTplh(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}
function fmtHours(v: number): string {
  return v.toFixed(1) + "h";
}

// ── Sales-tier grouping (mirrors DashboardClient's SalesTierTable) ────────────

const TIERS = [
  { label: "< $45k",      min: 0,     max: 45000    },
  { label: "$45k – $65k", min: 45000, max: 65000    },
  { label: "$65k – $85k", min: 65000, max: 85000    },
  { label: "> $85k",      min: 85000, max: Infinity },
];

type Bucket = { netSales: number; transactions: number; laborHours: number };
type StoreData = {
  primarySales: number; // "Net Sales" (weeks mode) or "Avg Weekly Sales" (periods mode) — also drives tier bucketing
  productivity: (number | null)[]; // $/labor-hr, oldest → newest
  tplh: (number | null)[]; // transactions/labor-hr, oldest → newest
  daily: PARDailyRow[];
};

type Mode = "weeks" | "periods";
type Metric = "dollars" | "count";

// Fetches once per mode change; both the Productivity and TPLH tables read from this shared result.
function usePosData(locations: PARLocation[], mode: Mode) {
  const weeks = lastNWeeks(3);
  const periods = lastNPeriods(3);

  const rangeStart = mode === "weeks" ? weeks[0].start : periods[0].start;
  const rangeEnd   = mode === "weeks" ? weeks[weeks.length - 1].end : periods[periods.length - 1].end;

  const [dataMap, setDataMap] = useState<Record<string, StoreData>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(() => {
    setDataMap({});
    const ids = new Set(locations.map(l => l.storeId));
    setLoadingIds(ids);

    for (const loc of locations) {
      fetch(`/api/par/data?storeId=${loc.storeId}&start=${rangeStart}&end=${rangeEnd}`)
        .then(r => r.json())
        .then((d: PARLocationResult) => {
          const daily = [...(d.daily ?? [])].sort((a, b) => a.date.localeCompare(b.date));

          let primarySales: number;
          let productivity: (number | null)[];
          let tplh: (number | null)[];

          if (mode === "weeks") {
            const buckets: Bucket[] = weeks.map(() => ({ netSales: 0, transactions: 0, laborHours: 0 }));
            for (const day of daily) {
              const idx = weeks.findIndex(w => day.date >= w.start && day.date <= w.end);
              if (idx === -1) continue;
              buckets[idx].netSales += day.netSales;
              buckets[idx].transactions += day.transactions;
              buckets[idx].laborHours += day.laborHours;
            }
            productivity = buckets.map(b => (b.laborHours > 0 ? b.netSales / b.laborHours : null));
            tplh = buckets.map(b => (b.laborHours > 0 ? b.transactions / b.laborHours : null));
            primarySales = buckets[buckets.length - 1].netSales;
          } else {
            const buckets: Bucket[] = periods.map(() => ({ netSales: 0, transactions: 0, laborHours: 0 }));
            for (const day of daily) {
              const idx = periods.findIndex(p => day.date >= p.start && day.date <= p.end);
              if (idx === -1) continue;
              buckets[idx].netSales += day.netSales;
              buckets[idx].transactions += day.transactions;
              buckets[idx].laborHours += day.laborHours;
            }
            productivity = buckets.map(b => (b.laborHours > 0 ? b.netSales / b.laborHours : null));
            tplh = buckets.map(b => (b.laborHours > 0 ? b.transactions / b.laborHours : null));
            const lastBucket = buckets[buckets.length - 1];
            const lastPeriodWeeks = periods[periods.length - 1]?.weeks ?? 1;
            primarySales = lastBucket.netSales / lastPeriodWeeks;
          }

          setDataMap(prev => ({ ...prev, [loc.storeId]: { primarySales, productivity, tplh, daily } }));
        })
        .catch(err => console.error("[PAR] fetch failed", loc.storeId, err))
        .finally(() => setLoadingIds(prev => {
          const n = new Set(prev); n.delete(loc.storeId); return n;
        }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locations, mode, rangeStart, rangeEnd]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  return { dataMap, loadingIds, weeks, periods, rangeStart, rangeEnd, refetch: fetchAll };
}

function PosTierTable({
  locations, showVA, showTN, mode, metric, dataMap, loadingIds, weeks, periods,
}: {
  locations: PARLocation[];
  showVA: boolean;
  showTN: boolean;
  mode: Mode;
  metric: Metric;
  dataMap: Record<string, StoreData>;
  loadingIds: Set<string>;
  weeks: Week[];
  periods: FiscalPeriod[];
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const loading = loadingIds.size > 0;

  const visibleLocs = locations.filter(l =>
    (l.state === "VA" && showVA) || (l.state === "TN" && showTN)
  );

  const tiered = TIERS.map(tier => ({
    label: tier.label,
    stores: visibleLocs
      .filter(l => {
        const sales = dataMap[l.storeId]?.primarySales;
        return sales != null && sales >= tier.min && sales < tier.max;
      })
      .sort((a, b) => (dataMap[b.storeId]?.primarySales ?? 0) - (dataMap[a.storeId]?.primarySales ?? 0)),
  })).filter(t => t.stores.length > 0).reverse(); // highest sales tier first

  const salesColTitle = mode === "weeks" ? "Net Sales" : "Avg Weekly Sales";
  const colLabels = mode === "weeks"
    ? [weeks[2].label, weeks[1].label, weeks[0].label]
    : [periodLabel(periods[periods.length - 1]), periodLabel(periods[periods.length - 2]), periodLabel(periods[periods.length - 3])];

  const cardTitle = metric === "dollars" ? "Productivity" : "TPLH";
  const metricColTitle = metric === "dollars" ? "Productivity" : "TPLH";
  const fmtMetric = metric === "dollars" ? fmtProductivity : fmtTplh;
  const metricArr = (d: StoreData) => (metric === "dollars" ? d.productivity : d.tplh);

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <CopyableTitle title={cardTitle} targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
        {loading && (
          <span className="text-xs text-gray-400 animate-pulse">Loading {loadingIds.size} more…</span>
        )}
      </div>
      <table className="w-full text-sm table-fixed">
        <colgroup>
          <col className="w-[28%]" />
          <col className="w-[18%]" />
          <col className="w-[18%]" />
          <col className="w-[18%]" />
          <col className="w-[18%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {salesColTitle}<br /><span className="normal-case font-normal tracking-normal text-gray-400">{colLabels[0]}</span>
            </th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {metricColTitle}<br /><span className="normal-case font-normal tracking-normal text-gray-400">{colLabels[0]}</span>
            </th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {metricColTitle}<br /><span className="normal-case font-normal tracking-normal text-gray-400">{colLabels[1]}</span>
            </th>
            <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              {metricColTitle}<br /><span className="normal-case font-normal tracking-normal text-gray-400">{colLabels[2]}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tiered.length === 0 && loading ? (
            <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400 animate-pulse">Loading…</td></tr>
          ) : tiered.map(tier => (
            <Fragment key={tier.label}>
              <tr className="bg-gray-50">
                <td colSpan={5} className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-gray-700 border-b border-gray-100">
                  {tier.label}
                </td>
              </tr>
              {tier.stores.map(loc => {
                const d = dataMap[loc.storeId];
                const isOpen = expandedIds.has(loc.storeId);
                const m = metricArr(d);
                return (
                  <Fragment key={loc.storeId}>
                    <tr
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedIds(prev => {
                        const n = new Set(prev);
                        if (n.has(loc.storeId)) n.delete(loc.storeId); else n.add(loc.storeId);
                        return n;
                      })}
                    >
                      <td className="px-4 py-2 font-medium text-gray-900">
                        {loc.name} <span className="ml-2 text-xs text-gray-400">{loc.state}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmtDollars(d.primarySales)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmtMetric(m[2])}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmtMetric(m[1])}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{fmtMetric(m[0])}</td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={5} className="border-b border-gray-100 bg-gray-50 px-4 py-3">
                          {mode === "weeks"
                            ? <DailyBreakdown daily={d.daily.filter(day => day.date >= weeks[weeks.length - 1].start && day.date <= weeks[weeks.length - 1].end)} metric={metric} />
                            : <WeeklyBreakdown daily={d.daily} rangeStart={periods[periods.length - 1].start} rangeEnd={periods[periods.length - 1].end} metric={metric} />}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Per-store daily breakdown (shown on row expand) ────────────────────────────

function DailyBreakdown({ daily, metric }: { daily: PARDailyRow[]; metric: Metric }) {
  if (daily.length === 0) {
    return <p className="text-xs text-gray-400">No daily data</p>;
  }
  const amountTitle = metric === "dollars" ? "Net Sales" : "Transactions";
  const metricTitle = metric === "dollars" ? "Productivity" : "TPLH";
  return (
    <table className="w-full text-xs max-w-2xl">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="text-left py-1 text-gray-400 font-semibold uppercase tracking-wide">Date</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">{amountTitle}</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Labor Hrs</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">{metricTitle}</th>
        </tr>
      </thead>
      <tbody>
        {daily.map(row => {
          const amount = metric === "dollars" ? row.netSales : row.transactions;
          const rate = row.laborHours > 0 ? amount / row.laborHours : null;
          return (
            <tr key={row.date} className="border-b border-gray-100">
              <td className="py-1 text-gray-700">{fmtDayLabel(row.date)}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">{metric === "dollars" ? fmtDollars(amount) : amount.toLocaleString()}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">{fmtHours(row.laborHours)}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">
                {metric === "dollars" ? fmtProductivity(rate) : fmtTplh(rate)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Per-store weekly breakdown (shown on row expand, periods mode) ─────────────

function WeeklyBreakdown({ daily, rangeStart, rangeEnd, metric }: { daily: PARDailyRow[]; rangeStart: string; rangeEnd: string; metric: Metric }) {
  const weeks = weeksInRange(rangeStart, rangeEnd);
  const rows = weeks.map(w => {
    const inWeek = daily.filter(d => d.date >= w.start && d.date <= w.end);
    const netSales = inWeek.reduce((s, d) => s + d.netSales, 0);
    const transactions = inWeek.reduce((s, d) => s + d.transactions, 0);
    const laborHours = inWeek.reduce((s, d) => s + d.laborHours, 0);
    return { week: w, netSales, transactions, laborHours };
  });
  if (rows.length === 0) {
    return <p className="text-xs text-gray-400">No weekly data</p>;
  }
  const amountTitle = metric === "dollars" ? "Net Sales" : "Transactions";
  const metricTitle = metric === "dollars" ? "Productivity" : "TPLH";
  return (
    <table className="w-full text-xs max-w-2xl">
      <thead>
        <tr className="border-b border-gray-200">
          <th className="text-left py-1 text-gray-400 font-semibold uppercase tracking-wide">Week</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">{amountTitle}</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Labor Hrs</th>
          <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">{metricTitle}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(row => {
          const amount = metric === "dollars" ? row.netSales : row.transactions;
          const rate = row.laborHours > 0 ? amount / row.laborHours : null;
          return (
            <tr key={row.week.start} className="border-b border-gray-100">
              <td className="py-1 text-gray-700">{row.week.label}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">{metric === "dollars" ? fmtDollars(amount) : amount.toLocaleString()}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">{fmtHours(row.laborHours)}</td>
              <td className="py-1 text-right tabular-nums text-gray-700">
                {metric === "dollars" ? fmtProductivity(rate) : fmtTplh(rate)}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PARClient({ locations }: { locations: PARLocation[] }) {
  const router = useRouter();

  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);
  const [mode, setMode] = useState<Mode>("weeks");
  const posData = usePosData(locations, mode);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/par/refresh", { method: "POST" });
    } catch (err) {
      console.error("[PAR] cache refresh failed", err);
    }
    posData.refetch();
    setRefreshing(false);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="relative w-fit">
              <select
                value="/par"
                onChange={e => router.push(e.target.value)}
                className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
              >
                <option value="/dashboard">Drive-Thru</option>
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

      {/* Sub-bar */}
      <div className="bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex items-center gap-3 text-sm">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            <button
              onClick={() => setMode("weeks")}
              className={`text-xs px-3 py-1.5 transition ${mode === "weeks" ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Weeks
            </button>
            <button
              onClick={() => setMode("periods")}
              className={`text-xs px-3 py-1.5 transition ${mode === "periods" ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"}`}
            >
              Periods
            </button>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showVA} onChange={e => setShowVA(e.target.checked)} className="rounded border-gray-300" />
              VA
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input type="checkbox" checked={showTN} onChange={e => setShowTN(e.target.checked)} className="rounded border-gray-300" />
              TN
            </label>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <PosTierTable locations={locations} showVA={showVA} showTN={showTN} mode={mode} metric="dollars" {...posData} />
        <div className="mt-6">
          <PosTierTable locations={locations} showVA={showVA} showTN={showTN} mode={mode} metric="count" {...posData} />
        </div>
      </main>
    </div>
  );
}
