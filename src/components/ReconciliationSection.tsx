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
 * The queue is people still working — a PAR record with no recent hours is not
 * a task — but the **candidates** offered cover every Workstream status.
 * Linking to somebody who has left is how their past shifts keep the title and
 * rate they were worked at, and linking to somebody onboarding is how a new
 * hire resolves before their first shift. Every candidate carries its
 * Workstream status — Active, Onboarding, Offboarded — so the choice is always
 * made with the record's state in view.
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

type Action = "confirm" | "absent" | "reject" | "clear" | "name";

const money = (n: number | null | undefined) => (n == null ? "—" : `$${n.toFixed(2)}`);

/**
 * A stored "YYYY-MM-DD" as "Aug 4, 2025".
 *
 * The year is the point. These dates decide whether somebody is a new hire or
 * has been here a year, and the previous rendering dropped it — so a 2025 hire
 * and a 2026 one were indistinguishable on screen.
 *
 * Split rather than passed to `new Date`, which would read a bare date as UTC
 * midnight and show the day before to anybody west of Greenwich.
 */
function hiredOn(date: string | null | undefined): string | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Workstream's lifecycle state, in Workstream's own words.
 *
 * Every status is labelled, current employees included: now that all three can
 * be matched against, the absence of a chip would be a thing the reader has to
 * interpret rather than read. Saying "Active" costs a word and removes the
 * question.
 *
 * The wording is Workstream's — Active, Onboarding, Offboarded — so that what
 * this screen calls somebody is what the system of record calls them, and
 * nobody has to translate between the two while deciding whether two records
 * are one person.
 */
const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  onboarding: "Onboarding",
  offboarded: "Offboarded",
  hired: "Hired",
};

const STATUS_TONES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  onboarding: "bg-sky-50 text-sky-700 border-sky-200",
  offboarded: "bg-gray-100 text-gray-600 border-gray-200",
  hired: "bg-sky-50 text-sky-700 border-sky-200",
};

function StatusChip({ status }: { status?: string | null }) {
  if (!status) return null;
  // An unrecognised status is shown as Workstream spelled it rather than
  // hidden: a new lifecycle state should be visible, not silently dropped.
  const label = STATUS_LABELS[status] ?? status;
  const tone = STATUS_TONES[status] ?? "bg-gray-100 text-gray-600 border-gray-200";
  return (
    <span
      className={`ml-1.5 align-middle text-[10px] tracking-wide px-1.5 py-0.5 rounded border font-normal ${tone}`}
    >
      {label}
    </span>
  );
}

/** One hit from /api/workstream/search. */
type SearchHit = {
  uuid: string;
  name: string;
  goesBy: string | null;
  title: string | null;
  hourlyRate: number | null;
  hiredDate: string | null;
  storeId: string | null;
  storeName: string | null;
  status?: string | null;
};

