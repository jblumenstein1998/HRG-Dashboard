/**
 * ZCase bonus goals, in one place.
 *
 * These are the Hospitality Director's "Guest Recovery & Z-Cases" numbers from
 * the HRG Binder doc. They live here rather than inline in rules.ts because the
 * SMG tab colours its ZCase table against them — one definition means the
 * colours on the dashboard can't drift from what the scorecard actually scores.
 *
 * Kept as its own module rather than exported from rules.ts so the SMG tab
 * doesn't pull all six scorecards into its bundle to read four numbers.
 */

/**
 * The ZCase types the bonus counts — the two guest-facing ones, matching what
 * the SMG tab reports. The team-member hotline is a different conversation and
 * is excluded from both.
 */
export const BONUS_ZCASE_TYPES = ["unsolicited", "locationSurvey"] as const;

export const ZCASE_GOALS = {
  /** Z-Cases opened in the period, per store. Fewer is better. */
  count: { target: 4, threshold: 8 },
  /**
   * Percent of Z-Cases resolved within 24 hours. Higher is better.
   *
   * The tab reports the complement (% *over* 24 hrs), so a 100% target reads as
   * 0% over and the 95% threshold reads as 5% over.
   */
  resolvedWithin24Pct: { target: 100, threshold: 95 },
} as const;
