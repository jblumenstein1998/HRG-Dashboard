"use client";

/**
 * Duplicate audit — people who exist more than once, in either system.
 *
 * Organised by severity rather than by store or by name, because the shape of
 * the data demands it: 564 clusters, of which six are costing somebody hours
 * today. An alphabetical list puts those six somewhere in the middle.
 *
 * So the two urgent tiers are open on arrival and the two long ones are
 * collapsed counts, and the fix happens here: a cluster that has exactly one
 * Workstream person can be linked in a click.
 *
 * See lib/workstreamAudit.ts for how a cluster is built and why hours are the
 * evidence on the row.
 */

import { useCallback, useEffect, useState } from "react";
import type { BonusStore } from "@/lib/bonus/storeMap";
import {
  countBySeverity,
  type AuditReport,
  type AuditRow,
  type AuditSeverity,
} from "@/lib/workstreamAuditFormat";

const SEVERITIES: AuditSeverity[] = [
  "splitting-hours",
  "duplicate-workstream",
  "stray-copies",
  "dormant",
];

const HEADINGS: Record<AuditSeverity, { title: string; blurb: string; tone: string }> = {
  "splitting-hours": {
    title: "Splitting hours",
    blurb: "Two clock numbers both in use. Hours and overtime are being divided between them.",
    tone: "text-red-700",
  },
  "duplicate-workstream": {
    title: "Duplicate Workstream profile",
    blurb: "Two live Workstream records for one person, so nothing can link automatically.",
    tone: "text-amber-700",
  },
  "stray-copies": {
    title: "Stray PAR copies",
    blurb: "One number in use, with unused duplicates alongside it. Nothing is broken.",
    tone: "text-gray-700",
  },
  dormant: {
    title: "Dormant duplicates",
    blurb: "No recent hours on any copy. Housekeeping.",
    tone: "text-gray-500",
  },
};

/** Tiers that are worth seeing without being asked for. */
const OPEN_BY_DEFAULT: AuditSeverity[] = ["splitting-hours", "duplicate-workstream"];

const hrs = (minutes: number) => `${(minutes / 60).toFixed(1)}h`;

