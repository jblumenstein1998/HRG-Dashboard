"use client";

/**
 * Workstream / PAR Reconciliation — deciding which PAR employee is which
 * Workstream employee.
 *
 * It sits at the bottom of the Staffing tab rather than on a tab of its own,
 * because it is the maintenance behind that screen and not a destination: the
 * reason a card says "not linked to Workstream" is here, a few inches below the
 * card saying it.
 *
 * One store at a time, loaded with the tab. A store's queue costs a PAR roster,
 * a job list and a week of shifts, so all twelve at once would be a slow page
 * for a screen people mostly open to see who is on the clock — the store
 * selector is the filter, and every underlying fetch is cached.
 *
 * Only people **active in both systems** appear. Leavers on either side are not
 * a task: their shifts are in the past, and no title or rate attached to them
 * now would change a number anybody reads.
 *
 * Three answers per person, and the last two matter most:
 *
 *   Confirm               yes, that's them
 *   Not a match           no — and remember it, so it stops being offered
 *   No Workstream record   they aren't in Workstream at all, stop asking
 *
 * Without those, the queue never empties and people stop opening it.
 */

import { useCallback, useEffect, useState } from "react";
import type { BonusStore } from "@/lib/bonus/storeMap";
import type { LinkProposal, MatchCandidate } from "@/lib/workstreamLink";
import type { StoreLinkView } from "@/lib/workstreamRoster";

type Action = "confirm" | "absent" | "reject" | "clear";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

