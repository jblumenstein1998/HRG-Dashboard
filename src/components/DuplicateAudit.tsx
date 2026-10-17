"use client";

/**
 * HR Cleanup — people who exist more than once in either system, plus any PAR
 * number nobody has used in 30 days.
 *
 * Organised by severity rather than by store or by name, because the shape of
 * the data demands it: 564 clusters, of which six are costing somebody hours
 * today. An alphabetical list puts those six somewhere in the middle.
 *
 * So the two urgent tiers are open on arrival and the two long ones are
 * collapsed counts, and the fix happens here: a cluster that has exactly one
 * Workstream person can be linked in a click.
 *
 * What cannot be fixed here is deactivating a PAR number, which only a GM can
 * do — hence the printable report, addressed to whoever the ribbon is filtered
 * to, so the list reaches the person who can act on it.
 *
 * See lib/workstreamAudit.ts for how a cluster is built and why hours are the
 * evidence on the row.
 */

import { useCallback, useEffect, useState } from "react";
import type { BonusStore } from "@/lib/bonus/storeMap";
import {
  auditToReportHtml,
  auditWindowStart,
  countBySeverity,
  scopeRow,
  type AuditParRecord,
  type AuditReport,
  type AuditRow,
  type AuditSeverity,
} from "@/lib/workstreamAuditFormat";
import { auditToXlsx } from "@/lib/workstreamAuditExcel";

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
    blurb: "One number in use, with unused numbers alongside it — at the same store or another. Terminate the unused ones.",
    tone: "text-gray-700",
  },
  dormant: {
    title: "No recent hours",
    blurb: "No PAR number for this person has worked in 30 days, duplicate or not. Usually somebody who left; terminate in PAR.",
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

export default function DuplicateAudit({
  stores,
  scopeLabel,
  reloadKey,
}: {
  stores: BonusStore[];
  /** What the ribbon is filtered to — "Tommy Demorest", "VA", or null. */
  scopeLabel: string | null;
  /** Bumped by the tab's Refresh button, after the roster has reloaded. */
  reloadKey: number;
}) {
  const [storeId, setStoreId] = useState("");
  const [data, setData] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<AuditSeverity>>(new Set(OPEN_BY_DEFAULT));
  const [busy, setBusy] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
  // Which Refresh the data in hand answers. Marked at the start of a load, so a
  // failed one is not retried in a loop.
  const [loadedFor, setLoadedFor] = useState<number | null>(null);

  const load = useCallback(async (forKey: number) => {
    setLoadedFor(forKey);
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
  // filter over rows already in hand, not a new question. Refresh does ask a
  // new one; while closed it waits, and reloads when next opened.
  useEffect(() => {
    if (open && loadedFor !== reloadKey) void load(reloadKey);
  }, [open, loadedFor, reloadKey, load]);

  /*
   * Two filters, and the outer one is not optional.
   *
   * The ribbon's above-store leader decides which stores exist as far as this
   * viewer is concerned, so "All stores" has to mean all of *theirs*. The
   * endpoint always returns the estate — it is one read for everybody and
   * cheaper to narrow here — which made "All stores" quietly show twelve
   * stores to somebody who runs four.
   *
   * The picker's own selection is checked against the same set rather than
   * trusted, because it survives a change of leader: pick a store, narrow the
   * ribbon to somebody who does not run it, and without this the section would
   * keep showing it.
   */
  const allowed = new Set(stores.map((s) => s.storeId));
  /*
   * Narrowed record by record, not person by person.
   *
   * A person is a name across the whole estate, and keeping them whenever any
   * one record was in scope showed a leader every record that name holds
   * anywhere — other stores' dead numbers, and namesakes merged in by name —
   * so "No recent hours" barely moved with the filter. scopeRow keeps only the
   * records at these stores and re-decides the group from those alone.
   */
  const scope = allowed.has(storeId) ? new Set([storeId]) : allowed;
  const windowStart = data ? auditWindowStart(data.today) : "";
  const rows = (data?.rows ?? [])
    .map((r) => scopeRow(r, scope, windowStart))
    .filter((r): r is AuditRow => r !== null);
  const counts = countBySeverity(rows);

  /**
   * Link one PAR record to the cluster's Workstream person.
   *
   * The cluster already knows who they are — that is the point of grouping by
   * person — so this is the one-click version of what the reconciliation queue
   * asks three questions to reach.
   *
   * The store comes off the record rather than the row: a link is keyed by
   * (store, employee id), and one person's records may sit at three stores.
   */
  async function link(record: AuditParRecord, workstreamUuid: string) {
    setBusy(`${record.storeId}:${record.employeeId}`);
    setError(null);
    try {
      const res = await fetch("/api/workstream/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: record.storeId,
          parEmployeeId: record.employeeId,
          action: "confirm",
          workstreamUuid,
          note: "linked from the duplicate audit",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error ?? res.status));
      await load(reloadKey);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const urgent = counts["splitting-hours"] + counts["duplicate-workstream"];

  /*
   * The name on the report, and the filename the browser will offer.
   *
   * Taken from the ribbon so the report is addressed to whoever the screen is
   * currently about: narrow to an above-store leader and it becomes their
   * report, naming only their stores.
   */
  const storeName = stores.find((st) => st.storeId === storeId)?.name ?? null;
  const fileName = `HR Cleanup - ${scopeLabel ?? storeName ?? "All stores"} - ${data?.today ?? ""}`;

  /*
   * Everything a download is built from, in one place.
   *
   * The PDF and the Excel are one report in two formats, so they take the same
   * object — same title, same scope line, same rows — and decide nothing for
   * themselves. Who is listed is settled downstream by reportPeople, which both
   * also share.
   */
  const report = data
    ? {
        title: fileName,
        scope: scopeLabel
          ? `${scopeLabel} — ${stores.map((st) => st.name).join(", ")}`
          : (storeName ?? "All stores"),
        today: data.today,
        rows,
      }
    : null;

  /** The report as a workbook, under the same filename as the PDF. */
  async function downloadExcel() {
    if (!report) return;
    setExporting(true);
    try {
      const blob = await auditToXlsx(report);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  /**
   * Hand the browser a printable copy of the report.
   *
   * An offscreen iframe rather than a new window: a popup is blocked by
   * default and would make the button look broken.
   *
   * The filename comes from the *top* page's title, not the frame's — Chrome
   * names a saved PDF after the main document even when an iframe is what is
   * printed. So the title is swapped for the length of the dialog and put back
   * afterwards. Dashes rather than slashes in the date, since a slash cannot
   * appear in a filename.
   */
  function printReport() {
    if (!report) return;
    const html = auditToReportHtml(report);

    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
    frame.srcdoc = html;
    frame.onload = () => {
      const pageTitle = document.title;
      document.title = fileName;
      // afterprint fires when the dialog closes, saved or cancelled — whether
      // or not print() itself blocked until then.
      frame.contentWindow?.addEventListener(
        "afterprint",
        () => { document.title = pageTitle; },
        { once: true },
      );
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      // Left in place briefly: removing it during the dialog cancels the job
      // in some browsers.
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  }

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
          HR Cleanup
        </button>

        {open && (
          <select
            // Falls back to "All stores" when the chosen one has dropped out of
            // scope, so the control agrees with what is on screen.
            value={allowed.has(storeId) ? storeId : ""}
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
                {rows.length} {rows.length === 1 ? "person" : "people"}
              </>
            ) : (
              <>{rows.length} {rows.length === 1 ? "person" : "people"}, none urgent</>
            )}
          </span>
        )}
        {loading && <span className="text-xs text-gray-400">reading every store…</span>}

        {open && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={downloadExcel}
              disabled={!data || rows.length === 0 || exporting}
              title={`${fileName}.xlsx`}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              {exporting ? "Building…" : "Download Excel"}
            </button>
            <button
              onClick={printReport}
              disabled={!data || rows.length === 0}
              title={`${fileName}.pdf`}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
            >
              Download PDF
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="px-4 py-3 space-y-4">
          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {data && rows.length === 0 && !loading && (
            <p className="text-sm text-gray-500">Nothing to clean up at this store.</p>
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
                        onLink={link}
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
  onLink: (record: AuditParRecord, workstreamUuid: string) => void;
}) {
  // One Workstream person in the cluster means linking is unambiguous, so the
  // button can act directly. Two means somebody has to choose first, and
  // offering a one-click link would be offering a coin toss.
  const target = row.workstream.length === 1 ? row.workstream[0] : null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-gray-50/60 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{row.name}</span>
        <span className="text-xs text-gray-500">{row.storeNames.join(" · ")}</span>
        <span className="text-xs text-gray-500">
          PAR ×{row.par.length} · Workstream ×{row.workstream.length}
        </span>
        <span className="ml-auto text-xs tabular-nums text-gray-600">
          {row.par.filter((p) => p.recentMinutes > 0).map((p) => hrs(p.recentMinutes)).join(" + ") || "no recent hours"}
        </span>
      </div>

      <ul className="divide-y divide-gray-100">
        {row.par.map((p) => (
          <li key={`${p.storeId}:${p.employeeId}`} className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-gray-500 text-xs w-12">PAR</span>
            <span className="tabular-nums text-gray-900">#{p.employeeId}</span>
            {/* The store is on every record now that a cluster spans them, and
                it is the field that says whether two numbers are a duplicate or
                one person working two restaurants. */}
            <span className="text-xs text-gray-600">{p.storeName}</span>
            <span className="text-xs text-gray-500">{p.job ?? "no job"}</span>
            <span className="text-xs tabular-nums text-gray-600">
              {hrs(p.recentMinutes)} · last {shortDate(p.lastWorked)}
            </span>
            {p.workstreamUuid ? (
              <span className="text-xs text-green-700">linked</span>
            ) : target ? (
              <button
                onClick={() => onLink(p, target.uuid)}
                disabled={busy != null}
                className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50"
              >
                {busy === `${p.storeId}:${p.employeeId}` ? "Linking…" : `Link to ${target.name}`}
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
            <span className="text-xs text-gray-500">{w.storeName ?? "no store assigned"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
