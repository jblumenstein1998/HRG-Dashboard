"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { CopyableTitle } from "@/components/CopyImageButton";
import { PERIODS, getPeriodForDate } from "@/lib/fiscal";
import {
  COMBINED_KEY,
  STORE_COLOR,
  TN_STORES,
  VA_STORES,
  marketOf,
  metricRank,
  pooledScore,
  prettyUnit,
  publishedMarketCells,
  shortMetric,
} from "@/lib/surveyMeta";

type ScoreRow = {
  unitKey: string;
  unitName: string;
  periodLabel: string;
  metric: string;
  score: number | null;
  responses: number | null;
  belowMin: boolean;
};

type ScoresResponse = {
  periods: string[];
  availableMetrics: string[];
  rows: ScoreRow[];
  error?: string;
};

type SnapshotsResponse = {
  ranges: { key: string; label: string; windowStart: string; windowEnd: string; asOf: string }[];
  rows: {
    rangeKey: string;
    unitKey: string;
    unitName: string;
    metric: string;
    score: number | null;
    responses: number | null;
  }[];
  error?: string;
};

/** SMG stores both grains; the tab's table only ever reads periods. */
type Grain = "weekly" | "period";

const GRAIN_OPTIONS: { key: Grain; label: string }[] = [
  { key: "weekly", label: "Weeks" },
  { key: "period", label: "Periods" },
];

/**
 * Market rollups, styled exactly as on the Drive-Thru trend charts: aggregates
 * rather than stores, so they stay out of the categorical store palette instead
 * of claiming extra hues — one neutral ink, TN solid and VA dashed.
 *
 * Their dash is fixed rather than following the selected metric. There are only
 * two of them and they share a color, so dash is the only thing telling them
 * apart; letting a metric override it would merge them into one line.
 */
const SUMMARY_COLOR = "#111827";
const SUMMARY_SERIES = [
  { key: "TN", dash: undefined as string | undefined },
  { key: "VA", dash: "6 4" as string | undefined },
] as const;

const SUMMARY_KEYS = SUMMARY_SERIES.map((s) => s.key) as readonly string[];
const SUMMARY_WIDTH = 2.5;

/** Dash encodes the metric, so several metrics can share one chart. */
const METRIC_DASH = [undefined, "6 3", "2 2", "8 3 2 3", "1 3", "10 3"];

/**
 * Survey volume, offered alongside the score metrics but plotted on its own.
 * It's a count, not a percentage, so it can't share an axis with them — mixing
 * the two would mean two y-scales on one chart, which makes every crossing
 * between a count line and a score line meaningless. Selecting it therefore
 * replaces the score selection rather than adding to it.
 */
const SURVEY_COUNT = "Surveys";

function niceStep(range: number, targetCount = 5): number {
  if (range <= 0) return 5;
  const raw = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return norm < 1.5 ? 1 * mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
}

const axisStyle = { fontSize: 10, fill: "#9ca3af" };

type Cell = { score: number | null; responses: number | null };
type Point = { label: string; series: Record<string, Record<string, number | null>> };

type AnyRow = {
  unitKey: string;
  unitName: string;
  metric: string;
  score: number | null;
  responses: number | null;
};

/**
 * One chart point: every store's score plus the TN/VA rollups.
 *
 * `published` is SMG's region-manager rows for the same window, used for the
 * market lines wherever one covers exactly that market's stores — the table
 * prefers them for the same reason, and the line and the row under it have to
 * agree.
 */
