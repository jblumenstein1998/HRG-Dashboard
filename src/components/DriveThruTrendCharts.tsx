"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { BranchStore } from "@/lib/berry";
import { groupBranches, getStoreLabel, SectionedBranches } from "@/lib/stores";
import { STORE_COLOR } from "@/lib/surveyMeta";
import { CopyableTitle } from "@/components/CopyImageButton";

// "period" is an HRG fiscal period (P1–P12) — what the business means when it
// says "monthly". Labelled "Period" in the UI rather than "Monthly" so there's
// no chance of reading it as a calendar month; calendar months aren't offered.
type Granularity = "week" | "period";

type TrendStorePoint = {
  lane_total_secs: number | null;
  window_service_secs: number | null;
  menu_board_secs: number | null;
  flagged_pull_forward: number | null;
  total_cars: number | null;
};

/** Only the four plottable metrics — total_cars is carried for weighting, not charted. */
type MetricKey = Exclude<keyof TrendStorePoint, "total_cars">;

type TrendPoint = {
  granularity: Granularity;
  bucketKey: string;
  label: string;
  start: string;
  end: string;
  stores: Record<string, TrendStorePoint>;
};

const GRANULARITY_OPTIONS: { key: Granularity; label: string }[] = [
  { key: "week", label: "Weekly" },
  { key: "period", label: "Period" },
];

/**
 * The TN/VA summary lines are aggregates, not stores, so they deliberately sit
 * outside the categorical store palette rather than taking a 13th and 14th hue.
 * Neutral ink + a heavier stroke reads as "reference line", and telling the two
 * apart rests on the dash pattern, not hue — so it survives colorblindness and
 * greyscale printing.
 */
const SUMMARY_COLOR = "#111827";
const SUMMARY_WIDTH = 2.5;

/** Straight (unweighted) mean — each store counts once, regardless of car count. */
function straightAverage(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => typeof v === "number");
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

const axisStyle = { fontSize: 10, fill: "#9ca3af" };

function niceStep(range: number, targetCount = 5): number {
  if (range <= 0) return 5;
  const raw = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  return norm < 1.5 ? 1 * mag : norm < 3 ? 2 * mag : norm < 7 ? 5 * mag : 10 * mag;
}

