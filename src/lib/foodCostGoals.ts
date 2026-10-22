/**
 * Food cost goal bands — shared by the Food Cost tab and the WBR deck so a
 * number can't be green in one and yellow in the other.
 */

export type GoalLevel = "good" | "warn" | "bad";

/** COGS % of sales: ≤ 28.5 good, ≤ 30.0 warn, above that bad. */
export function cogsLevel(pct: number | null): GoalLevel | null {
  if (pct === null) return null;
  if (pct <= 28.5) return "good";
  if (pct <= 30.0) return "warn";
  return "bad";
}

/** Variance % — either direction counts: within ±1.0 good, ±1.5 warn, beyond bad. */
export function varianceLevel(pct: number | null): GoalLevel | null {
  if (pct === null) return null;
  if (Math.abs(pct) <= 1.0) return "good";
  if (Math.abs(pct) <= 1.5) return "warn";
  return "bad";
}