export default function ReconciliationSection({
  stores,
  reloadKey,
}: {
  stores: BonusStore[];
  /** Bumped by the tab's Refresh button, after the roster has reloaded. */
  reloadKey: number;
}) {
  const [picked, setPicked] = useState(stores[0]?.storeId ?? "");

  /*
   * The chosen store, if the viewer may still see it.
   *
   * `picked` is seeded once and then belongs to the user, but the list it was
   * chosen from can change underneath it: narrowing the ribbon to an
   * above-store leader removes stores they do not run. Resolving this during
   * render rather than correcting the state in an effect keeps the component
   * pure and means there is never a frame showing a store out of scope.
   */
  const storeId = stores.some((s) => s.storeId === picked)
    ? picked
    : (stores[0]?.storeId ?? "");
  const setStoreId = setPicked;
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

  // Loads with the tab, and reloads when the store changes or Refresh is hit.
  useEffect(() => {
    if (storeId) void load(storeId);
  }, [storeId, load, reloadKey]);

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
  async function decide(
    parEmployeeId: string,
    action: Action,
    workstreamUuid?: string,
    nameSource?: "workstream" | "par",
  ) {
    setBusy(`${parEmployeeId}:${workstreamUuid ?? action}`);
    setError(null);
    try {
      const res = await fetch("/api/workstream/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId, parEmployeeId, action, workstreamUuid, nameSource }),
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
                <UnlinkedWorkstreamRow
                  key={c.workstreamUuid}
                  person={c}
                  proposals={proposals}
                  busy={busy != null}
                  onPick={(parEmployeeId) =>
                    decide(parEmployeeId, "confirm", c.workstreamUuid)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * A Workstream employee with no counterpart here, and a way to go find one.
 *
 * The mirror of the search on a PAR card, and needed for a different reason.
 * A PAR record reaches the review queue only if it has worked recently — which
 * is right, since a store's roster carries years of people who simply stopped
 * coming — but it means somebody hired last month whose PAR record has no hours
 * yet is invisible from the PAR side. They show up here instead, with no
 * candidates, and until now there was nothing to do about it.
 *
 * Five of Columbia's six unlinked people turned out to have an exact-name PAR
 * record sitting in the dormant pile. The names were already on the page; there
 * was just no way to reach them.
 *
 * Searches the proposals the store already loaded rather than asking the server,
 * so it costs nothing and answers as you type. Every PAR record at the store is
 * in there, dormant ones included — which is the whole point.
 */
function UnlinkedWorkstreamRow({
  person,
  proposals,
  busy,
  onPick,
}: {
  person: MatchCandidate;
  proposals: LinkProposal[];
  busy: boolean;
  onPick: (parEmployeeId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  // Seeded with the surname, which is the query somebody was about to type.
  const [q, setQ] = useState("");

  const surname = (person.name ?? "").trim().split(/\s+/).slice(-1)[0] ?? "";
  const term = (q || surname).trim().toLowerCase();
  const hits = term.length < 2
    ? []
    : proposals.filter((p) => p.parName.toLowerCase().includes(term)).slice(0, 12);

  return (
    <div className="px-3 py-1.5 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="font-medium text-gray-900">{person.name ?? "(no name)"}</span>
        <span className="text-gray-500">{person.title ?? "no position"}</span>
        <span className="text-gray-500 tabular-nums">{money(person.hourlyRate)}</span>
        <button
          onClick={() => { setOpen((v) => !v); setQ(""); }}
          className="text-xs text-gray-500 hover:text-gray-900 underline decoration-dotted underline-offset-2 transition"
        >
          {open ? "Cancel" : "Find in PAR"}
        </button>
        <span className="text-xs text-gray-400 ml-auto">
          {person.hiredDate ? `hired ${hiredOn(person.hiredDate)}` : ""}
        </span>
      </div>

      {open && (
        <div className="mt-1.5 mb-1">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search PAR names — starting with "${surname}"`}
            className="w-full text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200"
          />
          <ul className="mt-1.5 divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
            {hits.length === 0 && (
              <li className="px-3 py-2 text-xs text-gray-500">
                No PAR record at this store matches that.
              </li>
            )}
            {hits.map((p) => (
              <li key={p.parEmployeeId} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm text-gray-900">{p.parName}</span>
                <span className="text-xs text-gray-500">PAR #{p.parEmployeeId}</span>
                {/* The state is the warning. A dormant record is the expected
                    answer here; one already linked to somebody else is a
                    decision being overwritten, and that should be visible
                    before the click, not after. */}
                <span className="text-xs text-gray-500">
                  {p.state === "ignored"
                    ? "no recent hours"
                    : p.state === "review"
                      ? "awaiting review"
                      : p.state === "absent"
                        ? "marked as having no Workstream record"
                        : `already linked — confirming moves it`}
                </span>
                <button
                  onClick={() => onPick(p.parEmployeeId)}
                  disabled={busy}
                  className="ml-auto text-xs px-3 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50"
                >
                  This is them
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
  onDecide: (
    parEmployeeId: string,
    action: Action,
    workstreamUuid?: string,
    nameSource?: "workstream" | "par",
  ) => void;
}) {
  const linked = person.candidates.find((c) => c.workstreamUuid === person.workstreamUuid);
  const others = person.candidates.filter((c) => c.workstreamUuid !== person.workstreamUuid);

  /*
   * Whether the two records disagree about the name badly enough to ask.
   *
   * "Rob Vance" against "Robert Vance" is a spelling and not worth a control;
   * "Natasha Wilson" against "Noah Starke" is a name change, and then which
   * name the roster shows is a real decision with a real wrong answer. The
   * test is deliberately crude — share no word, so ask — because the cost of
   * offering the choice once too often is one extra control on a maintenance
   * screen, and the cost of not offering it is a shift leader reading a name
   * nobody at that store recognises.
   */
  const parWords = new Set(person.parName.toLowerCase().split(/\s+/).filter(Boolean));
  const wsWords = (linked?.name ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const namesDiffer =
    !!linked?.name && wsWords.length > 0 && !wsWords.some((w) => parWords.has(w));
  const showingPar = person.nameSource === "par";

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
        <div className="bg-green-50/40">
          <div className="px-3 py-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="text-gray-900 font-medium">
              {linked?.name ?? person.workstreamUuid}
            </span>
            <span className="text-gray-600">{linked?.title ?? ""}</span>
            <span className="text-gray-600 tabular-nums">{money(linked?.hourlyRate)}</span>
            {linked?.atOtherStore && (
              <span className="text-xs text-amber-700">assigned to {linked.atOtherStore}</span>
            )}
            <button
              onClick={() => onDecide(person.parEmployeeId, "clear")}
              disabled={busy != null}
              className="ml-auto text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-white text-gray-600 transition disabled:opacity-50"
            >
              {person.state === "auto" ? "Not them" : "Unlink"}
            </button>
          </div>

          {/* Two names for one person, and somebody has to say which one the
              staffing screens should use. Only shown when they genuinely
              differ, and only once the link is confirmed — an automatic match
              means the names already agreed. */}
          {namesDiffer && person.state === "confirmed" && (
            <div className="px-3 pb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-gray-500">Show as</span>
              <button
                onClick={() => onDecide(person.parEmployeeId, "name", undefined, "workstream")}
                disabled={busy != null}
                className={`px-2 py-1 rounded-md border transition disabled:opacity-50 ${
                  showingPar
                    ? "border-gray-200 text-gray-600 hover:bg-white"
                    : "bg-gray-900 text-white border-gray-900"
                }`}
              >
                {linked?.name}
              </button>
              <button
                onClick={() => onDecide(person.parEmployeeId, "name", undefined, "par")}
                disabled={busy != null}
                className={`px-2 py-1 rounded-md border transition disabled:opacity-50 ${
                  showingPar
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-200 text-gray-600 hover:bg-white"
                }`}
              >
                {person.parName}
              </button>
              <span className="text-gray-400">
                {showingPar ? "PAR's name" : "Workstream's name"}
              </span>
            </div>
          )}
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
        <div className="border-t border-gray-100">
          {/* Search the whole estate by hand.
              The scorer offers people whose names look alike, which is the
              right default and no help at all when somebody has changed their
              name — no measure of string distance will ever put Natasha Wilson
              and Noah Starke together. Only a person who knows can, so give
              them a search box rather than a dead end. */}
          <NameSearch
            parName={person.parName}
            disabled={busy != null}
            onPick={(uuid) => onDecide(person.parEmployeeId, "confirm", uuid)}
          />
          <div className="px-3 py-2 flex flex-wrap items-center gap-3">
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
        </div>
      )}
    </div>
  );
}

/**
 * Search Workstream by name and link whoever you find.
 *
 * The escape hatch from automatic matching. Everything else on this screen
 * works by comparing the two names, which fails completely for the one case
 * that most needs solving — a person whose name changed, whose two records now
 * look like two different people to anything that reads text.
 *
 * Estate-wide rather than store-scoped, and the store is shown on each hit
 * instead: a name change and a transfer often arrive together, and a search
 * that quietly hid the right answer would be worse than no search.
 */
function NameSearch({
  parName,
  disabled,
  onPick,
}: {
  parName: string;
  disabled: boolean;
  onPick: (uuid: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);

  // Debounced, because this runs on every keystroke. It reads the local copy
  // of the roster rather than the vendor, so the cost is a Postgres query and
  // not a slice of the 1,000-call daily budget — but a request per character
  // would still be a request per character.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/workstream/search?q=${encodeURIComponent(term)}`);
        const json = await res.json();
        if (!cancelled) setResults(res.ok ? (json.people ?? []) : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  if (!open) {
    return (
      <div className="px-3 pt-2">
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-gray-500 hover:text-gray-900 underline decoration-dotted underline-offset-2 transition"
        >
          Search Workstream by name…
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Who is ${parName} in Workstream?`}
          className="flex-1 text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-200"
        />
        <button
          onClick={() => { setOpen(false); setQ(""); }}
          className="text-xs px-2 py-1.5 text-gray-500 hover:text-gray-900 transition"
        >
          Cancel
        </button>
      </div>

      {q.trim().length >= 2 && (
        <ul className="mt-1.5 divide-y divide-gray-100 border border-gray-100 rounded-lg overflow-hidden">
          {results.length === 0 && (
            <li className="px-3 py-2 text-xs text-gray-500">
              {searching ? "Searching…" : "Nobody active in Workstream matches that."}
            </li>
          )}
          {results.map((r) => (
            <li key={r.uuid} className="px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-gray-900">{r.name}<StatusChip status={r.status} /></span>
              {r.goesBy && <span className="text-xs text-gray-500">goes by {r.goesBy}</span>}
              <span className="text-xs text-gray-500">
                {r.title ?? "no position"} · {money(r.hourlyRate)}
              </span>
              {/* The store is the thing to check before clicking: linking
                  across one is legitimate, and also how a wrong link happens. */}
              <span className="text-xs text-gray-500">{r.storeName ?? "no store"}</span>
              <button
                onClick={() => onPick(r.uuid)}
                disabled={disabled}
                className="ml-auto text-xs px-3 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-800 transition disabled:opacity-50"
              >
                This is them
              </button>
            </li>
          ))}
        </ul>
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
          {/* Every candidate says where it sits in Workstream's lifecycle.
              Linking to a leaver is legitimate — it is how past shifts keep the
              title and rate they were worked at — but it should never happen
              without the reviewer seeing it. */}
          <StatusChip status={candidate.status} />
        </div>
        <div className="text-xs text-gray-500">
          {candidate.title ?? "no position"} · {money(candidate.hourlyRate)}
          {candidate.hiredDate ? ` · hired ${hiredOn(candidate.hiredDate)}` : ""}
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
