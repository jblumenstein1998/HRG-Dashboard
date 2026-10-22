/**
 * Weekly productivity targets shown on the WBR productivity slides.
 *
 * Copied from the 10.19–10.25 deck (the format Josh signed off on), which sets
 * them per store by volume. They differ from the GM bonus rules in
 * lib/bonus/rules.ts, which use one estate-wide band — these are the
 * meeting's coaching targets, not the bonus gates. Edit here when the deck's
 * targets change.
 *
 * `floor` is the number a store has to reach to read ON TARGET; `ceiling`, when
 * present, only completes the printed band ("$82–87").
 */

export type Target = { floor: number; ceiling?: number };
export type StoreTargets = { splh: Target; tplh: Target };

const TN_STANDARD: StoreTargets = { splh: { floor: 82, ceiling: 87 }, tplh: { floor: 5.25 } };
const VA_HIGH: StoreTargets = { splh: { floor: 75, ceiling: 85 }, tplh: { floor: 4.75 } };
const VA_STANDARD: StoreTargets = { splh: { floor: 70, ceiling: 80 }, tplh: { floor: 4.0 } };

/** Keyed by the store label in lib/stores.ts. */
export const WBR_TARGETS: Record<string, StoreTargets> = {
  Portland: TN_STANDARD,
  Springfield: TN_STANDARD,
  "White House": TN_STANDARD,
  Columbia: TN_STANDARD,
  "Spring Hill": TN_STANDARD,
  Brentwood: { splh: { floor: 60 }, tplh: { floor: 4.0 } },
  Hampton: VA_HIGH,
  College: VA_HIGH,
  Chesapeake: VA_HIGH,
  Jefferson: VA_STANDARD,
  Oyster: VA_STANDARD,
  Hillcrest: VA_STANDARD,
  Beach: VA_STANDARD,
};
