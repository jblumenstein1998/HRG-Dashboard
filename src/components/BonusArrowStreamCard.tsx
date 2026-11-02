"use client";

/**
 * The Quality Director's ArrowStream bonus for a period.
 *
 * From the binder's Quality Director plan: "The Quality Director at the store
 * with the largest number ArrowStream credits received will receive the full
 * dollar amount of credits received as a one-time bonus for that period."
 *
 * A flat dollar award decided across stores, so it sits beside the scorecards
 * rather than in one. Each store's credits and their dollar value are entered
 * on its Quality Director scorecard (q_arrowstream_credits / _dollars, recorded
 * but not scored); this reads every store's entries for the period and names
 * the winner — most credits, dollars breaking a tie, and a true tie shown as
 * one rather than settled silently.
 */

import { useEffect, useState } from "react";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import type { BonusInput } from "@/lib/bonus/types";

type Row = { storeId: string; name: string; credits: number | null; dollars: number | null };

const money = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export default function BonusArrowStreamCard({ period, refreshKey }: { period: string; refreshKey: number }) {
  const key = `${period}|${refreshKey}`;
  const [loaded, setLoaded] = useState<{ key: string; rows: Row[] | null; error: string | null }>({ key: "", rows: null, error: null });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/inputs?period=${encodeURIComponent(period)}`)
      .then((r) => r.json())
      .then((json: { inputs?: BonusInput[]; error?: string }) => {
        if (cancelled) return;
        if (json.error) return setLoaded({ key, rows: null, error: json.error });
        const byStore = new Map<string, Row>();
        for (const i of json.inputs ?? []) {
          if (i.criterionId !== "q_arrowstream_credits" && i.criterionId !== "q_arrowstream_dollars") continue;
          if (i.value === null) continue;
          const s = BONUS_STORES.find((x) => x.storeId === i.storeId);
          const row = byStore.get(i.storeId) ?? { storeId: i.storeId, name: s?.name ?? i.storeId, credits: null, dollars: null };
          if (i.criterionId === "q_arrowstream_credits") row.credits = i.value;
          else row.dollars = i.value;
          byStore.set(i.storeId, row);
        }
        const rows = [...byStore.values()].sort((a, b) => (b.credits ?? -1) - (a.credits ?? -1) || (b.dollars ?? -1) - (a.dollars ?? -1));
        setLoaded({ key, rows, error: null });
      })
      .catch((e) => { if (!cancelled) setLoaded({ key, rows: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [period, key]);

  const loading = loaded.key !== key;
  const rows = loading ? null : loaded.rows;
  const counted = (rows ?? []).filter((r) => r.credits !== null && r.credits > 0);
  const top = counted[0];
  const tied = top ? counted.filter((r) => r.credits === top.credits && r.dollars === top.dollars) : [];

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-gray-900">ArrowStream credits bonus · Quality Director</h2>
      <p className="mt-0.5 text-xs text-gray-500">
        The Quality Director at the store with the most ArrowStream credits this period is paid the full dollar amount of
        those credits as a one-time bonus. Enter each store&apos;s credits and their dollar value on its Quality Director
        scorecard. This is paid on top of attainment; it isn&apos;t a percentage of target.
      </p>

      {loading && <p className="mt-3 text-xs text-gray-400">Reading entries…</p>}
      {!loading && loaded.error && <p className="mt-3 text-xs text-red-600">{loaded.error}</p>}

      {!loading && !loaded.error && (
        <>
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm">
            {!top ? (
              <span className="text-gray-500">No ArrowStream credits entered for {period} yet.</span>
            ) : tied.length > 1 ? (
              <span className="text-amber-700">
                Tie at {top.credits} credits ({money(top.dollars)}): {tied.map((r) => r.name).join(", ")}. Decide the award by hand.
              </span>
            ) : top.dollars === null ? (
              <span className="text-gray-700">
                <span className="font-semibold text-gray-900">{top.name}</span> leads with {top.credits} credits — enter the
                dollar value to set the bonus.
              </span>
            ) : (
              <span className="text-gray-700">
                <span className="font-semibold text-gray-900">{top.name}</span>&apos;s Quality Director earns{" "}
                <span className="font-semibold text-green-700">{money(top.dollars)}</span> ({top.credits} credits).
              </span>
            )}
          </div>

          {rows && rows.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-xs text-gray-500">
                  <th className="py-1.5 text-left font-medium">Store</th>
                  <th className="py-1.5 text-right font-medium">Credits</th>
                  <th className="py-1.5 text-right font-medium">Dollars</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.storeId} className="border-b border-gray-50 last:border-0">
                    <td className={`py-1.5 ${top && r.storeId === top.storeId && tied.length <= 1 ? "font-semibold text-gray-900" : "text-gray-700"}`}>{r.name}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">{r.credits ?? "—"}</td>
                    <td className="py-1.5 text-right tabular-nums text-gray-700">{money(r.dollars)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
