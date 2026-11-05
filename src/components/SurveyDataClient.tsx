"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CopyableTitle } from "@/components/CopyImageButton";
import SurveyTrendChart from "@/components/SurveyTrendChart";
import ZCasesSection from "@/components/ZCasesSection";
import GoogleReviewsSection from "@/components/GoogleReviewsSection";
import TabOptions from "@/components/TabOptions";
import type { Tab } from "@/lib/users/tabs";
import { StoreFilterPicker, useStoreFilter, inFilter, marketShown, type Leader } from "@/components/StoreFilter";
import { getPriorYearRange, PERIODS, resolveRange } from "@/lib/fiscal";
import {
  COMBINED_KEY,
  DIGITAL_METRIC,
  STORE_LABELS,
  TONE_BG,
  TONE_TEXT,
  marketOf,
  metricRank,
  pooledScore,
  prettyUnit,
  publishedMarketCells,
  type PooledCell,
  type RollupRow,
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

/** /api/smg/custom — one custom window, both levels. */
type CustomResponse = {
  start: string;
  end: string;
  store: (SnapshotRow & { asOf: string })[];
  regionManager: (SnapshotRow & { asOf: string })[];
};

/**
 * The stored snapshot windows plus the custom one, once it's been pulled, as
 * window "custom". Its dates are the ones asked for rather than read off the
 * rows, so a range with no surveys at all still shows as that range.
 */
function withCustom(
  base: SnapshotsResponse | null,
  custom: CustomResponse | null,
  level: "store" | "regionManager",
): SnapshotsResponse | null {
  if (!custom) return base;
  const rows = custom[level];
  const newest = rows.reduce((t, r) => Math.max(t, Date.parse(r.asOf) || 0), 0);
  const asOf = new Date(newest || Date.now()).toISOString();
  return {
    ranges: [
      ...(base?.ranges ?? []),
      { key: "custom", label: "Custom", windowStart: custom.start, windowEnd: custom.end, asOf },
    ],
    units: base?.units ?? [],
    metrics: base?.metrics ?? [],
    rows: [...(base?.rows ?? []), ...rows.map((r) => ({ ...r, rangeKey: "custom" }))],
  };
}

// Fixed rather than exposed: the tab always reads store level, visit date, at
// period grain. The regional/district-manager cuts are still ingested by the
// cron and queryable through /api/smg/scores — the picker just doesn't offer
// them, since TN/VA is the split HRG actually reads the tab by.
const LEVEL = "store";
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
 * SMG's own row for a group of units, if one of `candidates` covers exactly
 * those units. Adapts the table's per-unit cell maps to the shape
 * `publishedMarketCells` compares on.
 */
function matchPublished(candidates: RollupRow[], units: UnitRow[], metrics: string[]) {
  if (!candidates.length || !units.length) return null;
  return publishedMarketCells(
    candidates,
    new Map(metrics.map((m) => [m, units.map((u) => u.cells.get(m) ?? { score: null, responses: null })])),
  );
}

/**
 * One market's (or the estate's) line.
 *
 * `published` is SMG's own row for this group where it has one — matched by
 * coverage, not by name, in `publishedMarketCells`. Preferring it makes the
 * line identical to the SMG portal rather than merely very close: pooling has
 * to reconstruct respondent counts from whole-percent store scores, which is
 * right ~99.5% of the time but can't be better, since the fractions SMG
 * rounded away aren't in the data we're given.
 */
function summarise(
  units: UnitRow[],
  metrics: string[],
  published?: Map<string, PooledCell> | null,
): UnitRow | null {
  if (!units.length) return null;
  const cells = new Map<string, Cell>();
  for (const metric of metrics) {
    const smg = published?.get(metric);
    const pooled = smg?.score != null
      ? smg
      : pooledScore(units.map((u) => u.cells.get(metric) ?? { score: null, responses: null }));
    cells.set(metric, { score: pooled.score, responses: pooled.responses, belowMin: false });
  }
  const surveys = units.reduce((n, u) => n + (u.surveys ?? 0), 0);
  const sales = units.reduce((n, u) => n + (u.sales ?? 0), 0);
  return { key: "", name: "", label: "", surveys: surveys || null, sales: sales || null, cells };
}

export default function SurveyDataClient({
  tabs,
  isAdmin,
  leaders,
}: {
  tabs: Tab[];
  isAdmin: boolean;
  leaders: Leader[];
}) {
  const router = useRouter();

  const [periodSel, setPeriodSel] = useState<string>("");
  const storeFilter = useStoreFilter(leaders);
  // Opens on most surveys first.
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" }>({ col: "surveys", dir: "desc" });
  const [refreshKey, setRefreshKey] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [fetchNote, setFetchNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Bumped only by Fetch, so the ZCases section re-pulls from SMG when the
  // scores do — Refresh just re-reads, and shouldn't cost an SMG round trip.
  const [zcaseFetchKey, setZcaseFetchKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const [scores, setScores] = useState<ScoresResponse | null>(null);
  const [storedSnapshots, setSnapshots] = useState<SnapshotsResponse | null>(null);
  // SMG's region-manager rows, which are the TN and VA totals as SMG itself
  // publishes them. Fetched alongside the store rows rather than replacing
  // them: the table still lists stores, and the market lines only borrow these
  // where they provably cover the same stores.
  const [rmScores, setRmScores] = useState<ScoresResponse | null>(null);
  const [storedRmSnapshots, setRmSnapshots] = useState<SnapshotsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // ── custom date range ──
  // Pulled from SMG on demand (no cron can know which ranges get asked for) and
  // folded in below as one more snapshot window, "snap:custom", so the table,
  // market lines, sales and ZCases all treat it exactly like PTD or T7.
  const [customStart, setCustomStart] = useState(() => resolveRange("yesterday").range.slice(0, 10));
  const [customEnd, setCustomEnd] = useState(() => resolveRange("yesterday").range.slice(0, 10));
  const [custom, setCustom] = useState<CustomResponse | null>(null);
  const [customLoading, setCustomLoading] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);
  const todayISO = resolveRange("today").range.slice(0, 10);
  const customValid = Boolean(customStart && customEnd && customStart <= customEnd && customEnd <= todayISO);

  const loadCustom = async (start: string, end: string, bust = false): Promise<boolean> => {
    setCustomLoading(true);
    setCustomError(null);
    try {
      const res = await fetch(
        `/api/smg/custom?start=${start}&end=${end}&dateBasis=${DATE_BASIS}${bust ? "&bust=1" : ""}`,
      );
      const j = (await res.json()) as CustomResponse & { error?: string };
      if (!res.ok || j.error) {
        setCustomError(j.error ? `Custom range failed — ${j.error}` : "Custom range failed");
        return false;
      }
      setCustom(j);
      return true;
    } catch {
      setCustomError("Custom range failed — couldn't reach the server");
      return false;
    } finally {
      setCustomLoading(false);
    }
  };

  const applyCustom = async () => {
    if (await loadCustom(customStart, customEnd)) setPeriodSel("snap:custom");
  };

  const snapshots = useMemo(() => withCustom(storedSnapshots, custom, "store"), [storedSnapshots, custom]);
  const rmSnapshots = useMemo(() => withCustom(storedRmSnapshots, custom, "regionManager"), [storedRmSnapshots, custom]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/smg/scores?level=${LEVEL}&periodType=${GRAIN}&dateBasis=${DATE_BASIS}&limit=${PERIOD_LOOKBACK}`).then((r) => r.json()),
      fetch(`/api/smg/snapshots?level=${LEVEL}&dateBasis=${DATE_BASIS}`).then((r) => r.json()),
      // The region-manager rows are read even though the tab only lists stores:
      // they carry SMG's own published market totals. See publishedRows.
      fetch(`/api/smg/scores?level=regionManager&periodType=${GRAIN}&dateBasis=${DATE_BASIS}&limit=${PERIOD_LOOKBACK}`).then((r) => r.json()),
      fetch(`/api/smg/snapshots?level=regionManager&dateBasis=${DATE_BASIS}`).then((r) => r.json()),
    ])
      .then(([s, snap, rs, rsnap]: [ScoresResponse, SnapshotsResponse, ScoresResponse, SnapshotsResponse]) => {
        if (cancelled) return;
        setScores(s.error ? null : s);
        setSnapshots(snap.error ? null : snap);
        setRmScores(rs.error ? null : rs);
        setRmSnapshots(rsnap.error ? null : rsnap);
        setLoading(false);
      })
      .catch(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

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
  // Apply greys out when the boxes already name the range on screen, as on POS Sales.
  const customIsCurrent = selected === "snap:custom" && custom?.start === customStart && custom?.end === customEnd;
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
          // Response counts match across a unit's metrics, except Digital OSAT's
          // smaller subset; the largest is every survey the unit received.
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
  }, [unitRows, salesByStore]);

  // Leader-filtered, because these feed the TN/VA/HRG summary rows and nothing
  // else. A rollup that averaged the whole market while the table below listed
  // one leader's stores would be quietly comparing two different things.
  const tn = useMemo(
    () => rows.filter((u) => marketOf(u.key, u.name) === "TN" && inFilter(storeFilter.allowed, u.label)),
    [rows, storeFilter.allowed],
  );
  const va = useMemo(
    () => rows.filter((u) => marketOf(u.key, u.name) === "VA" && inFilter(storeFilter.allowed, u.label)),
    [rows, storeFilter.allowed],
  );
  const tx = useMemo(
    () => rows.filter((u) => marketOf(u.key, u.name) === "TX" && inFilter(storeFilter.allowed, u.label)),
    [rows, storeFilter.allowed],
  );

  /** SMG's region-manager rows for whichever window is selected. */
  const publishedRows = useMemo(() => {
    const source = selected.startsWith("snap:")
      ? (rmSnapshots?.rows ?? []).filter((r) => r.rangeKey === selected.slice(5))
      : selected.startsWith("period:")
        ? (rmScores?.rows ?? []).filter((r) => r.periodLabel === selected.slice(7))
        : [];
    // SMG's own all-regions rollup is the HRG line, not a market candidate.
    return source.filter((r) => r.unitKey !== COMBINED_KEY);
  }, [selected, rmScores, rmSnapshots]);

  /** SMG's own Combined row for the selected window — the estate total. */
  const combinedRows = useMemo(() => {
    const source: { unitKey: string; metric: string; score: number | null; responses: number | null }[] =
      selected.startsWith("snap:")
        ? (snapshots?.rows ?? []).filter((r) => r.rangeKey === selected.slice(5))
        : selected.startsWith("period:")
          ? (scores?.rows ?? []).filter((r) => r.periodLabel === selected.slice(7))
          : [];
    return source.filter((r) => r.unitKey === COMBINED_KEY);
  }, [selected, scores, snapshots]);

  /**
   * The one rollup line, over whatever the filter left.
   *
   * Both of SMG's own rollups are offered as candidates — the Combined row and
   * the per-market rows — because `publishedMarketCells` matches them by
   * response coverage and returns one only when exactly one qualifies. So the
   * line stays identical to the SMG portal in the two cases where SMG has
   * published the same set: the whole estate, and a single market. Filter to a
   * leader and nothing covers that set, so it pools, which is what the fallback
   * is for.
   *
   * SMG publishes Combined at period grain but not for the rolling snapshot
   * windows, so the estate line pools more often than a market line does.
   */
  const hrgSummary = useMemo(() => {
    // Always store level now that the level picker is gone, so the estate is
    // simply every market.
    const units = [...tn, ...va, ...tx];
    return summarise(units, metrics, matchPublished([...publishedRows, ...combinedRows], units, metrics));
  }, [tn, va, tx, metrics, publishedRows, combinedRows]);

  /**
   * One flat list of stores — the market split lives in the summary rows at the
   * bottom now, so the whole estate can be ranked against itself in one go.
   * The TN/VA checkboxes still filter which stores are listed.
   */
  const listed = useMemo(
    () =>
      rows.filter((u) => inFilter(storeFilter.allowed, u.label)),
    [rows, storeFilter.allowed],
  );

  /**
   * Store numbers the ZCases section should cover, from the TN/VA checkboxes.
   * Null means no filter.
   *
   * Built from STORE_LABELS rather than from `listed`, because a store with no
   * surveys in the window can still have ZCases — filtering by what the survey
   * table happens to list would hide them.
   */
  const zcaseStores = useMemo(() => {
    if (!storeFilter.allowed) return null;
    return Object.keys(STORE_LABELS).filter((key) => inFilter(storeFilter.allowed, STORE_LABELS[key]));
  }, [storeFilter.allowed]);

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

  /**
   * One rollup, named after whatever is selected.
   *
   * The market split used to be pinned here as separate TN and VA lines, from
   * when TN/VA was the only cut the tab offered. Now that the filter can name
   * any slice, the rollup follows it: pick VA and the line is VA, pick a leader
   * and it is theirs. Unfiltered it covers the estate and says so.
   */
  const summaryLabel = `Total - ${storeFilter.label ?? "HRG"}`;

  const summaryRows = useMemo(
    () => (hrgSummary ? [{ label: summaryLabel, row: hrgSummary }] : []),
    [hrgSummary, summaryLabel],
  );

  const colCount = metrics.length + 3;

  // The note describes the window it was fetched for, so it can't outlive it.
  useEffect(() => setFetchNote(null), [selected]);

  /**
   * The tab's one refresh: re-pull the selected window from SMG, then re-read.
   *
   * Previously two buttons — Fetch for the SMG round trip, Refresh for a plain
   * re-read. One button covers both, since re-reading without pulling only
   * ever showed the same rows again.
   *
   * The ZCase pull is kicked off first so it runs alongside the scores pull
   * rather than after it; ZCases are a separate report on a different window
   * basis, so they can't ride along on `selection`.
   */
  const refreshAll = async () => {
    setFetching(true);
    setFetchNote(null);
    setZcaseFetchKey((k) => k + 1);
    // A custom window isn't one the refresh route knows; it re-pulls through
    // its own endpoint, skipping the cache.
    if (selected === "snap:custom" && custom) {
      await loadCustom(custom.start, custom.end, true);
      setRefreshKey((k) => k + 1);
      setFetching(false);
      return;
    }
    try {
      const res = await fetch("/api/smg/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selection: selected, dateBasis: DATE_BASIS }),
      });
      const j = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok || j.error) {
        setFetchNote({ ok: false, text: j.error ? `Fetch failed — ${j.error}` : "Fetch failed" });
        return;
      }
      // Re-read so the table shows what was just written. No success note; the
      // button returning from "Refreshing…" says it. Failures still surface,
      // since nothing else would show them.
      setRefreshKey((k) => k + 1);
    } catch {
      setFetchNote({ ok: false, text: "Fetch failed — couldn't reach the server" });
    } finally {
      setFetching(false);
    }
  };

  /**
   * The dates the selected window actually covers, carried in the card title so
   * a pasted screenshot says what it's showing. `range` already resolves both
   * kinds of selection — snapshot windows from their stored dates, fiscal
   * periods through fiscal.ts — so the two read identically.
   */
  // A one-day window ("Yesterday") reads as a single date, not "7/26–7/26".
  const titleRange = !range
    ? ""
    : range.start === range.end
      ? shortDate(range.start)
      : `${shortDate(range.start)}–${shortDate(range.end)}`;
  const cardTitle = titleRange ? `SMG — ${selectedLabel} · ${titleRange}` : `SMG — ${selectedLabel}`;

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
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
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
                Sign out
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

            {/* Custom range — pulled from SMG on Apply, then listed above as
                "Custom". Styled to match the POS Sales and Slack pickers. */}
            <div className="flex items-center gap-1">
              <input
                type="date"
                aria-label="From"
                value={customStart}
                max={customEnd || todayISO}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <span className="text-xs text-gray-400">to</span>
              <input
                type="date"
                aria-label="To"
                value={customEnd}
                min={customStart || undefined}
                max={todayISO}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>
            <button
              onClick={applyCustom}
              disabled={!customValid || customLoading || customIsCurrent}
              title="Pull this range from SMG. Takes a few seconds the first time."
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {customLoading ? "Loading…" : "Apply"}
            </button>

            {/* The cut the tab offers. The scores table, its TN/VA/HRG summary
                rows and the ZCases section all follow it. */}
            <StoreFilterPicker leaders={leaders} value={storeFilter.value} onChange={storeFilter.setValue} />

            {selectedWindow && (
              <span className="text-xs text-gray-500">
                {shortDate(selectedWindow.windowStart)}–{shortDate(selectedWindow.windowEnd)}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Only failures appear here. */}
              {fetchNote && !fetchNote.ok && (
                <span className="text-xs text-red-600">{fetchNote.text}</span>
              )}
              {customError && <span className="text-xs text-red-600">{customError}</span>}
              <button
                onClick={refreshAll}
                disabled={fetching || busy || !selected}
                title="Re-pull this window from SMG. Scores keep moving for 14 days after the visit date, so a window can change between daily syncs."
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
              >
                {fetching || busy ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5">
        <div ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <CopyableTitle
                title={cardTitle}
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
          </div>
          <div className={`overflow-x-auto transition-opacity ${busy ? "opacity-50" : "opacity-100"}`}>
            {/* text-sm cells / text-xs headers / py-3 rows — same metrics as the
                Food Cost tables, so the two read as one system. */}
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
                    label="Location"
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

                {/* The rollup, pinned below the stores rather than splitting
                    the list into sections, and named after whatever the filter
                    selected. */}
                {!loading &&
                  summaryRows.map((s, i) => (
                    <SummaryRow key={s.label} label={s.label} row={s.row} metrics={metrics} first={i === 0} />
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-3">
          Visit date — a guest&apos;s response counts on the day they visited, not the day they
          answered. Digital OSAT counts only surveys SMG tags as digital, so most stores fall
          under SMG&apos;s minimum response threshold (italics); hover a score for its count.
        </p>

        {/* Current Google ratings — follows the store filter, not the period
            picker, since Google has no notion of a period. */}
        <GoogleReviewsSection stores={zcaseStores} refreshKey={refreshKey} />

        {/* Always store-level with its own grain and range, so it can span a
            longer history than whichever single period the table is showing. */}
        <div className="mt-5">
          <SurveyTrendChart
            dateBasis={DATE_BASIS}
            showTN={marketShown(storeFilter.allowed, "TN")}
            showVA={marketShown(storeFilter.allowed, "VA")}
            showTX={marketShown(storeFilter.allowed, "TX")}
          />
        </div>

        {/* Shares the page's period picker. ZCases window on the guest's visit
            date, the same basis as the scores above, so the two answer the same
            question about the same days. `range` is null for a period fiscal.ts
            can't resolve, which the section renders as an empty state. */}
        <ZCasesSection
          start={range?.start ?? null}
          end={range?.end ?? null}
          label={selectedLabel}
          refreshKey={refreshKey}
          fetchKey={zcaseFetchKey}
          stores={zcaseStores}
          totalLabel={summaryLabel}
        />
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

/**
 * Hover text for a score. Digital OSAT states its own count, because it's the
 * one metric whose base isn't the row's Surveys figure.
 */
function cellTitle(c: Cell | undefined, metric: string): string | undefined {
  const notes = [
    c?.belowMin ? "Below SMG's minimum response threshold" : null,
    c?.responses && DIGITAL_METRIC.test(metric)
      ? `${c.responses} digital ${c.responses === 1 ? "survey" : "surveys"}`
      : null,
  ].filter(Boolean);
  return notes.length ? notes.join(" · ") : undefined;
}

function DataRow({ row, metrics }: { row: UnitRow; metrics: string[] }) {
  return (
    <tr className="border-b border-gray-100">
      <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">{row.label}</td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-900">{fmtSales(row.sales)}</td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{row.surveys ?? "—"}</td>
      {metrics.map((m) => {
        const c = row.cells.get(m);
        const tone = scoreTone(c?.score, m);
        return (
          <td
            key={m}
            title={cellTitle(c, m)}
            // Below-minimum cells are marked with italics only. They used to
            // carry opacity-70 as well, which faded the fill along with the
            // text and made those rows look like a lighter shade of the same
            // scale rather than the same shade with a caveat.
            className={`px-4 py-3 text-right tabular-nums ${TONE_TEXT[tone]} ${TONE_BG[tone]} ${c?.belowMin ? "italic" : ""}`}
          >
            {c?.score === null || c === undefined ? "—" : `${c.score}%`}
          </td>
        );
      })}
    </tr>
  );
}

/**
 * Market / company rollup. Uses exactly the same score colours as a store row —
 * a heavier fill would read as a worse score rather than a different kind of
 * row. What separates the block is the rule above it (`first`) plus bold text,
 * not a second colour scale.
 */
function SummaryRow({
  label,
  row,
  metrics,
  first,
}: {
  label: string;
  row: UnitRow;
  metrics: string[];
  first?: boolean;
}) {
  return (
    <tr className={`border-b border-gray-200 ${first ? "border-t-2 border-t-gray-400" : ""}`}>
      <td className="px-4 py-3 font-semibold text-gray-900 whitespace-nowrap">{label}</td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{fmtSales(row.sales)}</td>
      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{row.surveys ?? "—"}</td>
      {metrics.map((m) => {
        const c = row.cells.get(m);
        const tone = scoreTone(c?.score, m);
        return (
          <td
            key={m}
            title={cellTitle(c, m)}
            className={`px-4 py-3 text-right tabular-nums font-semibold ${TONE_TEXT[tone]} ${TONE_BG[tone]}`}
          >
            {c?.score === null || c === undefined ? "—" : `${c.score}%`}
          </td>
        );
      })}
    </tr>
  );
}
