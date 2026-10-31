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
 * `note` says what the window is ("guest's visit time", "daypart 2"); `narrow`
 * keeps the tiers in one column for a panel inside a card.
 */
export function TeamPanel({ url, note, narrow = false }: { url: string; note: string; narrow?: boolean }) {
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
  const sections = [
    ...JOB_GROUPS.map((g) => ({ key: g.key, label: g.label })),
    { key: "other", label: "Other" },
  ]
    .map((s) => ({ ...s, people: data.team.filter((p) => groupOf(p.position) === s.key) }))
    .filter((s) => s.people.length > 0);

  return (
    <div className="rounded-md border border-gray-200 bg-white px-3 py-2">
      <div className="text-[11px] text-gray-500">
        On the clock {when}, {Number(m)}/{Number(d)} — {note}
        {data.wholeHour && " (given to the hour)"}
      </div>
      {data.team.length === 0 ? (
        <div className="py-1.5 text-xs text-gray-500">Nobody was on the clock at that time.</div>
      ) : (
        <div className={`mt-1.5 grid gap-2 ${narrow ? "" : "sm:grid-cols-2"}`}>
          {sections.map((s) => (
            <div key={s.key} className={`rounded-lg border ${GROUP_TONE[s.key] ?? GROUP_TONE.other}`}>
              <div className="px-2.5 py-1 flex items-baseline gap-2 border-b border-black/5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-700">{s.label}</span>
                <span className="text-[11px] text-gray-500">{s.people.length}</span>
              </div>
              <ul className="divide-y divide-black/5">
                {s.people.map((p) => (
                  <li
                    key={`${p.employeeId ?? p.name}|${p.startLabel}`}
                    className="px-2.5 py-1 flex items-baseline gap-2 text-[12.5px]"
                  >
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
                    <span className="ml-auto text-[11px] text-gray-500 tabular-nums whitespace-nowrap">
                      {p.startLabel}–{p.endLabel}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
