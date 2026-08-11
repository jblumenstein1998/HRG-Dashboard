"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CopyableTitle } from "@/components/CopyImageButton";
import { ZCASE_GOALS } from "@/lib/bonus/goals";
import { formatSyncStamp, prettyUnit, STORE_LABELS, TONE_TEXT, type ScoreTone } from "@/lib/surveyMeta";

type ZCaseRow = {
  caseKey: string;
  displayKey: string;
  store: string | null;
  unitName: string | null;
  type: string | null;
  receivedAt: string | null;
  eventAt: string | null;
  resolvedAt: string | null;
  resolutionHours: number | null;
  escalated: boolean;
  openHours: number | null;
  deepLink: string;
};

type StoreRollup = {
  store: string | null;
  unitName: string | null;
  cases: number;
  avgResolveHours: number | null;
  over24: number;
  over24Pct: number | null;
  outstanding: number;
  escalated: number;
};

type ZCaseResponse = {
  window: { start: string; end: string; label: string; types: string[] };
  totals: {
    cases: number;
    avgResolveHours: number | null;
    over24: number;
    over24Pct: number | null;
    outstanding: number;
    escalated: number;
  };
  stores: StoreRollup[];
  outstanding: ZCaseRow[];
  cases: ZCaseRow[];
  syncedAt: string | null;
  refreshError?: string | null;
  error?: string;
};

/**
 * The two guest-facing ZCase types, reported together. The team-member hotline
 * is a different conversation and stays out — the API leaves it out too unless
 * asked for by name.
 *
 * They're one table rather than a filter: a store's guest-recovery record is
 * both kinds of case, and every case row carries its own label so the mix stays
 * readable without splitting the numbers.
 */
const TYPES = "unsolicited,locationSurvey";

/** Labels for the case rows, so the two types stay tellable apart. */
const TYPE_LABEL: Record<string, string> = {
  unsolicited: "Unsolicited",
  locationSurvey: "Location survey",
  hotline: "Hotline",
};

/**
 * "2026-07-27" -> "07/27/26". Split rather than parsed: `new Date("2026-07-27")`
 * is UTC midnight, which prints as the day before in Central.
 */
const mdy = (isoDate: string) => {
  const [y, m, d] = isoDate.split("-");
  return y && m && d ? `${m}/${d}/${y.slice(2)}` : isoDate;
};

const shortDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : `${d.getMonth() + 1}/${d.getDate()}`;
};

const storeLabel = (store: string | null, unitName: string | null) =>
  store ? prettyUnit(unitName ?? "", store) : (unitName ?? "Unknown");

/**
 * The two columns that carry a bonus goal are scored against it and shaded on
 * the same green/yellow/red scale the survey table uses: green at Target,
 * yellow at Threshold, red below. Everything else in the table stays black —
 * a number without a goal behind it shouldn't look like a verdict.
 *
 * Both goals are per store per **period**, so the shading only means what it
 * says on a full-period window; on Today or WTD a green count is just an
 * incomplete one.
 */
const countTone = (cases: number): ScoreTone =>
  cases <= ZCASE_GOALS.count.target ? "good" : cases <= ZCASE_GOALS.count.threshold ? "ok" : "bad";

/**
 * The API reports the share of cases that ran *over* 24 hrs; the scorecard is
 * written the other way round ("Z-Cases resolved within 24 hrs", ≥95% / 100%),
 * so the table reports that. Same number read the way it's scored, and it puts
 * the column the same way up as every other percentage on the tab — bigger is
 * better, best at the top when you sort it.
 */
const within24 = (over24Pct: number | null): number | null =>
  over24Pct === null ? null : 100 - over24Pct;

const within24Tone = (pct: number | null): ScoreTone => {
  if (pct === null) return "none";
  if (pct >= ZCASE_GOALS.resolvedWithin24Pct.target) return "good";
  if (pct >= ZCASE_GOALS.resolvedWithin24Pct.threshold) return "ok";
  return "bad";
};

type SortCol = "store" | "cases" | "avg" | "over24" | "within24Pct" | "outstanding";

/** Store name column; the five data columns share what's left equally. */
const STORE_COL_PCT = 28;
const DATA_COLS = 5;

