"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

const METRICS = [
  { id: "631212", label: "Overall Satisfaction" },
  { id: "631215", label: "Accuracy of Order" },
  { id: "631218", label: "Friendliness" },
  { id: "631220", label: "Cleanliness" },
];

const RANGES = [
  { key: "7d", label: "7 Days" },
  { key: "cw", label: "Cur. Week" },
  { key: "pw", label: "Prev. Week" },
  { key: "cp", label: "Cur. Period" },
  { key: "pp", label: "Prev. Period" },
];

type StoreScore = {
  unitId: string;
  unitName: string;
  scores: Record<string, number | null>; // itemId -> score (0-100 or null)
  counts: Record<string, number>;
};

type SmgData = {
  range: { start: string; end: string };
  stores: StoreScore[];
};

function scoreColor(score: number | null): string {
  if (score === null) return "text-gray-400";
  if (score >= 90) return "text-green-600";
  if (score >= 80) return "text-yellow-600";
  return "text-red-600";
}

function scoreBg(score: number | null): string {
  if (score === null) return "bg-gray-50";
  if (score >= 90) return "bg-green-50";
  if (score >= 80) return "bg-yellow-50";
  return "bg-red-50";
}

function avg(stores: StoreScore[], itemId: string): number | null {
  const vals = stores.map(s => s.scores[itemId]).filter((v): v is number => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

export default function GuestSatisfactionClient() {
  const router = useRouter();
  const [range, setRange] = useState("cp");
  const [data, setData] = useState<SmgData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<string>("unitName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const fetchData = useCallback(async (r: string) => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/smg/data?range=${r}`);

    if (res.status === 401) { router.push("/login"); return; }

    const json = await res.json();

    if (!res.ok) {
      setError(json.error ?? "Failed to load guest satisfaction data");
      setLoading(false);
      return;
    }

    setData(json as SmgData);
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchData(range); }, [range, fetchData]);

  function handleSort(col: string) {
    if (sortBy === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortBy(col); setSortDir("desc"); }
  }

  const stores = data?.stores ?? [];
  const sorted = [...stores].sort((a, b) => {
    let av: number | string | null, bv: number | string | null;
    if (sortBy === "unitName") { av = a.unitName; bv = b.unitName; }
    else { av = a.scores[sortBy]; bv = b.scores[sortBy]; }

    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  const rangeLabel = data ? `${data.range.start} – ${data.range.end}` : "";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div>
              <select
                value="/guest-satisfaction"
                onChange={e => router.push(e.target.value)}
                className="text-base font-semibold text-gray-900 leading-tight bg-transparent border-0 p-0 cursor-pointer focus:outline-none focus:ring-0"
              >
                <option value="/dashboard">Drive-Thru</option>
                <option value="/guest-satisfaction">Guest Scores</option>
                <option value="/food-cost">Food Cost</option>
              </select>
              {rangeLabel && <p className="text-xs text-gray-400 leading-tight">{rangeLabel}</p>}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {RANGES.map(o => (
                <button
                  key={o.key}
                  onClick={() => setRange(o.key)}
                  disabled={loading}
                  className={`text-xs px-3 py-1.5 transition disabled:opacity-50 ${
                    range === o.key
                      ? "bg-red-700 text-white font-medium"
                      : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => fetchData(range)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-6 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => fetchData(range)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        {/* Summary cards */}
        {data && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {METRICS.map(m => {
              const score = avg(stores, m.id);
              return (
                <div key={m.id} className={`rounded-xl border border-gray-200 p-4 ${scoreBg(score)}`}>
                  <p className="text-xs text-gray-500 font-medium mb-1">{m.label}</p>
                  <p className={`text-3xl font-bold ${scoreColor(score)}`}>
                    {score !== null ? score.toFixed(1) : "—"}
                    <span className="text-sm font-normal text-gray-400 ml-0.5">%</span>
                  </p>
                  <p className="text-xs text-gray-400 mt-1">avg across all stores</p>
                </div>
              );
            })}
          </div>
        )}

        {loading && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {METRICS.map(m => (
              <div key={m.id} className="rounded-xl border border-gray-200 p-4 animate-pulse">
                <div className="h-3 bg-gray-100 rounded w-3/4 mb-3" />
                <div className="h-8 bg-gray-100 rounded w-1/2" />
              </div>
            ))}
          </div>
        )}

        {/* Store table */}
        {data && sorted.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th
                    className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 select-none"
                    onClick={() => handleSort("unitName")}
                  >
                    Store {sortBy === "unitName" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </th>
                  {METRICS.map(m => (
                    <th
                      key={m.id}
                      className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer hover:text-gray-800 select-none whitespace-nowrap"
                      onClick={() => handleSort(m.id)}
                    >
                      {m.label} {sortBy === m.id ? (sortDir === "asc" ? "↑" : "↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((store, i) => (
                  <tr
                    key={store.unitId}
                    className={`border-b border-gray-50 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-900">{store.unitName}</td>
                    {METRICS.map(m => {
                      const s = store.scores[m.id];
                      return (
                        <td key={m.id} className={`px-4 py-3 text-right font-semibold tabular-nums ${scoreColor(s)}`}>
                          {s !== null && s !== undefined ? `${s.toFixed(1)}%` : "—"}
                          {store.counts[m.id] ? (
                            <span className="text-xs font-normal text-gray-400 ml-1">({store.counts[m.id]})</span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-4 px-4 py-3 border-b border-gray-50 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-1/4" />
                <div className="flex-1 grid grid-cols-4 gap-4">
                  {[0,1,2,3].map(j => <div key={j} className="h-4 bg-gray-100 rounded" />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
