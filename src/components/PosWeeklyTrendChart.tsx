"use client";

import { useState, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CopyableTitle } from "@/components/CopyImageButton";
import { inFilter, type StoreFilter } from "@/components/StoreFilter";
import { STORE_COLOR } from "@/lib/surveyMeta";

// ── Weekly trend line chart (POS tab) ─────────────────────────────────────────
// Week-grain only: the From/To pickers list whole Mon–Sun weeks, never free
// dates, and default to the six weeks ending on the most recent Sunday. One
// line per store plus TN / VA / HRG summary lines, each toggleable like the
// Drive-Thru trend charts; the hover box gives every visible line's change vs
// last year and vs the week before. Types are duplicated (not imported) from
// @/lib/parWeeklyTrend for the same reason as PARClient's: that module pulls
// in the Postgres client at module scope.

type WeekTotals = { netSales: number; transactions: number; laborHours: number };
type StoreWeeklyTrend = { storeId: string; name: string; state: "TN" | "VA"; ty: (WeekTotals | null)[]; ly: (WeekTotals | null)[] };
type WeeklyTrend = { weeks: string[]; stores: StoreWeeklyTrend[]; rolledUpThrough: string | null };

// First full Mon–Sun week in par_daily_metrics (the rollup starts Tue 2024-07-23).
const FIRST_WEEK = "2024-07-29";
const DEFAULT_WEEKS = 6;

type MetricKey = "netSales" | "transactions" | "avgCheck" | "productivity" | "tplh";

// `additive` metrics (sales, transactions) are drawn per-store for the summary
// lines — an HRG *total* of ~$700k on the same axis as $25–80k stores would
// flatten every store line — while the hover box still reports the HRG total.
// Ratio metrics are taken over the group's summed components, never averaged
// across stores (see AvgCheckRaw in PARClient), so their HRG line *is* the HRG
// total figure.
const METRICS: { key: MetricKey; label: string; additive: boolean; fmt: (v: number) => string; derive: (t: WeekTotals) => number | null }[] = [
  { key: "netSales", label: "Net Sales", additive: true, fmt: v => v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }), derive: t => t.netSales },
  { key: "transactions", label: "Transactions", additive: true, fmt: v => Math.round(v).toLocaleString(), derive: t => t.transactions },
  { key: "avgCheck", label: "Average Check", additive: false, fmt: v => `$${v.toFixed(2)}`, derive: t => (t.transactions > 0 ? t.netSales / t.transactions : null) },
  { key: "productivity", label: "Productivity", additive: false, fmt: v => `$${v.toFixed(2)}`, derive: t => (t.laborHours > 0 ? t.netSales / t.laborHours : null) },
  { key: "tplh", label: "TPLH", additive: false, fmt: v => v.toFixed(2), derive: t => (t.laborHours > 0 ? t.transactions / t.laborHours : null) },
];
type Metric = (typeof METRICS)[number];

/**
 * Summary lines sit outside the store palette, same as DriveThruTrendCharts:
 * neutral ink, a heavier stroke, and told apart by dash pattern, not hue.
 */
const SUMMARY_COLOR = "#111827";
const SUMMARY_WIDTH = 2.5;
const SUMMARY_DASH: Record<string, string | undefined> = { tn: undefined, va: "6 4", hrg: "2 3" };

// ── Date helpers (local-time, so a Monday never slips a day through UTC) ──────

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return iso(new Date(y, m - 1, d + days));
}
function fmtShort(isoDate: string): string {
  const [, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}`;
}
function fmtWithYear(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${m}/${d}/${String(y).slice(2)}`;
}

// Monday of the week that ended on the most recent Sunday (today, if today is
// Sunday) — the same "last completed week" the rest of the POS tab uses.
function lastCompletedWeekStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay() - 6);
  return iso(d);
}

