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

export const TONE_TEXT: Record<ScoreTone, string> = {
  good: "text-emerald-800",
  ok: "text-amber-800",
  bad: "text-red-800",
  none: "text-gray-400",
};

/**
 * Cell shading, same scale as the text. Deliberately the faintest step of each
 * hue: the fill is there to be scanned down a column, while the number stays
 * the thing you read, so it must not fight the text sitting on it. Untinted
 * when there's no score, so a blank cell reads as absent rather than neutral.
 */
export const TONE_BG: Record<ScoreTone, string> = {
  good: "bg-emerald-100",
  ok: "bg-amber-100",
  bad: "bg-red-100",
  none: "",
};

/** One step stronger, so summary rows keep reading as heavier than the stores. */
export const TONE_BG_STRONG: Record<ScoreTone, string> = {
  good: "bg-emerald-200",
  ok: "bg-amber-200",
  bad: "bg-red-200",
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
