import type { OperatingTargets, TargetRow, TargetSection } from "@/lib/operatingTargets";

/**
 * The Store Operating Targets, published on the Admin tab. Every number comes
 * from the bonus scorecards (lib/operatingTargets.ts reads lib/bonus/rules.ts),
 * so this is what's scored, not a copy of the sheet. Laid out like the sheet:
 * two columns of sections, threshold (50%) and target (100%) per metric.
 */
export default function OperatingTargetsPanel({ targets }: { targets: OperatingTargets }) {
  const columns = balance(targets.sections);

  return (
    <section className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="px-4 pt-4 pb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-900">Store Operating Targets</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Threshold = 50% category payout · Target = 100% category payout. Read from the bonus scorecards, so this is
          exactly what&apos;s scored, and the dashboard colours by the same numbers: green at target, yellow at
          threshold, red below.
        </p>
      </div>

      <div className="mx-4 mb-4 rounded-md bg-gray-900 px-4 py-2.5 text-sm text-white">
        <span className="mr-3 text-xs font-semibold uppercase tracking-wide text-gray-300">North star</span>
        {targets.northStar}
      </div>

      <div className="grid gap-x-8 gap-y-4 px-4 pb-4 lg:grid-cols-2">
        {columns.map((col, i) => (
          <table key={i} className="w-full self-start text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-400">
                <th className="py-1.5 text-left font-medium uppercase tracking-wide">Store metric</th>
                <th className="w-28 py-1.5 text-right font-medium uppercase tracking-wide">Threshold</th>
                <th className="w-40 py-1.5 text-right font-medium uppercase tracking-wide">Target</th>
              </tr>
            </thead>
            {col.map((s) => (
              <tbody key={s.title}>
                <tr>
                  <td colSpan={3} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-red-700">
                    {s.title}
                  </td>
                </tr>
                {s.rows.map((r) => (
                  <Row key={r.metric} r={r} />
                ))}
              </tbody>
            ))}
          </table>
        ))}
      </div>

      <div className="grid gap-x-8 gap-y-4 border-t border-gray-100 px-4 py-3 text-xs lg:grid-cols-2">
        <div>
          <h3 className="mb-1 font-semibold uppercase tracking-wide text-gray-700">Category disqualifiers</h3>
          <table className="w-full">
            <tbody>
              {targets.guardrails.map((g) => (
                <tr key={g.who + g.text} className="border-b border-gray-50 last:border-0">
                  <td className="py-1 pr-3 text-gray-700">
                    {g.text}
                    <span className="block text-gray-400">{g.who}</span>
                  </td>
                  <td className="whitespace-nowrap py-1 text-right align-top font-semibold text-gray-900">0% category</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-1 font-semibold uppercase tracking-wide text-gray-700">Bonus multipliers</h3>
          <table className="w-full">
            <tbody>
              {targets.notOnSheet.map((r) => (
                <tr key={r.who + r.earns} className="border-b border-gray-50 last:border-0">
                  <td className="py-1 pr-3 text-gray-700">
                    {r.earns}
                    <span className="block text-gray-400">{r.who}</span>
                  </td>
                  <td className="whitespace-nowrap py-1 text-right align-top font-semibold tabular-nums text-gray-900">{r.pays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/** Splits the sections into two columns of about equal height (rows, plus one per heading). */
function balance(sections: TargetSection[]): [TargetSection[], TargetSection[]] {
  const height = (s: TargetSection[]) => s.reduce((n, x) => n + x.rows.length + 1, 0);
  let best = 1;
  for (let i = 1; i < sections.length; i++) {
    const gap = Math.abs(height(sections.slice(0, i)) - height(sections.slice(i)));
    if (gap < Math.abs(height(sections.slice(0, best)) - height(sections.slice(best)))) best = i;
  }
  return [sections.slice(0, best), sections.slice(best)];
}

function Row({ r }: { r: TargetRow }) {
  return (
    <tr className="border-b border-gray-50 last:border-0">
      <td className="py-1 pr-2 text-gray-700">
        {r.metric}
        {r.note && <span className="ml-1.5 text-xs text-gray-400">{r.note}</span>}
      </td>
      <td className="whitespace-nowrap py-1 pl-3 text-right tabular-nums text-gray-500">{r.threshold}</td>
      <td className="whitespace-nowrap py-1 pl-3 text-right font-semibold tabular-nums text-gray-900">{r.target}</td>
    </tr>
  );
}
