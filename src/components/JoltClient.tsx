"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { useCopyImage } from "@/components/CopyImageButton";
import { PERIODS, resolveRange, type RangeKey } from "@/lib/fiscal";
import type { Tab } from "@/lib/users/tabs";

// Store order matches lib/stores.ts, so this tab reads in the same sequence as
// the rest of the dashboard. Jolt runs at seven of the twelve stores; the other
// five still get a section, so the page is a roster of HRG rather than of Jolt.
const TN_STORES = ["Columbia", "Spring Hill", "Brentwood", "White House", "Springfield"];
const VA_STORES = ["Jefferson", "Oyster", "Hampton", "College", "Chesapeake", "Hillcrest", "Beach"];

// Jolt has no URL for a single list instance — /review/review/review?id=… just
// bounces away — so every list links to Browse Lists, where a person filters
// down to the one they came looking for.
const JOLT_BROWSE_LISTS = "https://app.joltup.com/review/review/listResultsReporting/lists";

/** Stores keep their own clock: TN is Central, VA is Eastern. */
const STORE_TZ: Record<string, string> = {};
for (const s of ["Columbia", "Spring Hill", "Brentwood", "White House", "Springfield"]) {
  STORE_TZ[s] = "America/Chicago";
}
for (const s of ["Jefferson", "Oyster", "Hampton", "College", "Chesapeake", "Hillcrest", "Beach"]) {
  STORE_TZ[s] = "America/New_York";
}
const tzFor = (store: string) => STORE_TZ[store] ?? "America/Chicago";

// Completion — not on-time — is what the bonus pays on, so the colouring follows
// the Quality Director sheet: condition `q_jolt_completion` in lib/bonus/rules.ts
// has target >= 100 and threshold >= 95, which engine.ts scores as
// target / threshold / missed. On-time % is shown but left uncoloured.
const COMPLETE_TARGET = 100;
const COMPLETE_THRESHOLD = 95;

// ── Types (mirror lib/jolt.ts) ────────────────────────────────────────────────

type ListInstanceStatus = "onTime" | "late" | "missed" | "pending";

type ListInstanceRow = {
  id: string;
  title: string;
  deadline: number | null;
  completedAt: number | null;
  completedBy: string | null;
  status: ListInstanceStatus;
};

type StoreLists = {
  store: string;
  joltName: string;
  onTimeCount: number;
  lateCount: number;
  missedCount: number;
  pendingCount: number;
  dueCount: number;
  onTimePct: number | null;
  completePct: number | null;
  rows: ListInstanceRow[];
};

type ToDoRow = {
  id: string;
  store: string;
  title: string;
  deadline: number;
};

type ToDoReport = {
  rows: ToDoRow[];
  asOf: number;
  overdueMinutes: number;
  upcomingMinutes: number;
  fetchedAt: number;
};

type StoreListsReport = {
  stores: StoreLists[];
  storesWithoutJolt: string[];
  startDate: string;
  endDate: string;
  timezone: string;
  asOf: number;
  truncated: boolean;
  fetchedAt: number;
};

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtPct(v: number | null | undefined, decimals = 1): string {
  if (v == null) return "—";
  return `${v.toFixed(decimals)}%`;
}

function fmtDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${m}/${d}/${y}`;
}

/**
 * Rendered in the store's own timezone, so a Virginia deadline reads as the
 * wall-clock time the crew there actually worked to. Jolt's own reports show
 * everything in the company timezone (Central), so a Virginia row here sits an
 * hour off from the same row in Jolt. The header bar is what says these are
 * local times; the columns themselves stay unlabelled.
 */
function fmtStamp(epochSeconds: number | null, timeZone: string): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toLocaleString("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}


/**
 * "in 3h 15m" / "2d ago", for a deadline measured against the instant the
 * report was built. Measured against `asOf` rather than the browser clock so
 * this can never contradict the status badge beside it — a cached report could
 * otherwise read "Not due yet · 5m ago".
 */
function untilDue(deadline: number, asOf: number): string {
  const delta = deadline - asOf;
  const abs = Math.abs(delta);
  if (abs < 60) return delta >= 0 ? "due now" : "just overdue";

  const mins = Math.floor(abs / 60);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);

  const span =
    days > 0
      ? `${days}d${hours % 24 ? ` ${hours % 24}h` : ""}`
      : hours > 0
        ? `${hours}h${mins % 60 ? ` ${mins % 60}m` : ""}`
        : `${mins}m`;

  return delta > 0 ? `in ${span}` : `${span} ago`;
}

/** "10 min" / "2 hr" — the To Do band's bounds, stated the way a person says them. */
function fmtSpanMinutes(minutes: number): string {
  return minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} hr` : `${minutes} min`;
}

