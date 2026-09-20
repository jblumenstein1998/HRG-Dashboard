"use client";

/**
 * Staffing — who was on the clock, at a moment, across every store.
 *
 * Opens on now and stays there until you move it. The date and time are one
 * control rather than two because they are one question, and a half-changed
 * pair would silently answer a different one.
 *
 * The stores keep their own clocks. Tennessee is Central and Virginia Eastern,
 * so a single instant is two different wall-clock times, and each store's
 * heading says which one it is reading. Asking "who was on at 6:30" without
 * saying whose 6:30 is how you end up an hour out for half the estate.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import { STORE_COLOR } from "@/lib/surveyMeta";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import ReconciliationSection from "@/components/ReconciliationSection";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import { CopyableTitle } from "@/components/CopyImageButton";
import { StoreFilterPicker, useStoreFilter, inFilter, type Leader, type StoreFilter } from "@/components/StoreFilter";
import type { Tab } from "@/lib/users/tabs";
import type {
  StaffingReport, StoreRoster, StaffOnClock, HoursReport, StoreHours, OpenCloseReport,
  MissedPunchReport, PayPeriod,
} from "@/lib/staffing";

/**
 * Column sorting for the two tables below.
 *
 * Null means the order the rows arrived in, which is the estate's own store
 * order — worth being able to get back to, since it is how everyone reads a
 * list of these stores. So a third click clears the sort rather than cycling
 * back to ascending.
 */
type SortState = { key: string; dir: "asc" | "desc" } | null;

function useColumnSort(defaultDir: "asc" | "desc" = "desc") {
  const [sort, setSort] = useState<SortState>(null);
  const toggle = (key: string) =>
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: defaultDir };
      if (prev.dir === defaultDir) return { key, dir: defaultDir === "desc" ? "asc" : "desc" };
      return null;
    });
  const arrow = (key: string) => (sort?.key === key ? (sort.dir === "asc" ? "↑" : "↓") : "");
  function apply<T>(rows: T[], value: (row: T, key: string) => number | string | null): T[] {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = value(a, sort.key);
      const vb = value(b, sort.key);
      // A store with nothing in a column sinks to the bottom either way round:
      // it is not the best or the worst, it simply has no figure.
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      if (typeof va === "string" || typeof vb === "string") {
        return String(va).localeCompare(String(vb)) * dir;
      }
      return (va - vb) * dir;
    });
  }
  return { sort, toggle, arrow, apply };
}

