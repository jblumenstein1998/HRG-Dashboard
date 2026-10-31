"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TabOptions from "@/components/TabOptions";
import { PERIODS } from "@/lib/fiscal";
import { StoreFilterPicker, useStoreFilter, inFilter, type Leader } from "@/components/StoreFilter";
import type { Tab } from "@/lib/users/tabs";

/**
 * Leaders, and what went wrong while they were on the clock — see
 * lib/management.ts for how each count is attributed.
 *
 * Rows are filtered by each person's Workstream home store, so a DO or DM
 * sees their own stores' leaders, counted everywhere those leaders worked.
 * People with no home store (above-store) only show under All stores.
 */

type Row = {
  uuid: string;
  name: string;
  position: string;
  storeId: string | null;
  storeName: string | null;
  hourlyRate: number | null;
  annualSalary: number | null;
  caveat: "unmatched" | "noShifts" | null;
  zcases: number;
  slowLane: number;
  slowWindow: number;
  joltProtein: number;
  joltTimeTemp: number;
  slackMissedLate: number;
  slackAccuracyPct: number | null;
  slackFigures: number;
};

type Report = {
  start: string;
  end: string;
  slackFrom: string | null;
  clampedFrom: string | null;
  rows: Row[];
  warnings: string[];
  error?: string;
};

// ── Ranges: the Admin tab's Slack-report controls, the same choices and bounds ─

type Range = { start: string; end: string };

/** Slack keeps 90 days, so no range starts earlier than that. */
const HISTORY_DAYS = 90;

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIso(new Date(y, m - 1, d + days));
}
const today = () => toIso(new Date());
const yesterday = () => shift(today(), -1);
const oldest = () => shift(today(), -(HISTORY_DAYS - 1));

function ptd(): Range {
  const p = PERIODS.find((q) => q.start <= today() && today() <= q.end);
  return { start: p?.start ?? today(), end: today() };
}
function lastWeek(): Range {
  const t = new Date();
  const thisMonday = toIso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7)));
  return { start: shift(thisMonday, -7), end: shift(thisMonday, -1) };
}

const QUICK: { key: string; label: string; range: () => Range }[] = [
  { key: "today", label: "Today", range: () => ({ start: today(), end: today() }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ start: yesterday(), end: yesterday() }) },
  { key: "last_week", label: "Last Week", range: lastWeek },
  { key: "ptd", label: "PTD", range: ptd },
];

type ColKey =
  | "name" | "position" | "store" | "pay"
  | "zcases" | "slowLane" | "slowWindow" | "joltProtein" | "joltTimeTemp" | "slackMissedLate" | "slackAccuracyPct";

const COUNT_COLS: { key: ColKey; label: string; title: string }[] = [
  { key: "zcases", label: "zCases", title: "zCases whose guest visit fell during their shift" },
  {
    key: "slowLane",
    label: "Total time > 1 min over goal",
    title: "Dayparts where total lane time was more than 1:00 over the 100% goal (3:40 at ≤ $85k/week, 4:00 above)",
  },
  {
    key: "slowWindow",
    label: "Window > 30s over goal",
    title: "Dayparts where window time was more than 0:30 over the 100% goal (1:10 at ≤ $45k/week, 0:57 above)",
  },
  { key: "joltProtein", label: "Jolt Protein", title: "Protein Traceability lists missed or late, while the list was open" },
  { key: "joltTimeTemp", label: "Jolt Time Temp", title: "Time/Temperature lists missed or late, while the list was open" },
  { key: "slackMissedLate", label: "Slack missed / late", title: "Slack reports missed or late, on the clock at the deadline" },
  { key: "slackAccuracyPct", label: "Slack % accuracy", title: "Figures accurate ÷ figures posted, on reports due while on the clock" },
];

const POSITION_RANK: Record<string, number> = { "General Manager": 0, AGM: 1, Director: 2 };

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function pay(r: Row): string {
  if (r.annualSalary) return `$${Math.round(r.annualSalary).toLocaleString()}/yr`;
  if (r.hourlyRate) return `$${r.hourlyRate.toFixed(2)}/hr`;
  return "—";
}

