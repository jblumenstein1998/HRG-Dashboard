"use client";

/**
 * Week-by-week full inventory counts under the Quality Director's COGS category.
 * The scorecard keeps only a yes or no for the period, so this is where a Quality
 * Director sees which weeks cost them.
 */

import { useEffect, useState } from "react";
import type { FullCountWeek } from "@/lib/netchefInventory";

type Response = {
  weeks: FullCountWeek[];
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
        <span className="text-xs font-semibold text-gray-700">Full inventory counts</span>
        {loading && <span className="text-[11px] text-gray-400 animate-pulse">Loading from Net-Chef…</span>}
        {data && <span className="text-xs text-gray-400">A count entered every Monday earns both threshold and target.</span>}
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
    </div>
  );
}
