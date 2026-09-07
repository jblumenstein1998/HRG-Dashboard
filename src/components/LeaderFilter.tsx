"use client";

import { useMemo, useState } from "react";

/**
 * The above-store-leader filter, shared by every tab that has VA/TN boxes.
 *
 * Six tabs filter by state, and each one grew its own pair of checkboxes. The
 * leader filter is deliberately not a seventh copy: it is one hook and one
 * control, so "what does picking a leader do" has a single answer and the
 * dropdown can't drift into looking different on the Jolt tab.
 *
 * A leader's stores are display labels — "Columbia", "Jefferson". That works
 * across all six because they already agree on those exact twelve names:
 * lib/stores.ts (Drive-Thru), lib/surveyMeta.ts TN_STORES/VA_STORES (Food Cost,
 * Jolt, SMG, ZU) and lib/par.ts PAR_LOCATIONS (POS Sales) are the same list. No
 * mapping layer, and nothing to keep in sync beyond those three.
 *
 * The type is spelled out here rather than imported from lib/users/leaders,
 * which pulls in `sql` and would blow up in the browser.
 */
export type Leader = { id: string; name: string; stores: string[] };

/**
 * Holds the selection and resolves it to a set of store labels.
 *
 * Returns null — not an empty set — when nothing is chosen, so callers can tell
 * "no leader filter" from "a leader who covers no stores". The set is derived
 * from the id on every render rather than stored, so a leader edited on Users &
 * Access can't leave a stale store list pinned in a tab someone left open.
 */
export function useLeaderFilter(leaders: Leader[]) {
  const [leaderId, setLeaderId] = useState("");

  const leaderStores = useMemo(
    () => (leaderId ? new Set(leaders.find((l) => l.id === leaderId)?.stores ?? []) : null),
    [leaderId, leaders],
  );

  const leaderName = leaders.find((l) => l.id === leaderId)?.name ?? null;

  return { leaderId, setLeaderId, leaderStores, leaderName };
}

/**
 * Whether a store survives the leader filter.
 *
 * Stacks with the state boxes rather than overriding them: picking a leader
 * narrows whatever VA/TN is already showing. Callers `&&` this onto their
 * existing predicate.
 */
export const inLeader = (leaderStores: Set<string> | null, label: string): boolean =>
  !leaderStores || leaderStores.has(label);

/**
 * The dropdown itself, sized to sit beside the VA/TN checkboxes.
 *
 * Renders nothing when no leaders have been set up on Users & Access — an empty
 * dropdown on six tabs reads like six things are broken.
 */
export function LeaderPicker({
  leaders,
  value,
  onChange,
  className = "",
}: {
  leaders: Leader[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  if (leaders.length === 0) return null;

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by above-store leader"
      className={`text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 cursor-pointer ${className}`}
    >
      <option value="">All leaders</option>
      {leaders.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}