function buildPoint(label: string, rows: AnyRow[], published: AnyRow[] = []): Point {
  const series: Record<string, Record<string, number | null>> = {};
  const market: Record<string, Record<string, Cell[]>> = { TN: {}, VA: {} };

  for (const r of rows) {
    if (r.unitKey === COMBINED_KEY) continue;
    const store = prettyUnit(r.unitName, r.unitKey);
    (series[store] ||= {})[r.metric] = r.score;

    // A store with no market (a manager rollup, say) is left out of the market
    // lines rather than quietly landing in one of them.
    const m = marketOf(r.unitKey, r.unitName);
    if (m) (market[m][r.metric] ||= []).push({ score: r.score, responses: r.responses });
  }

  // Survey volume: a store's metrics all share a response count, so take the
  // largest; a market's is the sum of its stores, not an average of them.
  const countByStore = new Map<string, number>();
  for (const r of rows) {
    if (r.unitKey === COMBINED_KEY || r.responses == null) continue;
    const store = prettyUnit(r.unitName, r.unitKey);
    countByStore.set(store, Math.max(countByStore.get(store) ?? 0, r.responses));
  }
  for (const [store, n] of countByStore) series[store][SURVEY_COUNT] = n;

  const candidates = published.filter((r) => r.unitKey !== COMBINED_KEY);

  for (const key of SUMMARY_KEYS) {
    const out: Record<string, number | null> = {};
    const cellsByMetric = new Map(Object.entries(market[key] ?? {}));
    const smg = publishedMarketCells(candidates, cellsByMetric);
    for (const [metric, cells] of cellsByMetric) {
      out[metric] = smg?.get(metric)?.score ?? pooledScore(cells).score;
    }
    let total = 0;
    for (const [store, n] of countByStore) {
      const list = key === "TN" ? TN_STORES : VA_STORES;
      if (list.includes(store)) total += n;
    }
    out[SURVEY_COUNT] = total || null;
    series[key] = out;
  }
  return { label, series };
}

function DashSwatch({ color, dash, width = 2 }: { color: string; dash?: string; width?: number }) {
  return (
    <svg width="20" height="8" aria-hidden="true" className="shrink-0">
      <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth={width} strokeDasharray={dash} />
    </svg>
  );
}

function YTick({ x, y, payload, isCount }: {
  x?: number; y?: number; payload?: { value: number }; isCount?: boolean;
}) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {isCount ? v.toFixed(0) : `${v.toFixed(0)}%`}
    </text>
  );
}

function TrendDot({ cx, cy, index, color, lastIndex }: {
  cx?: number; cy?: number; index?: number; color?: string; lastIndex?: number;
}) {
  if (cx == null || cy == null) return <g />;
  const isLast = index === lastIndex;
  return <circle cx={cx} cy={cy} r={isLast ? 4 : 3} fill={isLast ? color : "white"} stroke={color} strokeWidth={2} />;
}

