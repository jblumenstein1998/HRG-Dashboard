/**
 * Formatting and colour for the Bonus tab.
 *
 * Modelled on surveyMeta.ts, and deliberately reusing its TONE_TEXT/TONE_BG so
 * a red cell means the same thing and looks the same on every tab. What changes
 * is the *scale*: survey scores are percentages of a fixed ceiling, attainment
 * is a percentage of target that can legitimately exceed 100 when a multiplier
 * or the transaction kicker fires.
 *
 * Pure, no env reads — safe to import from a client component.
 */

import { TONE_BG, TONE_TEXT, type ScoreTone } from "../surveyMeta";
import type { ConditionStatus, ConditionUnit, Gate } from "./types";

export { TONE_BG, TONE_TEXT };
export type { ScoreTone };

/**
 * Attainment colour. 100% is full target, so the bands sit higher than the
 * survey scale: at or above target is green, threshold-ish is amber, below that
 * is red. A null score is untinted — the tab must never let "nobody has entered
 * this yet" read as a failing grade.
 */
export function bonusTone(score: number | null | undefined): ScoreTone {
  if (score === null || score === undefined) return "none";
  if (score >= 95) return "good";
  if (score >= 70) return "ok";
  return "bad";
}

/** Condition-level colour, keyed off how the condition landed rather than a number. */
export const STATUS_TONE: Record<ConditionStatus, ScoreTone> = {
  target: "good",
  threshold: "ok",
  missed: "bad",
  pending: "none",
  notApplicable: "none",
};

export const STATUS_LABEL: Record<ConditionStatus, string> = {
  target: "Target",
  threshold: "Threshold",
  missed: "Missed",
  pending: "Not entered",
  notApplicable: "N/A",
};

export function fmtScore(score: number | null | undefined): string {
  return score === null || score === undefined ? "—" : `${score.toFixed(1)}%`;
}

/** Seconds render as M:SS, matching how every drive-thru time is shown elsewhere. */
export function fmtSecs(v: number): string {
  const m = Math.floor(v / 60);
  return `${m}:${String(Math.round(v % 60)).padStart(2, "0")}`;
}

export function fmtValue(value: number | null | undefined, unit: ConditionUnit): string {
  if (value === null || value === undefined) return "—";
  switch (unit) {
    case "seconds": return fmtSecs(value);
    case "percent": return `${round(value)}%`;
    case "currency": return `$${Math.round(value).toLocaleString("en-US")}`;
    case "boolean": return value >= 1 ? "Yes" : "No";
    case "rating": return value >= 2 ? "Exceeds" : value >= 1 ? "Meets" : "Below";
    case "ratio": return round(value);
    default: return round(value);
  }
}

function round(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, "");
}

export function fmtGateValue(gate: Gate, unit: ConditionUnit): string {
  if (unit === "boolean") return gate.cmp === "lte" && gate.value === 0 ? "No" : "Yes";
  if (unit === "rating") return gate.value >= 2 ? "Exceeds" : gate.value >= 1 ? "Meets" : "—";
  const n = (v: number) => fmtValue(v, unit);
  if (gate.cmp === "between") return `${n(gate.value)}–${n(gate.value2)}`;
  return `${gate.cmp === "gte" ? "≥" : "≤"} ${n(gate.value)}`;
}

/**
 * How a partially-entered scorecard should be described.
 *
 * Attainment and the weight it was measured over must always be read together —
 * 40% of a 40-point scorecard is not the same result as 40% of a full one — so
 * the grid never prints a bare percentage.
 */
export function coverageNote(scoreableWeight: number, pendingCount: number): string | null {
  if (scoreableWeight >= 100 && pendingCount === 0) return null;
  if (scoreableWeight <= 0) return "not yet scoreable";
  return `of ${Math.round(scoreableWeight)}% measured${pendingCount ? ` · ${pendingCount} pending` : ""}`;
}