/**
 * ZCases for the SMG tab.
 *
 * The window comes from the page's period picker rather than a second control
 * of its own — one timeframe for the whole tab. `start`/`end` are calendar
 * dates; they're null while the picker is still loading, or for a period
 * outside the fiscal calendar, and the section shows an empty state instead of
 * querying a window it can't name.
 */
export default function ZCasesSection({
  start,
  end,
  label,
  refreshKey,
  stores,
}: {
  start: string | null;
  end: string | null;
  label: string;
  /** Bumped by the page's Refresh button; forces a fresh pull from SMG. */
  refreshKey: number;
  /**
   * Store numbers to include, from the page's TN/VA checkboxes. Null means
   * every store — the aggregates are done in SQL rather than by filtering the
   * rows here, so the tiles can't disagree with the table.
   */
  stores: string[] | null;
}) {
  const [sort, setSort] = useState<{ col: SortCol; dir: "asc" | "desc" }>({ col: "cases", dir: "desc" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // An empty list is "nothing selected", not "no filter" — both checkboxes off
  // empties the table above, and this follows it rather than quietly showing
  // every store.
  const noneSelected = stores !== null && stores.length === 0;
  const storeFilter = stores?.join(",") ?? "";
  const query =
    start && end && !noneSelected
      ? `start=${start}&end=${end}&type=${TYPES}${storeFilter ? `&stores=${storeFilter}` : ""}`
      : "";
  // Refresh has to move the key too, or hitting it while the period is
  // unchanged would leave the data looking current and never reload.
  const queryKey = query ? `${query}#${refreshKey}` : "";

  /**
   * Keyed by what it was loaded for, so "is this stale?" stays derived — the
   * same shape SurveyDataClient uses for sales. A separate `loading` flag would
   * have to be set synchronously inside the effect, which cascades renders and
   * is a lint error.
   */
  const [state, setState] = useState<{ key: string; data: ZCaseResponse | null }>({ key: "", data: null });

  useEffect(() => {
    if (!query) return;
    let cancelled = false;
    fetch(`/api/smg/zcases?${query}`)
      .then((r) => r.json())
      .then((j: ZCaseResponse) => {
        if (!cancelled) setState({ key: queryKey, data: j.error ? null : j });
      })
      .catch(() => {
        if (!cancelled) setState({ key: queryKey, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [query, queryKey]);

  /**
   * Pull from SMG in the background — once on mount, and again each time
   * Refresh is pressed.
   *
   * The pull costs ~6s against SMG, so blocking the first paint on it would
   * trade a working table for a spinner. The stored data renders immediately
   * and the fresh numbers swap in when they land. Keyed on `refreshKey` rather
   * than on the window, so changing period reads the sync's data instead of
   * hammering SMG for rows it already holds.
   */
  // Copy-as-image targets: each card is captured on its own, so a screenshot
  // carries just that table rather than the whole section.
  const outstandingRef = useRef<HTMLDivElement>(null);
  const byStoreRef = useRef<HTMLDivElement>(null);

  const startedFor = useRef<number | null>(null);
  const [doneFor, setDoneFor] = useState<number | null>(null);

  useEffect(() => {
    if (!query || startedFor.current === refreshKey) return;
    startedFor.current = refreshKey;
    let cancelled = false;
    fetch(`/api/smg/zcases?${query}&refresh=1`)
      .then((r) => r.json())
      .then((j: ZCaseResponse) => {
        if (!cancelled && !j.error) setState({ key: queryKey, data: j });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setDoneFor(refreshKey);
      });
    return () => {
      cancelled = true;
    };
  }, [query, queryKey, refreshKey]);

  // Stale rows stay on screen while a new window loads, with the table's own
  // "Loading…" row as the tell — blanking the tab on every period change reads
  // as "no data" rather than "one moment".
  // Null when there's nothing to show — otherwise the tiles would keep printing
  // the last window's numbers after the markets were unchecked.
  const data = query ? state.data : null;
  const loading = Boolean(query) && state.key !== queryKey;
  const refreshing = Boolean(query) && doneFor !== refreshKey;

  const casesByStore = useMemo(() => {
    const map = new Map<string, ZCaseRow[]>();
    for (const c of data?.cases ?? []) {
      const key = c.store ?? "unknown";
      const list = map.get(key);
      if (list) list.push(c);
      else map.set(key, [c]);
    }
    return map;
  }, [data]);

  /**
   * Every store, always — a store missing from the table reads as "no such
   * store" rather than "no ZCases", and on a short period that's most of them.
   * Same reason the survey table above fills its own gaps.
   */
  const allStores = useMemo(() => {
    if (!query) return [];
    const rows = [...(data?.stores ?? [])];
    const seen = new Set(rows.map((r) => r.store));
    for (const store of Object.keys(STORE_LABELS)) {
      if (seen.has(store) || (stores && !stores.includes(store))) continue;
      rows.push({
        store,
        unitName: null,
        cases: 0,
        avgResolveHours: null,
        over24: 0,
        over24Pct: null,
        outstanding: 0,
        escalated: 0,
      });
    }
    return rows;
  }, [data, query, stores]);

  const sortedStores = useMemo(() => {
    const rows = [...allStores];
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.sort((a, b) => {
      if (sort.col === "store") {
        return dir * storeLabel(a.store, a.unitName).localeCompare(storeLabel(b.store, b.unitName));
      }
      const pick = (r: StoreRollup) =>
        sort.col === "cases" ? r.cases
        : sort.col === "avg" ? (r.avgResolveHours ?? -1)
        : sort.col === "over24" ? r.over24
        : sort.col === "within24Pct" ? (within24(r.over24Pct) ?? -1)
        : r.outstanding;
      // Ties break on name so the zero-ZCase stores don't shuffle between renders.
      return (
        dir * (pick(a) - pick(b)) ||
        storeLabel(a.store, a.unitName).localeCompare(storeLabel(b.store, b.unitName))
      );
    });
  }, [allStores, sort]);

  const toggle = (store: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(store)) next.delete(store);
      else next.add(store);
      return next;
    });

  /**
   * The type split, for the header tile. Counted from the case rows rather than
   * asked of the API — they're already loaded, and one number per type on the
   * tile beats a second round trip.
   */
  const typeMix = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.cases ?? []) {
      const key = c.type ?? "unknown";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${n} ${(TYPE_LABEL[type] ?? type).toLowerCase()}`)
      .join(" · ");
  }, [data]);

  const totals = data?.totals;
  const outstanding = data?.outstanding ?? [];

  return (
    <section className="mt-6">
      {/* Boxed like the cards below it, so the section reads as its own block
          rather than as a caption hanging off the trend chart above. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3 bg-white rounded-xl border border-gray-200 px-4 py-3">
        <h2 className="text-base font-semibold text-gray-800">ZCases</h2>
        <span className="text-xs text-gray-500 border border-gray-200 bg-gray-50 rounded-full px-2.5 py-0.5">
          Unsolicited feedback + location survey callbacks
        </span>
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <span className="ml-auto flex items-center gap-2 text-xs text-gray-500">
          {refreshing && <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />}
          <span>
            Updated {formatSyncStamp(data?.syncedAt)}
            {refreshing ? " · refreshing…" : ""}
          </span>
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="ZCases" value={totals ? String(totals.cases) : "—"} foot={typeMix || "—"} />
        <Tile
          label="Avg time to resolve"
          value={totals?.avgResolveHours == null ? "—" : String(totals.avgResolveHours)}
          unit="hrs"
          foot="Resolved cases only"
        />
        <Tile
          label="Resolved > 24 hrs"
          value={totals ? String(totals.over24) : "—"}
          foot={totals?.over24Pct == null ? "—" : `${totals.over24Pct}% of resolved`}
        />
        <Tile
          label="Outstanding now"
          value={totals ? String(totals.outstanding) : "—"}
          foot={
            outstanding.length > 0
              ? `Oldest open ${Math.max(...outstanding.map((c) => c.openHours ?? 0))} hrs`
              : "All resolved"
          }
          tone={totals && totals.outstanding > 0 ? "crit" : undefined}
        />
      </div>

      {/* Outstanding leads: it's the only part that needs action today. */}
      <div ref={outstandingRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-3">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-3">
          <div>
            <CopyableTitle
              title="Outstanding ZCases"
              targetRef={outstandingRef}
              className="text-sm font-semibold text-gray-800"
            />
            <div className="text-xs text-gray-400">Open cases, oldest first</div>
          </div>
          {outstanding.length > 0 && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">
              {outstanding.length} open
            </span>
          )}
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-gray-400 animate-pulse">Loading…</div>
        ) : outstanding.length === 0 ? (
          <div className="px-4 py-7 text-center">
            <div className="text-sm font-semibold text-green-700">No open ZCases</div>
            <div className="text-xs text-gray-500 mt-0.5">Every ZCase has been resolved.</div>
          </div>
        ) : (
          outstanding.map((c) => {
            const hrs = c.openHours ?? 0;
            const stripe = hrs >= 24 ? "bg-red-600" : hrs >= 12 ? "bg-amber-600" : "bg-gray-300";
            return (
              <div key={c.caseKey} className="flex items-center gap-3.5 px-4 py-3 border-b border-gray-100 last:border-b-0">
                <span className={`w-1 h-8 rounded-sm shrink-0 ${stripe}`} />
                <div className="min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-gray-900">{storeLabel(c.store, c.unitName)}</span>
                    <CaseLink row={c} />
                    <TypeTag type={c.type} />
                    {hrs >= 24 && (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                        Past 24 hrs
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">Opened {shortDate(c.receivedAt)}</div>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <div className="text-[15px] font-semibold tabular-nums text-gray-900">{hrs} hrs</div>
                  <div className="text-[11px] text-gray-400">open</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div ref={byStoreRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-3">
        <div className="px-4 pt-3 pb-2">
          <CopyableTitle
            title="ZCases by Store"
            targetRef={byStoreRef}
            className="text-sm font-semibold text-gray-800"
          />
          <div className="text-xs text-gray-400">
            {start && end ? `${mdy(start)} – ${mdy(end)}` : label}
          </div>
        </div>
        <div className="overflow-x-auto">
          {/* Store column takes a fixed share and the five data columns split
              the rest evenly, same shape as the survey table above — otherwise
              each column sizes to its content and the numbers sit at ragged
              intervals across the row. */}
          <table className="w-full text-sm table-fixed">
            <colgroup>
              <col style={{ width: `${STORE_COL_PCT}%` }} />
              {Array.from({ length: DATA_COLS }).map((_, i) => (
                <col key={i} style={{ width: `${(100 - STORE_COL_PCT) / DATA_COLS}%` }} />
              ))}
            </colgroup>
            <thead>
              <tr className="border-b border-gray-200">
                <ZSortHeader col="store" label="Store" sort={sort} onSort={setSort} align="left" />
                <ZSortHeader col="cases" label="ZCases" sort={sort} onSort={setSort} />
                <ZSortHeader col="avg" label="Avg resolve" sort={sort} onSort={setSort} />
                <ZSortHeader col="over24" label="# > 24 hrs" sort={sort} onSort={setSort} />
                <ZSortHeader col="within24Pct" label="% within 24 hrs" sort={sort} onSort={setSort} />
                {/* "now", not "in this window" — see the note under the table. */}
                <ZSortHeader col="outstanding" label="Open now" sort={sort} onSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400 animate-pulse">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && !query && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    {noneSelected ? "No markets selected." : "Pick a period above to see ZCases."}
                  </td>
                </tr>
              )}
              {!loading && query && sortedStores.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-500">
                    No ZCases in this window.
                  </td>
                </tr>
              )}
              {!loading &&
                sortedStores.map((s) => {
                  const key = s.store ?? "unknown";
                  const open = expanded.has(key);
                  return (
                    <StoreRow
                      key={key}
                      rollup={s}
                      expanded={open}
                      onToggle={() => toggle(key)}
                      cases={open ? (casesByStore.get(key) ?? []) : []}
                    />
                  );
                })}
            </tbody>
            {!loading && totals && sortedStores.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50/60 font-semibold text-gray-900">
                  <td className="px-4 py-2.5">All stores</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.cases}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {totals.avgResolveHours == null ? "—" : `${totals.avgResolveHours} hrs`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.over24}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {within24(totals.over24Pct) == null ? "—" : `${within24(totals.over24Pct)}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{totals.outstanding}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

    </section>
  );
}

function TypeTag({ type }: { type: string | null }) {
  const text = type ? TYPE_LABEL[type] : null;
  if (!text) return null;
  return (
    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">{text}</span>
  );
}

function Tile({
  label,
  value,
  unit,
  foot,
  tone,
}: {
  label: string;
  value: string;
  unit?: string;
  foot?: string;
  tone?: "warn" | "crit";
}) {
  const valueColor = tone === "crit" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-[28px] leading-tight font-semibold tabular-nums mt-1 ${valueColor}`}>
        {value}
        {unit && <span className="text-[15px] font-medium text-gray-500 ml-1">{unit}</span>}
      </div>
      {foot && <div className="text-xs text-gray-500 mt-0.5">{foot}</div>}
    </div>
  );
}

/**
 * Goes through our own route rather than straight to `row.deepLink`.
 *
 * The bare smg360 link only resolves if the browser already holds an smg360
 * session; without one the SPA drops the route and renders a blank page. The
 * route signs the browser in first, then lands on the case. Costs ~3s on the
 * click, which beats a dead tab.
 */
function CaseLink({ row }: { row: ZCaseRow }) {
  return (
    <a
      href={`/api/smg/zcase/${row.caseKey}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700 rounded-sm"
    >
      ZCase {row.displayKey} <span className="text-[10px] text-gray-400">↗</span>
    </a>
  );
}

function StoreRow({
  rollup,
  expanded,
  onToggle,
  cases,
}: {
  rollup: StoreRollup;
  expanded: boolean;
  onToggle: () => void;
  cases: ZCaseRow[];
}) {
  return (
    <>
      {/*
        The whole row is the control, not just the name — a table row reads as
        one object, so anywhere in it should open it. It's a <tr> with a button
        role rather than a <button> in every cell, which would break the column
        alignment and put six tab stops on one row.
      */}
      <tr
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className={`border-b border-gray-100 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gray-400 ${
          expanded ? "bg-gray-50" : "hover:bg-gray-50"
        }`}
      >
        <td className="px-4 py-3 font-medium text-gray-900">{storeLabel(rollup.store, rollup.unitName)}</td>
        <td className={`px-4 py-3 text-right tabular-nums font-medium ${TONE_TEXT[countTone(rollup.cases)]}`}>
          {rollup.cases}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-900">
          {rollup.avgResolveHours == null ? "—" : `${rollup.avgResolveHours} hrs`}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-900">{rollup.over24}</td>
        <td
          className={`px-4 py-3 text-right tabular-nums font-medium ${TONE_TEXT[within24Tone(within24(rollup.over24Pct))]}`}
        >
          {within24(rollup.over24Pct) == null ? "—" : `${within24(rollup.over24Pct)}%`}
        </td>
        <td className="px-4 py-3 text-right tabular-nums text-gray-900">{rollup.outstanding}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100">
          <td colSpan={6} className="bg-gray-50/60 p-0">
            <div className="flex flex-col pl-8 pr-4 py-1.5">
              {cases.length === 0 && (
                <div className="py-2 text-xs text-gray-500">No ZCases for this store in the window.</div>
              )}
              {cases.map((c) => (
                <div
                  key={c.caseKey}
                  className="flex items-center gap-3 py-1.5 border-b border-gray-100 last:border-b-0 text-[12.5px]"
                >
                  <CaseLink row={c} />
                  <TypeTag type={c.type} />
                  {c.escalated && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 text-red-700">
                      Escalated
                    </span>
                  )}
                  <span className="ml-auto text-gray-500 tabular-nums">{shortDate(c.eventAt)}</span>
                  <span className="w-24 text-right tabular-nums">
                    {c.resolvedAt === null ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-700">
                        open {c.openHours ?? 0} hrs
                      </span>
                    ) : (c.resolutionHours ?? 0) > 24 ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                        {c.resolutionHours} hrs
                      </span>
                    ) : (
                      <span className="text-gray-700">{c.resolutionHours} hrs</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Same interaction as the survey table's header: click to sort, click again to flip. */
function ZSortHeader({
  col,
  label,
  sort,
  onSort,
  align = "right",
}: {
  col: SortCol;
  label: string;
  sort: { col: SortCol; dir: "asc" | "desc" };
  onSort: (s: { col: SortCol; dir: "asc" | "desc" }) => void;
  align?: "left" | "right";
}) {
  const active = sort.col === col;
  const naturalDir = col === "store" ? "asc" : "desc";
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide ${align === "left" ? "text-left" : "text-right"}`}
    >
      <button
        type="button"
        onClick={() => onSort({ col, dir: active ? (sort.dir === "asc" ? "desc" : "asc") : naturalDir })}
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
