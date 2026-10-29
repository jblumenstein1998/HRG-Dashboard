"use client";

import { Fragment, useState } from "react";

/**
 * Slack reporting, store by store — what the GM's Slack completion criterion
 * scores (/api/admin/slack-reports). On the admin tab so the classification can
 * be checked against the real channels and tuned before stores see the number.
 *
 * Loaded on demand: every load reads thirteen Slack channels live.
 */

type SlotId = "previous_day" | "lunch" | "midday" | "dinner";
type Status = "on_time" | "late" | "missed" | null;
type Post = { ts: string; date: string; time: string } | null;

type StoreRow = {
  storeId: string;
  name: string;
  timeZone: string | null;
  required: number;
  onTime: number;
  late: number;
  missed: number;
  pct: number | null;
  error: string | null;
  days: { date: string; slots: Record<SlotId, { status: Status; post: Post }> }[];
  messages:
    | {
        ts: string;
        date: string;
        time: string;
        user: string;
        text: string;
        files: number;
        placed: { date: string; slot: SlotId; onTime: boolean; by: "content" | "time" } | null;
      }[]
    | null;
};

type Payload = {
  period: string;
  periods: string[];
  start: string;
  end: string;
  slots: { id: SlotId; label: string; deadline: string }[];
  stores: StoreRow[];
};

const TARGET = 95;

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
};

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  const day = new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${Number(m)}/${Number(d)}`;
}

export default function AdminSlackReports() {
  const [data, setData] = useState<Payload | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, StoreRow>>({});
  const [detailLoading, setDetailLoading] = useState<string | null>(null);
  const [reportsOnly, setReportsOnly] = useState(true);

  async function load(p: string) {
    setLoading(true);
    setError("");
    setOpen(null);
    setDetail({});
    try {
      const res = await fetch(`/api/admin/slack-reports${p ? `?period=${encodeURIComponent(p)}` : ""}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      setData(j);
      setPeriod(j.period);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
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
      const res = await fetch(
        `/api/admin/slack-reports?period=${encodeURIComponent(data.period)}&store=${storeId}`,
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Load failed");
      setDetail((d) => ({ ...d, [storeId]: j.stores[0] }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDetailLoading(null);
    }
  }

  const failing = data?.stores.filter((s) => s.error) ?? [];

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex flex-wrap items-center gap-2">
        <div>
          <div className="text-sm font-semibold text-gray-800">Slack reporting</div>
          <div className="text-[11px] text-gray-400">
            GM bonus · reports posted by 8:30 AM, 2:30, 5:30 and 8:30 PM local ÷ reports due · late
            posts don&apos;t count · closed days owe nothing
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {data && (
            <select
              value={period}
              onChange={(e) => load(e.target.value)}
              disabled={loading}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
            >
              {data.periods.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => load(period)}
            disabled={loading}
            className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
          >
            {loading ? "Reading Slack…" : data ? "Reload" : "Load"}
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
            {data.period} · {shortDate(data.start)} – {shortDate(data.end)} · click a store for its days and messages
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="text-left font-medium px-4 py-2">Store</th>
                  <th className="text-right font-medium px-3 py-2">Due</th>
                  <th className="text-right font-medium px-3 py-2">On time</th>
                  <th className="text-right font-medium px-3 py-2">Late</th>
                  <th className="text-right font-medium px-3 py-2">Missed</th>
                  <th className="text-right font-medium px-4 py-2">Completion</th>
                </tr>
              </thead>
              <tbody>
                {data.stores.map((s) => (
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
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.required}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{s.onTime}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-amber-700">{s.late || ""}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-600">{s.missed || ""}</td>
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
          Each cell: when the report that filled it was posted ({row.timeZone?.replace("America/", "")} time)
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
                        {cell.status === null ? "closed" : post ? `${late}${post.time}` : "missed"}
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
