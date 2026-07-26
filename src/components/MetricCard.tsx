"use client";

import type { MetricDisplay } from "@/lib/tools/displayFormat";

// Renders figures straight from the tool's own output. The model picks which
// tool runs and writes the commentary around this card, but every digit shown
// here came from the tool result — so a number on this card cannot be
// fabricated, and the house formatting cannot drift.
//
// The store and date range are deliberately shown alongside the value: if the
// model asked the wrong question, the answer is real but irrelevant, and the
// only way to notice is to see which question was actually answered.
export default function MetricCard({ display }: { display: MetricDisplay }) {
  return (
    <div className="my-2 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="text-xs font-semibold text-gray-900">{display.title}</div>
      {display.subtitle && (
        <div className="text-[11px] text-gray-500">{display.subtitle}</div>
      )}

      <dl className="mt-2 space-y-1">
        {display.rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4">
            <dt className="text-[11px] text-gray-500">{row.label}</dt>
            <dd className="text-xs font-medium tabular-nums text-gray-900">{row.value}</dd>
          </div>
        ))}
      </dl>

      {display.note && (
        <p className="mt-2 border-t border-gray-100 pt-2 text-[11px] text-amber-700">
          {display.note}
        </p>
      )}
    </div>
  );
}
