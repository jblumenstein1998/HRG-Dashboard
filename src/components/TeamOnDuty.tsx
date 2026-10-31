"use client";

import { useEffect, useState } from "react";
import { GROUP_TONE, JOB_GROUPS, groupOf, titleOf } from "@/lib/staffGroups";

/**
 * Who was on the clock when something happened at a store — a guest's visit
 * behind a ZCase, a drive-thru daypart — drawn in the Staffing tab's tiers.
 *
 * The button and the panel are separate so each caller can put the panel
 * wherever it has room (under a case line, across a daypart row); the panel
 * fetches when it mounts, so nothing is read until somebody asks.
 */

type TeamMember = {
  employeeId: string | null;
  name: string;
  job: string | null;
  position: string | null;
  startLabel: string;
  endLabel: string;
  onBreakThroughout: boolean;
};

type TeamResponse = {
  storeName: string;
  localDate: string;
  startMinutes: number;
  endMinutes: number;
  /** ZCases only: the visit time came on the hour and was taken as the hour. */
  wholeHour?: boolean;
  team: TeamMember[];
  error: string | null;
};

/** The tiers shown, most senior first. Crew and Other are left out. */
const LEADER_TIERS = ["leadership", "directors", "managers"].map((key) => {
  const g = JOB_GROUPS.find((j) => j.key === key)!;
  return { key: g.key, label: g.label };
});

const clock = (minutes: number) => {
  const h24 = Math.floor(minutes / 60) % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(minutes % 60).padStart(2, "0")}${h24 < 12 ? "am" : "pm"}`;
};

export function TeamButton({
  open,
  onClick,
  label = "Team on duty",
}: {
  open: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      // Sits inside rows that expand on click; this shouldn't toggle them too.
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => e.stopPropagation()}
      className={`text-[10.5px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-gray-400 ${
        open ? "bg-gray-800 border-gray-800 text-white" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-100"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The people on the clock during the window `url` answers for, in the
 * Staffing tab's tiers — Workstream positions, grouped and coloured as on its
 * "currently clocked in" cards (lib/staffGroups), so a person is the same
 * thing on every tab.
 *
 * Leaders only — Leadership, Directors, Managers. The question every caller is
 * asking is who was in charge, and crew made the panel tall without answering
 * it. "Other" (not linked to Workstream, so no known tier) goes with them.
 *
 * `note` says what the window is ("guest's visit time", "daypart 2").
 * `layout` fits the panel to its space: "row" puts the three tiers side by
 * side, always all three so the columns line up panel to panel, for full-width
 * rows (ZCases, Jolt); "stacked" keeps them in one column and drops empty
 * tiers, for tight spots (a drive-thru card, the Slack report grid).
 */
export function TeamPanel({
  url,
  note,
  layout = "row",
}: {
  url: string;
  note: string;
  layout?: "row" | "stacked";
}) {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(url)
      .then(async (r) => {
        const body = await r.json();
        if (!live) return;
        if (!r.ok || body.error) setError(body.error ?? `HTTP ${r.status}`);
        else setData(body);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [url]);

  if (error) return <div className="py-1.5 text-xs text-amber-700">Couldn&apos;t load the team: {error}</div>;
  if (!data) return <div className="py-1.5 text-xs text-gray-400 animate-pulse">Loading team on duty…</div>;

  const [, m, d] = data.localDate.split("-");
  const when =
    data.startMinutes === data.endMinutes
      ? `at ${clock(data.startMinutes)}`
      : `${clock(data.startMinutes)}–${clock(data.endMinutes)}`;
  // Most senior first.
  const row = layout === "row";
  const sections = [...LEADER_TIERS]
    .map((s) => ({ ...s, people: data.team.filter((p) => groupOf(p.position) === s.key) }))
    .filter((s) => row || s.people.length > 0);
  const leaders = sections.reduce((n, s) => n + s.people.length, 0);

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] text-gray-500">
        Leaders on the clock {when}, {Number(m)}/{Number(d)} — {note}
        {data.wholeHour && " (given to the hour)"}
      </div>
      {leaders === 0 ? (
        <div className="py-1.5 text-xs text-gray-500">No leadership, directors or managers on the clock then.</div>
      ) : (
        <div className={`mt-1.5 grid gap-2 ${row ? "sm:grid-cols-3" : ""}`}>
          {sections.map((s) => (
            <div key={s.key} className={`rounded-lg border ${GROUP_TONE[s.key]}`}>
              <div className="px-2.5 py-1 flex items-baseline gap-2 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">{s.label}</span>
                <span className="text-[11px] text-gray-500">{s.people.length}</span>
              </div>
              {s.people.length === 0 ? (
                <div className="px-2.5 py-1 text-[12.5px] text-gray-400">—</div>
              ) : (
                <ul className="divide-y divide-black/5">
                  {s.people.map((p) => (
                    <li
                      key={`${p.employeeId ?? p.name}|${p.startLabel}`}
                      // In a row the columns are a third wide, so the shift
                      // times drop under the name rather than squeezing it.
                      className={`px-2.5 py-1 text-[12.5px] ${row ? "" : "flex items-baseline gap-2"}`}
                    >
                      <div className={`flex items-baseline gap-2 min-w-0 ${row ? "" : "contents"}`}>
                        <span className="font-medium text-gray-900 truncate">
                          {p.name}
                          {titleOf(p.position, p.job) && (
                            <span className="font-normal text-gray-500">
                              {" — "}
                              {titleOf(p.position, p.job)}
                            </span>
                          )}
                        </span>
                        {p.onBreakThroughout && (
                          <span className="text-[10px] uppercase tracking-wide text-amber-700">break</span>
                        )}
                      </div>
                      <span
                        className={`text-[11px] text-gray-500 tabular-nums whitespace-nowrap ${row ? "block" : "ml-auto"}`}
                      >
                        {p.startLabel}–{p.endLabel}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
