"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyableTitle } from "@/components/CopyImageButton";
import SurveyTrendChart from "@/components/SurveyTrendChart";
import { getPriorYearRange, PERIODS } from "@/lib/fiscal";
import {
  COMBINED_KEY,
  STORE_LABELS,
  TONE_BG,
  TONE_BG_STRONG,
  TONE_TEXT,
  marketOf,
  metricRank,
  prettyUnit,
  scoreTone,
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
  units: { key: string; name: string }[];
  availableMetrics: string[];
  rows: ScoreRow[];
  error?: string;
};

type SnapshotRow = {
  rangeKey: string;
  unitKey: string;
  unitName: string;
  metric: string;
  score: number | null;
  responses: number | null;
  belowMin: boolean;
};

type SnapshotsResponse = {
  ranges: { key: string; label: string; windowStart: string; windowEnd: string; asOf: string }[];
  units: { key: string; name: string }[];
  metrics: string[];
  rows: SnapshotRow[];
  error?: string;
};

const LEVELS = [
  { value: "store", label: "Store" },
  { value: "regionManager", label: "Regional Manager" },
  { value: "districtManager", label: "District Manager" },
] as const;

// Fixed rather than exposed: the tab always reads visit date at period grain.
// Weeks are still ingested and queryable — the picker just doesn't list them.
const GRAIN = "period";
const DATE_BASIS = "visit";
const PERIOD_LOOKBACK = 26;

/** Width of the label column; the data columns share the remainder evenly. */
const LABEL_COL_PCT = 20;

/**
 * Postgres DATE columns arrive as full timestamps; show just M/D.
 *
 * Read in UTC, not local time. The server stamps these with its own offset —
 * UTC on Vercel, local in dev — so reading local components pulls a
 * UTC-stamped midnight back a day when viewed from a western timezone, and the
 * window renders as 6/28–7/24 instead of 6/29–7/25.
 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

/**
 * Snapshot window dates come back as JS date strings ("Sat Jul 25 2026 …"),
 * not ISO — slicing the first 10 chars silently yields garbage, so parse and
 * reformat in local time.
 */
function toISODate(value: string): string | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  // UTC components, for the same reason as shortDate — otherwise the sales
  // window queried for a rolling range is a day earlier than the scores it
  // sits next to.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

type Cell = { score: number | null; responses: number | null; belowMin: boolean };
type UnitRow = {
  key: string;
  name: string;
  label: string;
  surveys: number | null;
  sales: number | null;
  cells: Map<string, Cell>;
};

