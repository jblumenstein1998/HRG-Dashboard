"use client";

/**
 * Workstream Links — deciding which PAR employee is which Workstream employee.
 *
 * The screen exists because the two systems share no identifier, so somebody
 * has to say. It is built to be worked through rather than admired: one store
 * at a time, the undecided people first, each with the evidence that made the
 * app suggest a candidate written out in words next to it.
 *
 * Three answers per person, and the third one matters most:
 *
 *   Confirm             yes, that's them
 *   Not a match         no — and remember that, so it stops being offered
 *   No Workstream record  they aren't in Workstream at all, stop asking
 *
 * Without the second and third, the queue never empties and people stop opening
 * it, which is the failure mode this whole design is trying to avoid.
 *
 * Loaded per store on demand rather than all twelve up front: each store costs
 * a PAR roster, a job list and a week of shifts, and nobody reviews twelve
 * stores at once.
 */

import { useCallback, useEffect, useState } from "react";
import TabPicker from "@/components/TabPicker";
import type { Tab } from "@/lib/users/tabs";
import type { BonusStore } from "@/lib/bonus/storeMap";
import type { LinkProposal, MatchCandidate } from "@/lib/workstreamLink";
import type { StoreLinkView } from "@/lib/workstreamRoster";

type Action = "confirm" | "absent" | "reject" | "clear";

const money = (n: number | null | undefined) =>
  n == null ? "—" : `$${n.toFixed(2)}`;

export default function WorkstreamLinksClient({
  tabs,
  stores,
}: {
  tabs: Tab[];
  stores: BonusStore[];
}) {
  const [storeId, setStoreId] = useState(stores[0]?.storeId ?? "");
  const [view, setView] = useState<StoreLinkView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Confirmed and auto-linked people are hidden by default. They are most of
  // the roster and none of the work.
  const [showLinked, setShowLinked] = useState(false);

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

  useEffect(() => {
    if (storeId) void load(storeId);
  }, [storeId, load]);

  /**
   * Record one decision.
   *
   * The response carries the store's whole recalculated view, so the screen
   * never patches its own copy — confirming one person can change what is
   * offered to another (a Workstream record can only be claimed once), and a
   * local edit would show a stale candidate list that the next answer then
   * contradicts.
   */
  async function decide(
    parEmployeeId: string,
    action: Action,
    workstreamUuid?: string,
  ) {
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
  const settled = proposals.filter((p) => p.state !== "review");
  const cov = view?.coverage;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="sticky top-0 z-20">
        <header className="bg-white border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/hrglogo.png" alt="HRG" className="h-9 w-auto" />
            <TabPicker tabs={tabs} current="/admin/workstream-links" isAdmin />
            <form action="/api/auth/logout" method="post" className="ml-auto">
              <button
                onClick={async (e) => {
                  e.preventDefault();
                  await fetch("/api/auth/logout", { method: "POST" });
                  window.location.href = "/login";
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
              >
                Log out
              </button>
            </form>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center gap-3">
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              aria-label="Store"
              className="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer"
            >
              {stores.map((s) => (
                <option key={s.storeId} value={s.storeId}>
                  {s.name} ({s.storeId})
                </option>
              ))}
            </select>

            {cov && !view?.error && (
              <span className="text-xs text-gray-600 tabular-nums">
                {cov.linked} linked · {cov.review} to review · {cov.absent} not in Workstream
                <span className="text-gray-400"> of {cov.total} PAR employees</span>
              </span>
            )}

            {loading && <span className="text-xs text-gray-500">Loading…</span>}

            <button
              onClick={() => setShowLinked((v) => !v)}
              className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition"
            >
              {showLinked ? "Hide settled" : `Show settled (${settled.length})`}
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-5 space-y-5">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {view?.error && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-3">
            {view.error}
          </div>
        )}

        {!view?.error && !loading && needsReview.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-6 text-sm text-gray-600">
            Nothing to review at {view?.storeName ?? "this store"}. New hires will appear
            here on their own once both systems know about them.
          </div>
        )}

        {needsReview.map((p) => (
          <PersonCard
            key={p.parEmployeeId}
            person={p}
            busy={busy}
            onDecide={decide}
          />
        ))}

        {showLinked && settled.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Settled</h2>
            {settled.map((p) => (
              <PersonCard
                key={p.parEmployeeId}
                person={p}
                busy={busy}
                onDecide={decide}
              />
            ))}
          </section>
        )}

        {(view?.unlinkedWorkstream.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-gray-900">
              In Workstream, not linked to anyone at this store
            </h2>
            {/* Usually a new hire PAR hasn't been told about, or someone who
                never clocks in. One that sits here for weeks while a PAR
                employee sits in the queue is the pair somebody should look at. */}
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
              {view!.unlinkedWorkstream.map((c) => (
                <div key={c.workstreamUuid} className="px-4 py-2 flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium text-gray-900">{c.name ?? "(no name)"}</span>
                  <span className="text-gray-500">{c.title ?? "no position"}</span>
                  <span className="text-gray-500 tabular-nums">{money(c.hourlyRate)}</span>
                  <span className="text-xs text-gray-400 ml-auto">
                    {c.terminationDate ? `left ${c.terminationDate}` : c.hiredDate ? `hired ${c.hiredDate}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

/** The badge in the corner of a card: what the app currently believes and why. */
function StateBadge({ state }: { state: LinkProposal["state"] }) {
  const styles: Record<LinkProposal["state"], string> = {
    auto: "bg-blue-50 text-blue-700 border-blue-200",
    confirmed: "bg-green-50 text-green-700 border-green-200",
    absent: "bg-gray-100 text-gray-600 border-gray-200",
    review: "bg-amber-50 text-amber-800 border-amber-200",
  };
  const labels: Record<LinkProposal["state"], string> = {
    auto: "matched on name",
    confirmed: "confirmed",
    absent: "not in Workstream",
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
    <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-gray-100">
        <span className="font-semibold text-gray-900">{person.parName}</span>
        <span className="text-xs text-gray-500">PAR #{person.parEmployeeId}</span>
        {person.parJob && <span className="text-sm text-gray-600">{person.parJob}</span>}
        {person.parPayRate != null && person.parPayRate > 0 && (
          <span className="text-sm text-gray-600 tabular-nums">{money(person.parPayRate)}/hr in PAR</span>
        )}
        {person.parTerminated && (
          <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200">
            terminated
          </span>
        )}
        <span className="ml-auto">
          <StateBadge state={person.state} />
        </span>
      </div>

      {/* Whatever is linked now sits at the top, with the way to undo it. */}
      {(person.state === "auto" || person.state === "confirmed") && (
        <div className="px-4 py-3 bg-green-50/40 flex flex-wrap items-center gap-3 text-sm">
          <span className="text-gray-900 font-medium">{linked?.name ?? person.workstreamUuid}</span>
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
        <div className="px-4 py-3 flex items-center gap-3 text-sm text-gray-600">
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
        <div className="px-4 py-3 border-t border-gray-100 flex flex-wrap items-center gap-3">
          {person.candidates.length === 0 && (
            <span className="text-sm text-gray-600">
              No Workstream employee at this store resembles this name.
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
    </section>
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
    <li className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
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
          {candidate.terminationDate ? ` · left ${candidate.terminationDate}` : ""}
        </div>
      </div>

      {/* The reasons, not the score. A reviewer can argue with "pay rates
          differ"; they can't argue with 74. */}
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