function completeColor(v: number | null | undefined): string {
  if (v == null) return "text-gray-400";
  if (v >= COMPLETE_TARGET) return "text-green-600";
  if (v >= COMPLETE_THRESHOLD) return "text-yellow-600";
  return "text-red-600";
}

const STATUS_STYLE: Record<ListInstanceStatus, { label: string; cls: string }> = {
  onTime: { label: "On time", cls: "bg-green-50 text-green-700 ring-green-600/20" },
  late: { label: "Late", cls: "bg-yellow-50 text-yellow-800 ring-yellow-600/20" },
  missed: { label: "Missed", cls: "bg-red-50 text-red-700 ring-red-600/20" },
  pending: { label: "Not due yet", cls: "bg-gray-100 text-gray-600 ring-gray-500/20" },
};

function StatusBadge({ status }: { status: ListInstanceStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${s.cls}`}
    >
      {s.label}
    </span>
  );
}

// ── Sorting ───────────────────────────────────────────────────────────────────

type Dir = "asc" | "desc";
type Sort = { key: string; dir: Dir };

/**
 * A clickable column header. Clicking a new column sorts by the direction that
 * column is usually read in — names ascending, counts descending — and clicking
 * the active column flips it.
 */
function SortTh({
  label,
  sortKey,
  sort,
  setSort,
  defaultDir = "asc",
  align = "left",
  className = "",
}: {
  label: string;
  sortKey: string;
  sort: Sort;
  setSort: (s: Sort) => void;
  defaultDir?: Dir;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th className={`font-medium ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        type="button"
        onClick={() =>
          setSort(active ? { key: sortKey, dir: sort.dir === "asc" ? "desc" : "asc" } : { key: sortKey, dir: defaultDir })
        }
        className={`inline-flex items-center gap-1 hover:text-gray-900 transition ${active ? "text-gray-900" : ""}`}
      >
        <span>{label}</span>
        <span aria-hidden className={`text-[8px] leading-none ${active ? "opacity-70" : "opacity-25"}`}>
          {active && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

/** Worst-first when flipped; the natural reading order is best-first. */
const STATUS_RANK: Record<ListInstanceStatus, number> = { onTime: 0, late: 1, missed: 2, pending: 3 };

/**
 * Sorts a copy. A null value means "nothing to rank" — a list with no deadline,
 * one that was never completed — and those always settle at the bottom, in
 * either direction. Letting them flip to the top on a descending sort would
 * bury the rows someone is actually looking for under a block of dashes.
 */
function sortBy<T>(rows: T[], dir: Dir, value: (row: T) => string | number | null): T[] {
  const ranked: T[] = [];
  const unranked: T[] = [];
  for (const row of rows) (value(row) == null ? unranked : ranked).push(row);

  ranked.sort((a, b) => {
    const av = value(a)!;
    const bv = value(b)!;
    const c = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
    return dir === "asc" ? c : -c;
  });
  return [...ranked, ...unranked];
}

// ── Date helpers ──────────────────────────────────────────────────────────────

const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** `hours` marks a rolling window; the dates then only bound the fetch. */
type Range = { start: string; end: string; hours?: number };

function lastNDays(n: number): Range {
  const now = new Date();
  const from = new Date(now);
  from.setDate(now.getDate() - (n - 1));
  return { start: toIso(from), end: toIso(now) };
}

/** Rolling 24 hours. The dates span two days so the window can't fall outside. */
function last24Hours(): Range {
  return { ...lastNDays(2), hours: 24 };
}

/**
 * Turns a fiscal RangeKey into plain dates. resolveRange speaks Superset's
 * "YYYY-MM-DDTHH:MM:SS : …" syntax, where a midnight end is exclusive and
 * "now" means today — both of which have to be unwound before the Jolt API,
 * which takes whole days, sees them.
 */
/**
 * Ranges that mean "…so far", which here run through today.
 *
 * lib/fiscal deliberately ends these at yesterday: once a range's end is in the
 * past it is closed, so Berry can cache it forever. Jolt is queried live and
 * caches nothing that way, and a PTD that stopped yesterday just silently
 * dropped today's lists while Last 7 Days included them.
 */
const TO_DATE_KEYS = new Set<RangeKey>(["mtd", "qtd", "ytd", "wtd"]);

function rangeKeyToDates(key: RangeKey): Range {
  const { range } = resolveRange(key);
  const [rawStart, rawEnd] = range.split(" : ").map(s => s.trim());
  const start = rawStart.split("T")[0];
  const today = toIso(new Date());

  if (TO_DATE_KEYS.has(key) || rawEnd === "now") return { start, end: today };

  const [endDate, endTime = ""] = rawEnd.split("T");
  if (endTime.startsWith("00:00:00")) {
    const [y, m, d] = endDate.split("-").map(Number);
    return { start, end: toIso(new Date(y, m - 1, d - 1)) };
  }
  return { start, end: endDate };
}

// The same historical picker the drive-thru tab uses, so a period means the
// same window on both tabs.
const PERIOD_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "last_period", label: "Last Period" },
  { key: "qtd", label: "Quarter to Date" },
  ...PERIODS.map(p => ({ key: `p${p.period}` as RangeKey, label: `P${p.period} (Full)` })),
];

// ── To do, right now ──────────────────────────────────────────────────────────
// Independent of the range buttons on purpose: someone reviewing last week still
// wants to know a temperature log is due in eight minutes.

function ToDoCard({ report, visibleStores }: { report: ToDoReport; visibleStores: Set<string> }) {
  const rows = report.rows.filter(r => visibleStores.has(r.store));

  // Soonest deadline first, so the most overdue sits at the top.
  const [sort, setSort] = useState<Sort>({ key: "deadline", dir: "asc" });
  const sortedRows = useMemo(
    () =>
      sortBy(rows, sort.dir, r => {
        switch (sort.key) {
          case "store": return r.store.toLowerCase();
          case "title": return r.title.trim().toLowerCase();
          // "Time left" is just the deadline seen from now, so it orders the same.
          default: return r.deadline;
        }
      }),
    [rows, sort],
  );

  const cardRef = useRef<HTMLElement>(null);
  const { status: copyStatus, copy } = useCopyImage(cardRef);

  return (
    <section ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100 flex flex-wrap items-baseline gap-x-3">
        <button
          onClick={copy}
          disabled={copyStatus === "copying"}
          title="Click to copy this table as an image"
          className="text-base font-semibold text-gray-900 hover:text-red-700 transition cursor-pointer disabled:cursor-wait"
        >
          To Do
        </button>
        <span className="text-xs text-gray-500">
          due in the next {fmtSpanMinutes(report.upcomingMinutes)}, or overdue by up to{" "}
          {fmtSpanMinutes(report.overdueMinutes)}
        </span>
        {copyStatus !== "idle" && (
          <span
            data-copy-image-ignore="true"
            className={`text-xs font-medium ${
              copyStatus === "done" ? "text-green-600" : copyStatus === "error" ? "text-red-600" : "text-gray-400"
            }`}
          >
            {copyStatus === "copying" ? "Copying…" : copyStatus === "done" ? "Copied!" : "Copy failed"}
          </span>
        )}
        {rows.length > 0 && <span className="ml-auto text-xs text-gray-400 tabular-nums">{rows.length} lists</span>}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 sm:px-5 py-6 text-sm text-gray-400">Nothing due right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-fixed min-w-[44rem]">
            <colgroup>
              <col style={{ width: "18%" }} />
              <col style={{ width: "42%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "18%" }} />
            </colgroup>
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                <SortTh label="Store" sortKey="store" sort={sort} setSort={setSort} className="px-4 sm:px-5 py-2" />
                <SortTh label="List" sortKey="title" sort={sort} setSort={setSort} className="px-3 py-2" />
                <SortTh label="Due" sortKey="deadline" sort={sort} setSort={setSort} className="px-3 py-2 whitespace-nowrap" />
                <SortTh label="Time left / overdue" sortKey="timeLeft" sort={sort} setSort={setSort} className="px-3 py-2 whitespace-nowrap" />
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(row => {
                const overdue = row.deadline < report.asOf;
                return (
                  <tr key={row.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-100">
                    <td className="px-4 sm:px-5 py-1.5 font-medium text-gray-900">{row.store}</td>
                    <td className="px-3 py-1.5 text-gray-900">
                      <a
                        href={JOLT_BROWSE_LISTS}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open Browse Lists in Jolt"
                        className="hover:text-red-700 hover:underline"
                      >
                        {row.title.trim()}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums whitespace-nowrap">
                      {fmtStamp(row.deadline, tzFor(row.store))}
                    </td>
                    <td
                      className={`px-3 py-1.5 tabular-nums whitespace-nowrap ${
                        overdue ? "text-red-600 font-medium" : "text-gray-600"
                      }`}
                    >
                      {untilDue(row.deadline, report.asOf)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── Summary: every store's on-time rate at a glance ───────────────────────────
// This is the whole-company view, so it always shows all visible stores. The
// detail table below shows one store at a time; clicking a row here switches it.

type SummaryRow = { store: string; data: StoreLists | null };

function SummaryCard({
  rows,
  highlighted,
  onPick,
}: {
  rows: SummaryRow[];
  /** The row the user clicked, or null when nothing is marked. */
  highlighted: string | null;
  onPick: (store: string) => void;
}) {
  const live = rows.map(r => r.data).filter((d): d is StoreLists => d != null);

  const totals = live.reduce(
    (acc, s) => ({
      onTimeCount: acc.onTimeCount + s.onTimeCount,
      lateCount: acc.lateCount + s.lateCount,
      missedCount: acc.missedCount + s.missedCount,
      pendingCount: acc.pendingCount + s.pendingCount,
      dueCount: acc.dueCount + s.dueCount,
      lists: acc.lists + s.rows.length,
    }),
    { onTimeCount: 0, lateCount: 0, missedCount: 0, pendingCount: 0, dueCount: 0, lists: 0 },
  );
  const totalPct = totals.dueCount > 0 ? (totals.onTimeCount / totals.dueCount) * 100 : null;
  const totalCompletePct =
    totals.dueCount > 0 ? ((totals.onTimeCount + totals.lateCount) / totals.dueCount) * 100 : null;

  // Ranked by on-time rate out of the box. Stores with no Jolt deployment have
  // nothing to rank, so they sit at the bottom whichever way the sort points.
  const [sort, setSort] = useState<Sort>({ key: "complete", dir: "desc" });

  const sorted = useMemo(() => {
    const withData = rows.filter(r => r.data);
    const withoutData = rows.filter(r => !r.data);
    const value = (r: SummaryRow): string | number | null => {
      const d = r.data!;
      switch (sort.key) {
        case "store": return r.store.toLowerCase();
        case "onTime": return d.onTimeCount;
        case "late": return d.lateCount;
        case "missed": return d.missedCount;
        case "pending": return d.pendingCount;
        case "lists": return d.rows.length;
        case "pct": return d.onTimePct;
        // A store with nothing due yet has no rate to rank on.
        default: return d.completePct;
      }
    };
    return [...sortBy(withData, sort.dir, value), ...withoutData];
  }, [rows, sort]);

  const numCell = "px-3 py-1.5 text-right tabular-nums";
  const thPad = "px-3 py-2";

  const cardRef = useRef<HTMLElement>(null);
  const { status: copyStatus, copy } = useCopyImage(cardRef);

  // The clicked-row highlight is a navigation aid, not part of the figures, so
  // it is dropped from the copied image. useCopyImage clones the live DOM
  // synchronously once it starts, so the un-highlighted rows have to be painted
  // BEFORE copy() is called — hence the flag plus a two-frame wait.
  const [capturing, setCapturing] = useState(false);
  const copyWithoutHighlight = async () => {
    setCapturing(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    try {
      await copy();
    } finally {
      setCapturing(false);
    }
  };

  return (
    <section ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 sm:px-5 py-3 border-b border-gray-100">
        <span className="inline-flex items-center gap-2">
          <button
            onClick={copyWithoutHighlight}
            disabled={copyStatus === "copying"}
            title="Click to copy this table as an image"
            className="text-base font-semibold text-gray-900 hover:text-red-700 transition text-left cursor-pointer disabled:cursor-wait"
          >
            Jolt Completion by Store
          </button>
          {copyStatus !== "idle" && (
            <span
              data-copy-image-ignore="true"
              className={`text-xs font-medium ${
                copyStatus === "done" ? "text-green-600" : copyStatus === "error" ? "text-red-600" : "text-gray-400"
              }`}
            >
              {copyStatus === "copying" ? "Copying…" : copyStatus === "done" ? "Copied!" : "Copy failed"}
            </span>
          )}
        </span>
      </div>
      <div className="overflow-x-auto">
        {/* Fixed layout: with auto widths the columns are sized from whatever
            data happens to be loaded, so every change of period nudged them
            sideways. These percentages hold still instead. */}
        <table className="w-full text-sm table-fixed min-w-[52rem]">
          <colgroup>
            <col style={{ width: "24%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "12%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "9%" }} />
            <col style={{ width: "10%" }} />
            <col style={{ width: "13%" }} />
            <col style={{ width: "10%" }} />
          </colgroup>
          <thead>
            <tr className="text-xs text-gray-500 border-b border-gray-100">
              <SortTh label="Store" sortKey="store" sort={sort} setSort={setSort} className="px-4 sm:px-5 py-2" />
              <SortTh label="Complete %" sortKey="complete" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={`${thPad} whitespace-nowrap`} />
              <SortTh label="On time %" sortKey="pct" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={`${thPad} whitespace-nowrap`} />
              <SortTh label="On time" sortKey="onTime" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={thPad} />
              <SortTh label="Late" sortKey="late" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={thPad} />
              <SortTh label="Missed" sortKey="missed" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={thPad} />
              <SortTh label="Not due yet" sortKey="pending" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={`${thPad} whitespace-nowrap`} />
              <SortTh label="Lists" sortKey="lists" sort={sort} setSort={setSort} defaultDir="desc" align="right" className={thPad} />
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ store, data }) => (
              <tr
                key={store}
                onClick={() => data && onPick(store)}
                // Hover and the clicked-row highlight use the identical shade,
                // so hovering a marked row never changes its appearance.
                className={`border-b border-gray-50 last:border-0 ${
                  data ? "cursor-pointer hover:bg-gray-100" : ""
                } ${store === highlighted && !capturing ? "bg-gray-100" : ""}`}
              >
                <td className={`px-4 sm:px-5 py-1.5 font-medium ${data ? "text-gray-900" : "text-gray-400"}`}>
                  {store}
                  {!data && <span className="ml-2 text-xs font-normal text-gray-400">Not on Jolt</span>}
                </td>
                <td className={`${numCell} font-semibold ${completeColor(data?.completePct)}`}>
                  {data ? fmtPct(data.completePct) : "—"}
                </td>
                <td className={`${numCell} text-gray-700`}>{data ? fmtPct(data.onTimePct) : "—"}</td>
                <td className={`${numCell} text-gray-600`}>{data?.onTimeCount ?? "—"}</td>
                <td className={`${numCell} text-gray-600`}>{data?.lateCount ?? "—"}</td>
                <td className={`${numCell} text-gray-600`}>{data?.missedCount ?? "—"}</td>
                <td className={`${numCell} text-gray-600`}>{data?.pendingCount ?? "—"}</td>
                <td className={`${numCell} text-gray-600`}>{data?.rows.length ?? "—"}</td>
              </tr>
            ))}
          </tbody>
          {live.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50/60 font-medium">
                <td className="px-4 sm:px-5 py-2 text-gray-900">
                  All Jolt stores
                  <span className="ml-2 text-xs font-normal text-gray-400">{live.length} shown</span>
                </td>
                <td className={`${numCell} font-semibold ${completeColor(totalCompletePct)}`}>
                  {fmtPct(totalCompletePct)}
                </td>
                <td className={`${numCell} text-gray-700`}>{fmtPct(totalPct)}</td>
                <td className={`${numCell} text-gray-700`}>{totals.onTimeCount}</td>
                <td className={`${numCell} text-gray-700`}>{totals.lateCount}</td>
                <td className={`${numCell} text-gray-700`}>{totals.missedCount}</td>
                <td className={`${numCell} text-gray-700`}>{totals.pendingCount}</td>
                <td className={`${numCell} text-gray-700`}>{totals.lists}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

// ── One store's lists, chosen from the dropdown ───────────────────────────────

function StorePanel({
  store,
  data,
  options,
  asOf,
  onChange,
}: {
  store: string;
  data: StoreLists | null;
  options: SummaryRow[];
  /** When the report was built; relative deadlines are measured from this. */
  asOf: number;
  onChange: (store: string) => void;
}) {
  // Most recent deadline first, so the newest activity is at the top.
  const [sort, setSort] = useState<Sort>({ key: "deadline", dir: "desc" });

  const sortedRows = useMemo(() => {
    if (!data) return [];
    const value = (r: ListInstanceRow): string | number | null => {
      switch (sort.key) {
        case "title": return r.title.trim().toLowerCase();
        case "completedAt": return r.completedAt;
        case "completedBy": return r.completedBy?.toLowerCase() ?? null;
        case "status": return STATUS_RANK[r.status];
        default: return r.deadline;
      }
    };
    return sortBy(data.rows, sort.dir, value);
  }, [data, sort]);

  const cardRef = useRef<HTMLElement>(null);
  // The store name is already a dropdown, so the on-time figure carries the
  // copy-as-image action instead of the title.
  const { status: copyStatus, copy } = useCopyImage(cardRef);
  const tz = tzFor(store);

  return (
    <section ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3 border-b border-gray-100">
        <div className="relative shrink-0">
          <select
            value={store}
            onChange={e => onChange(e.target.value)}
            className="text-base font-semibold text-gray-900 bg-transparent border border-gray-200 rounded-lg pl-3 pr-8 py-1.5 appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            {options.map(o => (
              <option key={o.store} value={o.store}>
                {o.store}
                {o.data ? "" : " — not on Jolt"}
              </option>
            ))}
          </select>
          <svg
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {data ? (
          <>
            <div className="flex items-baseline gap-1.5 shrink-0">
              {/* Completion leads — it is what the bonus pays on — and carries
                  the copy-as-image action, since the title is a dropdown. */}
              <button
                onClick={copy}
                disabled={copyStatus === "copying"}
                title="Click to copy this table as an image"
                className={`text-lg font-semibold tabular-nums cursor-pointer disabled:cursor-wait hover:underline decoration-2 underline-offset-4 ${completeColor(
                  data.completePct,
                )}`}
              >
                {fmtPct(data.completePct)}
              </button>
              <span className="text-xs text-gray-500">complete</span>
              <span className="text-gray-300">/</span>
              <span className="text-lg font-semibold tabular-nums text-gray-900">{fmtPct(data.onTimePct)}</span>
              <span className="text-xs text-gray-500">on time</span>
              {copyStatus !== "idle" && (
                <span
                  data-copy-image-ignore="true"
                  className={`text-xs font-medium ${
                    copyStatus === "done" ? "text-green-600" : copyStatus === "error" ? "text-red-600" : "text-gray-400"
                  }`}
                >
                  {copyStatus === "copying" ? "Copying…" : copyStatus === "done" ? "Copied!" : "Copy failed"}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-[11px] ml-auto">
              <span className="rounded px-1.5 py-0.5 bg-green-50 text-green-700 tabular-nums">
                {data.onTimeCount} on time
              </span>
              <span className="rounded px-1.5 py-0.5 bg-yellow-50 text-yellow-800 tabular-nums">
                {data.lateCount} late
              </span>
              <span className="rounded px-1.5 py-0.5 bg-red-50 text-red-700 tabular-nums">
                {data.missedCount} missed
              </span>
              {data.pendingCount > 0 && (
                <span className="rounded px-1.5 py-0.5 bg-gray-100 text-gray-600 tabular-nums">
                  {data.pendingCount} not due yet
                </span>
              )}
              <span className="text-gray-400 tabular-nums">· {data.rows.length} lists</span>
            </div>
          </>
        ) : (
          <span className="text-sm text-gray-400">Jolt is not deployed at this store.</span>
        )}
      </div>

      {data && (
        <div className="overflow-x-auto">
          {data.rows.length === 0 ? (
            <p className="px-5 py-6 text-sm text-gray-400">No lists assigned in this period.</p>
          ) : (
            // Fixed widths for the same reason as the summary table; the Due
            // column especially grew and shrank as countdowns came and went.
            <table className="w-full text-sm table-fixed min-w-[56rem]">
              <colgroup>
                <col style={{ width: "32%" }} />
                <col style={{ width: "22%" }} />
                <col style={{ width: "15%" }} />
                <col style={{ width: "19%" }} />
                <col style={{ width: "12%" }} />
              </colgroup>
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100">
                  <SortTh label="List" sortKey="title" sort={sort} setSort={setSort} className="px-4 sm:px-5 py-2" />
                  <SortTh label="Due" sortKey="deadline" sort={sort} setSort={setSort} defaultDir="desc" className="px-3 py-2 whitespace-nowrap" />
                  <SortTh label="Completed" sortKey="completedAt" sort={sort} setSort={setSort} defaultDir="desc" className="px-3 py-2 whitespace-nowrap" />
                  <SortTh label="Completed by" sortKey="completedBy" sort={sort} setSort={setSort} className="px-3 py-2" />
                  <SortTh label="Status" sortKey="status" sort={sort} setSort={setSort} className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {sortedRows.map(row => (
                  <tr key={row.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                    <td className="px-4 sm:px-5 py-1.5 text-gray-900">
                      <a
                        href={JOLT_BROWSE_LISTS}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Open Browse Lists in Jolt"
                        className="hover:text-red-700 hover:underline"
                      >
                        {row.title.trim()}
                      </a>
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums whitespace-nowrap">
                      {fmtStamp(row.deadline, tz)}
                      {/* Only unfinished lists get a countdown — once a list is
                          done, how long was left is no longer the useful fact. */}
                      {row.completedAt === null && row.deadline !== null && (
                        <span
                          className={`ml-2 text-xs ${
                            row.status === "missed" ? "text-red-500" : "text-gray-400"
                          }`}
                        >
                          {untilDue(row.deadline, asOf)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600 tabular-nums whitespace-nowrap">
                      {fmtStamp(row.completedAt, tz)}
                    </td>
                    <td className="px-3 py-1.5 text-gray-600">{row.completedBy ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

type Status = "loading" | "done" | "error";

export default function JoltClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();
  // Opens on the last 24 hours: the shift that just happened, and the lightest
  // window to load (~120 rows against ~850 for a week). The range buttons widen
  // it from there.
  const initial = last24Hours();

  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [range, setRange] = useState(initial);
  const [quick, setQuick] = useState<string | null>("24h");

  const [showVA, setShowVA] = useState(true);
  const [showTN, setShowTN] = useState(true);

  const [report, setReport] = useState<StoreListsReport | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  // Fetched alongside the report but never from it: the To Do band is fixed to
  // the present, while the report follows the range buttons.
  const [todo, setTodo] = useState<ToDoReport | null>(null);

  const load = useCallback(
    (r: Range, { bust = false, markLoading = true }: { bust?: boolean; markLoading?: boolean } = {}) => {
      if (markLoading) setStatus("loading");
      setError(null);
      const qs = new URLSearchParams({ start: r.start, end: r.end });
      if (r.hours) qs.set("hours", String(r.hours));
      if (bust) qs.set("bust", "1");
      fetch(`/api/jolt/store-lists?${qs}`)
        .then(res => {
          if (res.status === 401) {
            router.push("/login");
            throw new Error("unauth");
          }
          return res.json();
        })
        .then((d: StoreListsReport & { error?: string }) => {
          if (d.error) throw new Error(d.error);
          setReport(d);
          setStatus("done");
        })
        .catch((e: Error) => {
          if (e.message === "unauth") return;
          setError(e.message);
          setStatus("error");
        });

      // Its own request, and its own failure: if the band cannot be fetched the
      // rest of the page is still worth showing, so this never sets the page
      // status. Refresh busts it too, since a stale To Do list is worse than
      // none — it shows work someone has already dealt with.
      fetch(`/api/jolt/todo${bust ? "?bust=1" : ""}`)
        .then(res => (res.status === 401 ? null : res.json()))
        .then((d: (ToDoReport & { error?: string }) | null) => {
          if (d && !d.error) setTodo(d);
        })
        .catch(() => {});
    },
    [router],
  );

  // Kick the first fetch off after the initial paint rather than during it, so
  // the status setter never runs inside the effect body.
  useEffect(() => {
    const id = setTimeout(() => load(initial, { markLoading: false }), 0);
    return () => clearTimeout(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const applyRange = (r: Range, key: string | null) => {
    setStart(r.start);
    setEnd(r.end);
    setRange(r);
    setQuick(key);
    load(r);
  };

  const loading = status === "loading";

  const byStore = useMemo(() => new Map((report?.stores ?? []).map(s => [s.store, s])), [report]);

  const visible = useMemo(() => {
    const names = [...(showTN ? TN_STORES : []), ...(showVA ? VA_STORES : [])];
    return names.map(store => ({ store, data: byStore.get(store) ?? null }));
  }, [byStore, showTN, showVA]);

  // The To Do band has its own rows, so it filters by name rather than by the
  // report's per-store entries.
  const visibleStores = useMemo(
    () => new Set([...(showTN ? TN_STORES : []), ...(showVA ? VA_STORES : [])]),
    [showTN, showVA],
  );

  // Which store's table is on screen. Held loosely rather than corrected in an
  // effect: toggling TN/VA or changing the range can drop the chosen store from
  // the list, and resolving that at render keeps the two in step without an
  // extra pass. Falls back to the first store that actually has Jolt data.
  const [picked, setPicked] = useState<string | null>(null);
  const selected =
    (picked && visible.some(v => v.store === picked) ? picked : null) ??
    visible.find(v => v.data)?.store ??
    visible[0]?.store ??
    "";
  const selectedData = byStore.get(selected) ?? null;

  // The summary highlight tracks what the user actually clicked, kept separate
  // from `selected` so the marker can be cleared without the detail table
  // jumping to another store. Clicking a marked row unmarks it.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const toggleHighlight = (store: string) => {
    setHighlighted(h => (h === store ? null : store));
    if (highlighted !== store) setPicked(store);
  };

  const quickButtons = [
    { key: "24h", label: "Last 24 Hours", fn: () => applyRange(last24Hours(), "24h") },
    // The last completed Monday–Sunday week, per lib/fiscal — a closed window,
    // so unlike the others its numbers are final.
    { key: "last_week", label: "Last Week", fn: () => applyRange(rangeKeyToDates("last_week"), "last_week") },
    // PTD is the fiscal period to date, the same window the drive-thru tab shows.
    { key: "mtd", label: "PTD", fn: () => applyRange(rangeKeyToDates("mtd"), "mtd") },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
              <div className="flex flex-col">
                <div className="relative w-fit">
                  <select
                    value="/jolt"
                    onChange={e => router.push(e.target.value)}
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
                <p className="text-xs text-gray-400 leading-tight">
                  {fmtDate(range.start)} – {fmtDate(range.end)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 flex-1 min-w-0">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {quickButtons.map(b => (
                  <button
                    key={b.key}
                    onClick={b.fn}
                    disabled={loading}
                    className={`text-xs px-3 py-1.5 transition disabled:opacity-50 ${
                      quick === b.key
                        ? "bg-red-700 text-white font-medium"
                        : "bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    {b.label}
                  </button>
                ))}
              </div>

              {/* Historical periods — same options as the drive-thru tab. */}
              <select
                value={quick && PERIOD_OPTIONS.some(o => o.key === quick) ? quick : ""}
                onChange={e => {
                  if (e.target.value) applyRange(rangeKeyToDates(e.target.value as RangeKey), e.target.value);
                }}
                disabled={loading}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-300"
              >
                <option value="">Period…</option>
                {PERIOD_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1">
                <input
                  type="date"
                  value={start}
                  max={end}
                  onChange={e => {
                    setStart(e.target.value);
                    setQuick(null);
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={end}
                  min={start}
                  onChange={e => {
                    setEnd(e.target.value);
                    setQuick(null);
                  }}
                  className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
                />
              </div>

              <button
                onClick={() => applyRange({ start, end }, null)}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
              >
                {loading ? "Fetching…" : "Fetch"}
              </button>
              <button
                onClick={() => load(range, { bust: true })}
                disabled={loading}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
              >
                Refresh
              </button>
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

        <div className="bg-gray-50 border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="text-gray-500">
              Complete&nbsp;
              <span className="text-green-600 font-medium">≥{COMPLETE_TARGET}%</span>
              {" / "}
              <span className="text-yellow-600 font-medium">≥{COMPLETE_THRESHOLD}%</span>
              {" / "}
              <span className="text-red-600 font-medium">&lt;{COMPLETE_THRESHOLD}%</span>
            </span>
            <div className="ml-auto flex items-center gap-3">
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showVA}
                  onChange={e => setShowVA(e.target.checked)}
                  className="rounded border-gray-300"
                />
                VA
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showTN}
                  onChange={e => setShowTN(e.target.checked)}
                  className="rounded border-gray-300"
                />
                TN
              </label>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {status === "error" && (
          <div className="bg-white rounded-xl border border-red-200 px-5 py-4 text-sm text-red-700">
            Could not load Jolt: {error ?? "unknown error"}
          </div>
        )}

        {report?.truncated && (
          <div className="bg-white rounded-xl border border-yellow-200 px-5 py-3 text-sm text-yellow-800">
            This range returned more lists than the page fetches in one go. Narrow the dates for a
            complete picture.
          </div>
        )}

        {/*
          Nothing renders until a report arrives. Before that every store is
          missing from the map, and drawing them would label all twelve "Not on
          Jolt" — a claim about the data, not a loading state.
        */}
        {/* Sits above everything and does not wait on the report — it answers a
            different question, and it is the one someone opens the tab for. */}
        {todo && <ToDoCard report={todo} visibleStores={visibleStores} />}

        {!report ? (
          status !== "error" && (
            <div className="bg-white rounded-xl border border-gray-200 px-5 py-8 text-sm text-gray-400">
              Loading lists…
            </div>
          )
        ) : (
          <>
            <SummaryCard rows={visible} highlighted={highlighted} onPick={toggleHighlight} />
            {selected && (
              <StorePanel
                store={selected}
                data={selectedData}
                options={visible}
                asOf={report.asOf}
                onChange={store => {
                  setPicked(store);
                  setHighlighted(store);
                }}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