const fmtSales = (n: number | null) => (n === null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

/**
 * Calendar range for the selected period, so sales can be summed over exactly
 * the window the scores cover. Rolling windows carry their own dates; fiscal
 * periods resolve through fiscal.ts, whose numbering matches SMG's (verified —
 * SMG "Period 6, 2026" is the same 5/25–6/28 window fiscal.ts calls P6).
 * Periods outside the fiscal year fiscal.ts defines return null, so sales show
 * blank rather than wrong.
 */
function rangeForSelection(
  selected: string,
  window?: { windowStart: string; windowEnd: string },
): { start: string; end: string } | null {
  if (selected.startsWith("snap:")) {
    if (!window) return null;
    const start = toISODate(window.windowStart);
    const end = toISODate(window.windowEnd);
    return start && end ? { start, end } : null;
  }
  const m = selected.match(/^period:Period (\d+), (\d{4})$/);
  if (!m) return null;
  const p = PERIODS.find((x) => x.period === Number(m[1]));
  if (!p) return null;

  // fiscal.ts only defines the current fiscal year, but earlier years are the
  // same period shifted back 364 days apiece — the retail-calendar shift the
  // YoY sales comps already use, which keeps weekday alignment intact.
  const yearsBack = Number(p.end.slice(0, 4)) - Number(m[2]);
  if (yearsBack < 0) return null;

  let range = { start: p.start, end: p.end };
  for (let i = 0; i < yearsBack; i++) range = getPriorYearRange(range.start, range.end);
  return range;
}

/**
 * Pooled score across units, weighted by each unit's response count — a plain
 * average of percentages would let a store with 2 responses swing the market
 * as hard as one with 60.
 */
function summarise(units: UnitRow[], metrics: string[]): UnitRow | null {
  if (!units.length) return null;
  const cells = new Map<string, Cell>();
  for (const metric of metrics) {
    let num = 0;
    let den = 0;
    for (const u of units) {
      const c = u.cells.get(metric);
      if (!c || c.score === null || !c.responses) continue;
      num += c.score * c.responses;
      den += c.responses;
    }
    cells.set(metric, {
      score: den ? Math.round(num / den) : null,
      responses: den || null,
      belowMin: false,
    });
  }
  const surveys = units.reduce((n, u) => n + (u.surveys ?? 0), 0);
  const sales = units.reduce((n, u) => n + (u.sales ?? 0), 0);
  return { key: "", name: "", label: "", surveys: surveys || null, sales: sales || null, cells };
}

export default function SurveyDataClient() {
  const router = useRouter();

  const [level, setLevel] = useState<string>("store");
  const [periodSel, setPeriodSel] = useState<string>("");
  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);
  // Opens on biggest-selling first, the order the table used to build in.
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "sales", dir: "desc" });
  const [refreshKey, setRefreshKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const [scores, setScores] = useState<ScoresResponse | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/smg/scores?level=${level}&periodType=${GRAIN}&dateBasis=${DATE_BASIS}&limit=${PERIOD_LOOKBACK}`).then((r) => r.json()),
      fetch(`/api/smg/snapshots?level=${level}&dateBasis=${DATE_BASIS}`).then((r) => r.json()),
    ])
      .then(([s, snap]: [ScoresResponse, SnapshotsResponse]) => {
        if (cancelled) return;
        setScores(s.error ? null : s);
        setSnapshots(snap.error ? null : snap);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [level, refreshKey]);

  // Rolling windows first, then fiscal periods newest-first. Values are
  // prefixed so a period label can't collide with a window key.
  const periodOptions = useMemo(() => {
    const opts: [string, string][] = [];
    for (const r of snapshots?.ranges ?? []) opts.push([`snap:${r.key}`, r.label]);
    for (const p of [...(scores?.periods ?? [])].reverse()) opts.push([`period:${p}`, p]);
    return opts;
  }, [snapshots, scores]);

  const defaultPeriod = periodOptions.find(([v]) => v === "snap:ptd")?.[0] ?? periodOptions[0]?.[0] ?? "";
  const selected = periodOptions.some(([v]) => v === periodSel) ? periodSel : defaultPeriod;
  const selectedLabel = periodOptions.find(([v]) => v === selected)?.[1] ?? "";
  const selectedWindow = selected.startsWith("snap:")
    ? snapshots?.ranges.find((r) => r.key === selected.slice(5))
    : undefined;

  /**
   * Every unit's metrics for the selected period, SMG's Combined row dropped.
   * Built by filtering rather than accumulating into a mutable map — the React
   * compiler treats a structure assembled from state values as state itself,
   * and mutating it in place is a lint error.
   */
  const unitRows = useMemo<UnitRow[]>(() => {
    const source: SnapshotRow[] | ScoreRow[] = selected.startsWith("snap:")
      ? (snapshots?.rows ?? []).filter((r) => r.rangeKey === selected.slice(5))
      : selected.startsWith("period:")
        ? (scores?.rows ?? []).filter((r) => r.periodLabel === selected.slice(7))
        : [];

    const keys = [...new Set(source.map((r) => r.unitKey))].filter((k) => k !== COMBINED_KEY);

    return keys
      .map((key) => {
        const rows = (source as { unitKey: string; unitName: string; metric: string; score: number | null; responses: number | null; belowMin: boolean }[])
          .filter((r) => r.unitKey === key);
        return {
          key,
          name: rows[0].unitName,
          label: prettyUnit(rows[0].unitName, key),
          // Response counts match across a unit's metrics; take the largest.
          surveys: rows.reduce((n, r) => Math.max(n, r.responses ?? 0), 0) || null,
          sales: null as number | null,
          cells: new Map<string, Cell>(
            rows.map((r) => [r.metric, { score: r.score, responses: r.responses, belowMin: r.belowMin }]),
          ),
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [selected, scores, snapshots]);

  const metrics = useMemo(() => {
    const s = new Set<string>();
    for (const u of unitRows) for (const k of u.cells.keys()) s.add(k);
    // Fixed reading order; anything unrecognised sorts to the end.
    return [...s].sort((a, b) => metricRank(a) - metricRank(b) || a.localeCompare(b));
  }, [unitRows]);

  // ── sales for the selected window ──
  // Keyed by the range it was loaded for, so "is this stale?" stays derived
  // rather than needing a second setState.
  const [salesState, setSalesState] = useState<{ key: string; map: Record<string, number> }>({ key: "", map: {} });
  const range = rangeForSelection(selected, selectedWindow);
  const rangeKey = range ? `${range.start}|${range.end}` : "";

  useEffect(() => {
    if (!rangeKey) return;
    let cancelled = false;
    const [start, end] = rangeKey.split("|");
    fetch(`/api/smg/sales?start=${start}&end=${end}`)
      .then((r) => r.json())
      .then((j: { salesByStoreId?: Record<string, number> }) => {
        if (!cancelled) setSalesState({ key: rangeKey, map: j.salesByStoreId ?? {} });
      })
      .catch(() => {
        if (!cancelled) setSalesState({ key: rangeKey, map: {} });
      });
    return () => {
      cancelled = true;
    };
  }, [rangeKey, refreshKey]);

  const salesByStore = salesState.key === rangeKey ? salesState.map : {};

  // Changing period refetches sales without touching `loading`, so the table
  // would otherwise sit showing stale figures with no indication.
  const salesLoading = Boolean(rangeKey) && salesState.key !== rangeKey;
  const busy = loading || salesLoading;

  /**
   * Every store always appears, even with no surveys in the window — a store
   * missing from the table reads as "no such store" rather than "nobody
   * responded", and on short windows like Today that's most of them.
   */
  const rows = useMemo(() => {
    const withSales = unitRows.map((u) => ({ ...u, sales: salesByStore[u.key] ?? null }));
    if (level !== "store") return withSales;

    const seen = new Set(withSales.map((u) => u.key));
    const missing = Object.keys(STORE_LABELS)
      .filter((key) => !seen.has(key))
      .map((key) => ({
        key,
        name: "",
        label: prettyUnit("", key),
        surveys: null,
        sales: salesByStore[key] ?? null,
        cells: new Map<string, Cell>(),
      }));
    return [...withSales, ...missing];
  }, [unitRows, salesByStore, level]);

  const isStoreLevel = level === "store";
  const tn = useMemo(() => rows.filter((u) => marketOf(u.key, u.name) === "TN"), [rows]);
  const va = useMemo(() => rows.filter((u) => marketOf(u.key, u.name) === "VA"), [rows]);

  const tnSummary = useMemo(() => summarise(tn, metrics), [tn, metrics]);
  const vaSummary = useMemo(() => summarise(va, metrics), [va, metrics]);
  const hrgSummary = useMemo(
    () => summarise(isStoreLevel ? [...tn, ...va] : rows, metrics),
    [isStoreLevel, tn, va, rows, metrics],
  );

  /**
   * One flat list of stores — the market split lives in the summary rows at the
   * bottom now, so the whole estate can be ranked against itself in one go.
   * The TN/VA checkboxes still filter which stores are listed.
   */
  const listed = useMemo(() => {
    if (!isStoreLevel) return rows;
    return rows.filter((u) => {
      const m = marketOf(u.key, u.name);
      if (m === "TN") return showTN;
      if (m === "VA") return showVA;
      return true;
    });
  }, [rows, isStoreLevel, showTN, showVA]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const value = (u: UnitRow): number | string | null => {
      if (sort.col === "label") return u.label;
      if (sort.col === "sales") return u.sales;
      if (sort.col === "surveys") return u.surveys;
      return u.cells.get(sort.col)?.score ?? null;
    };
    return [...listed].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      // Blanks always sink, whichever way the column is pointing — a store with
      // no surveys isn't "the worst", it's simply absent from the ranking.
      if (x === null && y === null) return a.label.localeCompare(b.label);
      if (x === null) return 1;
      if (y === null) return -1;
      const cmp = typeof x === "string" || typeof y === "string"
        ? String(x).localeCompare(String(y))
        : x - y;
      return cmp * dir || a.label.localeCompare(b.label);
    });
  }, [listed, sort]);

  const colCount = metrics.length + 3;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* banner: nav + controls, locked to the top together */}
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/survey-data"
                  onChange={(e) => router.push(e.target.value)}
                  className="text-base font-semibold text-gray-900 bg-transparent border-0 p-0 m-0 pr-5 appearance-none cursor-pointer focus:outline-none focus:ring-0"
                >
                  <option value="/dashboard">Drive-Thru</option>
                  <option value="/food-cost">Food Cost</option>
                  <option value="/par">POS Sales</option>
                  <option value="/survey-data">SMG</option>
                </select>
                <svg className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <button
                onClick={async () => {
                  await fetch("/api/auth/logout", { method: "POST" });
                  router.push("/login");
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <select
              value={selected}
              onChange={(e) => setPeriodSel(e.target.value)}
              className="text-sm font-medium border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {periodOptions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>

            <select
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>

            {isStoreLevel && (
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showVA} onChange={(e) => setShowVA(e.target.checked)} className="rounded border-gray-300" />
                  VA
                </label>
                <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input type="checkbox" checked={showTN} onChange={(e) => setShowTN(e.target.checked)} className="rounded border-gray-300" />
                  TN
                </label>
              </div>
            )}

            {selectedWindow && (
              <span className="text-xs text-gray-500">
                {shortDate(selectedWindow.windowStart)}–{shortDate(selectedWindow.windowEnd)}
              </span>
            )}

            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={busy}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {busy ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CopyableTitle
                title={`SMG — ${selectedLabel}`}
                targetRef={cardRef}
                className="text-sm font-semibold text-gray-800"
              />
              {busy && (
                <span className="flex items-center gap-1.5 text-xs text-gray-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
                  Loading…
                </span>
              )}
            </div>
            {selectedWindow && (
              <span className="text-xs text-gray-400">
                {shortDate(selectedWindow.windowStart)}–{shortDate(selectedWindow.windowEnd)}
              </span>
            )}
          </div>
          <div className={`overflow-x-auto transition-opacity ${busy ? "opacity-50" : "opacity-100"}`}>
            <table className="w-full text-sm table-fixed">
              {/* Every data column the same width; the label column takes the rest. */}
              <colgroup>
                <col style={{ width: `${LABEL_COL_PCT}%` }} />
                {Array.from({ length: metrics.length + 2 }).map((_, i) => (
                  <col key={i} style={{ width: `${(100 - LABEL_COL_PCT) / (metrics.length + 2)}%` }} />
                ))}
              </colgroup>
              <thead>
                <tr className="border-b border-gray-200">
                  <SortHeader
                    col="label"
                    sort={sort}
                    onSort={setSort}
                    align="left"
                    label={isStoreLevel ? "Location" : LEVELS.find((l) => l.value === level)?.label ?? ""}
                  />
                  <SortHeader col="sales" sort={sort} onSort={setSort} label="Sales" />
                  <SortHeader col="surveys" sort={sort} onSort={setSort} label="Surveys" />
                  {metrics.map((m) => (
                    <SortHeader key={m} col={m} sort={sort} onSort={setSort} label={shortMetric(m)} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-400 animate-pulse">
                      Loading…
                    </td>
                  </tr>
                )}

                {!loading && unitRows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} className="px-4 py-8 text-center text-sm text-gray-500">
                      No data stored for {selectedLabel || "this period"} yet.
                    </td>
                  </tr>
                )}

                {!loading && sorted.map((u) => <DataRow key={u.key} row={u} metrics={metrics} />)}

                {/* Market and company rollups, pinned below the stores rather
                    than splitting the list into sections. */}
                {!loading && isStoreLevel && showTN && tnSummary && tn.length > 0 && (
                  <SummaryRow label="TN" row={tnSummary} metrics={metrics} />
                )}
                {!loading && isStoreLevel && showVA && vaSummary && va.length > 0 && (
                  <SummaryRow label="VA" row={vaSummary} metrics={metrics} />
                )}
                {!loading && hrgSummary && showTN && showVA && (
                  <SummaryRow label="HRG" row={hrgSummary} metrics={metrics} emphasis />
                )}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Visit date — a guest&apos;s response counts on the day they visited, not the day they
          answered. Market and HRG lines are pooled across stores, weighted by survey count.
        </p>

        {/* Always store-level with its own grain and range, so it can span a
            longer history than whichever single period the table is showing. */}
        <div className="mt-5">
          <SurveyTrendChart dateBasis={DATE_BASIS} showTN={showTN} showVA={showVA} />
        </div>
      </main>
    </div>
  );
}

/**
 * Clickable column header. First click on a new column sorts it the way that
 * column is usually read — biggest sales, highest score, but A-Z for the name —
 * and clicking the active column flips it.
 */
function SortHeader({
  col,
  label,
  sort,
  onSort,
  align = "right",
}: {
  col: string;
  label: string;
  sort: { col: string; dir: "asc" | "desc" };
  onSort: (s: { col: string; dir: "asc" | "desc" }) => void;
  align?: "left" | "right";
}) {
  const active = sort.col === col;
  const naturalDir = col === "label" ? "asc" : "desc";
  const next = () => onSort({ col, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : naturalDir });

  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide ${align === "left" ? "text-left" : "text-right"}`}
    >
      <button
        type="button"
        onClick={next}
        className={`inline-flex items-center gap-1 w-full cursor-pointer transition-colors hover:text-gray-600 ${
          align === "left" ? "justify-start" : "justify-end"
        } ${active ? "text-gray-700" : "text-gray-400"}`}
      >
        <span>{label}</span>
        <span aria-hidden="true" className={`text-[9px] leading-none ${active ? "opacity-100" : "opacity-0"}`}>
          {sort.dir === "asc" ? "▲" : "▼"}
        </span>
      </button>
    </th>
  );
}

