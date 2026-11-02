"use client";

/**
 * Day-by-day inventory counts under the Quality Director's COGS category: the
 * AM and PM critical-item counts for every day of the period, and the full
 * count each week. The scorecard keeps only the two totals, so this is where a
 * Quality Director sees which days cost them.
 */

import { useEffect, useState } from "react";
import type { CriticalDay, FullCountWeek } from "@/lib/netchefInventory";

type Response = {
  days: CriticalDay[];
  weeks: FullCountWeek[];
  criticalPct: number | null;
  criticalDone: number;
  criticalSlots: number;
  error?: string;
};

const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
};
const weekday = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
};

function Cell({ at, excused }: { at: string | null; excused: boolean }) {
  if (excused && !at) {
    return (
      <span className="inline-block w-full rounded bg-gray-50 text-gray-400 text-[10px] py-0.5" title="Full-count day — not required">
        full
      </span>
    );
  }
  return at ? (
    <span className="inline-block w-full rounded bg-green-50 text-green-700 text-[10px] tabular-nums py-0.5" title={`Entered ${at}`}>
      {at}
    </span>
  ) : (
    <span className="inline-block w-full rounded bg-red-50 text-red-600 text-[10px] py-0.5">missed</span>
  );
}

export default function InventoryCountsPanel({ period, storeId }: { period: string; storeId: string }) {
  const key = `${period}|${storeId}`;
  const [state, setState] = useState<{ key: string; data: Response | null; error: string | null }>(
    { key: "", data: null, error: null },
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/inventory?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then(async (r) => {
        const json = (await r.json()) as Response;
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json;
      })
      .then((json) => { if (!cancelled) setState({ key, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [key, period, storeId]);

  const loading = state.key !== key;
  const data = state.key === key ? state.data : null;

  return (
    <div className="border-t border-gray-100 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-semibold text-gray-700">Inventory counts</span>
        {loading && <span className="text-[11px] text-gray-400 animate-pulse">Loading from Net-Chef…</span>}
        {data && (
          <span className="text-xs text-gray-600">
            {data.criticalDone} of {data.criticalSlots} critical counts done
            {data.criticalPct !== null && ` (${data.criticalPct}%)`}.
            <span className="text-gray-400"> Mondays are excused (full-count day). 95% earns half, 100% full — with a full count every Monday.</span>
          </span>
        )}
      </div>
      {state.error && state.key === key && <p className="text-xs text-red-600">{state.error}</p>}

      {data && data.weeks.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {data.weeks.map((w) => (
            <span
              key={w.weekStart}
              className={`text-[11px] rounded-md border px-2 py-0.5 ${
                !w.judged
                  ? "border-gray-200 text-gray-400"
                  : w.onTime
                    ? "border-green-200 bg-green-50 text-green-700"
                    : "border-red-200 bg-red-50 text-red-700"
              }`}
              title={w.enteredAt ? `${w.items} items` : undefined}
            >
              Full count for week of {md(w.weekStart)}:{" "}
              {!w.judged
                ? `due Mon ${md(w.dueOn)}`
                : w.enteredAt
                  ? w.onTime
                    ? `Mon ${md(w.dueOn)} ${w.enteredAt.slice(11)}`
                    : `late — ${weekday(w.enteredAt.slice(0, 10))} ${md(w.enteredAt.slice(0, 10))} ${w.enteredAt.slice(11)}`
                  : "missed"}
            </span>
          ))}
        </div>
      )}

      {data && data.days.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs border-separate border-spacing-0.5">
            <thead>
              <tr className="text-[10px] text-gray-400">
                <th />
                {data.days.map((d) => (
                  <th key={d.date} className="font-normal min-w-[2.75rem] text-center">
                    <div>{weekday(d.date)}</div>
                    <div className="tabular-nums">{md(d.date)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["am", "pm"] as const).map((slot) => (
                <tr key={slot}>
                  <td className="pr-1 text-[10px] uppercase tracking-wide text-gray-400">{slot}</td>
                  {data.days.map((d) => (
                    <td key={d.date} className="text-center"><Cell at={d[slot]} excused={d.excused} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
