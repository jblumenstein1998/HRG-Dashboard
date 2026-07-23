"use client";

import { useEffect, useState, useCallback } from "react";
import type { PARLocation } from "@/lib/par";

type HourBucket = { hour: number; label: string; netSales: number; orderCount: number; laborHours: number };

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

const fmtDollars = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function HourlyAuditClient({ locations }: { locations: PARLocation[] }) {
  const [storeId, setStoreId] = useState(locations[0]?.storeId ?? "");
  const [date, setDate] = useState(todayISO());
  const [hours, setHours] = useState<HourBucket[]>([]);
  const [storeName, setStoreName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(() => {
    if (!storeId || !date) return;
    setLoading(true);
    setError(null);
    fetch(`/api/par/hourly-breakdown?store=${storeId}&date=${date}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? "Failed to load");
        return r.json();
      })
      .then(d => {
        setHours(d.hours ?? []);
        setStoreName(d.store ?? "");
      })
      .catch(err => setError(String(err.message ?? err)))
      .finally(() => setLoading(false));
  }, [storeId, date]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dayTotal = hours.reduce(
    (acc, h) => ({ netSales: acc.netSales + h.netSales, orderCount: acc.orderCount + h.orderCount, laborHours: acc.laborHours + h.laborHours }),
    { netSales: 0, orderCount: 0, laborHours: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
          <h1 className="text-base font-semibold text-gray-900">Hourly Audit</h1>
          <span className="text-xs text-gray-400">— cross-check against Brink&apos;s hourly sales report</span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={storeId}
              onChange={e => setStoreId(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700"
            >
              {locations.map(loc => (
                <option key={loc.storeId} value={loc.storeId}>{loc.name} ({loc.state})</option>
              ))}
            </select>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700"
            />
            <button
              onClick={fetchData}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {error && (
          <div className="mb-4 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}

        {!error && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-sm font-semibold text-gray-800">
              {storeName || "—"} · {date}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2 font-medium">Hour</th>
                  <th className="px-4 py-2 font-medium text-right">Net Sales</th>
                  <th className="px-4 py-2 font-medium text-right">Orders</th>
                  <th className="px-4 py-2 font-medium text-right">Labor Hrs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {hours.map(h => (
                  <tr key={h.hour} className={h.netSales === 0 && h.orderCount === 0 ? "text-gray-300" : "text-gray-900"}>
                    <td className="px-4 py-1.5 tabular-nums">{h.label}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmtDollars(h.netSales)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{h.orderCount}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{h.laborHours.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200 font-semibold text-gray-900">
                  <td className="px-4 py-2">Total</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtDollars(dayTotal.netSales)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dayTotal.orderCount}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{dayTotal.laborHours.toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
