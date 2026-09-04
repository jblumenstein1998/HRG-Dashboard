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
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { CopyableTitle } from "@/components/CopyImageButton";
import type { Tab } from "@/lib/users/tabs";
import type {
  StaffingReport, StoreRoster, HoursReport, StoreHours, OpenCloseReport,
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

export default function StaffingClient({ tabs, isAdmin }: { tabs: Tab[]; isAdmin: boolean }) {
  const router = useRouter();

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

  const totalOn = data?.stores.reduce((n, s) => n + s.onClock.length, 0) ?? 0;
  const storesReporting = data?.stores.filter((s) => !s.error).length ?? 0;

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

        <div ref={cardRef} className="flex flex-wrap items-baseline gap-x-3">
          <CopyableTitle
            title={`On the clock — ${data ? new Date(data.at).toLocaleString() : when.replace("T", " ")}`}
            targetRef={cardRef}
            className="text-base font-semibold text-gray-900"
          />
          {loading && (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
              Reading PAR — first load of a new time takes a moment
            </span>
          )}
        </div>

        <div className={`space-y-3 transition-opacity ${loading ? "opacity-50" : "opacity-100"}`}>
          {(data?.stores ?? []).map((store) => <StoreCard key={store.storeId} store={store} />)}
          {!loading && data && data.stores.length === 0 && (
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-10 text-center text-sm text-gray-400">
              No stores configured.
            </div>
          )}
        </div>

        <OpenCloseSection />

        <HoursSection />

        <p className="text-[11px] text-gray-400">
          Times are each store&apos;s own — Tennessee is Central, Virginia Eastern. Position and
          break windows are PAR&apos;s own. <strong>Elapsed</strong> is time since clocking in and
          includes breaks; <strong>trailing 7d</strong> is PAR&apos;s paid minutes-worked, which
          excludes them, over the seven business dates before the one shown. Wages sum the hourly
          rates on the clock; salaried staff carry no rate in PAR and are counted separately rather
          than added as zero. In the weekly table the hours are PAR&apos;s own split of regular and
          overtime, and the dollars are those hours at the rate recorded on each shift — with
          overtime at <strong>1.5×</strong>, the one figure on this screen that is assumed rather
          than read, since PAR records the hours but never what it pays for them. All of it is
          gross pay, not a burdened cost, and salaried hours cost nothing in it.
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
function OpenCloseSection() {
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

  const data = state.data;

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
function HoursSection() {
  // "2" / "4" are weeks; "periods" is the last two pay periods.
  const [range, setRange] = useState<"2" | "4" | "periods">("4");
  const [expanded, setExpanded] = useState<string | null>(null);
  const sorter = useColumnSort("desc");
  const [state, setState] = useState<{ key: string; data: HoursReport | null; error: string | null }>(
    { key: "", data: null, error: null },
  );

  const query = range === "periods" ? "periods=2" : `weeks=${range}`;
  const requestKey = query;

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
  const data = state.data;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Hours</span>
        <span className="text-xs text-gray-400">
regular / overtime · hours then cost · completed spans only
        </span>
        <select
          value={range}
          onChange={(e) => { setRange(e.target.value as "2" | "4" | "periods"); setExpanded(null); }}
          className="ml-auto text-xs border border-gray-200 rounded-lg py-0.5 pl-2 pr-6 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
        >
          <option value="2">2 weeks</option>
          <option value="4">4 weeks</option>
          <option value="periods">Last 2 pay periods</option>
        </select>
        {loading && <span className="text-xs text-gray-400 animate-pulse">Loading…</span>}
      </div>

      {state.error && <p className="px-3 py-3 text-sm text-red-700">{state.error}</p>}

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
        {store.weeks.map((w) => (
          <td key={w.weekStart} className="px-3 py-1 text-right text-xs tabular-nums whitespace-nowrap">
            <span className="text-gray-700">{hrs(w.regularMinutes)}</span>{" "}
            <span className="text-gray-400">{usd(w.regularCost)}</span>
            <span className="text-gray-300"> / </span>
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
                        {meta.position && (
                          <span className="ml-2 text-[11px] text-gray-600">{meta.position}</span>
                        )}
                        {meta.rateOfRecord != null && (
                          <span className="ml-1.5 text-[11px] text-gray-400 tabular-nums">
                            ${meta.rateOfRecord.toFixed(2)}/hr
                          </span>
                        )}
                        {meta.job && meta.job !== meta.position && (
                          <span className="ml-2 text-[11px] text-gray-400">clocks in as {meta.job}</span>
                        )}
                      </td>
                      {store.weeks.map((w) => {
                        const row = w.people.find((p) => p.employeeId === id);
                        if (!row) return <td key={w.weekStart} className="px-2 py-1 text-right text-xs text-gray-300">—</td>;
                        return (
                          <td key={w.weekStart} className="px-2 py-1 text-right text-xs tabular-nums whitespace-nowrap">
                            <span className="text-gray-600">{hrs(row.regularMinutes)}</span>{" "}
                            <span className="text-gray-400">{usd(row.regularCost)}</span>
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
 * Which bucket a job title falls in.
 *
 * An explicit list of the titles PAR actually returns, not a pattern match over
 * the names — the last version of this screen inferred front/back of house from
 * the words in a title and was quietly wrong. A title that is not on this list
 * is not guessed at: it appears under "Other" with its real name, so a new or
 * renamed job shows up as something to look at rather than silently joining a
 * group it does not belong to.
 *
 * Provisional by agreement. Positions get their real definitions when payroll
 * is integrated, and this map goes away.
 */
const JOB_GROUPS: { key: string; label: string; titles: string[] }[] = [
  { key: "cooks", label: "Cooks", titles: ["Cook", "Catering Cook"] },
  { key: "cashiers", label: "Cashiers", titles: ["Cashier"] },
  {
    key: "managers",
    label: "Managers",
    titles: [
      "Salary - General Manager",
      "Salary - Assistant Manager",
      "Hourly - Assistant Manager",
      "SAL Mgr Asst Gen",
      "Shift Leader",
      "Salary - Catering Manager",
      "Hourly - Catering Manager",
      "Above Store",
    ],
  },
];

const GROUP_TONE: Record<string, string> = {
  cooks: "bg-amber-50 border-amber-200",
  cashiers: "bg-blue-50 border-blue-200",
  managers: "bg-purple-50 border-purple-200",
  other: "bg-gray-50 border-gray-200",
};

function groupOf(job: string | null): string {
  if (!job) return "other";
  return JOB_GROUPS.find((g) => g.titles.includes(job))?.key ?? "other";
}

function StoreCard({ store }: { store: StoreRoster }) {
  const [open, setOpen] = useState(true);

  const grouped = new Map<string, typeof store.onClock>();
  for (const p of store.onClock) {
    const key = groupOf(p.job);
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
                        <span className="ml-auto text-xs tabular-nums text-gray-600">
                          {p.payRate === null || p.payRate === 0 ? "salaried" : `$${p.payRate.toFixed(2)}`}
                        </span>
                      </div>
                      {/* The real title, always — the grouping above is provisional and
                          this is what PAR actually says. */}
                      <div className="text-[11px] text-gray-500 truncate">{p.job ?? "no position recorded"}</div>
                      {/* Workstream's half, only where the two records have been
                          joined. A rate that disagrees with what the shift was
                          costed at is worth seeing, so it is stated rather than
                          reconciled. */}
                      {p.workstream && (
                        <div className="text-[11px] text-gray-400 truncate">
                          {p.workstream.position ?? "no position in Workstream"}
                          {p.workstream.rateOfRecord != null && (
                            <span className="tabular-nums">
                              {" · "}${p.workstream.rateOfRecord.toFixed(2)} on file
                              {p.payRate != null
                                && p.payRate > 0
                                && Math.abs(p.payRate - p.workstream.rateOfRecord) > 0.005 && (
                                  <span className="text-amber-700"> ≠ shift rate</span>
                                )}
                            </span>
                          )}
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
