"use client";

/**
 * The people on a store's scorecard, at the foot of the page.
 *
 * One row per person: a position and a name. It starts as the six positions —
 * GM, AGM and the four Directors — and rows can be added or removed, so a store
 * with two GMs lists both. **Two named people in one position split that
 * position's bonus**, and the rows say so.
 *
 * Names are free text with this store's Workstream staff of the matching title
 * offered as suggestions — never another store's, so a store short a Director
 * simply has nothing to suggest there. Workstream calls all four Directors
 * "Director", so this is where they are told apart, and the card lists the
 * store's Directors nobody has been placed as yet.
 *
 * A team carries forward from the last period that saved one (see
 * lib/bonus/assignments.ts) and says where it came from. Saving writes the
 * whole team to the period on screen.
 */

import { useEffect, useMemo, useState } from "react";
import { POSITION_LABELS, type PositionId } from "@/lib/bonus/types";

const TEAM_ORDER: PositionId[] = ["gm", "agm", "hospitality", "driveThru", "quality", "training"];

type ManagerTitle = "General Manager" | "AGM" | "Director";

/** Which Workstream title fills which position. */
const TITLE_FOR_POSITION: Record<PositionId, ManagerTitle> = {
  gm: "General Manager",
  agm: "AGM",
  driveThru: "Director",
  quality: "Director",
  training: "Director",
  hospitality: "Director",
};

type TeamMember = { positionId: PositionId; name: string; workstreamUuid: string | null };
type Team = { members: TeamMember[]; fromPeriod: string | null };
type Candidate = { workstreamUuid: string; name: string; title: ManagerTitle };

/** A row on screen; `key` keeps React's inputs attached to the right row as rows come and go. */
type Row = TeamMember & { key: number };

const withKeys = (members: TeamMember[]): Row[] => members.map((m, i) => ({ ...m, key: i }));
const nextKey = (rows: Row[]) => rows.reduce((max, r) => Math.max(max, r.key), -1) + 1;
const strip = (rows: Row[]): TeamMember[] =>
  rows.map(({ positionId, name, workstreamUuid }) => ({ positionId, name: name.trim(), workstreamUuid }));

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** Named people per position — the names each scorecard header shows. */
export type TeamByPosition = Map<PositionId, string[]>;

