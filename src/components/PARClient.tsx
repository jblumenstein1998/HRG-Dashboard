"use client";

import { useState, useCallback, useEffect, Fragment } from "react";
import { useRouter } from "next/navigation";
import { PAR_LOCATIONS } from "@/lib/par";
import { FISCAL_YEAR_START, PERIODS, currentPeriod } from "@/lib/fiscal";
import type { PARLocationResult, PARHourlyRow, PARDaypartRow } from "@/app/api/par/data/route";

// ── Date helpers ──────────────────────────────────────────────────────────────

function toISO(d: Date): string {
  return d.toISOString().split("T")[0];
}
function daysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return toISO(d);
}
function yesterday(): string { return daysAgo(1); }
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-"); return `${m}/${d}/${y}`;
}
function fmtHour(h: number): string {
  if (h === 0)  return "12 AM";
  if (h < 12)   return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}
function lastPeriod(): { start: string; end: string } {
  const cp  = currentPeriod();
  const idx = PERIODS.findIndex(p => p.period === cp.period);
  if (idx <= 0) return { start: PERIODS[0].start, end: PERIODS[0].end };
  return { start: PERIODS[idx - 1].start, end: PERIODS[idx - 1].end };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtDollars(v: number): string {
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}
function fmtHours(v: number): string {
  return v.toFixed(1) + "h";
}

// ── Hourly breakdown sub-table ─────────────────────────────────────────────────

function HourlyTable({ hourly, dayparts }: { hourly: PARHourlyRow[]; dayparts: PARDaypartRow[] }) {
  const peakNames = new Set(dayparts.filter(d => d.isPeak).map(d => d.name));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-4 py-3 bg-gray-50">
      {/* Hourly sales */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Hourly Sales</p>
        {hourly.length === 0 ? (
          <p className="text-xs text-gray-400">No sales data</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 text-gray-400 font-semibold uppercase tracking-wide">Hour</th>
                <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Sales</th>
                <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Trans</th>
                <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Avg</th>
              </tr>
            </thead>
            <tbody>
              {hourly.filter(h => h.transactions > 0 || h.netSales > 0).map(h => (
                <tr key={h.hour} className="border-b border-gray-100">
                  <td className="py-1 text-gray-700">{fmtHour(h.hour)}</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">{fmtDollars(h.netSales)}</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">{h.transactions}</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">{fmtDollars(h.avgTicket)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Daypart labor */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Labor by Daypart</p>
        {dayparts.length === 0 ? (
          <p className="text-xs text-gray-400">No labor data</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 text-gray-400 font-semibold uppercase tracking-wide">Daypart</th>
                <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Hours</th>
                <th className="py-1 w-12" />
              </tr>
            </thead>
            <tbody>
              {dayparts.map(dp => (
                <tr key={dp.name} className="border-b border-gray-100">
                  <td className="py-1 text-gray-700">{dp.name}</td>
                  <td className="py-1 text-right tabular-nums text-gray-700">{fmtHours(dp.laborHours)}</td>
                  <td className="py-1 text-center">
                    {peakNames.has(dp.name) && (
                      <span className="text-orange-500 font-semibold text-[10px] uppercase tracking-wide">Peak</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Hourly labor */}
        {hourly.some(h => h.laborHours > 0) && (
          <>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-2">Hourly Labor</p>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-1 text-gray-400 font-semibold uppercase tracking-wide">Hour</th>
                  <th className="text-right py-1 text-gray-400 font-semibold uppercase tracking-wide">Hours</th>
                </tr>
              </thead>
              <tbody>
                {hourly.filter(h => h.laborHours > 0).map(h => (
                  <tr key={h.hour} className="border-b border-gray-100">
                    <td className="py-1 text-gray-700">{fmtHour(h.hour)}</td>
                    <td className="py-1 text-right tabular-nums text-gray-700">{fmtHours(h.laborHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PARClient() {
  const router = useRouter();

  const [startDate, setStartDate] = useState(daysAgo(7));
  const [endDate,   setEndDate]   = useState(yesterday());
  const [activeQuick, setActiveQuick] = useState<string | null>("last7");

  const [dataMap,    setDataMap]    = useState<Record<string, PARLocationResult>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);

  const fetchAll = useCallback((start: string, end: string) => {
    setDataMap({});
    setExpandedIds(new Set());
    const ids = new Set(PAR_LOCATIONS.map(l => l.storeId));
    setLoadingIds(ids);

    for (const loc of PAR_LOCATIONS) {
      fetch(`/api/par/data?storeId=${loc.storeId}&start=${start}&end=${end}`)
        .then(r => r.json())
        .then((d: PARLocationResult) => setDataMap(prev => ({ ...prev, [loc.storeId]: d })))
        .catch(err => console.error("[PAR] fetch failed", loc.storeId, err))
        .finally(() => setLoadingIds(prev => {
          const n = new Set(prev); n.delete(loc.storeId); return n;
        }));
    }
  }, []);

  useEffect(() => { fetchAll(startDate, endDate); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = (start: string, end: string, key: string) => {
    setStartDate(start); setEndDate(end); setActiveQuick(key); fetchAll(start, end);
  };

  const quickBtns = [
    { key: "last7",      label: "Last 7 Days",  fn: () => setRange(daysAgo(7),              yesterday(),                "last7")      },
    { key: "ptd",        label: "PTD",           fn: () => setRange(currentPeriod().start,   yesterday(),                "ptd")        },
    { key: "lastperiod", label: "Last Period",   fn: () => { const lp = lastPeriod(); setRange(lp.start, lp.end, "lastperiod"); }     },
    { key: "ytd",        label: "YTD",           fn: () => setRange(FISCAL_YEAR_START,        yesterday(),                "ytd")        },
  ];

  const loading  = loadingIds.size > 0;
  const hasData  = Object.keys(dataMap).length > 0;

  const visibleLocs = PAR_LOCATIONS.filter(l =>
    (l.state === "VA" && showVA) || (l.state === "TN" && showTN)
  );

  const rows = visibleLocs
    .map(l => ({ loc: l, data: dataMap[l.storeId] ?? null }))
    .sort((a, b) => (b.data?.summary.netSales ?? 0) - (a.data?.summary.netSales ?? 0));

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
              </select>
              <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            {/* Quick buttons */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {quickBtns.map(b => (
                <button
                  key={b.key}
                  onClick={b.fn}
                  disabled={loading}
                  className={`text-xs px-3 py-1.5 transition disabled:opacity-50 ${
                    activeQuick === b.key
                      ? "bg-red-700 text-white font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* Custom date range */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={startDate}
                min={FISCAL_YEAR_START}
                max={endDate}
                onChange={e => { setStartDate(e.target.value); setActiveQuick(null); }}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                value={endDate}
                min={startDate}
                max={yesterday()}
                onChange={e => { setEndDate(e.target.value); setActiveQuick(null); }}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>

            <button
              onClick={() => fetchAll(startDate, endDate)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              {loading ? "Fetching…" : "Fetch"}
            </button>
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
          <span className="text-gray-500 text-xs">{fmtDate(startDate)} – {fmtDate(endDate)}</span>
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

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {loading && !hasData && (
          <div className="mb-4 rounded-xl bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
            Loading {loadingIds.size} location{loadingIds.size !== 1 ? "s" : ""}…
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-800">POS Sales &amp; Labor</h2>
            {loading && hasData && (
              <span className="text-xs text-gray-400 animate-pulse">Loading {loadingIds.size} more…</span>
            )}
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide w-8">#</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Location</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Net Sales</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Trans</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Avg Ticket</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Labor Hrs</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Peak</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide">Non-Peak</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">Select a date range and click Fetch.</td></tr>
              ) : rows.map(({ loc, data }, i) => {
                const isLoading = loadingIds.has(loc.storeId);
                const isOpen    = expandedIds.has(loc.storeId);
                const s         = data?.summary;
                return (
                  <Fragment key={loc.storeId}>
                    <tr
                      className={`border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${isLoading ? "opacity-50" : ""}`}
                      onClick={() => setExpandedIds(prev => {
                        const n = new Set(prev);
                        if (n.has(loc.storeId)) n.delete(loc.storeId); else n.add(loc.storeId);
                        return n;
                      })}
                    >
                      <td className="px-3 py-3 text-right text-xs text-gray-400 tabular-nums">{i + 1}.</td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {loc.name}
                        <span className="ml-2 text-xs text-gray-400">{loc.state}</span>
                      </td>
                      {isLoading ? (
                        <td colSpan={6} className="px-4 py-3 text-xs text-gray-400 animate-pulse">Loading…</td>
                      ) : s ? (
                        <>
                          <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{fmtDollars(s.netSales)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{s.transactions.toLocaleString()}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtDollars(s.avgTicket)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmtHours(s.laborHours)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-orange-600 font-medium">{fmtHours(s.peakHours)}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-gray-600">{fmtHours(s.nonPeakHours)}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="px-4 py-3 text-xs text-gray-400">—</td>
                      )}
                    </tr>
                    {isOpen && data && (
                      <tr>
                        <td colSpan={8} className="border-b border-gray-100">
                          <HourlyTable hourly={data.hourly} dayparts={data.dayparts} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
