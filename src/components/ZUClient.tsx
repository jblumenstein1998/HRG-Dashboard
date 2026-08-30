"use client";

import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { CopyableTitle } from "@/components/CopyImageButton";
import type { Tab } from "@/lib/users/tabs";
import { TN_STORES, VA_STORES } from "@/lib/surveyMeta";

/**
 * Zaxby's University — training compliance out of Schoox.
 *
 * One table, one row per store, sorted TN then VA the way every other tab
 * orders them. Opening a row lists that store's people worst-rate-first, which
 * is the question a store row raises: not "how bad", but "who".
 */


type ZuStats = {
  complianceRate: number | null;
  people: number;
  compliant: number;
  noncompliant: number;
  complianceScore: number | null;
  averageCourses: number;
  totalTime: string;
};

type ZuStore = ZuStats & {
  unitId: string;
  storeId: string;
  label: string;
  /** Unrounded rate, for subtotals. See the note in lib/schoox.ts. */
  exactRate: number | null;
};

type ZuReport = { total: ZuStats; stores: ZuStore[]; fetchedAt: number };

type ZuMember = {
  id: string;
  name: string;
  complianceRate: number | null;
  totalCourses: number;
  completions: number;
};

type MemberState = "loading" | "error" | ZuMember[];

type ZuTestPerson = {
  id: string;
  name: string;
  /** Test id → progress 0–100. Null means the test isn't assigned to them. */
  results: Record<string, number | null>;
};

type ZuTestStore = {
  unitId: string;
  storeId: string;
  label: string;
  /** Test id → the store's completion rate for it. */
  rates: Record<string, number | null>;
  people: ZuTestPerson[];
};

type ZuTestReport = {
  tests: { id: string; label: string; short: string }[];
  stores: ZuTestStore[];
  fetchedAt: number;
};


// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v)}%`;
}

function num(v: number): string {
  return v.toLocaleString("en-US");
}

/**
 * HRG's thresholds, not Schoox's: red below 95, yellow to 99, green only at a
 * clean 100. Stricter than the gauge on Schoox's own dashboard, deliberately —
 * these are certifications, where "almost everyone" is the thing worth seeing
 * rather than a passing grade. Kept here rather than in surveyMeta because they
 * score compliance, not a survey metric, and the two have no reason to move
 * together.
 */
/** Stated in the header legend, so the two can't drift apart. */
const COMPLIANCE_TARGET = 100;
const COMPLIANCE_THRESHOLD = 95;

function rateColor(v: number | null): string {
  if (v === null) return "text-gray-400";
  if (v >= COMPLIANCE_TARGET) return "text-green-600";
  if (v >= COMPLIANCE_THRESHOLD) return "text-yellow-600";
  return "text-red-600";
}

/**
 * The row's shade while hovered or open — neutral, and carrying no meaning
 * about the rate. Scoring is said once, by the colour of the rate itself;
 * banding the whole row repeated it in a heavier voice and left the table
 * looking like a heat map of something it wasn't measuring.
 *
 * Hover and open deliberately share a shade: both mean "this is the row you
 * are working on", and separate tones would imply a distinction that isn't
 * there.
 */
function rowTone(open: boolean): string {
  return open ? "bg-gray-100" : "hover:bg-gray-100";
}