export default function BonusTeamCard({
  period, storeId, storeName, payLocked, onTeam,
}: {
  period: string;
  storeId: string;
  storeName: string;
  payLocked: boolean;
  onTeam: (team: TeamByPosition) => void;
}) {
  const key = `${period}|${storeId}`;
  const [loaded, setLoaded] = useState<{ key: string; team: Team; candidates: Candidate[] }>(
    { key: "", team: { members: [], fromPeriod: null }, candidates: [] }
  );
  const [error, setError] = useState<string | null>(null);
  /** Unsaved rows, or null while the saved team is on screen untouched. */
  const [draft, setDraft] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const loading = loaded.key !== key;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/bonus/assignments?period=${encodeURIComponent(period)}&store=${storeId}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? `HTTP ${r.status}`);
        return json as { team: Team; candidates: Candidate[] };
      })
      .then((json) => {
        if (cancelled) return;
        setLoaded({ key, team: json.team, candidates: json.candidates });
        setDraft(null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoaded({ key, team: { members: [], fromPeriod: null }, candidates: [] });
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [key, period, storeId]);

  // What is on screen before any edit: the saved team, or the six positions
  // empty for a store that has never saved one.
  const baseline = useMemo<Row[]>(
    () => withKeys(
      loaded.team.fromPeriod === null
        ? TEAM_ORDER.map((positionId) => ({ positionId, name: "", workstreamUuid: null }))
        : loaded.team.members
    ),
    [loaded.team]
  );
  const rows = draft ?? baseline;

  useEffect(() => {
    const byPosition: TeamByPosition = new Map();
    for (const m of loaded.team.members) {
      if (!m.name) continue;
      byPosition.set(m.positionId, [...(byPosition.get(m.positionId) ?? []), m.name]);
    }
    onTeam(byPosition);
  }, [loaded.team, onTeam]);

  const dirty = draft !== null && JSON.stringify(strip(draft)) !== JSON.stringify(strip(baseline));
  const carried = loaded.team.fromPeriod !== null && loaded.team.fromPeriod !== period;

  // Named people per position, for the split note.
  const holders = new Map<PositionId, number>();
  for (const r of rows) if (r.name.trim()) holders.set(r.positionId, (holders.get(r.positionId) ?? 0) + 1);

  // Suggestions per title. Someone already on the team sinks below the people
  // still to be placed.
  const taken = new Set(rows.map((r) => norm(r.name)).filter(Boolean));
  const suggestions = (title: ManagerTitle) =>
    loaded.candidates
      .filter((c) => c.title === title)
      .sort((a, b) => Number(taken.has(norm(a.name))) - Number(taken.has(norm(b.name))));
  const unplacedDirectors = suggestions("Director").filter((c) => !taken.has(norm(c.name)));

  const edit = (fn: (rows: Row[]) => Row[]) => setDraft((prev) => fn(prev ?? baseline));

  /** A name that matches one of the store's people links them; anything else stays a typed name. */
  function setName(rowKey: number, name: string) {
    const match = loaded.candidates.find((c) => norm(c.name) === norm(name));
    edit((rs) => rs.map((r) => (r.key === rowKey ? { ...r, name, workstreamUuid: match?.workstreamUuid ?? null } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      // Grouped by position so shared positions sit together. A blank row
      // beside a named one in the same position is dropped — it would read as
      // a vacancy in a position that is filled.
      const ordered = [...rows].sort((a, b) => TEAM_ORDER.indexOf(a.positionId) - TEAM_ORDER.indexOf(b.positionId));
      const members = strip(ordered).filter((m) => m.name || !holders.get(m.positionId));
      const res = await fetch("/api/bonus/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, storeId, members }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setLoaded((prev) => ({ ...prev, team: json.team }));
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const editable = !payLocked && !loading;

  return (
    <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-900">Team</span>
        <span className="text-[11px] text-gray-400">
          who holds each position at {storeName} in {period}
          {carried && !dirty && ` · carried from ${loaded.team.fromPeriod}`}
        </span>
        {!payLocked && (dirty || carried) && (
          <span className="ml-auto flex items-center gap-2">
            {dirty && (
              <button
                onClick={() => setDraft(null)}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 transition disabled:opacity-50"
              >
                Discard
              </button>
            )}
            <button
              onClick={save}
              disabled={saving}
              title={dirty ? undefined : `Save the team carried from ${loaded.team.fromPeriod} as ${period}'s team.`}
              className="text-xs px-2.5 py-1 rounded-lg bg-gray-900 text-white hover:bg-gray-700 transition disabled:opacity-50"
            >
              {saving ? "Saving…" : dirty ? "Save team" : `Confirm for ${period}`}
            </button>
          </span>
        )}
      </div>

      {error && <p className="px-3 pt-2 text-xs text-red-600">{error}</p>}

      <div className={`px-3 py-2.5 space-y-1.5 transition-opacity ${loading ? "opacity-50" : ""}`}>
        {rows.length === 0 && (
          <p className="text-xs text-gray-400">Nobody on the team for this period.</p>
        )}
        {rows.map((r) => {
          const listId = `bonus-team-${r.key}`;
          const shared = r.name.trim() ? holders.get(r.positionId) ?? 0 : 0;
          return (
            <div key={r.key} className="flex items-center gap-2 min-w-0">
              <select
                value={r.positionId}
                onChange={(e) => {
                  const positionId = e.target.value as PositionId;
                  edit((rs) => rs.map((x) => (x.key === r.key ? { ...x, positionId } : x)));
                }}
                disabled={!editable}
                className="w-44 shrink-0 text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:bg-gray-50 disabled:text-gray-600"
              >
                {TEAM_ORDER.map((id) => (
                  <option key={id} value={id}>{POSITION_LABELS[id]}</option>
                ))}
              </select>
              <input
                list={listId}
                value={r.name}
                onChange={(e) => setName(r.key, e.target.value)}
                disabled={!editable}
                placeholder={payLocked ? "Not assigned" : "Pick or type a name"}
                className="flex-1 min-w-0 text-sm border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 disabled:bg-gray-50 disabled:text-gray-600"
              />
              <datalist id={listId}>
                {suggestions(TITLE_FOR_POSITION[r.positionId]).map((c) => (
                  <option key={c.workstreamUuid} value={c.name}>{c.title}</option>
                ))}
              </datalist>
              <span className="w-24 shrink-0 text-[10px] leading-tight text-gray-400">
                {shared > 1
                  ? <span className="text-amber-700">split {shared} ways</span>
                  : r.name.trim() && !r.workstreamUuid
                    ? "typed"
                    : ""}
              </span>
              {editable && (
                <button
                  onClick={() => edit((rs) => rs.filter((x) => x.key !== r.key))}
                  title="Remove this row"
                  aria-label={`Remove ${POSITION_LABELS[r.positionId]} row`}
                  className="shrink-0 w-6 h-6 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition"
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        {editable && (
          <button
            onClick={() => edit((rs) => [...rs, { positionId: "gm", name: "", workstreamUuid: null, key: nextKey(rs) }])}
            className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 transition"
          >
            + Add position
          </button>
        )}
      </div>

      {editable && unplacedDirectors.length > 0 && (
        <p className="px-3 pb-2.5 text-[11px] text-gray-500">
          Workstream Directors at {storeName} not on the team yet:{" "}
          {unplacedDirectors.map((c) => c.name).join(", ")}
        </p>
      )}
    </section>
  );
}
