"use client";

/**
 * The people on a store's scorecard — GM, AGM and the four Directors.
 *
 * Each position is a free-text field with this store's Workstream staff of the
 * matching title offered as suggestions — never another store's, so a store
 * short a Director simply has nothing to suggest there. Workstream calls all four
 * Directors "Director", so for those this card is where they are told apart,
 * and it lists the store's Directors nobody has been given a position yet.
 *
 * Names carry forward from the last period that set them (see
 * lib/bonus/assignments.ts) and are marked with where they came from. Saving
 * writes the whole team to the period on screen.
 */

import { useEffect, useMemo, useState } from "react";
import { POSITION_LABELS, type PositionId } from "@/lib/bonus/types";

const TEAM_ORDER: PositionId[] = ["gm", "agm", "hospitality", "driveThru", "quality", "training"];

type ManagerTitle = "General Manager" | "AGM" | "Director";

/** Mirrors TITLE_FOR_POSITION in lib/bonus/assignments.ts, which reads the db and can't be imported here. */
const TITLE_FOR_POSITION: Record<PositionId, ManagerTitle> = {
  gm: "General Manager",
  agm: "AGM",
  driveThru: "Director",
  quality: "Director",
  training: "Director",
  hospitality: "Director",
};

export type Assignment = {
  positionId: PositionId;
  name: string;
  workstreamUuid: string | null;
  fromPeriod: string;
};

type Candidate = {
  workstreamUuid: string;
  name: string;
  title: ManagerTitle;
  storeId: string | null;
  storeName: string | null;
};

type Field = { name: string; workstreamUuid: string | null };

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export default function BonusTeamCard({
  period, storeId, storeName, payLocked, onAssignments,
}: {
  period: string;
  storeId: string;
  storeName: string;
  payLocked: boolean;
  /** The saved team, for the position headers further down the page. */
  onAssignments: (byPosition: Map<PositionId, Assignment>) => void;
}) {
  const key = `${period}|${storeId}`;
  const [loaded, setLoaded] = useState<{ key: string; assignments: Assignment[]; candidates: Candidate[] }>(
    { key: "", assignments: [], candidates: [] }
  );
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Partial<Record<PositionId, Field>>>({});
  const [saving, setSaving] = useState(false);
  const loading = loaded.key !== key;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/assignments?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        return json as { assignments: Assignment[]; candidates: Candidate[] };
      })
      .then((json) => {
        if (cancelled) return;
        setLoaded({ key, assignments: json.assignments, candidates: json.candidates });
        setEdits({});
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoaded({ key, assignments: [], candidates: [] });
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [key, period, storeId]);

  const saved = useMemo(
    () => new Map(loaded.assignments.map((a) => [a.positionId, a])),
    [loaded.assignments]
  );
  useEffect(() => { onAssignments(saved); }, [saved, onAssignments]);

  const field = (id: PositionId): Field =>
    edits[id] ?? { name: saved.get(id)?.name ?? "", workstreamUuid: saved.get(id)?.workstreamUuid ?? null };

  // Suggestions per title, from this store's people only (the API sends no
  // one else). A Director already in another slot sinks below the ones still
  // to be placed.
  const taken = new Set(TEAM_ORDER.map((id) => norm(field(id).name)).filter(Boolean));
  const rank = (c: Candidate) => (taken.has(norm(c.name)) ? 1 : 0);
  const suggestions = new Map<ManagerTitle, Candidate[]>(
    (["General Manager", "AGM", "Director"] as ManagerTitle[]).map((t) => [
      t,
      loaded.candidates.filter((c) => c.title === t).sort((a, b) => rank(a) - rank(b)),
    ])
  );

  const unplacedDirectors = (suggestions.get("Director") ?? []).filter((c) => !taken.has(norm(c.name)));

  /** Typing a name that matches a Workstream person links them; anything else stays a typed name. */
  function setName(id: PositionId, name: string) {
    const pool = suggestions.get(TITLE_FOR_POSITION[id]) ?? [];
    const match = pool.find((c) => norm(c.name) === norm(name))
      ?? loaded.candidates.find((c) => norm(c.name) === norm(name));
    setEdits((prev) => ({ ...prev, [id]: { name, workstreamUuid: match?.workstreamUuid ?? null } }));
  }

  const dirty = TEAM_ORDER.some((id) => {
    const e = edits[id];
    return e !== undefined && e.name.trim() !== (saved.get(id)?.name ?? "");
  });
  // Names carried from an earlier period are worth saving as they stand, so a
  // team that hasn't changed can be confirmed for this period in one click.
  const carried = loaded.assignments.some((a) => a.fromPeriod !== period);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const team = Object.fromEntries(TEAM_ORDER.map((id) => [id, field(id)]));
      const res = await fetch("/api/bonus/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, storeId, team }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLoaded((prev) => ({ ...prev, assignments: json.assignments }));
      setEdits({});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Team</span>
        <span className="text-[11px] text-gray-400">who holds each position at {storeName} in {period}</span>
        {!payLocked && (dirty || carried) && (
          <span className="ml-auto flex items-center gap-2">
            {dirty && (
              <button
                onClick={() => setEdits({})}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
              >
                Discard
              </button>
            )}
            <button
              onClick={save}
              disabled={saving}
              title={dirty ? undefined : `Save the names carried from an earlier period as ${period}'s team.`}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : dirty ? "Save team" : `Confirm for ${period}`}
            </button>
          </span>
        )}
      </div>

      {error && <p className="px-3 pt-2 text-xs text-red-600">{error}</p>}

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2.5 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {TEAM_ORDER.map((id) => {
          const f = field(id);
          const s = saved.get(id);
          const changed = edits[id] !== undefined && f.name.trim() !== (s?.name ?? "");
          const listId = `bonus-team-${id}`;
          return (
            <label key={id} className="flex items-center gap-2 min-w-0">
              <span className="w-36 shrink-0 text-xs text-gray-600">{POSITION_LABELS[id]}</span>
              <input
                list={listId}
                value={f.name}
                onChange={(e) => setName(id, e.target.value)}
                disabled={payLocked || loading}
                placeholder={payLocked ? "Not assigned" : "Pick or type a name"}
                className={`flex-1 min-w-0 text-sm border rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:bg-gray-50 disabled:text-gray-600 ${
                  changed ? "border-blue-300" : "border-gray-200"
                }`}
              />
              <datalist id={listId}>
                {(suggestions.get(TITLE_FOR_POSITION[id]) ?? []).map((c) => (
                  <option key={c.workstreamUuid} value={c.name}>
                    {c.title}
                  </option>
                ))}
              </datalist>
              <span className="w-16 shrink-0 text-[10px] leading-tight text-gray-400">
                {changed
                  ? "unsaved"
                  : s && s.fromPeriod !== period
                    ? `from ${s.fromPeriod.split(" ")[0]}`
                    : f.name && !f.workstreamUuid
                      ? "typed"
                      : ""}
              </span>
            </label>
          );
        })}
      </div>

      {!payLocked && !loading && unplacedDirectors.length > 0 && (
        <p className="px-3 pb-2.5 text-[11px] text-gray-500">
          Workstream Directors at {storeName} not in a position yet:{" "}
          {unplacedDirectors.map((c) => c.name).join(", ")}
        </p>
      )}
    </section>
  );
}
