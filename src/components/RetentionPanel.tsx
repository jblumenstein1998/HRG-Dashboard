"use client";

/**
 * Who is in a store's new-hire retention figure, under the Training Director's
 * Retention & Engagement category.
 *
 * Two jobs. It makes the number checkable — every name behind "5 of 8 stayed",
 * and every name left out and why — which is how the Training Directors vet a
 * figure that drives their pay. And it is where the people PAR could not
 * confirm get resolved: until each is marked as having worked or not, the
 * store's figure stays pending rather than guessed (workstreamRetention.ts).
 */

import { useEffect, useState } from "react";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import type { RetentionPerson, RetentionStatus, StoreRetention } from "@/lib/workstreamRetention";

const DAYS = [30, 60, 90] as const;

type Response = {
  store: StoreRetention | null;
  unattributed: Record<number, RetentionPerson[]>;
  error?: string;
};

const STATUS_TEXT: Record<RetentionStatus, string> = {
  worked: "Hire",
  never_worked: "Never worked",
  excluded: "Left out",
  unverified: "Needs review",
};

const STATUS_CLASS: Record<RetentionStatus, string> = {
  worked: "bg-gray-100 text-gray-700",
  never_worked: "bg-gray-50 text-gray-400",
  excluded: "bg-gray-50 text-gray-400",
  unverified: "bg-amber-100 text-amber-800",
};

function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

