"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { PERIODS } from "@/lib/fiscal";

/**
 * Slack reporting, store by store — what the GM's Slack completion criterion
 * scores (/api/admin/slack-reports). On the admin tab so the classification can
 * be checked against the real channels and tuned before stores see the number.
 *
 * Read live from Slack on every load and never stored. The workspace keeps 90
 * days of history, so that is as far back as the range controls go.
 */

type SlotId = "previous_day" | "lunch" | "midday" | "dinner";
type Status = "on_time" | "late" | "missed" | "upcoming" | null;
type Post = { ts: string; date: string; time: string } | null;
type Range = { start: string; end: string };

type StoreRow = {
  storeId: string;
  name: string;
  timeZone: string | null;
  required: number;
  onTime: number;
  inGrace: number;
  late: number;
  missed: number;
  pct: number | null;
  error: string | null;
  days: { date: string; slots: Record<SlotId, { status: Status; post: Post; grace: boolean }> }[];
  messages:
    | {
        ts: string;
        date: string;
        time: string;
        user: string;
        text: string;
        files: number;
        placed: { date: string; slot: SlotId; onTime: boolean; inGrace: boolean; by: "content" | "time" } | null;
      }[]
    | null;
};

type Payload = {
  start: string;
  end: string;
  clampedFrom: string | null;
  historyStart: string;
  maxEnd: string;
  graceMinutes: number;
  slots: { id: SlotId; label: string; deadline: string }[];
  stores: StoreRow[];
};

const TARGET = 95;
const HISTORY_DAYS = 90;

const SLOT_SHORT: Record<SlotId, string> = {
  previous_day: "8:30a day",
  lunch: "2:30p",
  midday: "5:30p",
  dinner: "8:30p",
};

const STATUS_CELL: Record<Exclude<Status, null>, string> = {
  on_time: "bg-green-50 text-green-800",
  late: "bg-amber-50 text-amber-800",
  missed: "bg-red-50 text-red-700",
  upcoming: "text-gray-400",
};

// ── Dates ────────────────────────────────────────────────────────────────────

