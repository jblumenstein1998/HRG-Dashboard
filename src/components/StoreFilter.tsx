"use client";

import { useMemo, useState } from "react";
import { ALL_STORES } from "@/lib/stores";

/**
 * The one store filter, shared by every tab that used to carry VA/TN checkboxes.
 *
 * Markets and above-store leaders are the same kind of choice — "show me this
 * slice of the estate" — so they are one dropdown rather than two checkboxes
 * plus a select. That also removes a state the old pair could reach and nobody
 * wanted: both boxes unticked, showing nothing at all.
 *
 * Everything resolves to a set of store *labels*, which is what makes one
 * control work across six tabs that identify stores differently. lib/stores.ts,
 * lib/surveyMeta.ts (TN_STORES/VA_STORES) and lib/par.ts PAR_LOCATIONS all name
 * the same twelve stores identically, so a caller compares whatever name it
 * already has against the set and needs no mapping.
 *
 * The market lists are derived from ALL_STORES rather than typed out again, so
 * adding a store to lib/stores.ts is enough to put it in its market here.
 */
export type Leader = { id: string; name: string; stores: string[] };

const MARKETS = {
  va: {
    label: "VA",
    stores: ALL_STORES.filter((s) => s.section === "Virginia").map((s) => s.label),
  },
  tn: {
    label: "TN",
    stores: ALL_STORES.filter((s) => s.section === "Tennessee").map((s) => s.label),
  },
} as const;

/** "" = everything; "va"/"tn" = a market; "leader:<id>" = one leader's stores. */
export type StoreFilterValue = string;

export type StoreFilter = {
  value: StoreFilterValue;
  setValue: (v: StoreFilterValue) => void;
  /** Allowed store labels, or null when nothing is filtered. */
  allowed: Set<string> | null;
  /**
   * What the selection is called — "VA", "Tommy Demorest", or null for
   * everything. Feeds total-row captions so a total says what it is summing.
   */
  label: string | null;
};

export function useStoreFilter(leaders: Leader[]): StoreFilter {
  const [value, setValue] = useState<StoreFilterValue>("");

  // Resolved on every render rather than stored, so a leader edited on Users &
  // Access can't leave a stale store list pinned in a tab left open.
  const { allowed, label } = useMemo(() => {
    if (value === "va" || value === "tn") {
      return { allowed: new Set<string>(MARKETS[value].stores), label: MARKETS[value].label };
    }
    if (value.startsWith("leader:")) {
      const leader = leaders.find((l) => l.id === value.slice("leader:".length));
      // A leader that has since been deleted falls back to showing everything,
      // rather than an empty screen attributed to a name that is no longer there.
      if (!leader) return { allowed: null, label: null };
      return { allowed: new Set(leader.stores), label: leader.name };
    }
    return { allowed: null, label: null };
  }, [value, leaders]);

  return { value, setValue, allowed, label };
}

/** Whether a store survives the filter. */
export const inFilter = (allowed: Set<string> | null, label: string): boolean =>
  !allowed || allowed.has(label);

/**
 * Caption for a total row: "Total" when nothing is filtered, otherwise
 * "Total - TN", "Total - Tommy Demorest".
 *
 * One row that renames itself, rather than a fixed set of market rows — the
 * total describes whatever is on screen, so it can't claim to be the estate
 * while showing three stores.
 */
export const totalLabelFor = (filter: StoreFilter): string =>
  filter.label ? `Total - ${filter.label}` : "Total";

/**
 * Whether a market still has any store in the filter — for the few places that
 * draw per-market series rather than per-store rows, and need to know whether a
 * market line has anything left to plot. Derived from the filter rather than
 * from loaded rows, so a chart doesn't blank its lines while data is in flight.
 */
export const marketShown = (allowed: Set<string> | null, market: "TN" | "VA"): boolean =>
  !allowed || MARKETS[market === "TN" ? "tn" : "va"].stores.some((s) => allowed.has(s));

/**
 * The control. Markets and leaders are separate optgroups because they are
 * different kinds of thing to slice by, and a flat list of "VA, TN, Chris,
 * Derek…" reads like the states are people.
 */
export function StoreFilterPicker({
  leaders,
  value,
  onChange,
  className = "",
}: {
  leaders: Leader[];
  value: StoreFilterValue;
  onChange: (v: StoreFilterValue) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter stores"
      className={`text-xs px-2 py-1 rounded-lg border border-gray-200 bg-white text-gray-600 cursor-pointer ${className}`}
    >
      <option value="">All stores</option>
      <optgroup label="Market">
        <option value="va">VA</option>
        <option value="tn">TN</option>
      </optgroup>
      {/* Omitted entirely until someone is set up on Users & Access — an empty
          group reads like the list failed to load. */}
      {leaders.length > 0 && (
        <optgroup label="Above-store leader">
          {leaders.map((l) => (
            <option key={l.id} value={`leader:${l.id}`}>
              {l.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