export default function RetentionPanel({
  period, storeId, locked, onRescored,
}: {
  period: string;
  storeId: string;
  locked: boolean;
  onRescored: () => void;
}) {
  const key = `${period}|${storeId}`;
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ key: string; data: Response | null; error: string | null }>(
    { key: "", data: null, error: null },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [day, setDay] = useState<(typeof DAYS)[number]>(30);
  const storeName = BONUS_STORES.find((s) => s.storeId === storeId)?.name ?? storeId;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/retention?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then(async (r) => {
        const json = (await r.json()) as Response;
        if (!r.ok) throw new Error(json.error ?? "Failed to load");
        return json;
      })
      .then((json) => { if (!cancelled) setState({ key: `${key}|${reload}`, data: json, error: null }); })
      .catch((err) => { if (!cancelled) setState({ key: `${key}|${reload}`, data: null, error: String(err?.message ?? err) }); });
    return () => { cancelled = true; };
  }, [key, reload, period, storeId]);

  const loading = state.key !== `${key}|${reload}`;

  const decide = async (person: RetentionPerson, outcome: "worked" | "never_worked" | "clear", assignStore: boolean) => {
    setBusy(person.workstreamUuid);
    try {
      const res = await fetch("/api/bonus/retention", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period,
          workstreamUuid: person.workstreamUuid,
          outcome,
          storeId: assignStore ? storeId : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      setReload((n) => n + 1);
      onRescored();
    } catch (err) {
      setState((s) => ({ ...s, error: String(err instanceof Error ? err.message : err) }));
    } finally {
      setBusy(null);
    }
  };

  const store = state.data?.store;
  const bucket = store?.byDay[day];
  const unattributed = state.data?.unattributed?.[day] ?? [];
  const reviewable = unattributed.filter((p) => p.status === "unverified" || p.reviewedBy);

  return (
    <div className="border-t border-gray-100 px-3 py-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-700">Who&apos;s counted</span>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          {DAYS.map((d) => {
            const b = store?.byDay[d];
            return (
              <button
                key={d}
                onClick={() => setDay(d)}
                className={`text-[11px] px-2 py-0.5 ${day === d ? "bg-gray-900 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}
              >
                {d}-day{b && b.unverified > 0 ? ` · ${b.unverified} to review` : ""}
              </button>
            );
          })}
        </div>
        {loading && <span className="text-[11px] text-gray-400 animate-pulse">Loading…</span>}
      </div>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      {store?.parUnavailable && (
        <p className="text-xs text-amber-700">
          PAR&apos;s employee list couldn&apos;t be read for {storeName}, so nobody here can be checked — the figure stays pending.
        </p>
      )}

      {bucket && (
        <p className="text-xs text-gray-600">
          {bucket.cohort === 0 && bucket.unverified === 0
            ? `Nobody reached day ${day} in this period.`
            : `${bucket.stayed} of ${bucket.cohort} hires stayed past day ${day}` +
              (bucket.percent !== null ? ` (${bucket.percent}%).` : ".") +
              (bucket.unverified > 0
                ? ` Pending until ${bucket.unverified} ${bucket.unverified === 1 ? "person is" : "people are"} reviewed.`
                : "")}
          <span className="text-gray-400">
            {" "}A hire is anyone who clocked a shift in PAR. Duplicate profiles and transfers are left out.
          </span>
        </p>
      )}

      {bucket && bucket.people.length > 0 && (
        <PeopleTable
          people={bucket.people}
          day={day}
          locked={locked}
          busy={busy}
          onDecide={(p, o) => decide(p, o, false)}
        />
      )}

      {reviewable.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] text-gray-500">
            No store in Workstream or PAR, so they count toward no store yet. If one worked at {storeName}, mark it here.
          </p>
          <PeopleTable
            people={reviewable}
            day={day}
            locked={locked}
            busy={busy}
            workedLabel={`Worked at ${storeName}`}
            onDecide={(p, o) => decide(p, o, o === "worked")}
          />
        </div>
      )}
    </div>
  );
}

function PeopleTable({
  people, day, locked, busy, workedLabel = "Worked", onDecide,
}: {
  people: RetentionPerson[];
  day: number;
  locked: boolean;
  busy: string | null;
  workedLabel?: string;
  onDecide: (person: RetentionPerson, outcome: "worked" | "never_worked" | "clear") => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th className="py-1 pr-2 font-semibold">Name</th>
            <th className="py-1 pr-2 font-semibold">Started</th>
            <th className="py-1 pr-2 font-semibold">Day {day}</th>
            <th className="py-1 pr-2 font-semibold">Counted as</th>
            <th className="py-1 pr-2 font-semibold">Outcome</th>
            <th className="py-1 font-semibold" />
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.workstreamUuid} className="border-b border-gray-50 align-top">
              <td className="py-1 pr-2 text-gray-800">
                {p.name}
                {p.suggestions.length > 0 && (
                  <div className="text-[10px] text-gray-400">PAR has: {p.suggestions.join(", ")}</div>
                )}
                {p.status === "excluded" && p.terminationNote && (
                  <div className="text-[10px] text-gray-400">“{p.terminationNote}”</div>
                )}
              </td>
              <td className="py-1 pr-2 tabular-nums text-gray-500">{shortDate(p.startedOn)}</td>
              <td className="py-1 pr-2 tabular-nums text-gray-500">{shortDate(p.anniversary)}</td>
              <td className="py-1 pr-2">
                <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[p.status]}`} title={p.reason}>
                  {STATUS_TEXT[p.status]}
                </span>
                {p.reviewedBy && <div className="text-[10px] text-gray-400">by {p.reviewedBy}</div>}
              </td>
              <td className="py-1 pr-2 text-gray-600">
                {p.status !== "worked" ? "—" : p.stayed ? "Stayed" : `Left ${shortDate(p.terminatedOn)}`}
              </td>
              <td className="py-1 text-right whitespace-nowrap">
                {!locked && p.status === "unverified" && (
                  <span className="inline-flex gap-1">
                    <button
                      disabled={busy !== null}
                      onClick={() => onDecide(p, "worked")}
                      className="text-[11px] px-2 py-0.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {workedLabel}
                    </button>
                    <button
                      disabled={busy !== null}
                      onClick={() => onDecide(p, "never_worked")}
                      className="text-[11px] px-2 py-0.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Never worked
                    </button>
                  </span>
                )}
                {!locked && p.reviewedBy && (
                  <button
                    disabled={busy !== null}
                    onClick={() => onDecide(p, "clear")}
                    className="text-[11px] text-gray-400 underline underline-offset-2 disabled:opacity-50"
                  >
                    Undo
                  </button>
                )}
                {busy === p.workstreamUuid && <span className="ml-1 text-[10px] text-gray-400">Saving…</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