function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function shift(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toIso(new Date(y, m - 1, d + days));
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const day = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${Number(m)}/${Number(d)}`;
}

const today = () => toIso(new Date());
const yesterday = () => shift(today(), -1);
const oldest = () => shift(today(), -(HISTORY_DAYS - 1));

/** The fiscal period containing `iso`, or null outside the calendar. */
function periodOf(iso: string) {
  return PERIODS.find((p) => p.start <= iso && iso <= p.end) ?? null;
}

/** Period to date, through today — today's reports count once they're due. */
function ptd(): Range {
  const p = periodOf(today());
  return { start: p?.start ?? today(), end: today() };
}

/** The last complete Monday–Sunday week. */
function lastWeek(): Range {
  const t = new Date();
  const sinceMonday = (t.getDay() + 6) % 7;
  const thisMonday = toIso(new Date(t.getFullYear(), t.getMonth(), t.getDate() - sinceMonday));
  return { start: shift(thisMonday, -7), end: shift(thisMonday, -1) };
}

const QUICK: { key: string; label: string; range: () => Range }[] = [
  { key: "today", label: "Today", range: () => ({ start: today(), end: today() }) },
  { key: "yesterday", label: "Yesterday", range: () => ({ start: yesterday(), end: yesterday() }) },
  { key: "last_week", label: "Last Week", range: lastWeek },
  { key: "ptd", label: "PTD", range: ptd },
];

// ── Sorting ──────────────────────────────────────────────────────────────────

type SortKey = "name" | "required" | "onTime" | "late" | "missed" | "pct";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const COLUMNS: { key: SortKey; label: string; align: "left" | "right"; firstDir: "asc" | "desc" }[] = [
  { key: "name", label: "Store", align: "left", firstDir: "asc" },
  { key: "required", label: "Due", align: "right", firstDir: "desc" },
  { key: "onTime", label: "On time*", align: "right", firstDir: "desc" },
  { key: "late", label: "Late", align: "right", firstDir: "desc" },
  { key: "missed", label: "Missed", align: "right", firstDir: "desc" },
  { key: "pct", label: "Completion", align: "right", firstDir: "desc" },
];

/** A zero reads as a dash, so the counts that matter stand out. */
const count = (n: number) => (n === 0 ? "—" : n);

export default function AdminSlackReports() {
  const [data, setData] = useState<Payload | null>(null);
  const [quick, setQuick] = useState<string | null>("ptd");
  const [start, setStart] = useState(() => ptd().start);
  const [end, setEnd] = useState(() => ptd().end);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, StoreRow>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [reportsOnly, setReportsOnly] = useState(true);
  // Completion, best first, until someone clicks a column.
  const [sort, setSort] = useState<Sort>({ key: "pct", dir: "desc" });

  async function load(r: Range) {
    setLoading(true);
    setError("");
    setOpen(null);
    setDetail({});
    try {
      const res = await fetch(`/api/admin/slack-reports?start=${r.start}&end=${r.end}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      setData(j);
      setStart(j.start);
      setEnd(j.end);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Period to date on arrival — the window the scorecard is scoring right now.
  useEffect(() => {
    load(ptd());
  }, []);

  function apply(r: Range, key: string | null) {
    setQuick(key);
    setStart(r.start);
    setEnd(r.end);
    load(r);
  }

  async function toggle(storeId: string) {
    if (open === storeId) {
      setOpen(null);
      return;
    }
    setOpen(storeId);
    if (detail[storeId] || !data) return;
    setDetailLoading(storeId);
    try {
      const res = await fetch(`/api/admin/slack-reports?start=${data.start}&end=${data.end}&store=${storeId}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      setDetail((d) => ({ ...d, [storeId]: j.stores[0] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(null);
    }
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const ok = data.stores.filter((s) => !s.error);
    const failed = data.stores.filter((s) => s.error);
    const sign = sort.dir === "asc" ? 1 : -1;
    ok.sort((a, b) => {
      if (sort.key === "name") return sign * a.name.localeCompare(b.name);
      const av = a[sort.key] ?? -1;
      const bv = b[sort.key] ?? -1;
      return sign * (av - bv) || a.name.localeCompare(b.name);
    });
    // Unreadable stores have nothing to sort by; they wait at the bottom.
    return [...ok, ...failed];
  }, [data, sort]);

  const failing = data?.stores.filter((s) => s.error) ?? [];
  const graceTotal = data?.stores.reduce((n, s) => n + s.inGrace, 0) ?? 0;

  // Only periods that can be shown whole: finished, and starting inside
  // Slack's 90 days. The period in progress is what PTD is for.
  const periodOptions = PERIODS.filter((p) => p.start >= oldest() && p.end <= yesterday())
    .slice()
    .reverse();

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-start gap-x-4 gap-y-2">
        <div>
          <div className="text-sm font-semibold text-gray-800">Slack reporting</div>
          <div className="text-[11px] text-gray-400">
            GM bonus · reports posted by 8:30 AM, 2:30, 5:30 and 8:30 PM local ÷ reports due · closed days owe nothing
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
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
              if (p) apply({ start: p.start, end: p.end }, e.target.value);
            }}
            disabled={loading}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-300"
          >
            <option value="">Period…</option>
            {periodOptions.map((p) => (
              <option key={p.period} value={`p:${p.period}`}>
                P{p.period}
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
            {loading ? "Reading Slack…" : "Fetch"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{error}</div>
      )}
      {failing.length > 0 && (
        <div className="mx-4 mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
          Couldn&apos;t read {failing.length} channel{failing.length === 1 ? "" : "s"}:{" "}
          {[...new Set(failing.map((s) => s.error))].join("; ")}
        </div>
      )}

      {data && (
        <>
          <div className="px-4 pb-1 text-[11px] text-gray-400">
            {shortDate(data.start)} – {shortDate(data.end)}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  {COLUMNS.map((c, i) => {
                    const active = sort.key === c.key;
                    return (
                      <th
                        key={c.key}
                        className={`font-medium py-2 ${i === 0 ? "px-4" : i === COLUMNS.length - 1 ? "px-4" : "px-3"} text-${c.align}`}
                      >
                        <button
                          onClick={() =>
                            setSort((s) =>
                              s.key === c.key
                                ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
                                : { key: c.key, dir: c.firstDir },
                            )
                          }
                          className={`uppercase tracking-wide hover:text-gray-700 ${active ? "text-gray-700" : ""}`}
                        >
                          {c.label}
                          <span className="ml-0.5 inline-block w-2">{active ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <Fragment key={s.storeId}>
                    <tr
                      onClick={() => !s.error && toggle(s.storeId)}
                      className={`border-b border-gray-50 ${s.error ? "" : "cursor-pointer hover:bg-gray-50"}`}
                    >
                      <td className="px-4 py-2 text-gray-800">
                        <span className="text-gray-300 mr-1.5">{s.error ? "·" : open === s.storeId ? "▾" : "▸"}</span>
                        {s.name}
                      </td>
                      {s.error ? (
                        <td colSpan={5} className="px-4 py-2 text-xs text-gray-400 text-right">{s.error}</td>
                      ) : (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{count(s.required)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{count(s.onTime)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${s.late ? "text-amber-700" : "text-gray-300"}`}>
                            {count(s.late)}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${s.missed ? "text-red-600" : "text-gray-300"}`}>
                            {count(s.missed)}
                          </td>
                          <td
                            className={`px-4 py-2 text-right tabular-nums font-semibold ${
                              s.pct === null ? "text-gray-300" : s.pct >= TARGET ? "text-green-700" : "text-red-600"
                            }`}
                          >
                            {s.pct === null ? "—" : `${s.pct.toFixed(1)}%`}
                          </td>
                        </>
                      )}
                    </tr>
                    {open === s.storeId && (
                      <tr className="bg-gray-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <StoreDetail
                            row={detail[s.storeId] ?? s}
                            slots={data.slots}
                            loading={detailLoading === s.storeId}
                            reportsOnly={reportsOnly}
                            setReportsOnly={setReportsOnly}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2.5 border-t border-gray-100 text-[11px] text-gray-500 space-y-0.5">
            <p>
              * On time includes a {data.graceMinutes}-minute grace: a report posted up to {data.graceMinutes} minutes
              after its deadline counts as on time ({graceTotal} in this range, marked * in a store&apos;s days).
              Later than that counts as late, and late reports don&apos;t count toward completion.
            </p>
            {data.clampedFrom && (
              <p>
                Slack keeps {HISTORY_DAYS} days of history, so this starts at {shortDate(data.historyStart)} rather than{" "}
                {shortDate(data.clampedFrom)}.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StoreDetail({
  row, slots, loading, reportsOnly, setReportsOnly,
}: {
  row: StoreRow;
  slots: Payload["slots"];
  loading: boolean;
  reportsOnly: boolean;
  setReportsOnly: (v: boolean) => void;
}) {
  const messages = row.messages?.filter((m) => !reportsOnly || m.placed) ?? null;
  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
      <div>
        <div className="text-[11px] text-gray-400 mb-1">
          Each cell: when the report that filled it was posted ({row.timeZone?.replace("America/", "")} time) · * within
          grace
        </div>
        <table className="text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left font-medium pr-3 py-1">Day</th>
              {slots.map((sl) => (
                <th key={sl.id} className="font-medium px-1 py-1 text-center">{SLOT_SHORT[sl.id]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row.days.map((d) => (
              <tr key={d.date}>
                <td className="pr-3 py-0.5 text-gray-600 whitespace-nowrap">{shortDate(d.date)}</td>
                {slots.map((sl) => {
                  const cell = d.slots[sl.id];
                  const post = cell.post;
                  const late = post && post.date !== d.date ? `${shortDate(post.date)} ` : "";
                  return (
                    <td key={sl.id} className="px-0.5 py-0.5">
                      <div
                        className={`rounded px-1.5 py-0.5 text-center whitespace-nowrap min-w-16 ${
                          cell.status ? STATUS_CELL[cell.status] : "text-gray-300"
                        }`}
                      >
                        {cell.status === null
                          ? "closed"
                          : cell.status === "upcoming"
                            ? "not due"
                            : post
                            ? `${late}${post.time}${cell.grace ? "*" : ""}`
                            : "missed"}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <div className="text-[11px] text-gray-400">Messages in the channel, and how each was read</div>
          <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-500">
            <input type="checkbox" checked={reportsOnly} onChange={(e) => setReportsOnly(e.target.checked)} />
            reports only
          </label>
        </div>
        {loading && <div className="text-xs text-gray-400">Reading the channel…</div>}
        {messages && (
          <div className="max-h-[32rem] overflow-y-auto border border-gray-100 rounded-lg bg-white divide-y divide-gray-50">
            {messages.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">Nothing.</div>}
            {messages.map((m) => (
              <div key={m.ts} className="px-3 py-2 text-xs grid grid-cols-[7rem_1fr] gap-3">
                <div className="text-gray-500">
                  <div>{shortDate(m.date)} {m.time}</div>
                  <div className="truncate text-gray-400">{m.user}</div>
                  <div className="mt-1">
                    {m.placed ? (
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 ${
                          m.placed.onTime ? STATUS_CELL.on_time : STATUS_CELL.late
                        }`}
                        title={m.placed.by === "time" ? "Read from the posting time — the text didn't say" : "Read from the text"}
                      >
                        {SLOT_SHORT[m.placed.slot]} {shortDate(m.placed.date)}
                        {m.placed.inGrace && "*"}
                        {m.placed.by === "time" && " ⏱"}
                      </span>
                    ) : (
                      <span className="text-gray-300">not a report{m.files ? " (image)" : ""}</span>
                    )}
                  </div>
                </div>
                <div className="whitespace-pre-wrap break-words text-gray-700">
                  {m.text || <span className="text-gray-300">{m.files ? `${m.files} file(s), no text` : "(empty)"}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