/** A header cell that ranks the table by its column. */
function SortHeader({
  label, sortKey, arrow, onClick, align = "right", className = "",
}: {
  label: string;
  sortKey: string;
  arrow: (key: string) => string;
  onClick: (key: string) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const mark = arrow(sortKey);
  return (
    <th className={`px-3 py-1.5 text-xs font-semibold uppercase tracking-wide whitespace-nowrap ${align === "left" ? "text-left" : "text-right"} ${mark ? "text-gray-600" : "text-gray-400"} ${className}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-gray-700 transition ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <span className="w-2 text-[9px] leading-none">{mark}</span>
      </button>
    </th>
  );
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "Thu 09/03" for a business date.
 *
 * Parsed as UTC because a business date is a calendar label rather than an
 * instant; reading it in the browser's zone shifts it a day for anyone west of
 * Greenwich, which would put the wrong weekday on every column.
 */
function dateHeader(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${dow} ${iso.slice(5).replace("-", "/")}`;
}

/**
 * A PAR job name with its payroll prefix taken off.
 *
 * PAR spells its jobs "Hourly - Assistant Manager", "Salary - General Manager",
 * "SAL Mgr Asst Gen" — the pay type welded onto the front of the position,
 * because the same role exists twice in its setup depending on how it is paid.
 * Nobody reading a staffing screen needs that: whether a manager is salaried is
 * already visible in the rate beside their name.
 *
 * Cosmetic only, and temporary. Positions come from Workstream once somebody is
 * linked, and Workstream says "Shift Lead" without the ceremony — at which
 * point this only applies to people the reconciliation queue has not reached.
 */
function cleanJobTitle(job: string | null | undefined): string | null {
  if (!job) return null;
  return job.replace(/^(hourly|salary|sal|hrly)\s*-\s*/i, "").trim() || null;
}

/** Hours, #,##0.0 — the one format used everywhere on this screen. */
function hrs(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  return (minutes / 60).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }) + "h";
}

/** Whole dollars. Cents on a wage bill are noise at this scale. */
function usd(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  return "(" + "$" + Math.round(amount).toLocaleString("en-US") + ")";
}

/** A value for <input type="datetime-local">, in the browser's own zone. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function StaffingClient({
  tabs,
  isAdmin,
  leaders,
}: {
  tabs: Tab[];
  isAdmin: boolean;
  leaders: Leader[];
}) {
  const router = useRouter();

  /*
   * One filter for the whole tab, held here and passed down.
   *
   * Every section on this page is a list of the same twelve stores, so a filter
   * that applied to only some of them would be worse than none — a manager
   * filtered to their four stores would still be reading the estate's overtime
   * chart underneath their own roster.
   *
   * It filters on the store *label*, which is what makes one control work
   * across tabs that identify stores differently. PAR_LOCATIONS, lib/stores.ts
   * and surveyMeta all name these twelve identically.
   */
  const storeFilter = useStoreFilter(leaders);

  // Held as the datetime-local string the input wants, seeded from now. `live`
  // means "follow the clock" — it survives until the field is touched, so the
  // page opened in the morning is still telling the truth at lunchtime.
  const [when, setWhen] = useState(() => toLocalInput(new Date()));
  const [live, setLive] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);

  const at = useMemo(() => (live ? null : new Date(when)), [live, when]);

  // Loading is derived from a request key rather than set inside the effect —
  // the React Compiler rejects a synchronous setState there, and keying the
  // response also drops answers that arrive out of order.
  const requestKey = `${live ? "live" : when}|${refreshKey}`;
  const [state, setState] = useState<{ key: string; data: StaffingReport | null; error: string | null }>(
    { key: "", data: null, error: null }
  );

  useEffect(() => {
    let cancelled = false;
    const qs = at && !Number.isNaN(at.getTime()) ? `?at=${encodeURIComponent(at.toISOString())}` : "";
    fetch(`/api/staffing${qs}`)
      .then(async (r) => {
        if (r.status === 401) { router.push("/login"); return null; }
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as StaffingReport;
      })
      .then((json) => { if (!cancelled && json) setState({ key: requestKey, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key: requestKey, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [requestKey, at, router]);

  const loading = state.key !== requestKey;
  const data = state.data;

  const setNow = useCallback(() => {
    setWhen(toLocalInput(new Date()));
    setLive(true);
    setRefreshKey((k) => k + 1);
  }, []);

  // Filtered once, here, so the headline count and the card below it can never
  // disagree about which stores are being talked about.
  const shownStores = (data?.stores ?? []).filter((s) => inFilter(storeFilter.allowed, s.storeName));
  const totalOn = shownStores.reduce((n, s) => n + s.onClock.length, 0);
  const storesReporting = shownStores.filter((s) => !s.error).length;

  /*
   * One store's roster at a time.
   *
   * Twelve open cards was several screens of names to get past, and the
   * headline above already answers the estate-wide question — how many are on
   * and at how many stores. So the detail is one store, chosen here.
   *
   * The choice falls back to the first available rather than being remembered
   * blindly: the leader filter can take the selected store off the list
   * entirely, and a selection pointing at a store that is no longer offered
   * would render nothing with no explanation.
   */
  const [storeId, setStoreId] = useState<string | null>(null);
  const shownStore = shownStores.find((s) => s.storeId === storeId) ?? shownStores[0] ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hrglogo.png" alt="HRG" className="h-8 w-auto" />
              <div className="relative w-fit">
                <select
                  value="/staffing"
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
            <button
              onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); }}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              Log out
            </button>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <StoreFilterPicker
              leaders={leaders}
              value={storeFilter.value}
              onChange={storeFilter.setValue}
            />
            <input
              type="datetime-local"
              value={when}
              onChange={(e) => { setWhen(e.target.value); setLive(false); }}
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
            />
            <button
              onClick={setNow}
              className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                live ? "bg-gray-900 text-white border-gray-900" : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              Now
            </button>
            {live && <span className="text-xs text-gray-400">following the clock</span>}

            {data && !loading && (
              <span className="text-xs text-gray-500">
                <strong className="text-gray-900">{totalOn}</strong> on the clock across{" "}
                <strong className="text-gray-900">{storesReporting}</strong> stores
              </span>
            )}

            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              disabled={loading}
              className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-3">
        {state.error && (
          <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center justify-between gap-4">
            <span>{state.error}</span>
            <button onClick={() => setRefreshKey((k) => k + 1)} className="text-xs font-medium underline underline-offset-2 shrink-0">Retry</button>
          </div>
        )}

        <WorkstreamSyncBanner sync={data?.workstreamSync} />

        {/* First on the page: the only section here that is a task rather than
            a report. */}
        <MissedClockOutSection filter={storeFilter} />

        <div ref={cardRef} className="flex flex-wrap items-baseline gap-x-3">
          <CopyableTitle
            title={`On the clock — ${shownStore?.storeName ?? "no store"} — ${data ? new Date(data.at).toLocaleString() : when.replace("T", " ")}`}
            targetRef={cardRef}
            className="text-base font-semibold text-gray-900"
          />
          {/* Every store is already loaded — the whole estate comes back in one
              PAR read — so this only chooses which one is drawn. The count on
              each option is what the twelve open cards used to give you at a
              glance: where the people are, without switching to find out. */}
          {shownStores.length > 0 && (
            <select
              data-copy-image-ignore="true"
              value={shownStore?.storeId ?? ""}
              onChange={(e) => setStoreId(e.target.value)}
              aria-label="Store"
              className="text-sm border border-gray-200 rounded-lg py-1 pl-2 pr-6 bg-white cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-200"
            >
              {shownStores.map((s) => (
                <option key={s.storeId} value={s.storeId}>
                  {s.storeName} ({s.error ? "—" : s.onClock.length})
                </option>
              ))}
            </select>
          )}
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              Reading PAR — first load of a new time takes a moment
            </span>
          )}
        </div>

        <div className={`space-y-3 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
          {shownStore && <StoreCard key={shownStore.storeId} store={shownStore} />}
          {!loading && data && shownStores.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
              No stores to show.
            </div>
          )}
        </div>

        <OpenCloseSection filter={storeFilter} />

        <HoursSection filter={storeFilter} />

        {/* Admin-only: it shows everyone's pay rate side by side and its
            decisions determine whose hours are costed at whose rate. */}
        {isAdmin && <ReconciliationSection stores={BONUS_STORES.filter((s) => inFilter(storeFilter.allowed, s.name))} />}

        <p className="text-[11px] text-gray-400">
          Times are each store&apos;s own — Tennessee is Central, Virginia Eastern. Position and
          break windows are PAR&apos;s own. <strong>Elapsed</strong> is time since clocking in and
          includes breaks; <strong>trailing 7d</strong> is PAR&apos;s paid minutes-worked, which
          excludes them, over the seven business dates before the one shown. Wages sum the hourly
          rates on the clock; salaried staff carry no rate in PAR and are counted separately rather
          than added as zero. The Hours chart and store rows show <strong>overtime only</strong>;
          opening a store adds each person&apos;s regular hours beside theirs, without a second
          dollar figure. Overtime is PAR&apos;s own split, costed at the rate recorded on each
          shift times{" "}
          <strong>1.5×</strong>, the one figure on this screen that is assumed rather than read,
          since PAR records the hours but never what it pays for them. It is gross pay, not a
          burdened cost, and salaried hours cost nothing in it. Every window ends{" "}
          <strong>yesterday</strong>, because a day still being worked reports less overtime than
          it will finish with; the <strong>WTD</strong> point is a part-week and will sit below the
          full weeks beside it for that reason alone. On a custom range a weekly column marked{" "}
          <strong>~</strong> is a week cut short by the dates you chose, and is low for the same
          reason.
        </p>
      </main>
    </div>
  );
}

/**
 * Labor spent before the doors open and after they shut.
 *
 * Open and close are PAR's own business hours per day of week, so a slow
 * morning does not read as a late open. The labor is the same window overlap
 * the hourly rollup uses: break time inside the window is not counted, and a
 * closing shift running past midnight is measured in its own frame rather than
 * wrapping into a negative span.
 */
function OpenCloseSection({ filter }: { filter: StoreFilter }) {
  const [side, setSide] = useState<"open" | "close">("open");
  const sorter = useColumnSort("desc");
  const [state, setState] = useState<{ loaded: boolean; data: OpenCloseReport | null; error: string | null }>(
    { loaded: false, data: null, error: null },
  );

  useEffect(() => {
    let cancelled = false;
    fetch("/api/staffing/openclose?days=5")
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as OpenCloseReport;
      })
      .then((json) => { if (!cancelled) setState({ loaded: true, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ loaded: true, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, []);

  // Filtered once, at the source, so this section's table, chart and legend
  // cannot disagree about which stores are on screen.
  const data = useMemo(
    () => (state.data ? { ...state.data, stores: state.data.stores.filter((s) => inFilter(filter.allowed, s.storeName)) } : null),
    [state.data, filter.allowed],
  );

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">
          Labor {side === "open" ? "before open" : "after close"}
        </span>
        <span className="text-xs text-gray-400">
          {side === "open"
            ? "hours worked before the doors open · people · first clock-in"
            : "hours worked after close · people · last clock-out"}
        </span>
        <div className="ml-auto flex rounded-lg border border-gray-200 overflow-hidden">
          {(["open", "close"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setSide(v)}
              className={`text-xs px-3 py-1 transition ${
                side === v ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {v === "open" ? "Open" : "Close"}
            </button>
          ))}
        </div>
        {!state.loaded && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
      </div>

      {state.error && <p className="px-3 py-3 text-sm text-red-700">{state.error}</p>}

      {data && <OpenCloseChart data={data} side={side} />}

      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader label="Store" sortKey="store" align="left" arrow={sorter.arrow} onClick={sorter.toggle} />
                {data.dates.map((d) => (
                  <SortHeader
                    key={d}
                    label={dateHeader(d)}
                    sortKey={d}
                    arrow={sorter.arrow}
                    onClick={sorter.toggle}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorter.apply(data.stores, (store, key) => {
                if (key === "store") return store.storeName;
                const cells = side === "open" ? store.open : store.close;
                const cell = cells.find((c) => c.businessDate === key);
                return cell && cell.people > 0 ? cell.laborMinutes : null;
              }).map((store) => {
                const cells = side === "open" ? store.open : store.close;
                return (
                  <tr key={store.storeId} className="border-b border-gray-50">
                    <td className="px-3 py-1 font-medium text-gray-900 whitespace-nowrap">
                      {store.storeName}
                      {cells[0]?.openLabel && (
                        <span className="ml-2 text-[11px] font-normal text-gray-400">
                          {side === "open" ? cells[0].openLabel : cells[0].closeLabel}
                        </span>
                      )}
                      {store.error && <span className="ml-2 text-xs text-red-600">{store.error}</span>}
                    </td>
                    {cells.map((c) => (
                      <td key={c.businessDate} className="px-3 py-1 text-right text-xs tabular-nums whitespace-nowrap">
                        {c.people === 0 ? (
                          <span className="text-gray-300">—</span>
                        ) : (
                          <>
                            <span className="text-gray-800 font-medium">{hrs(c.laborMinutes)}</span>{" "}
                            <span className="text-gray-400">{c.people}p</span>{" "}
                            <span className="text-gray-400" title={side === "open" ? "first clock-in" : "last clock-out"}>
                              {c.edgeLabel}
                            </span>
                          </>
                        )}
                      </td>
                    ))}
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

/**
 * The same labor the table below shows, as a line per store.
 *
 * Store colours come from the shared map the survey and drive-thru charts use,
 * so a store is the same colour wherever it appears — reading two charts side
 * by side is otherwise a memory test.
 *
 * The market checkboxes and the per-store ones follow the same pattern as the
 * survey trend chart: hiding a store hides the line, and the market box is
 * checked only when all of its stores are.
 */
function OpenCloseChart({ data, side }: { data: OpenCloseReport; side: "open" | "close" }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const markets = useMemo(() => {
    const tn = data.stores.filter((s) => s.state === "TN").map((s) => s.storeName);
    const va = data.stores.filter((s) => s.state === "VA").map((s) => s.storeName);
    return [
      { key: "TN", stores: tn },
      { key: "VA", stores: va },
    ];
  }, [data]);

  // One row per date, one key per store — the shape recharts wants.
  const series = useMemo(
    () =>
      data.dates.map((date) => {
        const row: Record<string, string | number | null> = { date: dateHeader(date) };
        for (const store of data.stores) {
          const cells = side === "open" ? store.open : store.close;
          const cell = cells.find((c) => c.businessDate === date);
          row[store.storeName] = cell && cell.people > 0
            ? Math.round((cell.laborMinutes / 60) * 10) / 10
            : null;
        }
        return row;
      }),
    [data, side],
  );

  const toggleStore = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const toggleMarket = (stores: string[], on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      for (const n of stores) { if (on) next.delete(n); else next.add(n); }
      return next;
    });

  return (
    <div className="px-3 pt-3 pb-2 border-b border-gray-100">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${v}h`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              formatter={(v, name) => [`${v}h`, String(name)]}
              // Busiest store first. Recharts defaults itemSorter to "name", so
              // twelve stores came out alphabetically and the day's biggest
              // number could sit anywhere in the list. The sort is ascending on
              // whatever the sorter returns, hence the negation.
              itemSorter={(item) => -(Number(item.value) || 0)}
            />
            {data.stores.map((store) =>
              hidden.has(store.storeName) ? null : (
                <Line
                  key={store.storeId}
                  type="monotone"
                  dataKey={store.storeName}
                  stroke={STORE_COLOR[store.storeName] ?? "#6b7280"}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ),
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 space-y-1.5">
        {markets.map((market) => {
          const allOn = market.stores.every((n) => !hidden.has(n));
          return (
            <div key={market.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => toggleMarket(market.stores, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {market.key}
              </label>
              {market.stores.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!hidden.has(name)}
                    onChange={() => toggleStore(name)}
                    className="rounded border-gray-300"
                    style={{ accentColor: STORE_COLOR[name] ?? "#6b7280" }}
                  />
                  {name}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Regular and overtime hours by store and week.
 *
 * Overtime is PAR's own OvertimeMinutesWorked, not a 40-hour rule applied here.
 * The workweek a payroll provider uses, and the rules around it, are not
 * visible to this app, and a locally computed figure that disagreed with
 * someone's pay would be worse than no figure at all.
 *
 * Only complete weeks are shown. A week in progress always reports less
 * overtime than it will finish with, which reads as a store improving when
 * nothing has changed.
 */
/**
 * Overtime hours per store, over whatever window the Hours section is showing.
 *
 * Deliberately overtime alone rather than overtime beside regular hours. They
 * differ by an order of magnitude, so on one axis overtime flattens into the
 * baseline and becomes unreadable — and a second axis to rescue it would be
 * worse, since two y-scales let any two shapes be made to agree. Regular hours
 * are in the table underneath for anyone who wants both.
 *
 * Store colours come from the shared map the survey, drive-thru and open/close
 * charts use, so a store is the same colour wherever it appears. The colour
 * follows the store, never its rank, so filtering the list never repaints the
 * lines that remain.
 */
function OvertimeChart({ data, grain }: { data: HoursReport; grain: string }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const markets = useMemo(() => {
    const of = (state: "TN" | "VA") =>
      data.stores.filter((s) => s.state === state).map((s) => s.storeName);
    return [
      { key: "TN", stores: of("TN") },
      { key: "VA", stores: of("VA") },
    ];
  }, [data]);

  // One row per span, one key per store — the shape recharts wants.
  const series = useMemo(
    () =>
      data.weeks.map((span) => {
        const row: Record<string, string | number | null> = { span: span.label };
        for (const store of data.stores) {
          const cell = store.weeks.find((w) => w.weekStart === span.start);
          // Zero overtime is a real and good answer, so it plots as zero. Only
          // a store that reported nothing at all is a gap in the line.
          row[store.storeName] = cell ? Math.round((cell.overtimeMinutes / 60) * 10) / 10 : null;
        }
        return row;
      }),
    [data],
  );

  const anyOvertime = series.some((row) =>
    Object.entries(row).some(([k, v]) => k !== "span" && typeof v === "number" && v > 0),
  );

  const toggleStore = (name: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });

  const toggleMarket = (stores: string[], on: boolean) =>
    setHidden((prev) => {
      const next = new Set(prev);
      for (const n of stores) { if (on) next.delete(n); else next.add(n); }
      return next;
    });

  return (
    <div className="px-3 pt-3 pb-2 border-b border-gray-100">
      <div className="flex flex-wrap items-baseline gap-x-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Overtime hours by {grain}
        </span>
        {!anyOvertime && (
          <span className="text-xs text-gray-400">no overtime in this window</span>
        )}
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="span" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 11, fill: "#94a3b8" }}
              axisLine={false}
              tickLine={false}
              width={44}
              tickFormatter={(v: number) => `${v}h`}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
              formatter={(v, name) => [`${v}h`, String(name)]}
              // Worst store first: twelve stores sorted by name would scatter
              // the number you opened the chart to find. Ascending on the
              // sorter's result, hence the negation.
              itemSorter={(item) => -(Number(item.value) || 0)}
            />
            {data.stores.map((store) =>
              hidden.has(store.storeName) ? null : (
                <Line
                  key={store.storeId}
                  type="monotone"
                  dataKey={store.storeName}
                  stroke={STORE_COLOR[store.storeName] ?? "#6b7280"}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ),
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 space-y-1.5">
        {markets.map((market) => {
          const allOn = market.stores.every((n) => !hidden.has(n));
          return (
            <div key={market.key} className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none w-8">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => toggleMarket(market.stores, e.target.checked)}
                  className="rounded border-gray-300"
                />
                {market.key}
              </label>
              {market.stores.map((name) => (
                <label key={name} className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!hidden.has(name)}
                    onChange={() => toggleStore(name)}
                    className="rounded border-gray-300"
                    style={{ accentColor: STORE_COLOR[name] ?? "#6b7280" }}
                  />
                  {name}
                </label>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Timecards to fix: still on the clock at 2:13am.
 *
 * Top of the page because it is the only thing here that is a task. Everything
 * below reports what happened; this says what to go and correct, and it is
 * worth nothing if it is found by scrolling.
 *
 * Two windows, which are the two moments anybody asks. **Yesterday** is for
 * catching it while people still remember the shift. **The pay period** is the
 * pre-payroll sweep — every date the run will pay for, so nothing wrong goes
 * out the door.
 *
 * Empty is the expected state, and says so rather than showing a bare table.
 */
function MissedClockOutSection({ filter }: { filter: StoreFilter }) {
  const [payDate, setPayDate] = useState<string | null>(null);
  const [state, setState] = useState<{
    key: string; data: MissedPunchReport & { payPeriods?: PayPeriod[] } | null; error: string | null;
  }>({ key: "", data: null, error: null });

  const query = payDate ? `payDate=${payDate}` : "";
  const requestKey = query || "yesterday";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staffing/exceptions${query ? `?${query}` : ""}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as MissedPunchReport & { payPeriods?: PayPeriod[] };
      })
      .then((json) => { if (!cancelled) setState({ key: requestKey, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key: requestKey, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [requestKey, query]);

  const loading = state.key !== requestKey;
  const data = state.data;
  const periods = data?.payPeriods ?? [];
  const cardRef = useRef<HTMLElement>(null);

  /**
   * The business dates this answer actually covers.
   *
   * Taken from the report rather than from the period that was asked for: a
   * fortnight still being worked is only read through yesterday, so the window
   * requested and the window examined are not the same thing, and only one of
   * them is true of the rows below.
   */
  const examined = (() => {
    const d = data?.dates ?? [];
    if (d.length === 0) return null;
    const first = d[0];
    const last = d[d.length - 1];
    return first === last
      ? dateHeader(first)
      : `${dateHeader(first)} – ${dateHeader(last)}`;
  })();
  const selected = payDate ? periods.find((p) => p.payDate === payDate) ?? null : null;

  const visible = (data?.stores ?? []).filter((s) => inFilter(filter.allowed, s.storeName));
  const rows = visible.flatMap((s) => s.rows.map((r) => ({ ...r, storeName: s.storeName })));
  const storeErrors = visible.filter((s) => s.error);

  return (
    <section ref={cardRef} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100">
        {/* The title names the window, so a screenshot pasted into a message
            says which fortnight it is about without anyone having to add it. */}
        <CopyableTitle
          title={`Timecards to fix — ${selected ? selected.label : "yesterday"}`}
          targetRef={cardRef}
          className="text-sm font-semibold text-gray-900 hover:text-gray-600"
        />
        {/* The dates actually examined, not the ones asked for. A pay period
            still being worked is only read through yesterday, and saying
            09/14-09/27 when the data stops on the 19th would overstate what
            has been checked. */}
        {examined && <span className="text-xs text-gray-400">{examined}</span>}

        {rows.length > 0 && (
          <span className="text-xs font-medium text-amber-700">
            {rows.length} to correct
          </span>
        )}

        {/* Controls are for the person at the screen, not for the picture —
            a screenshot of a button nobody can press is noise. */}
        <div data-copy-image-ignore="true" className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={() => setPayDate(null)}
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${
              payDate === null
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            Yesterday
          </button>
          <select
            value={payDate ?? ""}
            onChange={(e) => setPayDate(e.target.value || null)}
            aria-label="Pay period"
            className={`text-xs border rounded-lg py-1 pl-2 pr-6 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 ${
              payDate ? "border-gray-400 text-gray-900" : "border-gray-200 text-gray-500"
            }`}
          >
            <option value="">Pay period…</option>
            {periods.map((p) => (
              <option key={p.payDate} value={p.payDate}>
                {p.label} ({p.start.slice(5).replace("-", "/")}–{p.end.slice(5).replace("-", "/")})
                {p.inProgress ? " · in progress" : ""}
              </option>
            ))}
          </select>
          {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      {state.error && <p className="px-3 py-3 text-sm text-red-700">{state.error}</p>}

      {storeErrors.length > 0 && (
        <p className="px-3 py-2 text-xs text-amber-700">
          Could not read {storeErrors.map((s) => s.storeName).join(", ")} — those stores are not
          included in the count above.
        </p>
      )}

      {data && rows.length === 0 && !loading && (
        <p className="px-3 py-4 text-sm text-gray-500">
          Nothing to fix{payDate ? " in this pay period" : " from yesterday"}. Every shift was
          clocked out.
        </p>
      )}

      {rows.length > 0 && (
        <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-400">
                <th className="px-3 py-1.5 text-left font-semibold">Date</th>
                <th className="px-3 py-1.5 text-left font-semibold">Store</th>
                <th className="px-3 py-1.5 text-left font-semibold">Employee</th>
                <th className="px-3 py-1.5 text-left font-semibold">Job</th>
                <th className="px-3 py-1.5 text-right font-semibold">In</th>
                <th className="px-3 py-1.5 text-right font-semibold">Out</th>
                <th className="px-3 py-1.5 text-right font-semibold">PAR credits</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.storeName}-${r.businessDate}-${r.employeeId ?? i}`} className="border-b border-gray-50 last:border-0">
                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-600">{dateHeader(r.businessDate)}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-900">{r.storeName}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap font-medium text-gray-900">{r.name}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-gray-500">{cleanJobTitle(r.job) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 whitespace-nowrap">{r.startLabel}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap text-amber-700 font-medium">
                    {r.endLabel}
                  </td>
                  {/* Flagged as what PAR currently credits, not as hours worked:
                      the whole point is that this figure is wrong. */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-400 whitespace-nowrap">
                    {hrs(r.minutesWorked)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Yesterday, ISO — the latest date any window on this screen may end on. */
function yesterdayISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `days` before yesterday, ISO — the default start of a custom range. */
function daysBeforeYesterday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - 1 - days);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function HoursSection({ filter }: { filter: StoreFilter }) {
  /*
   * Two independent choices, because they are two questions.
   *
   *   grain  — are the columns days or weeks?
   *   range  — week to date, or dates you pick?
   *
   * They used to be one dropdown of six canned combinations, which meant
   * "weekly, but for last month" was not on the menu at all. Splitting them
   * makes every combination reachable and the control smaller.
   *
   * One control still drives the chart and the table: they are two views of the
   * same window, and two selectors that could disagree would be a way to
   * misread both.
   */
  const [grain, setGrain] = useState<"day" | "week">("week");
  const [mode, setMode] = useState<"wtd" | "custom">("wtd");
  const [from, setFrom] = useState(() => daysBeforeYesterday(27));
  const [to, setTo] = useState(yesterdayISO);

  const [expanded, setExpanded] = useState<string | null>(null);
  const sorter = useColumnSort("desc");
  const [state, setState] = useState<{ key: string; data: HoursReport | null; error: string | null }>(
    { key: "", data: null, error: null },
  );

  /*
   * Week to date means different things at the two grains, and both are what
   * somebody asking for "WTD" wants to see:
   *
   *   weekly  three finished weeks to read a trend against, then where this
   *           week has got to
   *   daily   this week alone, one column per day through yesterday
   */
  const query = mode === "wtd"
    ? (grain === "week" ? "weeks=3&wtd=1" : "wtdDays=1")
    : `from=${from}&to=${to}&grain=${grain}`;
  const requestKey = query;
  const badRange = mode === "custom" && to < from;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/staffing/hours?${query}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json as HoursReport;
      })
      .then((json) => { if (!cancelled) setState({ key: requestKey, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key: requestKey, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [requestKey, query]);

  const loading = state.key !== requestKey;
  const data = useMemo(
    () => (state.data ? { ...state.data, stores: state.data.stores.filter((s) => inFilter(filter.allowed, s.storeName)) } : null),
    [state.data, filter.allowed],
  );

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Hours</span>
        <span className="text-xs text-gray-400">
          overtime hours and cost · through yesterday
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Grain. A segmented pair rather than a dropdown: two options that
              are always both worth seeing should not need opening. */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
            {(["day", "week"] as const).map((g) => (
              <button
                key={g}
                onClick={() => { setGrain(g); setExpanded(null); }}
                className={`text-xs px-2.5 py-1 transition ${
                  grain === g ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                {g === "day" ? "Daily" : "Weekly"}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setMode("wtd"); setExpanded(null); }}
            title="Week to date, through yesterday"
            className={`text-xs px-2.5 py-1 rounded-lg border transition ${
              mode === "wtd"
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            }`}
          >
            WTD
          </button>

          {/* Touching either date switches to the custom range, so there is no
              separate "custom" button to press first and forget. */}
          <label className="flex items-center gap-1 text-xs text-gray-500">
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => { setFrom(e.target.value); setMode("custom"); setExpanded(null); }}
              className={`text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 ${
                mode === "custom" ? "border-gray-400 text-gray-900" : "border-gray-200 text-gray-500"
              }`}
            />
            <span className="text-gray-400">to</span>
            <input
              type="date"
              value={to}
              min={from}
              max={yesterdayISO()}
              onChange={(e) => { setTo(e.target.value); setMode("custom"); setExpanded(null); }}
              className={`text-xs border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 ${
                mode === "custom" ? "border-gray-400 text-gray-900" : "border-gray-200 text-gray-500"
              }`}
            />
          </label>

          {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
        </div>
      </div>

      {badRange && (
        <p className="px-3 py-2 text-xs text-amber-700">
          The start date is after the end date.
        </p>
      )}

      {state.error && <p className="px-3 py-3 text-sm text-red-700">{state.error}</p>}

      {data && <OvertimeChart data={data} grain={grain === "day" ? "day" : "week"} />}

      {data && (
        <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <SortHeader label="Store" sortKey="store" align="left" arrow={sorter.arrow} onClick={sorter.toggle} />
                {data.weeks.map((w) => (
                  <SortHeader
                    key={w.start}
                    label={w.label.startsWith("P") ? w.label : dateHeader(w.start)}
                    sortKey={w.start}
                    arrow={sorter.arrow}
                    onClick={sorter.toggle}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {sorter.apply(data.stores, (store, key) => {
                if (key === "store") return store.storeName;
                const week = store.weeks.find((w) => w.weekStart === key);
                return week ? week.overtimeMinutes : null;
              }).map((store) => (
                <StoreHoursRows
                  key={store.storeId}
                  store={store}
                  open={expanded === store.storeId}
                  onToggle={() => setExpanded(expanded === store.storeId ? null : store.storeId)}
                  weekCount={data.weeks.length}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StoreHoursRows({
  store, open, onToggle, weekCount,
}: {
  store: StoreHours;
  open: boolean;
  onToggle: () => void;
  weekCount: number;
}) {
  // Everyone who appears in any week, ordered by the overtime they racked up
  // across the whole window — the question the drawer is opened to answer.
  // `job` is the job they clocked in as; `position` is what Workstream hired
  // them as. Both are shown, because they are different claims and disagreeing
  // is normal — a Shift Leader on a Cook shift is a Tuesday, not an error.
  const people = new Map<string, {
    name: string;
    job: string | null;
    position: string | null;
    rateOfRecord: number | null;
    total: number;
  }>();
  for (const w of store.weeks) {
    for (const p of w.people) {
      const row = people.get(p.employeeId) ?? {
        name: p.name,
        job: p.job,
        position: p.workstream?.position ?? null,
        rateOfRecord: p.workstream?.rateOfRecord ?? null,
        total: 0,
      };
      row.total += p.overtimeMinutes;
      people.set(p.employeeId, row);
    }
  }
  const ranked = [...people.entries()].sort((a, b) => b[1].total - a[1].total);

  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={onToggle}>
        <td className="px-3 py-1.5 font-medium text-gray-900 whitespace-nowrap">
          {store.storeName}
          {store.error && <span className="ml-2 text-xs text-red-600">{store.error}</span>}
        </td>
        {/* Overtime only. Regular hours took four times the width for a number
            nobody opens this table to read — the overtime is the actionable
            figure, and sitting it beside one ten times its size made it the
            small print. */}
        {store.weeks.map((w) => (
          <td key={w.weekStart} className="px-3 py-1 text-right text-xs tabular-nums whitespace-nowrap">
            <span className={w.overtimeMinutes > 0 ? "text-amber-700 font-medium" : "text-gray-300"}>
              {hrs(w.overtimeMinutes)}
            </span>{" "}
            <span className={w.overtimeMinutes > 0 ? "text-amber-600" : "text-gray-300"}>
              {usd(w.overtimeCost)}
            </span>
          </td>
        ))}
      </tr>

      {open && (
        <tr className="border-b border-gray-200 bg-gray-50">
          <td colSpan={weekCount + 1} className="px-3 py-2">
            {ranked.length === 0 ? (
              <p className="text-sm text-gray-400">No shifts in this window.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-2 py-1 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Employee</th>
                    {store.weeks.map((w) => (
                      <th key={w.weekStart} className="px-2 py-1 text-right text-xs font-semibold uppercase tracking-wide text-gray-400 whitespace-nowrap">
                        {w.weekStart.slice(5).replace("-", "/")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(([id, meta]) => (
                    <tr key={id} className="border-b border-gray-100 last:border-0">
                      <td className="px-2 py-1 text-gray-800 whitespace-nowrap">
                        {meta.name}
                        {/* One position, not two. Workstream's where the person
                            has been linked, PAR's job otherwise — and PAR's with
                            its "Hourly - " pay-type prefix taken off, which is
                            payroll's business and not a job title. */}
                        {(meta.position ?? cleanJobTitle(meta.job)) && (
                          <span className="ml-2 text-[11px] text-gray-600">
                            {meta.position ?? cleanJobTitle(meta.job)}
                          </span>
                        )}
                        {meta.rateOfRecord != null && (
                          <span className="ml-1.5 text-[11px] text-gray-400 tabular-nums">
                            ${meta.rateOfRecord.toFixed(2)}/hr
                          </span>
                        )}
                      </td>
                      {store.weeks.map((w) => {
                        const row = w.people.find((p) => p.employeeId === id);
                        if (!row) return <td key={w.weekStart} className="px-2 py-1 text-right text-xs text-gray-300">—</td>;
                        // Regular hours for context — how much of a person's
                        // week the overtime sits on top of — but no cost beside
                        // them. The dollar figure that matters is the overtime
                        // one, and a second one next to it is what buried it.
                        return (
                          <td key={w.weekStart} className="px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap">
                            <span className="text-gray-600">{hrs(row.regularMinutes)}</span>
                            <span className="text-gray-300"> / </span>
                            <span className={row.overtimeMinutes > 0 ? "text-amber-700 font-medium" : "text-gray-300"}>
                              {hrs(row.overtimeMinutes)}
                            </span>{" "}
                            <span className={row.overtimeMinutes > 0 ? "text-amber-600" : "text-gray-300"}>
                              {usd(row.overtimeCost)}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The four tiers, keyed on Workstream's job titles.
 *
 * These are positions of record, not what someone clocked in as — Workstream is
 * where a person is hired into a job, and PAR only knows which button they
 * pressed at the terminal. That is why an earlier version of this map listed
 * PAR's titles ("SAL Mgr Asst Gen", "Hourly - Assistant Manager") and described
 * itself as provisional until payroll was integrated. It is integrated; this is
 * the replacement.
 *
 * Cook and Cashier sit in Crew: they are crew-level line positions, and between
 * them they are about a quarter of everyone active.
 *
 * Still an explicit list rather than a pattern match over the words in a title,
 * for the same reason as before — a title that is not named here appears under
 * "Other" with its real name, so a new or renamed job is something to look at
 * rather than something that silently joins the wrong tier. District Manager
 * and Director of Operations land there on purpose: they are above-store roles
 * and are not usually on a store's clock.
 */
const JOB_GROUPS: { key: string; label: string; titles: string[] }[] = [
  { key: "crew", label: "Crew", titles: ["Crew", "Cook", "Cashier"] },
  { key: "managers", label: "Managers", titles: ["Crew Trainer", "Shift Lead"] },
  { key: "directors", label: "Directors", titles: ["Director"] },
  { key: "leadership", label: "Leadership", titles: ["AGM", "General Manager"] },
];

const GROUP_TONE: Record<string, string> = {
  crew: "bg-blue-50 border-blue-200",
  managers: "bg-amber-50 border-amber-200",
  directors: "bg-purple-50 border-purple-200",
  leadership: "bg-emerald-50 border-emerald-200",
  other: "bg-gray-50 border-gray-200",
};

/**
 * The title to group and label by: Workstream's, falling back to PAR's.
 *
 * The fallback only fires for someone not yet linked to a Workstream record,
 * and it will land them in "Other" because PAR's titles are not in the list
 * above. That is the honest outcome — an unlinked person's position is not
 * known, and putting them in Crew because PAR said "Cashier" would be a guess
 * wearing a fact's clothes.
 */
function titleOf(p: StaffOnClock): string | null {
  return p.workstream?.position ?? p.job;
}

/**
 * The rate to show: Workstream's rate of record, or PAR's shift rate.
 *
 * Null means salaried — Workstream states those annually and PAR records them
 * as 0, and neither is an hourly number. The card says "salaried" rather than
 * "$0.00", which is what it used to do and read as free labour.
 */
function rateOf(p: StaffOnClock): number | null {
  const rate = p.workstream?.rateOfRecord ?? p.payRate;
  return rate === null || rate === 0 ? null : rate;
}

function groupOf(p: StaffOnClock): string {
  const title = p.workstream?.position;
  if (!title) return "other";
  return JOB_GROUPS.find((g) => g.titles.includes(title))?.key ?? "other";
}

/**
 * Says when the Workstream roster was last read, but only when that matters.
 *
 * Silent on a fresh sync, because a line reporting that everything is fine is a
 * line people stop reading. It speaks up when the table is empty or a day and a
 * half stale — the states where every card reads "not linked to Workstream" and
 * everybody falls into "Other", which looks like broken matching rather than
 * absent data. That misreading has already cost an hour once.
 */
function WorkstreamSyncBanner({
  sync,
}: {
  sync?: { rows: number; lastSyncedAt: string | null; ageHours: number | null };
}) {
  if (!sync) return null;

  const ageHours = sync.ageHours;
  const empty = sync.rows === 0;
  // The cron runs daily, so a day and a bit is normal and two days is not.
  const stale = ageHours !== null && ageHours > 36;
  if (!empty && !stale) return null;

  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-2.5">
      {empty ? (
        <>
          <strong>Workstream positions and pay rates are unavailable.</strong> The stored
          roster is empty, so everyone shows their PAR job and shift rate and falls under
          &ldquo;Other&rdquo;. Hours and headcount below are unaffected — they come from PAR.
        </>
      ) : (
        <>
          <strong>Workstream roster is {Math.floor((ageHours ?? 0) / 24)} days old.</strong>{" "}
          Positions and pay rates may be out of date; recent hires and leavers will be missing.
        </>
      )}
    </div>
  );
}

function StoreCard({ store }: { store: StoreRoster }) {
  // Open on arrival, now that only the chosen store is drawn. It was collapsed
  // when all twelve were on the page and the roster was several screens to
  // scroll past; with one store, picking it from the dropdown *is* the request
  // to see it, and a closed bar under your own selection reads as broken.
  // Still collapsible, for reading the header figures without the names.
  const [open, setOpen] = useState(true);

  const grouped = new Map<string, typeof store.onClock>();
  for (const p of store.onClock) {
    const key = groupOf(p);
    const list = grouped.get(key) ?? [];
    list.push(p);
    grouped.set(key, list);
  }

  const sections = [
    ...JOB_GROUPS.map((g) => ({ key: g.key, label: g.label, people: grouped.get(g.key) ?? [] })),
    { key: "other", label: "Other", people: grouped.get("other") ?? [] },
  ].filter((s) => s.people.length > 0);

  const onBreak = store.onClock.filter((p) => p.onBreak).length;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-gray-50 transition"
      >
        <span className="text-sm font-semibold text-gray-900">{store.storeName}</span>
        <span className="text-xs text-gray-400">{store.state} · {store.localTime} local</span>
        {store.error ? (
          <span className="text-xs text-red-600">{store.error}</span>
        ) : (
          <>
            <span className="text-xs text-gray-500">
              {store.onClock.length} on the clock
              {onBreak > 0 && <span className="text-gray-400"> · {onBreak} on break</span>}
            </span>
            {sections.length > 0 && (
              <span className="text-xs text-gray-400">
                {sections.map((s, i) => (
                  <span key={s.key}>{i > 0 && " · "}{s.people.length} {s.label.toLowerCase()}</span>
                ))}
              </span>
            )}
            {store.hourlyWageRunRate !== null && (
              <span className="ml-auto text-xs tabular-nums text-gray-500">
                ${store.hourlyWageRunRate.toFixed(2)}/hr in wages
                {store.salariedOnClock > 0 && (
                  <span className="text-gray-400"> · {store.salariedOnClock} salaried</span>
                )}
              </span>
            )}
          </>
        )}
      </button>

      {open && !store.error && (
        store.onClock.length === 0 ? (
          <p className="px-3 py-4 text-sm text-gray-400 border-t border-gray-100">
            Nobody clocked in at this time.
          </p>
        ) : (
          <div className="border-t border-gray-100 p-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sections.map((section) => (
              <div key={section.key} className={`rounded-lg border ${GROUP_TONE[section.key] ?? GROUP_TONE.other}`}>
                <div className="px-2.5 py-1.5 flex items-baseline gap-2 border-b border-black/5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-700">{section.label}</span>
                  <span className="text-xs text-gray-500">{section.people.length}</span>
                </div>
                <ul className="divide-y divide-black/5">
                  {section.people.map((p, i) => (
                    <li key={`${p.employeeId ?? "?"}-${i}`} className="px-2.5 py-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{p.name}</span>
                        {p.onBreak && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700">break</span>
                        )}
                        {/* Workstream's rate of record — what this person is
                            paid — falling back to the shift's rate when they
                            are not linked yet. */}
                        <span className="ml-auto text-xs tabular-nums text-gray-600">
                          {rateOf(p) === null ? "salaried" : `$${rateOf(p)!.toFixed(2)}`}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {cleanJobTitle(titleOf(p)) ?? "no position recorded"}
                        {!p.workstream && (
                          <span className="text-gray-400"> · not linked to Workstream</span>
                        )}
                      </div>
                      {/* The job they clocked in as, when it differs from the job
                          they hold. A Shift Lead on a Cook shift is a Tuesday,
                          not an error — but it is worth being able to see. */}
                      {p.workstream?.position && p.job && p.job !== p.workstream.position && (
                        <div className="text-[11px] text-gray-400 truncate">clocked in as {cleanJobTitle(p.job)}</div>
                      )}
                      {/* Where the two rates disagree, say so rather than
                          reconcile them: one of the two records is wrong. */}
                      {p.workstream?.rateOfRecord != null
                        && p.payRate != null
                        && p.payRate > 0
                        && Math.abs(p.payRate - p.workstream.rateOfRecord) > 0.005 && (
                          <div className="text-[11px] text-amber-700 tabular-nums truncate">
                            PAR has ${p.payRate.toFixed(2)} for this shift
                          </div>
                        )}
                      <div className="text-[11px] text-gray-500 tabular-nums">
                        {p.startLabel}–{p.endLabel}
                        {p.isOpen && <span className="ml-1 text-green-600">on now</span>}
                      </div>
                      <div className="text-[11px] text-gray-400 tabular-nums">
                        {hrs(p.minutesElapsedAtQuery)} elapsed · {hrs(p.trailing7Minutes)} in 7d
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )
      )}
    </section>
  );
}