function SurveyTooltip({ active, payload, label, isCount }: {
  active?: boolean;
  payload?: { name?: string; value: number | null; color: string }[];
  label?: string;
  isCount?: boolean;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter((p) => p.value != null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  if (!sorted.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map((p) => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 flex-1">{p.name}</span>
          <span className="font-medium tabular-nums text-gray-800">
            {p.value == null ? "—" : isCount ? p.value.toFixed(0) : `${p.value.toFixed(0)}%`}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SurveyTrendChart({
  dateBasis = "visit",
  showTN = true,
  showVA = true,
}: {
  dateBasis?: string;
  /** Driven by the market checkboxes in the page ribbon, so the chart shows the
   *  same markets as the table above it. */
  showTN?: boolean;
  showVA?: boolean;
}) {
  const [grain, setGrain] = useState<Grain>("period");
  // Each grain is fetched once and kept, so flipping between Weeks and Periods
  // after the first load costs nothing.
  const [byGrain, setByGrain] = useState<Partial<Record<Grain, ScoresResponse>>>({});
  // SMG only publishes a period once it closes, so the newest closed period is
  // always a few weeks stale. The period-to-date snapshot fills that gap.
  const [snapshots, setSnapshots] = useState<SnapshotsResponse | null>(null);
  // SMG's region-manager rows — the TN and VA totals as SMG publishes them.
  // The market lines prefer these over pooling; see publishedMarketCells.
  const [rmByGrain, setRmByGrain] = useState<Partial<Record<Grain, ScoresResponse>>>({});
  const [rmSnapshots, setRmSnapshots] = useState<SnapshotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [activeMetrics, setActiveMetrics] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const cardRef = useRef<HTMLDivElement>(null);

  const data = byGrain[grain];
  const loading = !data && !error;

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    fetch(`/api/smg/scores?level=store&periodType=${grain}&dateBasis=${dateBasis}&limit=260`)
      .then(async (r) => {
        const j: ScoresResponse = await r.json();
        if (cancelled) return;
        if (j.error) setError("Failed to load survey trend");
        else setByGrain((prev) => ({ ...prev, [grain]: j }));
      })
      .catch(() => !cancelled && setError("Failed to load survey trend"));
    return () => { cancelled = true; };
  }, [grain, data, dateBasis]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/smg/snapshots?level=store&dateBasis=${dateBasis}`)
      .then(async (r) => {
        const j: SnapshotsResponse = await r.json();
        // A missing snapshot just costs the partial point, so it isn't an error.
        if (!cancelled && !j.error) setSnapshots(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dateBasis]);

  // Published rollups. Failing to load them is never an error — the market
  // lines just fall back to pooling, which is what they did before.
  useEffect(() => {
    if (rmByGrain[grain]) return;
    let cancelled = false;
    fetch(`/api/smg/scores?level=regionManager&periodType=${grain}&dateBasis=${dateBasis}&limit=260`)
      .then(async (r) => {
        const j: ScoresResponse = await r.json();
        if (!cancelled && !j.error) setRmByGrain((prev) => ({ ...prev, [grain]: j }));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [grain, rmByGrain, dateBasis]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/smg/snapshots?level=regionManager&dateBasis=${dateBasis}`)
      .then(async (r) => {
        const j: SnapshotsResponse = await r.json();
        if (!cancelled && !j.error) setRmSnapshots(j);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dateBasis]);

  const metrics = useMemo(() => {
    const scored = [...(data?.availableMetrics ?? [])].sort(
      (a, b) => metricRank(a) - metricRank(b) || a.localeCompare(b)
    );
    return scored.length ? [...scored, SURVEY_COUNT] : scored;
  }, [data]);

  // Default to Overall Satisfaction alone, matching the SMG tab's opening view.
  const selectedMetrics = useMemo(() => {
    const chosen = metrics.filter((m) => activeMetrics.has(m));
    return chosen.length ? chosen : metrics.slice(0, 1);
  }, [metrics, activeMetrics]);

  const dashFor = useCallback(
    (metric: string) => METRIC_DASH[metrics.indexOf(metric) % METRIC_DASH.length],
    [metrics]
  );

  /**
   * The period currently in progress, from SMG's own period-to-date snapshot.
   *
   * SMG only publishes a period once it closes, so the newest closed period is
   * always weeks behind — this puts the running period on the end of the line
   * rather than making you wait for it. It's SMG's figure for the window, not
   * something derived by pooling the weeks inside it, so it agrees with the
   * PTD row in the table above.
   */
  const partialPoint = useMemo<Point | null>(() => {
    if (grain !== "period" || !snapshots) return null;
    const ptd = snapshots.ranges.find((r) => r.key === "ptd");
    if (!ptd) return null;

    // Snapshot windows arrive as JS date strings ("Mon Jun 29 2026 00:00:00
    // GMT+0000 …"), stamped with whatever offset the server runs in — UTC on
    // Vercel, local in dev. Read the UTC components so the calendar date
    // survives either, then rebuild it as a local date to compare against the
    // fiscal calendar. Reading local components instead pulls a UTC-stamped
    // midnight back a day when viewed from a western timezone, which mapped
    // P7's start onto P6 in production and silently dropped the partial point.
    const parsed = new Date(ptd.windowStart);
    if (Number.isNaN(parsed.getTime())) return null;
    const start = new Date(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
    const period = getPeriodForDate(start);
    if (!period) return null;

    const fiscalYear = new Date(`${PERIODS[0].end}T12:00:00`).getFullYear();
    const label = `Period ${period.period}, ${fiscalYear}`;
    // Once SMG publishes the period for real, its own closed figure wins.
    if (data?.periods.includes(label)) return null;

    const rows = snapshots.rows.filter((r) => r.rangeKey === "ptd");
    const pub = (rmSnapshots?.rows ?? []).filter((r) => r.rangeKey === "ptd");
    return rows.length ? buildPoint(`${label} (partial)`, rows, pub) : null;
  }, [grain, snapshots, rmSnapshots, data]);

  /** One point per period, with the in-progress period appended. */
  const points = useMemo<Point[]>(() => {
    if (!data) return [];
    const byPeriod = new Map<string, ScoreRow[]>();
    for (const r of data.rows) {
      const list = byPeriod.get(r.periodLabel);
      if (list) list.push(r); else byPeriod.set(r.periodLabel, [r]);
    }
    const pubByPeriod = new Map<string, ScoreRow[]>();
    for (const r of rmByGrain[grain]?.rows ?? []) {
      const list = pubByPeriod.get(r.periodLabel);
      if (list) list.push(r); else pubByPeriod.set(r.periodLabel, [r]);
    }
    const closed = data.periods.map((label) =>
      buildPoint(label, byPeriod.get(label) ?? [], pubByPeriod.get(label) ?? []),
    );
    return partialPoint ? [...closed, partialPoint] : closed;
  }, [data, partialPoint, rmByGrain, grain]);

  const storeNames = useMemo(() => {
    const s = new Set<string>();
    for (const p of points) for (const k of Object.keys(p.series)) if (!SUMMARY_KEYS.includes(k)) s.add(k);
    return [...s].sort();
  }, [points]);

  /**
   * Stores grouped by market, so the legend reads the same as every other
   * chart. A market switched off in the page ribbon drops out entirely —
   * checkboxes and lines both — rather than leaving dead toggles behind.
   */
  const sections = useMemo(() => {
    const tn: string[] = [];
    const va: string[] = [];
    const other: string[] = [];
    for (const n of storeNames) {
      if (TN_STORES.includes(n)) tn.push(n);
      else if (VA_STORES.includes(n)) va.push(n);
      else other.push(n);
    }
    return [
      { key: "TN", stores: tn, rollup: "TN" as string | null, shown: showTN },
      { key: "VA", stores: va, rollup: "VA" as string | null, shown: showVA },
      { key: "Other", stores: other, rollup: null as string | null, shown: true },
    ].filter((s) => s.shown && s.stores.length > 0);
  }, [storeNames, showTN, showVA]);

  /** Only what the visible sections contribute — drives the lines and the y-axis. */
  const activeStores = useMemo(() => sections.flatMap((s) => s.stores), [sections]);
  const activeSummaries = useMemo(
    () => SUMMARY_SERIES.filter((s) => sections.some((sec) => sec.rollup === s.key)),
    [sections]
  );

  /**
   * Opens on the current fiscal year rather than all of history — two years of
   * periods at once is a wall. Derived from the newest year present, so it
   * rolls forward on its own instead of pinning a literal "2026".
   */
  const defaultRange = useMemo(() => {
    if (points.length === 0) return null;
    const last = points.length - 1;
    // First 4-digit run, not the trailing one — the in-progress point carries a
    // "(partial)" suffix after its year.
    const yearOf = (label: string) => Number(label.match(/(\d{4})/)?.[1] ?? NaN);
    const years = points.map((p) => yearOf(p.label)).filter((y) => Number.isFinite(y));
    if (!years.length) return { start: 0, end: last };
    const newest = Math.max(...years);
    const start = points.findIndex((p) => yearOf(p.label) === newest);
    return { start: start === -1 ? 0 : start, end: last };
  }, [points]);

  /**
   * The From/To lists read newest-first — the recent periods are the ones
   * anyone reaches for, and it matches the page's own period picker.
   *
   * The option `value` stays the index into `points`, which is chronological
   * and is what `range` and the chart itself are expressed in. Only the display
   * order flips; reversing `points` itself would invert every comparison in
   * `effectiveRange` and the drawing code.
   */
  const pickerOptions = useMemo(
    () => points.map((p, index) => ({ label: p.label, index })).reverse(),
    [points],
  );

  // Clamped so an explicit selection survives a grain switch returning fewer periods.
  const effectiveRange = useMemo(() => {
    if (points.length === 0) return null;
    const last = points.length - 1;
    if (!range) return defaultRange;
    return {
      start: Math.min(Math.max(range.start, 0), last),
      end: Math.min(Math.max(range.end, 0), last),
    };
  }, [points, range, defaultRange]);

  const visible = useMemo(
    () => (effectiveRange ? points.slice(effectiveRange.start, effectiveRange.end + 1) : []),
    [points, effectiveRange]
  );

  const setStart = useCallback((i: number) => {
    setRange((r) => {
      const base = r ?? effectiveRange;
      return base ? { start: Math.min(i, base.end), end: base.end } : r;
    });
  }, [effectiveRange]);

  const setEnd = useCallback((i: number) => {
    setRange((r) => {
      const base = r ?? effectiveRange;
      return base ? { start: base.start, end: Math.max(i, base.start) } : r;
    });
  }, [effectiveRange]);

  const changeGrain = useCallback((g: Grain) => {
    setGrain(g);
    // Week 12 and Period 12 aren't the same place on the timeline, so a carried
    // index would silently land somewhere unrelated.
    setRange(null);
    setError(null);
  }, []);

  const toggle = (name: string) =>
    setHidden((prev) => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });

  const toggleMetric = (m: string) =>
    setActiveMetrics((prev) => {
      // Surveys is a count and the rest are percentages, so the two can never be
      // on screen together — picking either side clears the other.
      if (m === SURVEY_COUNT) return prev.has(m) ? new Set() : new Set([SURVEY_COUNT]);
      const s = new Set(prev);
      s.delete(SURVEY_COUNT);
      if (s.has(m)) s.delete(m); else s.add(m);
      return s;
    });

  const toggleGroup = (names: string[], checked: boolean) =>
    setHidden((prev) => {
      const s = new Set(prev);
      for (const n of names) { if (checked) s.delete(n); else s.add(n); }
      return s;
    });

  const multiMetric = selectedMetrics.length > 1;
  const isCount = selectedMetrics.length === 1 && selectedMetrics[0] === SURVEY_COUNT;
  const seriesName = (name: string, metric: string) =>
    multiMetric ? `${name} — ${shortMetric(metric)}` : name;

  // Percent axis, zoomed to the visible data on 10-point steps and capped at
  // 100 — a fixed 0-100 axis squashes a tight 78-88 band into nothing.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of visible) {
    for (const name of [...activeStores, ...activeSummaries.map((s) => s.key)]) {
      if (hidden.has(name)) continue;
      for (const m of selectedMetrics) {
        const v = p.series[name]?.[m];
        if (typeof v === "number") { if (v < lo) lo = v; if (v > hi) hi = v; }
      }
    }
  }
  const hasData = Number.isFinite(lo) && Number.isFinite(hi);

  // Counts floor at 0 (a survey count can't be negative) and step to fit;
  // percentages zoom to the data on 10-point steps, capped at 100.
  const countStep = niceStep(hasData ? hi : 10);
  const yMin = isCount ? 0 : hasData ? Math.max(Math.floor(lo / 10) * 10, 0) : 0;
  const yMax = isCount
    ? Math.max(Math.ceil((hasData ? hi : 10) / countStep) * countStep, countStep)
    : hasData ? Math.min(Math.ceil(hi / 10) * 10, 100) : 100;
  const step = isCount ? countStep : 10;
  const span = Math.max(yMax - yMin, step);
  const yTicks = Array.from({ length: Math.round(span / step) + 1 }, (_, i) => yMin + i * step);

  const rangeLabel =
    visible.length === 0 ? "" : visible.length === 1
      ? visible[0].label
      : `${visible[0].label} – ${visible[visible.length - 1].label}`;

  const selectClass =
    "text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 " +
    "focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50";

  return (
    // The grain and range pickers live in their own ribbon above the card, the
    // same shape the Drive-Thru charts use. cardRef covers only the card below,
    // so copying the chart as an image captures the plot and its legend without
    // a row of dropdowns baked into the picture. The range still reads off the
    // title, so a pasted screenshot says which periods it covers.
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {GRAIN_OPTIONS.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => changeGrain(o.key)}
              aria-pressed={grain === o.key}
              className={`px-3 py-1 text-xs font-medium transition-colors ${
                grain === o.key ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500" htmlFor="survey-trend-start">From</label>
          <select
            id="survey-trend-start"
            className={selectClass}
            value={effectiveRange?.start ?? 0}
            disabled={points.length === 0}
            onChange={(e) => setStart(Number(e.target.value))}
          >
            {pickerOptions.map(({ label, index }) => (
              <option key={label} value={index} disabled={index > (effectiveRange?.end ?? 0)}>{label}</option>
            ))}
          </select>

          <label className="text-xs text-gray-500" htmlFor="survey-trend-end">to</label>
          <select
            id="survey-trend-end"
            className={selectClass}
            value={effectiveRange?.end ?? 0}
            disabled={points.length === 0}
            onChange={(e) => setEnd(Number(e.target.value))}
          >
            {pickerOptions.map(({ label, index }) => (
              <option key={label} value={index} disabled={index < (effectiveRange?.start ?? 0)}>{label}</option>
            ))}
          </select>
        </div>

        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
      </div>

      <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <CopyableTitle
          title={`Survey Trend — by Store${rangeLabel ? ` — ${rangeLabel}` : ""}`}
          targetRef={cardRef}
          className="text-sm font-semibold text-gray-800"
        />
        <div className="flex flex-wrap rounded-lg border border-gray-200 overflow-hidden">
          {metrics.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggleMetric(m)}
              aria-pressed={selectedMetrics.includes(m)}
              className={`text-xs px-3 py-1.5 transition ${
                selectedMetrics.includes(m)
                  ? "bg-red-700 text-white font-medium"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {shortMetric(m)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="py-10 text-center text-sm text-gray-400">{error}</div>}
      {!error && loading && <div className="py-10 text-center text-xs text-gray-400 animate-pulse">Loading survey trend…</div>}
      {!error && !loading && visible.length === 0 && (
        <div className="py-10 text-center text-sm text-gray-400">No survey data in the selected range.</div>
      )}

      {!error && visible.length > 0 && (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={visible} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
            <XAxis dataKey="label" tick={axisStyle} />
            <YAxis tick={<YTick isCount={isCount} />} domain={[yMin, yMax]} ticks={yTicks} interval={0} width={40} />
            <Tooltip content={<SurveyTooltip isCount={isCount} />} />
            {activeStores.map((name) =>
              hidden.has(name) ? null : selectedMetrics.map((m) => (
                <Line
                  key={`${name}-${m}`}
                  type="monotone"
                  dataKey={(d: Point) => d.series[name]?.[m] ?? null}
                  name={seriesName(name, m)}
                  stroke={STORE_COLOR[name] ?? "#6b7280"}
                  strokeWidth={1.5}
                  strokeDasharray={dashFor(m)}
                  dot={<TrendDot color={STORE_COLOR[name] ?? "#6b7280"} lastIndex={visible.length - 1} />}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
            {/* Drawn last so the rollups sit on top of the store pack. */}
            {activeSummaries.map((s) =>
              hidden.has(s.key) ? null : selectedMetrics.map((m) => (
                <Line
                  key={`${s.key}-${m}`}
                  type="monotone"
                  dataKey={(d: Point) => d.series[s.key]?.[m] ?? null}
                  name={seriesName(s.key, m)}
                  stroke={SUMMARY_COLOR}
                  strokeWidth={SUMMARY_WIDTH}
                  strokeDasharray={s.dash}
                  dot={<TrendDot color={SUMMARY_COLOR} lastIndex={visible.length - 1} />}
                  connectNulls
                  isAnimationActive={false}
                />
              ))
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {multiMetric && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {selectedMetrics.map((m) => (
            <div key={m} className="flex items-center gap-1.5 text-xs text-gray-500">
              <DashSwatch color="#6b7280" dash={dashFor(m)} />
              {shortMetric(m)}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        {sections.map((section) => {
          const groupChecked = section.stores.every((n) => !hidden.has(n));
          const rollup = SUMMARY_SERIES.find((s) => s.key === section.rollup);
          return (
            <div key={section.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-12">
                <input
                  type="checkbox"
                  checked={groupChecked}
                  onChange={(e) => toggleGroup(section.stores, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {section.key}
              </label>
              {section.stores.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!hidden.has(name)}
                    onChange={() => toggle(name)}
                    style={{ accentColor: STORE_COLOR[name] ?? "#6b7280" }}
                    className="rounded border-gray-300"
                  />
                  {name}
                </label>
              ))}
              {rollup && (
                <label className="flex items-center gap-1.5 text-xs font-medium text-gray-800 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!hidden.has(rollup.key)}
                    onChange={() => toggle(rollup.key)}
                    style={{ accentColor: SUMMARY_COLOR }}
                    className="rounded border-gray-300"
                  />
                  <DashSwatch color={SUMMARY_COLOR} dash={rollup.dash} width={SUMMARY_WIDTH} />
                  {rollup.key} Average
                </label>
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
