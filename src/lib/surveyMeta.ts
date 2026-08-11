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

// Canonical per-store colors — the single source for the SMG, Drive-Thru trend and
// Food Cost variance charts, which all import from here. Change a store's color once,
// and it changes on every tab; don't copy this map back into a component.
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

/**
 * Freshness stamp for the "Updated …" labels — "8/10/26, 6:07 PM".
 *
 * An absolute time rather than "6 min ago": these numbers are compared against
 * SMG's own screens, and "which pull am I looking at" is the question being
 * asked. A relative age also goes stale on a tab left open, while a timestamp
 * stays true.
 */
export function formatSyncStamp(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-US", {
    month: "numeric",
    day: "numeric",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
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
 * Combined and region-manager row stored: 1415 of 1422 cells (99.5%) against
 * 1292 (90.9%) for the weighted-percentage form. The seven that still differ
 * land within 0.6 of a rounding boundary, six of them exactly on .50.
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

export type RollupRow = {
  unitKey: string;
  metric: string;
  score: number | null;
  responses: number | null;
};

/**
 * SMG's own published row for a market, when one provably covers exactly the
 * stores we're rolling up.
 *
 * SMG publishes its region-manager rows for the same windows we show, and
 * today each region is one market — so where such a row exists it *is* the
 * answer, with none of the rounding loss `pooledScore` has to work around.
 *
 * The catch is that "region manager" is a personnel fact and "TN / VA" is a
 * geographic one. They coincide right now, but an RM picking up a store across
 * the state line would silently turn the market line into something else. So a
 * row is never matched by name: a candidate qualifies only if its response
 * count agrees with the market's own store total on every metric, which is
 * exactly the claim "these two cover the same stores". When no candidate
 * qualifies, or more than one does, the caller falls back to pooling and the
 * line stays approximately right rather than confidently wrong.
 *
 * `marketCells` is the market's store cells keyed by metric — the same input
 * `pooledScore` would get.
 */
export function publishedMarketCells(
  published: RollupRow[],
  marketCells: Map<string, PooledCell[]>,
): Map<string, PooledCell> | null {
  const byUnit = new Map<string, Map<string, PooledCell>>();
  for (const r of published) {
    if (!byUnit.has(r.unitKey)) byUnit.set(r.unitKey, new Map());
    byUnit.get(r.unitKey)!.set(r.metric, { score: r.score, responses: r.responses });
  }

  // Responses counted the way pooledScore counts them, so "same denominator"
  // means the same thing on both sides of the comparison.
  const wanted = new Map<string, number>();
  for (const [metric, cells] of marketCells) {
    let n = 0;
    for (const c of cells) if (c.score !== null && c.responses) n += c.responses;
    if (n > 0) wanted.set(metric, n);
  }
  if (!wanted.size) return null;

  const qualified = [...byUnit.values()].filter((cells) =>
    [...wanted].every(([metric, n]) => cells.get(metric)?.responses === n),
  );
  return qualified.length === 1 ? qualified[0] : null;
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