function fmtFetched(at: number): string {
  return `Updated ${new Date(at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

// ── Store ordering and grouping ───────────────────────────────────────────────

function marketOf(label: string): "TN" | "VA" | null {
  if (TN_STORES.includes(label)) return "TN";
  if (VA_STORES.includes(label)) return "VA";
  return null;
}

/**
 * TN then VA, in the order every other tab lists them. Stores Schoox knows
 * about but the shared list doesn't — a new opening, before surveyMeta catches
 * up — fall to the end rather than disappearing.
 */
function sortStores<T extends { label: string }>(stores: T[]): T[] {
  const order = [...TN_STORES, ...VA_STORES];
  return [...stores].sort((a, b) => {
    const ia = order.indexOf(a.label);
    const ib = order.indexOf(b.label);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
}

/**
 * A subtotal for whatever subset is on screen.
 *
 * Average Compliance Rate is the mean of each person's rate, so rolling stores
 * up means weighting each store's rate by its headcount — a plain mean of the
 * store percentages would let an 18-person store pull as hard as a 51-person
 * one.
 *
 * The weight is applied to `exactRate`, not to the rounded percentage the row
 * displays. Using the rounded figure runs about a third of a point low, which
 * printed Tennessee as 88% when its people average 89% — small, but wrong in a
 * way nobody would catch by eye.
 */
// ── Sorting ───────────────────────────────────────────────────────────────────

type SortDir = "asc" | "desc";
type SortKey = { key: string; dir: SortDir };

/**
 * Sort keys, most recently clicked first. Empty means the table's own order.
 *
 * A list rather than a single key, so sorting accumulates: clicking a new
 * column makes it primary but keeps the earlier ones behind it as tiebreakers.
 * Rows the new column can't separate therefore stay in the order the previous
 * sort put them, instead of falling back to the unsorted data.
 */
type Sort = SortKey[];

/** One shared empty sort, so an unsorted drop-down doesn't churn a new array each render. */
const NO_SORT: Sort = [];

/**
 * Clicking any column promotes it to primary; clicking the one that is already
 * primary cycles it ascending → descending → off.
 *
 * Older keys slide down rather than being discarded, which is what makes
 * successive sorts accumulate. Dropping the primary hands the table back to
 * whatever was sorted before it, and emptying the list restores the table's own
 * order — the store order every other tab uses, worth being able to return to.
 */
function nextSort(current: Sort, key: string): Sort {
  const rest = current.filter((s) => s.key !== key);
  const primary = current[0];

  if (primary && primary.key === key) {
    return primary.dir === "asc" ? [{ key, dir: "desc" }, ...rest] : rest;
  }
  return [{ key, dir: "asc" }, ...rest];
}

/**
 * Nulls sort last in both directions. A person who was never assigned a test
 * has no score to rank, and letting "—" head the table on one click would read
 * as a zero they earned.
 */
function compareValues(
  a: number | string | null,
  b: number | string | null,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const base =
    typeof a === "string" && typeof b === "string" ? a.localeCompare(b) : Number(a) - Number(b);
  return dir === "asc" ? base : -base;
}

/**
 * Sorts by each active key in turn: the primary decides, and older keys break
 * its ties. Rows that tie on every key keep the order they came in with, which
 * is the table's default, because Array.prototype.sort is stable.
 */
function sortRows<T>(
  rows: T[],
  sort: Sort,
  value: (row: T, key: string) => number | string | null,
): T[] {
  if (sort.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const { key, dir } of sort) {
      const order = compareValues(value(a, key), value(b, key), dir);
      if (order !== 0) return order;
    }
    return 0;
  });
}

/**
 * Sorts inside each market rather than across them, so Tennessee stays above
 * Virginia however the columns are ordered. The grouping is the tab's spine —
 * a sort that shuffled the two together would answer a question nobody asked.
 */
function sortStoresWithinMarkets<T extends { label: string }>(
  rows: T[],
  sort: Sort,
  value: (row: T, key: string) => number | string | null,
): T[] {
  const ordered = sortStores(rows);
  if (sort.length === 0) return ordered;

  // Insertion order is the default market order, so the groups come back out
  // in the order they went in — only their contents move.
  const groups = new Map<string, T[]>();
  for (const row of ordered) {
    const key = marketOf(row.label) ?? "other";
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()].flatMap((group) => sortRows(group, sort, value));
}

function storeValue(s: ZuStore, key: string): number | string | null {
  switch (key) {
    case "store":
      return s.label;
    // The unrounded rate, so stores a point apart don't tie on the display value.
    case "rate":
      return s.exactRate ?? s.complianceRate;
    case "people":
      return s.people;
    case "compliant":
      return s.compliant;
    case "noncompliant":
      return s.noncompliant;
    case "courses":
      return s.averageCourses;
    default:
      return null;
  }
}

function memberValue(m: ZuMember, key: string): number | string | null {
  switch (key) {
    case "name":
      return m.name;
    case "courses":
      return m.totalCourses;
    case "completions":
      return m.completions;
    case "rate":
      return m.complianceRate;
    default:
      return null;
  }
}

/** Any key that isn't "store" is a test id. */
function testStoreValue(s: ZuTestStore, key: string): number | string | null {
  return key === "store" ? s.label : (s.rates[key] ?? null);
}

function testPersonValue(p: ZuTestPerson, key: string): number | string | null {
  return key === "name" ? p.name : (p.results[key] ?? null);
}

/**
 * A clickable column heading.
 *
 * The arrow sits in a fixed-width slot that is always rendered, so the header
 * row doesn't jump sideways the first time someone sorts.
 */
function SortTh({
  label,
  sortKey,
  sort,
  onSort,
  align = "right",
  title,
  size = "md",
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  onSort: (key: string) => void;
  align?: "left" | "right";
  title?: string;
  size?: "md" | "sm";
}) {
  // Only the primary key is marked. The keys behind it are still sorting —
  // see nextSort — but labelling them turned the header into something to
  // decode rather than read.
  const primary = sort[0] && sort[0].key === sortKey ? sort[0] : null;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      aria-sort={primary ? (primary.dir === "asc" ? "ascending" : "descending") : "none"}
      className={`${size === "md" ? "px-4 py-2" : "px-2 py-1"} font-medium cursor-pointer ${
        align === "left" ? "text-left" : "text-right"
      } select-none transition-colors hover:text-gray-700 ${
        primary ? "text-gray-700" : "text-gray-500"
      }`}
    >
      {label}
      <span className="inline-block w-3 text-[10px] text-gray-500">
        {primary ? (primary.dir === "asc" ? "▲" : "▼") : ""}
      </span>
    </th>
  );
}


function subtotal(stores: ZuStore[]): ZuStats {
  const people = stores.reduce((t, s) => t + s.people, 0);
  const weighted = (pick: (s: ZuStore) => number | null) => {
    if (people === 0) return null;
    const sum = stores.reduce((t, s) => t + (pick(s) ?? 0) * s.people, 0);
    return sum / people;
  };
  return {
    complianceRate: weighted((s) => s.exactRate ?? s.complianceRate),
    people,
    compliant: stores.reduce((t, s) => t + s.compliant, 0),
    noncompliant: stores.reduce((t, s) => t + s.noncompliant, 0),
    complianceScore: null,
    averageCourses: Math.round(weighted((s) => s.averageCourses) ?? 0),
    totalTime: "",
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ZUClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

  const [report, setReport] = useState<ZuReport | null>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [error, setError] = useState<string>("");
  const [showTN, setShowTN] = useState(true);
  const [showVA, setShowVA] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [members, setMembers] = useState<Record<string, MemberState>>({});
  const [tests, setTests] = useState<ZuTestReport | null>(null);
  const [testsStatus, setTestsStatus] = useState<"loading" | "done" | "error">("loading");
  const [testsError, setTestsError] = useState<string>("");
  const [openTestStores, setOpenTestStores] = useState<Set<string>>(new Set());
  const testsRef = useRef<HTMLDivElement>(null);
  const [storeSort, setStoreSort] = useState<Sort>(NO_SORT);
  const [testSort, setTestSort] = useState<Sort>(NO_SORT);
  // Keyed by store, so sorting one open drop-down leaves the others alone.
  const [rosterSort, setRosterSort] = useState<Record<string, Sort>>({});
  const [peopleSort, setPeopleSort] = useState<Record<string, Sort>>({});

  const tableRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setStatus("loading");
    try {
      const res = await fetch(`/api/zu/compliance${refresh ? "?refresh=1" : ""}`);
      const data = (await res.json()) as ZuReport | { error: string };
      if (!res.ok || "error" in data) {
        setError("error" in data ? data.error : `Request failed (${res.status})`);
        setStatus("error");
        return;
      }
      setReport(data);
      setStatus("done");
      // A refresh re-reads Schoox, so any roster already on screen is stale.
      if (refresh) setMembers({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  /**
   * The certification grid arrives whole — rates and people together — so a
   * store row opens without another round trip.
   *
   * Keyed on `report` rather than run once on mount: Refresh replaces the store
   * report and clears the shared cache tag, so a new report object is the
   * signal that these numbers are stale too.
   */
  useEffect(() => {
    if (!report) return;

    let cancelled = false;
    setTestsStatus("loading");

    void (async () => {
      try {
        const res = await fetch("/api/zu/tests");
        const data = (await res.json()) as ZuTestReport | { error: string };
        if (cancelled) return;
        if (!res.ok || "error" in data) {
          setTestsError("error" in data ? data.error : `Request failed (${res.status})`);
          setTestsStatus("error");
          return;
        }
        setTests(data);
        setTestsStatus("done");
      } catch (err) {
        if (cancelled) return;
        setTestsError(err instanceof Error ? err.message : String(err));
        setTestsStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [report]);

  const toggleTestStore = useCallback((unitId: string) => {
    setOpenTestStores((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  }, []);

  const toggleRow = useCallback(
    (store: ZuStore) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(store.unitId)) next.delete(store.unitId);
        else next.add(store.unitId);
        return next;
      });

      // Fetched once per store and kept, so collapsing and reopening a row is
      // instant rather than another round trip to Schoox.
      setMembers((prev) => {
        if (prev[store.unitId]) return prev;
        void (async () => {
          try {
            const res = await fetch(`/api/zu/members?unitId=${encodeURIComponent(store.unitId)}`);
            const data = (await res.json()) as { members?: ZuMember[]; error?: string };
            setMembers((m) => ({
              ...m,
              [store.unitId]: res.ok && data.members ? data.members : "error",
            }));
          } catch {
            setMembers((m) => ({ ...m, [store.unitId]: "error" }));
          }
        })();
        return { ...prev, [store.unitId]: "loading" };
      });
    },
    [],
  );

  const onStoreSort = useCallback((key: string) => setStoreSort((p) => nextSort(p, key)), []);
  const onTestSort = useCallback((key: string) => setTestSort((p) => nextSort(p, key)), []);
  const onRosterSort = useCallback((unitId: string, key: string) => {
    setRosterSort((prev) => ({ ...prev, [unitId]: nextSort(prev[unitId] ?? NO_SORT, key) }));
  }, []);
  const onPeopleSort = useCallback((unitId: string, key: string) => {
    setPeopleSort((prev) => ({ ...prev, [unitId]: nextSort(prev[unitId] ?? NO_SORT, key) }));
  }, []);
  const allStores = report ? sortStores(report.stores) : [];
  const visible = sortStoresWithinMarkets(
    allStores.filter((s) => {
      const market = marketOf(s.label);
      if (market === "TN" && !showTN) return false;
      if (market === "VA" && !showVA) return false;
      return true;
    }),
    storeSort,
    storeValue,
  );

  // Schoox's own academy figure when everything is on screen; a weighted
  // subtotal otherwise, so the bottom row always describes the rows above it.
  const showingEverything = report !== null && visible.length === allStores.length;
  const totals = report
    ? showingEverything
      ? report.total
      : subtotal(visible)
    : null;
  const totalsLabel = showingEverything
    ? "All Stores"
    : showTN && !showVA
      ? "Tennessee"
      : showVA && !showTN
        ? "Virginia"
        : "Selected";

  /**
   * The grid answers to the same controls as the table above it, so the two
   * always describe the same set of stores.
   */
  const visibleTestStores = sortStoresWithinMarkets(
    (tests?.stores ?? []).filter((s) => {
      const market = marketOf(s.label);
      if (market === "TN" && !showTN) return false;
      if (market === "VA" && !showVA) return false;
      return true;
    }),
    testSort,
    testStoreValue,
  );

  const COLUMNS = 6;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="flex flex-col">
              <div className="relative w-fit">
                <select
                  value="/zu"
                  onChange={(e) => router.push(e.target.value)}
                  aria-label="Switch tab"
                  className="text-base font-semibold text-gray-900 leading-tight bg-transparent border-0 p-0 m-0 pr-5 w-full appearance-none cursor-pointer focus:outline-none focus:ring-0 [text-align-last:center]"
                >
                  <TabOptions tabs={tabs} isAdmin={isAdmin} />
                </select>
                <svg
                  className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-900 pointer-events-none"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              {report && (
                <p className="text-xs text-gray-400 leading-tight">{fmtFetched(report.fetchedAt)}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 flex-1 min-w-0">

            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showVA}
                onChange={(e) => setShowVA(e.target.checked)}
                className="rounded border-gray-300"
              />
              VA
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showTN}
                onChange={(e) => setShowTN(e.target.checked)}
                className="rounded border-gray-300"
              />
              TN
            </label>

            <button
              onClick={() => void load(true)}
              disabled={refreshing || status === "loading"}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
      </header>

      {/* The scoring legend, stated once — matches the Jolt tab. */}
      <div className="bg-gray-50 border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
          <span className="text-gray-500">
            Compliance&nbsp;
            <span className="text-green-600 font-medium">≥{COMPLIANCE_TARGET}%</span>
            {" / "}
            <span className="text-yellow-600 font-medium">≥{COMPLIANCE_THRESHOLD}%</span>
            {" / "}
            <span className="text-red-600 font-medium">&lt;{COMPLIANCE_THRESHOLD}%</span>
          </span>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {status === "loading" && (
          <p className="text-sm text-gray-500">Loading Zaxby&apos;s University compliance…</p>
        )}

        {status === "error" && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm font-medium text-red-800">Couldn&apos;t load ZU compliance</p>
            <p className="text-xs text-red-700 mt-1">{error}</p>
          </div>
        )}

        {status === "done" && report && (
          <section>
            <CopyableTitle title="AVERAGE COMPLIANCE RATE BY STORE" targetRef={tableRef} />
            <div
              ref={tableRef}
              className="mt-2 rounded-lg border border-gray-200 bg-white overflow-x-auto"
            >
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <SortTh
                      label="Store"
                      sortKey="store"
                      sort={storeSort}
                      onSort={onStoreSort}
                      align="left"
                    />
                    <SortTh
                      label="Avg Compliance"
                      sortKey="rate"
                      sort={storeSort}
                      onSort={onStoreSort}
                    />
                    <SortTh label="People" sortKey="people" sort={storeSort} onSort={onStoreSort} />
                    <SortTh
                      label="Compliant"
                      sortKey="compliant"
                      sort={storeSort}
                      onSort={onStoreSort}
                    />
                    <SortTh
                      label="Noncompliant"
                      sortKey="noncompliant"
                      sort={storeSort}
                      onSort={onStoreSort}
                    />
                    <SortTh
                      label="Avg Courses"
                      sortKey="courses"
                      sort={storeSort}
                      onSort={onStoreSort}
                    />
                  </tr>
                </thead>
                <tbody>
                  {visible.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNS} className="px-4 py-6 text-center text-sm text-gray-500">
                        No stores match the current filters.
                      </td>
                    </tr>
                  )}

                  {visible.map((s, i) => {
                    const prev = visible[i - 1];
                    const newMarket = i > 0 && marketOf(s.label) !== marketOf(prev.label);
                    const isOpen = expanded.has(s.unitId);
                    const roster = members[s.unitId];

                    return (
                      <Fragment key={s.storeId || s.unitId}>
                        <tr
                          onClick={() => toggleRow(s)}
                          className={`cursor-pointer transition-colors ${
                            newMarket ? "border-t-2 border-gray-300" : "border-t border-gray-100"
                          } ${rowTone(isOpen)}`}
                        >
                          <td className="px-4 py-2 whitespace-nowrap text-gray-900">{s.label}</td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-medium ${rateColor(
                              s.complianceRate,
                            )}`}
                          >
                            {fmtPct(s.complianceRate)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.people)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.compliant)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.noncompliant)}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums text-gray-700">
                            {num(s.averageCourses)}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr className="border-t border-gray-100">
                            <td colSpan={COLUMNS} className="bg-gray-50 px-4 py-3">
                              {roster === "loading" && (
                                <p className="text-xs text-gray-500">Loading {s.label}&apos;s team…</p>
                              )}
                              {roster === "error" && (
                                <p className="text-xs text-red-700">
                                  Couldn&apos;t load {s.label}&apos;s team.
                                </p>
                              )}
                              {Array.isArray(roster) && roster.length === 0 && (
                                <p className="text-xs text-gray-500">No people at {s.label}.</p>
                              )}
                              {Array.isArray(roster) && roster.length > 0 && (
                                <table className="w-full border-collapse text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-200">
                                      <SortTh
                                        size="sm"
                                        align="left"
                                        label="Name"
                                        sortKey="name"
                                        sort={rosterSort[s.unitId] ?? NO_SORT}
                                        onSort={(k) => onRosterSort(s.unitId, k)}
                                      />
                                      <SortTh
                                        size="sm"
                                        label="Courses"
                                        sortKey="courses"
                                        sort={rosterSort[s.unitId] ?? NO_SORT}
                                        onSort={(k) => onRosterSort(s.unitId, k)}
                                      />
                                      <SortTh
                                        size="sm"
                                        label="Completions"
                                        sortKey="completions"
                                        sort={rosterSort[s.unitId] ?? NO_SORT}
                                        onSort={(k) => onRosterSort(s.unitId, k)}
                                      />
                                      <SortTh
                                        size="sm"
                                        label="Compliance Rate"
                                        sortKey="rate"
                                        sort={rosterSort[s.unitId] ?? NO_SORT}
                                        onSort={(k) => onRosterSort(s.unitId, k)}
                                      />
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {sortRows(
                                      roster,
                                      rosterSort[s.unitId] ?? NO_SORT,
                                      memberValue,
                                    ).map((m) => (
                                      <tr
                                        key={m.id}
                                        className="border-t border-gray-100 transition-colors hover:bg-gray-50"
                                      >
                                        <td className="px-2 py-1 whitespace-nowrap text-gray-800">
                                          {m.name}
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                                          {num(m.totalCourses)}
                                        </td>
                                        <td className="px-2 py-1 text-right tabular-nums text-gray-600">
                                          {num(m.completions)}
                                        </td>
                                        <td
                                          className={`px-2 py-1 text-right tabular-nums font-medium ${rateColor(
                                            m.complianceRate,
                                          )}`}
                                        >
                                          {fmtPct(m.complianceRate)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}

                  {totals && visible.length > 0 && (
                    <tr className="border-t-2 border-gray-300 font-semibold text-gray-900">
                      <td className="px-4 py-2 whitespace-nowrap">{totalsLabel}</td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${rateColor(
                          totals.complianceRate,
                        )}`}
                      >
                        {fmtPct(totals.complianceRate)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(totals.people)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{num(totals.compliant)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(totals.noncompliant)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {num(totals.averageCourses)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {status === "done" && report && (
          <section>
            <CopyableTitle title="CERTIFICATION TESTS BY STORE" targetRef={testsRef} />
            <div
              ref={testsRef}
              className="mt-2 rounded-lg border border-gray-200 bg-white overflow-x-auto"
            >
              {testsStatus === "loading" && (
                <p className="px-4 py-6 text-sm text-gray-500">Loading certification tests…</p>
              )}

              {testsStatus === "error" && (
                <p className="px-4 py-6 text-sm text-red-700">
                  Couldn&apos;t load certification tests. {testsError}
                </p>
              )}

              {testsStatus === "done" && tests && (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <SortTh
                        label="Store"
                        sortKey="store"
                        sort={testSort}
                        onSort={onTestSort}
                        align="left"
                      />
                      {tests.tests.map((t) => (
                        <SortTh
                          key={t.id}
                          label={t.short}
                          title={t.label}
                          sortKey={t.id}
                          sort={testSort}
                          onSort={onTestSort}
                        />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleTestStores.length === 0 && (
                      <tr>
                        <td
                          colSpan={tests.tests.length + 1}
                          className="px-4 py-6 text-center text-sm text-gray-500"
                        >
                          No stores match the current filters.
                        </td>
                      </tr>
                    )}

                    {visibleTestStores.map((s, i) => {
                      const prev = visibleTestStores[i - 1];
                      const newMarket = i > 0 && marketOf(s.label) !== marketOf(prev.label);
                      const isOpen = openTestStores.has(s.unitId);

                      return (
                        <Fragment key={s.storeId || s.unitId}>
                          <tr
                            onClick={() => toggleTestStore(s.unitId)}
                            className={`cursor-pointer transition-colors ${
                              newMarket ? "border-t-2 border-gray-300" : "border-t border-gray-100"
                            } ${isOpen ? "bg-gray-50" : "hover:bg-gray-50"}`}
                          >
                            <td className="px-4 py-2 whitespace-nowrap text-gray-900">{s.label}</td>
                            {tests.tests.map((t) => (
                              <td
                                key={t.id}
                                className="px-4 py-2 text-right tabular-nums text-gray-700"
                              >
                                {fmtPct(s.rates[t.id] ?? null)}
                              </td>
                            ))}
                          </tr>

                          {isOpen && (
                            <tr className="border-t border-gray-100">
                              <td
                                colSpan={tests.tests.length + 1}
                                className="bg-gray-50 px-4 py-3"
                              >
                                {s.people.length === 0 ? (
                                  <p className="text-xs text-gray-500">
                                    Nobody at {s.label} is assigned these tests.
                                  </p>
                                ) : (
                                  <table className="w-full border-collapse text-xs">
                                    <thead>
                                      <tr className="border-b border-gray-200">
                                        <SortTh
                                          size="sm"
                                          align="left"
                                          label="Name"
                                          sortKey="name"
                                          sort={peopleSort[s.unitId] ?? NO_SORT}
                                          onSort={(k) => onPeopleSort(s.unitId, k)}
                                        />
                                        {tests.tests.map((t) => (
                                          <SortTh
                                            key={t.id}
                                            size="sm"
                                            label={t.short}
                                            title={t.label}
                                            sortKey={t.id}
                                            sort={peopleSort[s.unitId] ?? NO_SORT}
                                            onSort={(k) => onPeopleSort(s.unitId, k)}
                                          />
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sortRows(
                                        s.people,
                                        peopleSort[s.unitId] ?? NO_SORT,
                                        testPersonValue,
                                      ).map((p) => (
                                        <tr
                                          key={p.id}
                                          className="border-t border-gray-100 transition-colors hover:bg-gray-50"
                                        >
                                          <td className="px-2 py-1 whitespace-nowrap text-gray-800">
                                            {p.name}
                                          </td>
                                          {tests.tests.map((t) => (
                                            <td
                                              key={t.id}
                                              className={`px-2 py-1 text-right tabular-nums font-medium ${rateColor(
                                                p.results[t.id] ?? null,
                                              )}`}
                                            >
                                              {fmtPct(p.results[t.id] ?? null)}
                                            </td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        )}
            </main>
    </div>
  );
}