export default function ManagementClient({ tabs, isAdmin, leaders }: { tabs: Tab[]; isAdmin: boolean; leaders: Leader[] }) {
  const router = useRouter();
  const storeFilter = useStoreFilter(leaders);
  const [quick, setQuick] = useState<string | null>("last_week");
  const [start, setStart] = useState(() => lastWeek().start);
  const [end, setEnd] = useState(() => lastWeek().end);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" }>({ key: "position", dir: "asc" });
  // Only the newest request may land, so a slow range can't overwrite a quick one.
  const latest = useRef(0);

  async function load(r: Range) {
    const id = ++latest.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/management?start=${r.start}&end=${r.end}`);
      const body = (await res.json()) as Report;
      if (id !== latest.current) return;
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setStart(body.start);
      setEnd(body.end);
    } catch (e) {
      if (id === latest.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
  }

  // Last Week on arrival: a whole week is the usual question here.
  useEffect(() => {
    load(lastWeek());
  }, []);

  function apply(r: Range, key: string | null) {
    setQuick(key);
    setStart(r.start);
    setEnd(r.end);
    load(r);
  }

  // Periods starting inside Slack's 90 days, the one in progress as "to date".
  const periodOptions = PERIODS.filter((p) => p.start >= oldest() && p.start <= today()).slice().reverse();

  const rows = useMemo(() => {
    const visible = (data?.rows ?? []).filter((r) =>
      storeFilter.allowed ? r.storeName !== null && inFilter(storeFilter.allowed, r.storeName) : true,
    );
    const value = (r: Row): string | number | null => {
      switch (sort.key) {
        case "name": return r.name.toLowerCase();
        case "position": return POSITION_RANK[r.position] ?? 9;
        case "store": return r.storeName?.toLowerCase() ?? null;
        case "pay": return r.annualSalary ?? (r.hourlyRate !== null ? r.hourlyRate * 2080 : null);
        default: return r[sort.key];
      }
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...visible].sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === vb) return (a.storeName ?? "~").localeCompare(b.storeName ?? "~") || a.name.localeCompare(b.name);
      if (va === null) return 1; // blanks last either way
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * dir;
    });
  }, [data, storeFilter.allowed, sort]);

  // The count headers wrap, in a column about as wide as its numbers, so the
  // whole table fits without scrolling sideways; the person columns don't.
  const th = (key: ColKey, label: string, title?: string, align: "left" | "right" = "right", wrap = false) => (
    <th
      key={key}
      title={title}
      onClick={() =>
        setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: align === "left" ? "asc" : "desc" }))
      }
      className={`px-3 py-2 font-medium cursor-pointer select-none hover:text-gray-800 align-bottom leading-tight ${
        wrap ? "w-24 min-w-[5.5rem]" : "whitespace-nowrap"
      } ${align === "right" ? "text-right" : "text-left"}`}
    >
      {label}
      {sort.key === key && <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "▲" : "▼"}</span>}
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-3 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <div className="flex flex-col">
              <div className="relative w-fit">
                <select
                  value="/management"
                  onChange={(e) => router.push(e.target.value)}
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
                {data ? `${fmtDate(data.start)} – ${fmtDate(data.end)}` : " "}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <StoreFilterPicker
              leaders={leaders}
              value={storeFilter.value}
              onChange={storeFilter.setValue}
              className="py-1.5"
              stores
            />
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              {QUICK.map((b) => (
                <button
                  key={b.key}
                  onClick={() => apply(b.range(), b.key)}
                  disabled={loading}
                  className={`text-xs px-3 py-1.5 transition disabled:opacity-50 ${
                    quick === b.key ? "bg-red-700 text-white font-medium" : "bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            <select
              value={quick?.startsWith("p:") ? quick : ""}
              onChange={(e) => {
                const p = PERIODS.find((q) => `p:${q.period}` === e.target.value);
                if (p) apply({ start: p.start, end: p.end < today() ? p.end : today() }, e.target.value);
              }}
              disabled={loading}
              className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-300"
            >
              <option value="">Period…</option>
              {periodOptions.map((p) => (
                <option key={p.period} value={`p:${p.period}`}>
                  P{p.period}
                  {p.end > yesterday() && " (to date)"}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1">
              <input
                type="date"
                value={start}
                min={oldest()}
                max={end}
                onChange={(e) => {
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
                max={today()}
                onChange={(e) => {
                  setEnd(e.target.value);
                  setQuick(null);
                }}
                className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 text-gray-700 focus:outline-none focus:ring-2 focus:ring-red-300"
              />
            </div>

            <button
              onClick={() => apply({ start, end }, quick)}
              disabled={loading}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition"
            >
              {loading ? "Reading…" : "Fetch"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col gap-3">
        <p className="text-xs text-gray-500">
          Leadership and Directors from Workstream. Each count is the events at any store while that person was on the
          PAR clock — the same people the team-on-duty buttons show. Today counts against PAR&apos;s live clock.
          {data?.clampedFrom && (
            <span className="text-amber-700"> Slack only keeps 90 days, so the range starts {fmtDate(data.start)}.</span>
          )}
        </p>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {data && data.warnings.length > 0 && (
          <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <summary className="cursor-pointer">Some sources couldn&apos;t be read fully — their columns may read low</summary>
            <ul className="mt-1 list-disc pl-5">
              {data.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        )}

        <section className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-gray-500 border-b border-gray-100">
                {th("name", "Name", undefined, "left")}
                {th("position", "Position", undefined, "left")}
                {th("store", "Store", undefined, "left")}
                {th("pay", "Pay")}
                {COUNT_COLS.map((c) => th(c.key, c.label, c.title, "right", true))}
              </tr>
            </thead>
            <tbody className={loading ? "opacity-50" : ""}>
              {loading && !data && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400 animate-pulse">
                    Reading zCases, drive-thru, Jolt and Slack for every store — the first look at a range can take a minute…
                  </td>
                </tr>
              )}
              {data && rows.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-500">
                    No leaders for this selection.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.uuid} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                  <td className="px-3 py-1.5 font-medium text-gray-900 whitespace-nowrap">
                    {r.name}
                    {/* Zeros only mean a clean record if they were there to count. */}
                    {r.caveat && (
                      <span
                        className="ml-2 text-[10px] font-normal text-gray-400"
                        title={
                          r.caveat === "unmatched"
                            ? "Not linked to a PAR employee, so nothing can be counted for them — check Staffing's reconciliation"
                            : "No PAR shifts in this range"
                        }
                      >
                        {r.caveat === "unmatched" ? "not matched to PAR" : "no shifts in range"}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.position}</td>
                  <td className="px-3 py-1.5 text-gray-600 whitespace-nowrap">{r.storeName ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right text-gray-600 tabular-nums whitespace-nowrap">{pay(r)}</td>
                  {COUNT_COLS.map((c) => {
                    if (c.key === "slackAccuracyPct") {
                      return (
                        <td key={c.key} className="px-3 py-1.5 text-right tabular-nums text-gray-700" title={`${r.slackFigures} figures`}>
                          {r.slackAccuracyPct === null ? "—" : `${r.slackAccuracyPct.toFixed(1)}%`}
                        </td>
                      );
                    }
                    const v = r[c.key as Exclude<ColKey, "name" | "position" | "store" | "pay" | "slackAccuracyPct">];
                    return (
                      <td key={c.key} className={`px-3 py-1.5 text-right tabular-nums ${v > 0 ? "text-gray-900 font-medium" : "text-gray-300"}`}>
                        {v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        {loading && data && <p className="text-xs text-gray-400 animate-pulse">Updating…</p>}
      </main>
    </div>
  );
}