export default function ReconciliationSection({ stores }: { stores: BonusStore[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.storeId ?? "");
  const [view, setView] = useState<StoreLinkView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Open on arrival, and the data loads either way — collapsing hides the
  // queue, it does not stop it being read. Somebody who has already worked
  // their store today wants it out of the way without losing the count in the
  // header telling them whether that is still true.
  const [open, setOpen] = useState(true);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workstream/links?store=${id}`);
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error ?? res.status));
      setView(json.stores?.[0] ?? null);
    } catch (err) {
      setView(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Loads with the tab, and reloads when the store changes.
  useEffect(() => {
    if (storeId) void load(storeId);
  }, [storeId, load]);

  /**
   * Re-read Workstream now, rather than waiting for tomorrow's sync.
   *
   * Worth a button because the moment you want it is right after fixing
   * something in Workstream — terminating a record that was superseded, say —
   * and until the next sync the screen keeps showing yesterday's answer and
   * looks like it is ignoring you. Takes about 35 seconds.
   */
  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      // A real re-read of the vendor into Postgres, so by the time it returns
      // the change is already stored and one reload shows it.
      const res = await fetch("/api/workstream/refresh", { method: "POST" });
      if (!res.ok) throw new Error(String((await res.json()).error ?? res.status));
      await load(storeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * Record one decision.
   *
   * The response carries the store's whole recalculated view, so this never
   * patches its own copy — confirming one person changes what is offered to
   * another, since a Workstream record can only be claimed once, and a local
   * edit would leave a stale candidate the next answer contradicts.
   */
  async function decide(parEmployeeId: string, action: Action, workstreamUuid?: string) {
    setBusy(`${parEmployeeId}:${workstreamUuid ?? action}`);
    setError(null);
    try {
      const res = await fetch("/api/workstream/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, parEmployeeId, action, workstreamUuid }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(String(json.error ?? res.status));
      setView(json.store ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const proposals = view?.proposals ?? [];
  const needsReview = proposals.filter((p) => p.state === "review");
  const settled = proposals.filter(
    (p) => p.state === "auto" || p.state === "confirmed" || p.state === "absent",
  );
  const cov = view?.coverage;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div
        className={`px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2 ${
          open ? "border-b border-gray-100" : ""
        }`}
      >
        {/* The title toggles, rather than the whole header — the store picker
            and the buttons live up here too, and a header that swallowed those
            clicks would collapse the section every time you changed store. */}
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 hover:text-gray-600 transition"
        >
          <svg
            className={`w-3 h-3 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
          Workstream / PAR Reconciliation
        </button>

        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          aria-label="Store"
          className="text-sm border border-gray-200 rounded-lg px-2.5 py-1 bg-white cursor-pointer"
        >
          {stores.map((s) => (
            <option key={s.storeId} value={s.storeId}>
              {s.name}
            </option>
          ))}
        </select>

        {cov && !view?.error && (
          <span className="text-xs text-gray-600 tabular-nums">
            {cov.linked} linked · {cov.review} to review · {cov.absent} not in Workstream
            <span className="text-gray-400"> of {cov.total} active</span>
            {cov.ignored > 0 && (
              <span className="text-gray-400"> · {cov.ignored} left the company, skipped</span>
            )}
          </span>
        )}

        {loading && <span className="text-xs text-gray-500">Loading…</span>}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={refresh}
            disabled={refreshing || loading}
            title="Re-read Workstream now instead of waiting for tomorrow's sync (about 35 seconds)"
            className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
          >
            {refreshing ? "Re-reading Workstream…" : "Refresh from Workstream"}
          </button>
          {settled.length > 0 && (
            <button
              onClick={() => setShowSettled((v) => !v)}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              {showSettled ? "Hide settled" : `Show settled (${settled.length})`}
            </button>
          )}
        </div>
      </div>

      <div className={`p-3 space-y-3 bg-gray-50 ${open ? "" : "hidden"}`}>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {view?.error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-3 py-2">
            {view.error}
          </div>
        )}

        {!view?.error && !loading && needsReview.length === 0 && (
          <p className="text-sm text-gray-600 px-1 py-4">
            Nothing to review at {view?.storeName ?? "this store"}. New hires appear here on
            their own once both systems know about them.
          </p>
        )}

        {needsReview.map((p) => (
          <PersonCard key={p.parEmployeeId} person={p} busy={busy} onDecide={decide} />
        ))}

        {showSettled && settled.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Settled</h3>
            {settled.map((p) => (
              <PersonCard key={p.parEmployeeId} person={p} busy={busy} onDecide={decide} />
            ))}
          </div>
        )}

        {(view?.unlinkedWorkstream.length ?? 0) > 0 && (
          <div className="space-y-2 pt-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              In Workstream, not linked to anyone at this store
            </h3>
            {/* Current employees only. Usually a new hire PAR has not been told
                about; one that sits here for weeks while a PAR employee sits in
                the queue is the pair somebody should look at. */}
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {view!.unlinkedWorkstream.map((c) => (
                <div
                  key={c.workstreamUuid}
                  className="px-3 py-1.5 flex flex-wrap items-baseline gap-x-3 text-sm"
                >
                  <span className="font-medium text-gray-900">{c.name ?? "(no name)"}</span>
                  <span className="text-gray-500">{c.title ?? "no position"}</span>
                  <span className="text-gray-500 tabular-nums">{money(c.hourlyRate)}</span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {c.hiredDate ? `hired ${c.hiredDate}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** The badge in the corner of a card: what the app currently believes. */
function StateBadge({ state }: { state: LinkProposal["state"] }) {
  const styles: Record<LinkProposal["state"], string> = {
    auto: "bg-blue-50 text-blue-700 border-blue-200",
    confirmed: "bg-green-50 text-green-700 border-green-200",
    absent: "bg-gray-100 text-gray-600 border-gray-200",
    ignored: "bg-gray-100 text-gray-500 border-gray-200",
    review: "bg-amber-50 text-amber-800 border-amber-200",
  };
  const labels: Record<LinkProposal["state"], string> = {
    auto: "matched on name",
    confirmed: "confirmed",
    absent: "not in Workstream",
    ignored: "left the company",
    review: "needs review",
  };
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${styles[state]}`}>
      {labels[state]}
    </span>
  );
}

function PersonCard({
  person,
  busy,
  onDecide,
}: {
  person: LinkProposal;
  busy: string | null;
  onDecide: (parEmployeeId: string, action: Action, workstreamUuid?: string) => void;
}) {
  const linked = person.candidates.find((c) => c.workstreamUuid === person.workstreamUuid);
  const others = person.candidates.filter((c) => c.workstreamUuid !== person.workstreamUuid);

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{person.parName}</span>
        <span className="text-xs text-gray-500">PAR #{person.parEmployeeId}</span>
        {person.parJob && <span className="text-sm text-gray-600">{person.parJob}</span>}
        {person.parPayRate != null && person.parPayRate > 0 && (
          <span className="text-sm text-gray-600 tabular-nums">
            {money(person.parPayRate)}/hr in PAR
          </span>
        )}
        <span className="ml-auto">
          <StateBadge state={person.state} />
        </span>
      </div>

      {(person.state === "auto" || person.state === "confirmed") && (
        <div className="px-3 py-2 bg-green-50/40 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-900 font-medium">
            {linked?.name ?? person.workstreamUuid}
          </span>
          <span className="text-gray-600">{linked?.title ?? ""}</span>
          <span className="text-gray-600 tabular-nums">{money(linked?.hourlyRate)}</span>
          <button
            onClick={() => onDecide(person.parEmployeeId, "clear")}
            disabled={busy != null}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-white text-gray-600 transition disabled:opacity-50"
          >
            {person.state === "auto" ? "Not them" : "Unlink"}
          </button>
        </div>
      )}

      {person.state === "absent" && (
        <div className="px-3 py-2 flex items-center gap-3 text-sm text-gray-600">
          Recorded as having no Workstream record.
          <button
            onClick={() => onDecide(person.parEmployeeId, "clear")}
            disabled={busy != null}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
          >
            Reconsider
          </button>
        </div>
      )}

      {others.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {others.map((c) => (
            <Candidate
              key={c.workstreamUuid}
              candidate={c}
              busy={busy === `${person.parEmployeeId}:${c.workstreamUuid}`}
              disabled={busy != null}
              onConfirm={() => onDecide(person.parEmployeeId, "confirm", c.workstreamUuid)}
              onReject={() => onDecide(person.parEmployeeId, "reject", c.workstreamUuid)}
            />
          ))}
        </ul>
      )}

      {person.state === "review" && (
        <div className="px-3 py-2 border-t border-gray-100 flex flex-wrap items-center gap-3">
          {person.candidates.length === 0 && (
            <span className="text-sm text-gray-600">
              No current Workstream employee at this store resembles this name.
            </span>
          )}
          <button
            onClick={() => onDecide(person.parEmployeeId, "absent")}
            disabled={busy != null}
            className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
          >
            No Workstream record
          </button>
        </div>
      )}
    </div>
  );
}

function Candidate({
  candidate,
  busy,
  disabled,
  onConfirm,
  onReject,
}: {
  candidate: MatchCandidate;
  busy: boolean;
  disabled: boolean;
  onConfirm: () => void;
  onReject: () => void;
}) {
  return (
    <li className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-[12rem]">
        <div className="text-sm font-medium text-gray-900">
          {candidate.name ?? "(no name)"}
          {candidate.goesBy && (
            <span className="ml-1.5 font-normal text-gray-500">goes by {candidate.goesBy}</span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          {candidate.title ?? "no position"} · {money(candidate.hourlyRate)}
          {candidate.hiredDate ? ` · hired ${candidate.hiredDate}` : ""}
        </div>
      </div>

      {/* The reasons, not the score. A reviewer can argue with "pay rates
          differ"; they cannot argue with 74. */}
      <ul className="text-xs text-gray-600 flex-1 min-w-[14rem] space-y-0.5">
        {candidate.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>

      <div className="flex items-center gap-2 ml-auto">
        <button
          onClick={onConfirm}
          disabled={disabled}
          className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50"
        >
          {busy ? "Saving…" : "Confirm"}
        </button>
        <button
          onClick={onReject}
          disabled={disabled}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
        >
          Not a match
        </button>
      </div>
    </li>
  );
}
