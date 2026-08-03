/**
 * Shared vocabulary for the Survey Data tab — store naming, market membership,
 * metric ordering and the score-to-color scale.
 *
 * The table and the trend chart both need all of this. It lives here rather
 * than in either component so the two can't drift: a store that reads
 * "Chesapeake" in the table must be the same color and the same market in the
 * chart, and a score that prints amber in one must not print green in the other.
 */

/** SMG's own all-units rollup — hidden everywhere, since TN/VA/HRG are computed locally. */
export const COMBINED_KEY = "COMBINED";

/** Higher is better for every metric except this one. */
export const LOWER_IS_BETTER = /experienced problem/i;

export const TN_STORES = ["Springfield", "White House", "Brentwood", "Spring Hill", "Columbia"];
export const VA_STORES = ["Jefferson", "Oyster", "Hampton", "College", "Chesapeake", "Hillcrest", "Beach"];

export const STORE_LABELS: Record<string, string> = {
  "28901": "Columbia",
  "36001": "Springfield",
  "42601": "White House",
  "56301": "Brentwood",
  "61401": "Spring Hill",
  "57001": "College",
  "57002": "Hampton",
  "57003": "Oyster",
  "57004": "Chesapeake",
  "57005": "Jefferson",
  "57006": "Hillcrest",
  "57007": "Beach",
};

// Canonical per-store colors — kept identical across SMG, Drive-Thru trend, and Food Cost variance charts.
export const STORE_COLOR: Record<string, string> = {
  "Columbia":       "#dc2626",
  "Springfield":    "#2563eb",
  "White House":    "#16a34a",
  "Brentwood":      "#d97706",
  "Spring Hill":    "#7c3aed",
  "Jefferson":      "#0891b2",
  "Oyster":         "#db2777",
  "Hampton":        "#65a30d",
  "College":        "#ea580c",
  "Chesapeake":     "#0284c7",
  "Hillcrest":      "#9333ea",
  "Beach":          "#0d9488",
};

export function prettyUnit(name: string, key: string): string {
  if (STORE_LABELS[key]) return STORE_LABELS[key];
  const m = name.match(/^(.*?)_(\d+)$/);
  if (!m) return name;
  return `${m[1].charAt(0)}${m[1].slice(1).toLowerCase()} ${m[2]}`;
}

export function marketOf(key: string, name: string): "TN" | "VA" | null {
  const label = prettyUnit(name, key);
  if (TN_STORES.includes(label)) return "TN";
  if (VA_STORES.includes(label)) return "VA";
  return null;
}

// ── Pooling ──────────────────────────────────────────────────────────────────

export type PooledCell = { score: number | null; responses: number | null };

/**
 * Pooled score across units, behind the TN / VA / HRG rollup rows.
 *
 * Weighting by response count is the easy half — a plain average of
 * percentages would let a store with 2 responses swing the market as hard as
 * one with 60. The subtle half is *what* gets weighted. SMG reports each unit
 * as a whole-percent top-box figure, so weighting those percentages
 * re-averages numbers that have each already lost up to half a point, and the
 * leftovers don't cancel — they accumulate into the pooled value and tip it
 * over the next rounding boundary.
 *
 * Recovering each unit's top-box count first (score% x responses, back to the
 * nearest whole respondent) and pooling counts over responses is what SMG
 * itself does, and it reproduces SMG's own rollup rows. Checked against every
 * Combined and region-manager row stored: 1215 of 1222 cells (99.4%) against
 * 1092 (89.4%) for the weighted-percentage form.
 *
 * VA is what exposed it — seven stores carrying 7–20 responses apiece is the
 * worst case for accumulated rounding, and its market line disagreed with the
 * SMG portal on 8 of 30 snapshot cells (Cleanliness 59 vs 58, OSAT 76 vs 75)
 * while TN's five larger stores happened to land right on all 30.
 *
 * The count recovery is exact while a unit's response count stays under ~100,
 * which covers any single store. It is not a general way to un-round a figure
 * the size of the Combined row, so pool from stores, never from other rollups.
 */
export function pooledScore(cells: PooledCell[]): { score: number | null; responses: number | null } {
  let topBox = 0;
  let responses = 0;
  for (const c of cells) {
    if (c.score === null || !c.responses) continue;
    topBox += Math.round((c.score / 100) * c.responses);
    responses += c.responses;
  }
  return {
    score: responses ? Math.round((topBox / responses) * 100) : null,
    responses: responses || null,
  };
}

// ── Score color scale ────────────────────────────────────────────────────────

export type ScoreTone = "good" | "ok" | "bad" | "none";

/**
 * Satisfaction metrics: >=80 good, >=75 ok, below that bad.
 * Experienced Problem is inverted: <=5 good, <=10 ok, above that bad.
 */
export function scoreTone(value: number | null | undefined, metric: string): ScoreTone {
  if (value === null || value === undefined) return "none";
  const inverted = LOWER_IS_BETTER.test(metric);
  if (inverted ? value <= 5 : value >= 80) return "good";
  if (inverted ? value <= 10 : value >= 75) return "ok";
  return "bad";
}

/**
 * Same scale the Food Cost tables use (green/yellow/red-600 on -50 fills), so a
 * red cell means the same thing and looks the same on both tabs.
 */
export const TONE_TEXT: Record<ScoreTone, string> = {
  good: "text-green-600",
  ok: "text-yellow-600",
  bad: "text-red-600",
  none: "text-gray-400",
};

/**
 * Cell shading, same scale as the text. Deliberately the faintest step of each
 * hue: the fill is there to be scanned down a column, while the number stays
 * the thing you read, so it must not fight the text sitting on it. Untinted
 * when there's no score, so a blank cell reads as absent rather than neutral.
 */
export const TONE_BG: Record<ScoreTone, string> = {
  good: "bg-green-50",
  ok: "bg-yellow-50",
  bad: "bg-red-50",
  none: "",
};

/** Legacy text-only helper, kept so callers can ask for just the ink. */
export function scoreColor(value: number | null, metric: string): string {
  return TONE_TEXT[scoreTone(value, metric)];
}

// ── Metric ordering / naming ────────────────────────────────────────────────

/** Reading order for the metric columns; matched loosely so SMG can rename. */
const METRIC_ORDER = [
  /^overall satisfaction$/i,
  /accuracy/i,
  /friendliness/i,
  /cleanliness/i,
  /temperature/i,
  /experienced problem/i,
];

export function metricRank(m: string): number {
  const i = METRIC_ORDER.findIndex((re) => re.test(m));
  return i === -1 ? METRIC_ORDER.length : i;
}

export const shortMetric = (m: string) =>
  m
    .replace(" of Team Members", "")
    .replace(" (Y/N)", "")
    .replace(" of Order", "")
    .replace(" of Food", "")
    .replace("Overall Satisfaction", "OSAT");