function shortDate(iso: string | null): string {
  if (!iso) return "never";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DuplicateAudit({ stores }: { stores: BonusStore[] }) {
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<AuditSeverity>>(new Set(OPEN_BY_DEFAULT));
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Read the whole estate, once.
   *
   * Deliberately never per store. The audit is built by reading every store's
   * roster and a month of shifts no matter what is asked for, so a request for
   * one store costs exactly as much as a request for twelve — measured at 7.8s
   * either way, to return 14KB instead of 368KB. Narrowing afterwards is the
   * server throwing away work it had already done, and the viewer waiting for
   * it to happen again.
   */
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workstream/audit");
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error ?? res.status));
      setData(json);
    } catch (err) {
      setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Only loads once opened, and not again when the store changes — that is a
  // filter over rows already in hand, not a new question.
  useEffect(() => {
    if (open && !data) void load();
  }, [open, data, load]);

  // The store picker is pure presentation: every row is already here.
  const rows = storeId ? (data?.rows ?? []).filter((r) => r.storeId === storeId) : (data?.rows ?? []);
  const counts = countBySeverity(rows);

  /**
   * Link one PAR record to the cluster's Workstream person.
   *
   * The cluster already knows who they are — that is the point of grouping by
   * person — so this is the one-click version of what the reconciliation queue
   * asks three questions to reach.
   */
  async function link(row: AuditRow, parEmployeeId: string, workstreamUuid: string) {
    setBusy(`${row.key}:${parEmployeeId}`);
    setError(null);
    try {
      const res = await fetch("/api/workstream/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: row.storeId,
          parEmployeeId,
          action: "confirm",
          workstreamUuid,
          note: "linked from the duplicate audit",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error ?? res.status));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const urgent = counts["splitting-hours"] + counts["duplicate-workstream"];

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${open ? "border-b border-gray-100" : ""}`}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-gray-600 transition"
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Duplicate audit
        </button>

        {open && (
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200"
          >
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.storeId} value={s.storeId}>{s.name}</option>
            ))}
          </select>
        )}

        {data && !loading && (
          <span className="text-xs text-gray-500">
            {urgent > 0 ? (
              <>
                <strong className="text-red-700">{urgent}</strong> needing attention of{" "}
                {rows.length} duplicates
              </>
            ) : (
              <>{rows.length} duplicates, none urgent</>
            )}
          </span>
        )}
        {loading && <span className="text-xs text-gray-400">reading every store…</span>}

      </div>

      {open && (
        <div className="px-4 py-3 space-y-4">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {data && rows.length === 0 && !loading && (
            <p className="text-sm text-gray-500">No duplicates at this store.</p>
          )}

          {data && SEVERITIES.map((sev) => {
            const tierRows = rows.filter((r) => r.severity === sev);
            if (tierRows.length === 0) return null;
            const isOpen = expanded.has(sev);
            const head = HEADINGS[sev];
            return (
              <div key={sev}>
                <button
                  onClick={() =>
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has(sev)) next.delete(sev); else next.add(sev);
                      return next;
                    })
                  }
                  className="w-full flex items-baseline gap-2 text-left group"
                >
                  <span className={`text-xs font-semibold uppercase tracking-wide ${head.tone}`}>
                    {head.title}
                  </span>
                  <span className="text-xs text-gray-400">{tierRows.length}</span>
                  <span className="text-xs text-gray-400 group-hover:text-gray-600 ml-auto">
                    {isOpen ? "hide" : "show"}
                  </span>
                </button>
                <p className="text-xs text-gray-500 mt-0.5 mb-1.5">{head.blurb}</p>

                {isOpen && (
                  <div className="space-y-2">
                    {tierRows.map((row) => (
                      <AuditCard
                        key={row.key}
                        row={row}
                        busy={busy}
                        onLink={(parId, uuid) => link(row, parId, uuid)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function AuditCard({
  row,
  busy,
  onLink,
}: {
  row: AuditRow;
  busy: string | null;
  onLink: (parEmployeeId: string, workstreamUuid: string) => void;
}) {
  // One Workstream person in the cluster means linking is unambiguous, so the
  // button can act directly. Two means somebody has to choose first, and
  // offering a one-click link would be offering a coin toss.
  const target = row.workstream.length === 1 ? row.workstream[0] : null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-gray-50/60 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{row.name}</span>
        <span className="text-xs text-gray-500">{row.storeName}</span>
        <span className="text-xs text-gray-500">
          PAR ×{row.par.length} · Workstream ×{row.workstream.length}
        </span>
        <span className="ml-auto text-xs tabular-nums text-gray-600">
          {row.par.filter((p) => p.recentMinutes > 0).map((p) => hrs(p.recentMinutes)).join(" + ") || "no recent hours"}
        </span>
      </div>

      <ul className="divide-y divide-gray-100">
        {row.par.map((p) => (
          <li key={p.employeeId} className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500 text-xs w-12">PAR</span>
            <span className="tabular-nums text-gray-900">#{p.employeeId}</span>
            <span className="text-xs text-gray-500">{p.job ?? "no job"}</span>
            <span className="text-xs tabular-nums text-gray-600">
              {hrs(p.recentMinutes)} · last {shortDate(p.lastWorked)}
            </span>
            {p.workstreamUuid ? (
              <span className="text-xs text-green-700">linked</span>
            ) : target ? (
              <button
                onClick={() => onLink(p.employeeId, target.uuid)}
                disabled={busy != null}
                className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50"
              >
                {busy === `${row.key}:${p.employeeId}` ? "Linking…" : `Link to ${target.name}`}
              </button>
            ) : (
              <span className="text-xs text-gray-400">not linked</span>
            )}
          </li>
        ))}

        {row.workstream.map((w) => (
          <li key={w.uuid} className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500 text-xs w-12">WS</span>
            <span className="text-gray-900">{w.name}</span>
            <span className="text-xs text-gray-500">{w.title ?? "no position"}</span>
            <span className="text-xs text-gray-500">
              {w.storeName ?? "no store assigned"}
              {w.elsewhere && w.storeName ? " (another store)" : ""}
            </span>
          </li>
        ))}
      </ul>

      {/* What to do about it, in a sentence. The row above states the problem;
          somebody still has to be told which number to keep, and leaving that
          as an inference from two hours figures is how the wrong one gets
          retired. */}
      <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50/60 border-t border-gray-100">
        {row.recommendedAction}
      </div>
    </div>
  );
}