// Every selectable week, newest first.
function weekOptions(): string[] {
  const out: string[] = [];
  for (let w = lastCompletedWeekStart(); w >= FIRST_WEEK; w = addDays(w, -7)) out.push(w);
  return out;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

// A store counts toward a week only once it has rung a sale in it — Portland's
// pre-opening days sit in the rollup as $0 rows and would otherwise drag every
// average it's part of toward zero.
function tradingWeeks(stores: StoreWeeklyTrend[], year: "ty" | "ly", i: number): WeekTotals[] {
  return stores.map(s => s[year][i]).filter((t): t is WeekTotals => t != null && t.transactions > 0);
}

function sumTotals(rows: WeekTotals[]): WeekTotals {
  return {
    netSales: rows.reduce((s, t) => s + t.netSales, 0),
    transactions: rows.reduce((s, t) => s + t.transactions, 0),
    laborHours: rows.reduce((s, t) => s + t.laborHours, 0),
  };
}

// For one store this is just its own figure; for a group it's the per-store
// average (additive metrics) or the group ratio (everything else).
function groupValue(stores: StoreWeeklyTrend[], year: "ty" | "ly", i: number, m: Metric): number | null {
  const rows = tradingWeeks(stores, year, i);
  if (rows.length === 0) return null;
  const v = m.derive(sumTotals(rows));
  return v != null && m.additive ? v / rows.length : v;
}

function groupTotal(stores: StoreWeeklyTrend[], year: "ty" | "ly", i: number, m: Metric): number | null {
  const rows = tradingWeeks(stores, year, i);
  return rows.length === 0 ? null : m.derive(sumTotals(rows));
}

function pctChange(now: number | null | undefined, then: number | null | undefined): number | null {
  if (now == null || then == null || then === 0) return null;
  return ((now - then) / then) * 100;
}

const trading = (t: WeekTotals | null): boolean => t != null && t.transactions > 0;

/**
 * Same-store % change of week `i` against `then` (the same week last year, or
 * the week before): both sides are taken over only the stores that rang sales
 * in both weeks, so a store opening, closing or missing data never reads as
 * growth or decline. The plotted figure itself still covers every store.
 */
function sameStorePct(
  stores: StoreWeeklyTrend[], i: number, then: { year: "ty" | "ly"; i: number }, m: Metric, total: boolean,
): number | null {
  if (then.i < 0) return null;
  const both = stores.filter(s => trading(s.ty[i]) && trading(s[then.year][then.i]));
  if (both.length === 0) return null;
  const value = total ? groupTotal : groupValue;
  return pctChange(value(both, "ty", i, m), value(both, then.year, then.i, m));
}

// ── Series ────────────────────────────────────────────────────────────────────

type Series = {
  key: string;
  label: string;
  kind: "store" | "summary";
  color: string;
  dash?: string;
  stores: StoreWeeklyTrend[];
};

// Per series, aligned to the fetched weeks (index 0 is the lead-in week, kept
// only so the first plotted week has a "vs LW").
type SeriesValues = { ty: (number | null)[]; vsLY: (number | null)[]; vsLW: (number | null)[] };

function seriesValues(stores: StoreWeeklyTrend[], weekCount: number, m: Metric, total: boolean): SeriesValues {
  const idx = Array.from({ length: weekCount }, (_, i) => i);
  return {
    ty: idx.map(i => (total ? groupTotal : groupValue)(stores, "ty", i, m)),
    vsLY: idx.map(i => sameStorePct(stores, i, { year: "ly", i }, m, total)),
    vsLW: idx.map(i => sameStorePct(stores, i, { year: "ty", i: i - 1 }, m, total)),
  };
}

type ChartRow = { week: string; idx: number } & Record<string, number | string | null>;

function PctCell({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-300">—</span>;
  return <span className={pct >= 0 ? "text-green-600" : "text-red-600"}>{`${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}</span>;
}

function TrendTooltip({ active, payload, metric, series, values, hrgTotal }: {
  active?: boolean;
  payload?: { payload: ChartRow }[];
  metric: Metric;
  series: Series[];
  values: Record<string, SeriesValues>;
  hrgTotal: SeriesValues | null;
}) {
  if (!active || !payload?.length) return null;
  const { week, idx } = payload[0].payload;
  const line = (label: string, v: SeriesValues, color: string, dash: string | undefined, strong: boolean) => (
    <tr key={label} className={strong ? "font-medium text-gray-900" : "text-gray-600"}>
      <td className="pr-3 py-0.5 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5">
          <svg width="14" height="6" aria-hidden="true" className="shrink-0">
            <line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth={strong ? 2.5 : 2} strokeDasharray={dash} />
          </svg>
          {label}
        </span>
      </td>
      <td className="pr-3 py-0.5 text-right tabular-nums text-gray-800">{v.ty[idx] == null ? "—" : metric.fmt(v.ty[idx]!)}</td>
      <td className="pr-3 py-0.5 text-right tabular-nums"><PctCell pct={v.vsLY[idx]} /></td>
      <td className="py-0.5 text-right tabular-nums"><PctCell pct={v.vsLW[idx]} /></td>
    </tr>
  );
  const summaries = series.filter(s => s.kind === "summary");
  const stores = series.filter(s => s.kind === "store").sort((a, b) => (values[b.key].ty[idx] ?? -Infinity) - (values[a.key].ty[idx] ?? -Infinity));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-1.5">Week beginning {fmtWithYear(week)}</p>
      <table>
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-gray-400">
            <th className="pr-3 pb-1 text-left font-semibold">{metric.label}</th>
            <th className="pr-3 pb-1 text-right font-semibold">TY</th>
            <th className="pr-3 pb-1 text-right font-semibold">vs LY</th>
            <th className="pb-1 text-right font-semibold">vs LW</th>
          </tr>
        </thead>
        <tbody>
          {summaries.map(s => line(s.label, values[s.key], s.color, s.dash, true))}
          {hrgTotal && line("HRG Total", hrgTotal, SUMMARY_COLOR, SUMMARY_DASH.hrg, true)}
          {summaries.length + (hrgTotal ? 1 : 0) > 0 && stores.length > 0 && (
            <tr><td colSpan={4} className="py-0.5"><div className="border-t border-gray-100" /></td></tr>
          )}
          {stores.map(s => line(s.label, values[s.key], s.color, undefined, false))}
        </tbody>
      </table>
    </div>
  );
}

export default function PosWeeklyTrendChart({ filter, refreshToken }: { filter: StoreFilter; refreshToken: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const options = weekOptions();
  const [toWeek, setToWeek] = useState(options[0]);
  const [fromWeek, setFromWeek] = useState(options[Math.min(DEFAULT_WEEKS - 1, options.length - 1)]);
  const [metricKey, setMetricKey] = useState<MetricKey>("netSales");
  // Hidden rather than visible, so every line — including stores that only
  // appear once data lands — starts switched on.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  // One week before `fromWeek` rides along so the first plotted week has a
  // "vs LW". The very first week of history has nothing before it.
  const leadIn = fromWeek > FIRST_WEEK;
  const fetchFrom = leadIn ? addDays(fromWeek, -7) : fromWeek;

  // Tagged with the request that produced it, so "loading" is just "the data on
  // screen isn't for the current selection yet" — and the previous weeks stay
  // drawn while the next ones load, instead of the chart blanking out.
  const requestKey = `${fetchFrom}|${toWeek}|${refreshToken}`;
  const [result, setResult] = useState<{ key: string; data: WeeklyTrend | null; leadIn: boolean } | null>(null);
  const loading = result?.key !== requestKey;
  const data = result?.data ?? null;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/par/weekly-trend?from=${fetchFrom}&to=${toWeek}`)
      .then(r => r.json())
      .then((d: WeeklyTrend) => { if (!cancelled) setResult({ key: requestKey, data: d.weeks ? d : null, leadIn }); })
      .catch(err => {
        console.error("[PAR] weekly-trend fetch failed", err);
        if (!cancelled) setResult({ key: requestKey, data: null, leadIn });
      });
    return () => { cancelled = true; };
  }, [fetchFrom, toWeek, leadIn, requestKey]);

  const m = METRICS.find(x => x.key === metricKey)!;
  const all = data?.stores ?? [];

  // The leader narrows the store lines *and* the TN/VA lines, so a filtered
  // chart can't show one leader's stores against a market-wide average. HRG is
  // deliberately not filtered — it's the benchmark, same as the tables below.
  const visibleStores = all.filter(s => inFilter(filter.allowed, s.name));
  const markets = (["TN", "VA"] as const).filter(st => visibleStores.some(s => s.state === st));
  const avgWord = m.additive ? " Avg" : "";
  const series: Series[] = [
    ...markets.map(st => ({
      key: st.toLowerCase(), label: `${st}${avgWord}`, kind: "summary" as const,
      color: SUMMARY_COLOR, dash: SUMMARY_DASH[st.toLowerCase()],
      stores: visibleStores.filter(s => s.state === st),
    })),
    ...(all.length > 0 ? [{ key: "hrg", label: `HRG${avgWord}`, kind: "summary" as const, color: SUMMARY_COLOR, dash: SUMMARY_DASH.hrg, stores: all }] : []),
    ...visibleStores.map(s => ({
      key: s.storeId, label: s.name, kind: "store" as const, color: STORE_COLOR[s.name] ?? "#6b7280", stores: [s],
    })),
  ];

  const weekCount = data?.weeks.length ?? 0;
  const values: Record<string, SeriesValues> = {};
  for (const s of series) values[s.key] = seriesValues(s.stores, weekCount, m, false);
  const hrgTotal: SeriesValues | null = m.additive && all.length > 0 && !hidden.has("hrg")
    ? seriesValues(all, weekCount, m, true)
    : null;

  const firstPlotted = result?.leadIn ? 1 : 0;
  const rows: ChartRow[] = (data?.weeks ?? []).slice(firstPlotted).map((week, j) => {
    const idx = j + firstPlotted;
    const row: ChartRow = { week, idx };
    for (const s of series) row[s.key] = values[s.key].ty[idx];
    return row;
  });

  const shown = series.filter(s => !hidden.has(s.key));
  const toggle = (keys: string[], on: boolean) =>
    setHidden(prev => {
      const n = new Set(prev);
      for (const k of keys) { if (on) n.delete(k); else n.add(k); }
      return n;
    });

  // Stores left out of some plotted week's comparison because they had no
  // sales in one of the two weeks (a new-build has no last year, a store's
  // first or closed week has no week before) — named in the footnote.
  const plottedIdx = rows.map(r => r.idx);
  const excluded = all
    .filter(s => plottedIdx.some(i => trading(s.ty[i]) && (!trading(s.ly[i]) || (i > 0 && !trading(s.ty[i - 1])))))
    .map(s => s.name);
  const lastShownEnd = data ? addDays(data.weeks[data.weeks.length - 1], 6) : null;
  const partialThrough = data?.rolledUpThrough && lastShownEnd && data.rolledUpThrough < lastShownEnd ? data.rolledUpThrough : null;

  const selectClass = "text-xs rounded-lg border border-gray-200 bg-white px-2 py-1 text-gray-700 cursor-pointer focus:outline-none focus:ring-1 focus:ring-red-700";

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-2">
        <CopyableTitle title={`Weekly Trend — ${m.label}`} targetRef={cardRef} className="text-sm font-semibold text-gray-800" />
        {/* Excluded from the copied image — the title and axis already record what was captured. */}
        <div data-copy-image-ignore="true" className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {METRICS.map(x => (
              <button
                key={x.key}
                onClick={() => setMetricKey(x.key)}
                className={`text-xs px-3 py-1 transition ${metricKey === x.key ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {x.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <select aria-label="From week" value={fromWeek} onChange={e => setFromWeek(e.target.value)} className={selectClass}>
              {options.map(w => (
                <option key={w} value={w} disabled={w > toWeek}>Week beginning {fmtWithYear(w)}</option>
              ))}
            </select>
            <span className="text-xs text-gray-400">to</span>
            <select aria-label="To week" value={toWeek} onChange={e => setToWeek(e.target.value)} className={selectClass}>
              {options.map(w => (
                <option key={w} value={w} disabled={w < fromWeek}>Week beginning {fmtWithYear(w)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="ml-auto text-xs text-gray-500">
          {loading && <span className="text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>
      <div className="px-2 pt-3 pb-1">
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
            <XAxis
              dataKey="week"
              tickFormatter={fmtShort}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              tickLine={false}
              axisLine={{ stroke: "#e5e7eb" }}
            />
            <YAxis
              domain={["auto", "auto"]}
              tickFormatter={m.fmt}
              tick={{ fontSize: 10, fill: "#9ca3af" }}
              width={72}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              content={<TrendTooltip metric={m} series={shown} values={values} hrgTotal={hrgTotal} />}
              wrapperStyle={{ zIndex: 20 }}
            />
            {shown.filter(s => s.kind === "store").map(s => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={1.5} dot={{ r: 2.5, fill: "white" }} activeDot={{ r: 4 }} isAnimationActive={false} />
            ))}
            {/* Drawn after the stores so the benchmarks sit on top of the pack. */}
            {shown.filter(s => s.kind === "summary").map(s => (
              <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={SUMMARY_WIDTH} strokeDasharray={s.dash} dot={{ r: 3, fill: "white" }} activeDot={{ r: 5 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="px-3 pt-2 pb-2 border-t border-gray-100 space-y-1.5">
        {markets.map(st => {
          const storeKeys = series.filter(s => s.kind === "store" && s.stores[0].state === st).map(s => s.key);
          const summary = series.find(s => s.key === st.toLowerCase())!;
          return (
            <div key={st} className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
                <input
                  type="checkbox"
                  checked={storeKeys.every(k => !hidden.has(k))}
                  onChange={e => toggle(storeKeys, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {st}
              </label>
              {series.filter(s => s.kind === "store" && s.stores[0].state === st).map(s => (
                <label key={s.key} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!hidden.has(s.key)}
                    onChange={e => toggle([s.key], e.target.checked)}
                    style={{ accentColor: s.color }}
                    className="rounded border-gray-300"
                  />
                  {s.label}
                </label>
              ))}
              <SummaryToggle series={summary} checked={!hidden.has(summary.key)} onChange={on => toggle([summary.key], on)} />
            </div>
          );
        })}
        {series.some(s => s.key === "hrg") && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="w-8" />
            <SummaryToggle series={series.find(s => s.key === "hrg")!} checked={!hidden.has("hrg")} onChange={on => toggle(["hrg"], on)} />
          </div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-gray-500 space-y-0.5">
        <p>
          % vs LY and vs LW are same-store: a store counts only when it has sales in both weeks compared
          {excluded.length > 0 && <> (excluded where missing: {excluded.join(", ")})</>}.
        </p>
        {partialThrough && <p>Data is rolled up through {fmtWithYear(partialThrough)}, so the last week shown is partial.</p>}
      </div>
    </div>
  );
}

function SummaryToggle({ series, checked, onChange }: { series: Series; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-800 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        style={{ accentColor: SUMMARY_COLOR }}
        className="rounded border-gray-300"
      />
      {/* Shows the dash pattern, so the summary lines are identifiable in the legend without relying on color. */}
      <svg width="18" height="8" aria-hidden="true" className="shrink-0">
        <line x1="0" y1="4" x2="18" y2="4" stroke={SUMMARY_COLOR} strokeWidth={SUMMARY_WIDTH} strokeDasharray={series.dash} />
      </svg>
      {series.label}
    </label>
  );
}