function DataRow({ row, metrics }: { row: UnitRow; metrics: string[] }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-2 font-medium text-gray-900 whitespace-nowrap">{row.label}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-900">{fmtSales(row.sales)}</td>
      <td className="px-4 py-2 text-right tabular-nums text-gray-700">{row.surveys ?? "—"}</td>
      {metrics.map((m) => {
        const c = row.cells.get(m);
        const tone = scoreTone(c?.score, m);
        return (
          <td
            key={m}
            title={c?.belowMin ? "Below SMG's minimum response threshold" : undefined}
            className={`px-4 py-2 text-right tabular-nums ${TONE_TEXT[tone]} ${TONE_BG[tone]} ${c?.belowMin ? "italic opacity-70" : ""}`}
          >
            {c?.score === null || c === undefined ? "—" : `${c.score}%`}
          </td>
        );
      })}
    </tr>
  );
}

function SummaryRow({
  label,
  row,
  metrics,
  emphasis,
}: {
  label: string;
  row: UnitRow;
  metrics: string[];
  emphasis?: boolean;
}) {
  return (
    <tr className={`border-b ${emphasis ? "border-gray-300 bg-gray-100" : "border-gray-200 bg-gray-50"}`}>
      <td className="px-4 py-2 font-semibold text-gray-900 whitespace-nowrap">{label}</td>
      <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{fmtSales(row.sales)}</td>
      <td className="px-4 py-2 text-right tabular-nums font-semibold text-gray-900">{row.surveys ?? "—"}</td>
      {metrics.map((m) => {
        const c = row.cells.get(m);
        const tone = scoreTone(c?.score, m);
        return (
          <td
            key={m}
            className={`px-4 py-2 text-right tabular-nums font-semibold ${TONE_TEXT[tone]} ${TONE_BG_STRONG[tone]}`}
          >
            {c?.score === null || c === undefined ? "—" : `${c.score}%`}
          </td>
        );
      })}
    </tr>
  );
}