function fmtSecs(v: number): string {
  const m = Math.floor(v / 60);
  const s = Math.round(v % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function findStoreValue(branch: BranchStore, stores: Record<string, TrendStorePoint>): TrendStorePoint | null {
  const key = `${branch.name} - ${branch.client_branch_id}`;
  if (stores[key]) return stores[key];
  if (branch.client_branch_id) {
    for (const k of Object.keys(stores)) {
      if (k.includes(branch.client_branch_id)) return stores[k];
    }
  }
  return null;
}

function YTickTime({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {fmtSecs(v)}
    </text>
  );
}

function YTickCount({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  const v = payload?.value ?? 0;
  return (
    <text x={x} y={y} fill="#9ca3af" fontSize={10} textAnchor="end" dominantBaseline="middle">
      {v.toFixed(0)}
    </text>
  );
}

/**
 * Passed to recharts as an element (`dot={<TrendDot … />}`) so recharts clones
 * it with cx/cy/index per point — the last point is drawn filled and slightly
 * larger to mark where the series currently stands.
 */
function TrendDot({ cx, cy, index, color, lastIndex }: {
  cx?: number;
  cy?: number;
  index?: number;
  color?: string;
  lastIndex?: number;
}) {
  if (cx == null || cy == null) return <g />;
  const isLast = index === lastIndex;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={isLast ? 4 : 3}
      fill={isLast ? color : "white"}
      stroke={color}
      strokeWidth={2}
    />
  );
}

function TrendTooltip({ active, payload, label, isTime }: {
  active?: boolean;
  payload?: { name?: string; value: number | null; color: string }[];
  label?: string;
  isTime: boolean;
}) {
  if (!active || !payload?.length) return null;
  const sorted = [...payload].filter(p => p.value != null).sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold text-gray-700 mb-2 uppercase tracking-wide">{label}</p>
      {sorted.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-gray-600 flex-1">{p.name}</span>
          <span className="font-medium tabular-nums text-gray-800">
            {p.value == null ? "—" : isTime ? fmtSecs(p.value) : p.value.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}

function TrendChart({
  title,
  points,
  sections,
  storeColor,
  metric,
  isTime,
  yAxisMin,
  yAxisStep,
}: {
  title: string;
  points: TrendPoint[];
  sections: SectionedBranches;
  storeColor: (branch: BranchStore) => string;
  metric: MetricKey;
  isTime: boolean;
  yAxisMin?: number;
  yAxisStep?: number;
}) {
  const storeOrder = useMemo(() => sections.flatMap(s => s.branches), [sections]);

  // One summary series per market that actually has stores. Virginia is the
  // dashed one purely so the two never rely on color to be told apart.
  const summarySeries = useMemo(
    () =>
      sections
        .filter(s => s.branches.length > 0)
        .map(s => {
          const short = s.section === "Tennessee" ? "TN" : "VA";
          return { key: `${short} Average`, short, branches: s.branches, dashed: short === "VA" };
        }),
    [sections]
  );

  const [visibleStores, setVisibleStores] = useState<Set<string>>(
    () => new Set([...storeOrder.map(b => getStoreLabel(b)), ...summarySeries.map(s => s.key)])
  );
  const cardRef = useRef<HTMLDivElement>(null);

  const rows = points.map(pt => {
    const row: Record<string, string | number | null> = { label: pt.label };
    for (const b of storeOrder) {
      const v = findStoreValue(b, pt.stores);
      row[getStoreLabel(b)] = v?.[metric] ?? null;
    }
    // Deliberately averaged over every store in the market, not just the ticked
    // ones — it's a fixed benchmark to read individual stores against, so it
    // must not move when someone hides a store.
    for (const s of summarySeries) {
      row[s.key] = straightAverage(s.branches.map(b => findStoreValue(b, pt.stores)?.[metric]));
    }
    return row;
  });

  const seriesKeys = [...storeOrder.map(b => getStoreLabel(b)), ...summarySeries.map(s => s.key)];

  let visibleMin = Infinity;
  let visibleMax = -Infinity;
  for (const row of rows) {
    for (const name of seriesKeys) {
      if (!visibleStores.has(name)) continue;
      const v = row[name];
      if (typeof v === "number") {
        if (v < visibleMin) visibleMin = v;
        if (v > visibleMax) visibleMax = v;
      }
    }
  }
  const hasVisibleData = Number.isFinite(visibleMin) && Number.isFinite(visibleMax);
  const floorAtZero = !isTime;

  // Time metrics zoom to fit the visible data (a tight 180-240s cluster shouldn't be
  // squashed against a 0-anchored axis); the count metric floors at 0 since it can't be negative.
  const rawRange = hasVisibleData ? Math.max(visibleMax - visibleMin, 1) : isTime ? 60 : 10;
  const step = yAxisStep ?? niceStep(rawRange);
  const fittedMin = floorAtZero
    ? 0
    : hasVisibleData ? Math.floor(visibleMin / step) * step : 0;
  // A caller-supplied floor is a hint tuned for the weekly view. Monthly and
  // period buckets average the weekly extremes away and can sit below it, so
  // only honor the hint while it stays under the data — otherwise lines would
  // be clipped off the bottom of the chart.
  const yMin = yAxisMin != null && (!hasVisibleData || yAxisMin <= visibleMin) ? yAxisMin : fittedMin;
  const target = hasVisibleData ? visibleMax : yMin + step * 5;
  const yMax = yMin + Math.max(Math.ceil((target - yMin) / step), 1) * step;
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);

  const toggleStore = (name: string) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      if (s.has(name)) s.delete(name); else s.add(name);
      return s;
    });
  };

  const toggleGroup = (group: BranchStore[], checked: boolean) => {
    setVisibleStores(prev => {
      const s = new Set(prev);
      for (const b of group) {
        const name = getStoreLabel(b);
        if (checked) s.add(name); else s.delete(name);
      }
      return s;
    });
  };

  return (
    <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="mb-3">
        <CopyableTitle title={title} targetRef={cardRef} />
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={rows} margin={{ top: 8, right: 48, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#d1d5db" vertical={false} />
          <XAxis dataKey="label" tick={axisStyle} />
          <YAxis
            tick={isTime ? <YTickTime /> : <YTickCount />}
            domain={[yMin, yMax]}
            ticks={yTicks}
            interval={0}
            width={isTime ? 44 : 36}
          />
          <Tooltip content={<TrendTooltip isTime={isTime} />} />
          {storeOrder.map(b => {
            const name = getStoreLabel(b);
            if (!visibleStores.has(name)) return null;
            const color = storeColor(b);
            return (
              <Line
                key={name}
                type="monotone"
                dataKey={name}
                name={name}
                stroke={color}
                strokeWidth={1.5}
                dot={<TrendDot color={color} lastIndex={rows.length - 1} />}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
          {/* Drawn after the stores so the benchmark sits on top of the pack. */}
          {summarySeries.map(s => {
            if (!visibleStores.has(s.key)) return null;
            return (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.key}
                stroke={SUMMARY_COLOR}
                strokeWidth={SUMMARY_WIDTH}
                strokeDasharray={s.dashed ? "6 4" : undefined}
                dot={<TrendDot color={SUMMARY_COLOR} lastIndex={rows.length - 1} />}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>

      <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
        {sections.map(({ section, branches: sectionBranches }) => {
          if (sectionBranches.length === 0) return null;
          const groupLabel = section === "Tennessee" ? "TN" : "VA";
          const groupChecked = sectionBranches.every(b => visibleStores.has(getStoreLabel(b)));
          return (
            <div key={section} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
                <input
                  type="checkbox"
                  checked={groupChecked}
                  onChange={e => toggleGroup(sectionBranches, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {groupLabel}
              </label>
              {sectionBranches.map(b => {
                const name = getStoreLabel(b);
                const color = storeColor(b);
                return (
                  <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleStores.has(name)}
                      onChange={() => toggleStore(name)}
                      style={{ accentColor: color }}
                      className="rounded border-gray-300"
                    />
                    {name}
                  </label>
                );
              })}
              {(() => {
                const s = summarySeries.find(x => x.short === groupLabel);
                if (!s) return null;
                return (
                  <label className="flex items-center gap-1.5 text-xs font-medium text-gray-800 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={visibleStores.has(s.key)}
                      onChange={() => toggleStore(s.key)}
                      style={{ accentColor: SUMMARY_COLOR }}
                      className="rounded border-gray-300"
                    />
                    {/* Shows the dash pattern, so the two summary lines are
                        identifiable in the legend without relying on color. */}
                    <svg width="18" height="8" aria-hidden="true" className="shrink-0">
                      <line
                        x1="0" y1="4" x2="18" y2="4"
                        stroke={SUMMARY_COLOR}
                        strokeWidth={SUMMARY_WIDTH}
                        strokeDasharray={s.dashed ? "5 3" : undefined}
                      />
                    </svg>
                    {s.key}
                  </label>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Granularity + range controls ─────────────────────────────────────────────

function TrendControls({
  granularity,
  onGranularity,
  points,
  startIdx,
  endIdx,
  onStart,
  onEnd,
  loading,
}: {
  granularity: Granularity;
  onGranularity: (g: Granularity) => void;
  points: TrendPoint[];
  startIdx: number;
  endIdx: number;
  onStart: (i: number) => void;
  onEnd: (i: number) => void;
  loading: boolean;
}) {
  const selectClass =
    "text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 " +
    "focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:opacity-50";

  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
        {GRANULARITY_OPTIONS.map(o => (
          <button
            key={o.key}
            type="button"
            onClick={() => onGranularity(o.key)}
            aria-pressed={granularity === o.key}
            className={
              "px-3 py-1 text-xs font-medium transition-colors " +
              (granularity === o.key
                ? "bg-gray-900 text-white"
                : "bg-white text-gray-600 hover:bg-gray-50")
            }
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-gray-500" htmlFor="dt-trend-start">From</label>
        <select
          id="dt-trend-start"
          className={selectClass}
          value={startIdx}
          disabled={loading || points.length === 0}
          onChange={e => onStart(Number(e.target.value))}
        >
          {points.map((p, i) => (
            <option key={p.bucketKey} value={i} disabled={i > endIdx}>{p.label}</option>
          ))}
        </select>

        <label className="text-xs text-gray-500" htmlFor="dt-trend-end">to</label>
        <select
          id="dt-trend-end"
          className={selectClass}
          value={endIdx}
          disabled={loading || points.length === 0}
          onChange={e => onEnd(Number(e.target.value))}
        >
          {points.map((p, i) => (
            <option key={p.bucketKey} value={i} disabled={i < startIdx}>{p.label}</option>
          ))}
        </select>
      </div>

      {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
    </div>
  );
}

// ── Container ────────────────────────────────────────────────────────────────

export default function DriveThruTrendCharts({ branches }: { branches: BranchStore[] }) {
  const [granularity, setGranularity] = useState<Granularity>("week");
  // Each granularity is fetched once and kept, so flipping between Weekly and
  // Period after the first load costs nothing.
  const [byGranularity, setByGranularity] = useState<Partial<Record<Granularity, TrendPoint[]>>>({});
  const [error, setError] = useState<string | null>(null);
  // null means "no explicit selection yet" — the range then defaults to the full
  // span. Bucket indices aren't comparable across granularities, so switching
  // granularity clears this rather than carrying the selection over.
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const points = byGranularity[granularity];
  const loading = !points && !error;

  useEffect(() => {
    if (points) return;
    let cancelled = false;
    fetch(`/api/berry/drive-thru-trend?granularity=${granularity}`)
      .then(async r => {
        if (!r.ok) throw new Error("bad status");
        const data: TrendPoint[] = await r.json();
        if (!cancelled) setByGranularity(prev => ({ ...prev, [granularity]: data }));
      })
      .catch(() => { if (!cancelled) setError("Failed to load drive-thru trend"); });
    return () => { cancelled = true; };
  }, [granularity, points]);

  // Clamped so an explicit selection can't fall out of bounds if a refetch
  // returns a different number of buckets.
  const effectiveRange = useMemo(() => {
    if (!points || points.length === 0) return null;
    const last = points.length - 1;
    if (!range) return { start: 0, end: last };
    return {
      start: Math.min(Math.max(range.start, 0), last),
      end: Math.min(Math.max(range.end, 0), last),
    };
  }, [points, range]);

  const setStart = useCallback((i: number) => {
    setRange(r => {
      const base = r ?? effectiveRange;
      if (!base) return r;
      return { start: Math.min(i, base.end), end: base.end };
    });
  }, [effectiveRange]);

  const setEnd = useCallback((i: number) => {
    setRange(r => {
      const base = r ?? effectiveRange;
      if (!base) return r;
      return { start: base.start, end: Math.max(i, base.start) };
    });
  }, [effectiveRange]);

  const handleGranularity = useCallback((g: Granularity) => {
    setGranularity(g);
    setRange(null);
    setError(null);
  }, []);

  const sections = useMemo(() => groupBranches(branches), [branches]);
  const storeColor = useCallback((b: BranchStore) => STORE_COLOR[getStoreLabel(b)] ?? "#6b7280", []);

  const visible = useMemo(() => {
    if (!points || !effectiveRange) return [];
    return points.slice(effectiveRange.start, effectiveRange.end + 1);
  }, [points, effectiveRange]);

  if (branches.length === 0) return null;

  const noun = GRANULARITY_OPTIONS.find(o => o.key === granularity)?.label ?? "Weekly";
  const rangeLabel =
    visible.length === 0
      ? ""
      : visible.length === 1
        ? visible[0].label
        : `${visible[0].label} – ${visible[visible.length - 1].label}`;
  const suffix = rangeLabel ? `${noun}, ${rangeLabel}` : noun;

  return (
    <div className="mt-6 flex flex-col gap-4">
      <TrendControls
        granularity={granularity}
        onGranularity={handleGranularity}
        points={points ?? []}
        startIdx={effectiveRange?.start ?? 0}
        endIdx={effectiveRange?.end ?? 0}
        onStart={setStart}
        onEnd={setEnd}
        loading={loading}
      />

      {error && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-sm text-gray-400">
          {error}
        </div>
      )}

      {!error && !points && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 h-20 flex items-center justify-center">
          <span className="text-xs text-gray-400 animate-pulse">Loading drive-thru trend…</span>
        </div>
      )}

      {!error && points && visible.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 text-center text-sm text-gray-400">
          No data in the selected range.
        </div>
      )}

      {!error && visible.length > 0 && (
        <>
          <TrendChart title={`Lane Total — ${suffix}`} points={visible} sections={sections} storeColor={storeColor} metric="lane_total_secs" isTime yAxisMin={150} yAxisStep={30} />
          <TrendChart title={`Window Time — ${suffix}`} points={visible} sections={sections} storeColor={storeColor} metric="window_service_secs" isTime yAxisMin={40} yAxisStep={10} />
          <TrendChart title={`Menu Time — ${suffix}`} points={visible} sections={sections} storeColor={storeColor} metric="menu_board_secs" isTime />
          <TrendChart title={`Flagged Pull-Forward Cars — ${suffix}`} points={visible} sections={sections} storeColor={storeColor} metric="flagged_pull_forward" isTime={false} />
        </>
      )}
    </div>
  );
}
