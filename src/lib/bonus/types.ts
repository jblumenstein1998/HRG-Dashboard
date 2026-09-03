/**
 * Shared vocabulary for bonus attainment.
 *
 * The whole feature is built around one simplification, and it's worth stating
 * up front because it is what keeps the engine small:
 *
 *   **Every condition is a single numeric gate against a single metric.**
 *
 * The bonus docs don't read that way. They say things like "any week with <65%
 * accuracy", "more than 5 days in a pay-period missing the target", "≤4 flagged
 * pull forward per week", "YOY transaction growth in every week of the period".
 * Those are week-shaped and day-shaped tests sitting next to period-shaped ones.
 *
 * Rather than teach the engine four evaluation modes, the *metric resolver*
 * (metrics.ts) does the time-shaped work and hands the engine a plain number:
 * "any week under 65%" becomes the metric `smgAccuracyMinWeekly` gated at
 * `>= 65`; "more than 5 days missing target" becomes `dtDaysMissingTarget`
 * gated at `<= 5`; "growth every week" becomes `txnAllWeeksGrew` gated at
 * `>= 1`. The engine then never needs to know what a week is.
 *
 * `MetricGrain` below is what survives of that distinction — it exists purely so
 * the UI can tell someone *why* a number is what it is ("lowest week", "days
 * missing target") rather than showing a bare figure that doesn't match the
 * period average they were expecting.
 */

// ── Positions ────────────────────────────────────────────────────────────────

export type PositionId =
  | "gm"
  | "agm"
  | "driveThru"
  | "quality"
  | "training"
  | "hospitality";

/** The four Director roles that roll up into the AGM's scorecard. */
export const DIRECTOR_IDS: PositionId[] = ["driveThru", "quality", "training", "hospitality"];

export const POSITION_LABELS: Record<PositionId, string> = {
  gm: "General Manager",
  agm: "Assistant GM",
  driveThru: "Drive-Thru Director",
  quality: "Quality Director",
  training: "Training Director",
  hospitality: "Hospitality Director",
};

/** Column order on the attainment grid — org order, most senior first. */
export const POSITION_ORDER: PositionId[] = [
  "gm",
  "agm",
  "driveThru",
  "quality",
  "training",
  "hospitality",
];

// ── Conditions ───────────────────────────────────────────────────────────────

/**
 * A single numeric gate.
 *
 * `between` exists for the GM's labor and SPLH criteria, which are the only
 * two-sided tests in any of the six docs — labor is "21% – 22% of sales" for
 * threshold and "19% – 21%" for target, so a store can miss by being *too low*
 * as well as too high. Both bounds are inclusive.
 */
export type Gate =
  | { cmp: "gte" | "lte"; value: number }
  | { cmp: "between"; value: number; value2: number };

/**
 * How the resolver derived a metric from the underlying data. Display only —
 * the engine treats every metric identically.
 */
export type MetricGrain =
  /** Aggregated across the whole period (or period-to-date). The default. */
  | "period"
  /** The worst single week in the period — backs "any week with <X" tests. */
  | "weeklyMin"
  /** The best/highest single week — backs "≤N per week" tests. */
  | "weeklyMax"
  /** A count of days in the period that failed something. */
  | "dayCount"
  /** 1 if every week in the period passed, else 0. */
  | "allWeeks"
  /**
   * A reading taken at a moment rather than aggregated over the window,
   * because the source only ever reports "now" — Schoox cannot be asked what a
   * store's compliance was on a date that has passed. These move while the
   * period is open and are frozen at the first run after it closes; see
   * POINT_IN_TIME_METRICS in compute.ts.
   */
  | "snapshot"
  /** Typed in by a person; has no time shape of its own. */
  | "entered";

export type ConditionUnit =
  | "percent"
  | "seconds"
  | "count"
  | "currency"
  | "ratio"
  /** 0 = no, 1 = yes. */
  | "boolean"
  /** 0 = below expectations, 1 = Meets, 2 = Exceeds. */
  | "rating"
  /** A review marked out of ten, where the mark IS the attainment. */
  | "tenPoint";

export type Condition = {
  /**
   * Stable identifier. This is the primary key a manual entry is stored under
   * (`bonus_inputs.criterion_id`), so **renaming one orphans previously entered
   * data**. Change the label instead.
   */
  id: string;
  label: string;
  /** Which metric supplies the value. Auto metrics are computed; manual ones are typed in. */
  metric: string;
  source: "auto" | "manual";
  unit: ConditionUnit;
  grain: MetricGrain;
  /** Gate for 50% payout. */
  threshold: Gate;
  /** Gate for 100% payout. */
  target: Gate;
  /**
   * Sales-tiered gates, matched against weekly-equivalent sales. The first tier
   * whose `maxWeeklySales` is null or >= the store's sales wins, so order these
   * ascending. Present on the Drive-Thru SOS conditions, whose targets differ
   * by store volume.
   */
  tiers?: SalesTier[];
  /**
   * Only evaluated when this gate passes. Used for conditions the docs attach
   * to one branch of a tier — e.g. line busting is only required of stores
   * doing more than $85k/week.
   */
  appliesWhen?: { metric: string; gate: Gate };
  /**
   * Recorded and shown, but never scored.
   *
   * Exactly one criterion needs this: the GM doc lists "Culture: Conducts
   * Monday manager meetings consistently…" as a bullet inside the AGM
   * Performance category, which is otherwise entirely derived from the AGM's
   * score. The doc gives it no weight and no threshold/target split, so any
   * scoring rule here would be invented rather than transcribed. It's captured
   * on the entry form and displayed on the scorecard, flagged as unscored,
   * pending a policy decision.
   */
  advisory?: boolean;
  /** Caveat from the source doc, shown next to the condition in the UI. */
  note?: string;
};

export type SalesTier = {
  /** Upper bound of the tier in weekly sales dollars; null = no upper bound. */
  maxWeeklySales: number | null;
  threshold: Gate;
  target: Gate;
};

/** A condition set that multiplies a category's payout when it passes. */
export type Multiplier = {
  factor: number;
  label: string;
  /**
   * `any` — the docs list alternative triggers (Quality's 1.5× fires on a 100%
   * health inspection OR a 105 Steritech). `all` — every condition is required
   * (Hospitality's 1.25× needs OSAT, Friendliness AND Cleanliness at 90%).
   */
  mode: "any" | "all";
  conditions: Condition[];
};

export type Category = {
  id: string;
  label: string;
  /** Percentage points of the position's total. Categories must sum to 100. */
  weight: number;
  conditions: Condition[];
  /** Failing any of these zeroes THIS category only, never the whole position. */
  disqualifiers: Condition[];
  multipliers: Multiplier[];
  /**
   * Marks the "Living Our Values" category. Excluded when this position's score
   * is fed to its parent (AGM ignores Directors' LOV; GM ignores the AGM's), per
   * both source docs.
   */
  isLivingOurValues?: boolean;
  /**
   * How the category turns its conditions into a score.
   *
   * "strict" (the default, and every category from the docs bar one) is
   * all-or-nothing: every condition at Target scores 100%, every condition at
   * Threshold scores 50%, anything else scores 0. No partial credit.
   *
   * "proportionalTen" is the deliberate exception for Living Our Values, which
   * is a single review marked out of ten where the mark is the attainment —
   * 8 means 80% of the category, not "passed" or "failed". Applying the strict
   * ladder to it would throw away the only criterion on these scorecards that
   * carries a genuine gradient.
   */
  scoreMode?: "strict" | "proportionalTen";
  /**
   * Marks a category whose score comes from other positions rather than metrics:
   * the AGM's Director Performance and the GM's AGM Performance. These carry no
   * conditions and are filled in by the rollup.
   */
  derivedFrom?: PositionId[];
};

export type PositionRules = {
  id: PositionId;
  label: string;
  /** Google Doc id in the HRG Binder folder that this config was transcribed from. */
  sourceDocId: string;
  categories: Category[];
};

// ── Results ──────────────────────────────────────────────────────────────────

export type ConditionStatus =
  /** Met the 100% gate. */
  | "target"
  /** Met the 50% gate but not the 100% gate. */
  | "threshold"
  /** Met neither. */
  | "missed"
  /** No value available yet — NOT the same as a zero. */
  | "pending"
  /** `appliesWhen` did not hold, so this condition was skipped. */
  | "notApplicable";

export type ConditionResult = {
  condition: Condition;
  value: number | null;
  status: ConditionStatus;
  /** The gates actually used, after tier selection. */
  thresholdUsed: Gate;
  targetUsed: Gate;
  /**
   * True when this is the single condition that held the category back — it
   * cleared the level below but was the only one to miss the level above.
   * Drives the near-miss callout, which is the point of scoring strictly.
   */
  isNearMiss: boolean;
};

export type CategoryResult = {
  category: Category;
  /** 0, 0.5 or 1. Null when the category can't be scored yet. */
  score: number | null;
  /** Product of every multiplier that fired. 1 when none did. */
  multiplier: number;
  /** weight × score × multiplier. Null while the category is pending. */
  payout: number | null;
  conditions: ConditionResult[];
  disqualifiers: ConditionResult[];
  /**
   * Every multiplier's criteria, evaluated whether or not it fired.
   *
   * These used to be discarded once a multiplier had been resolved, which left
   * four manual criteria — the external Steritech scores, the health-inspection
   * bonus and the pipeline promotion — with nowhere to be displayed or entered,
   * since they appear only inside a multiplier.
   */
  multiplierGroups: {
    factor: number;
    label: string;
    mode: "any" | "all";
    fired: boolean;
    results: ConditionResult[];
  }[];
  multipliersFired: { factor: number; label: string }[];
  /** Set when a disqualifier fired; score is forced to 0. */
  disqualifiedBy: string | null;
  /** Conditions still waiting on a manual entry. */
  pendingCount: number;
  /**
   * The result a person set by hand — 0, 50 or 100 — or null when the score is
   * the computed one. Kept separate from `score` so the card can say that a
   * figure was decided rather than measured.
   */
  scoreOverride: number | null;
};

export type PositionResult = {
  positionId: PositionId;
  storeId: string;
  periodLabel: string;
  categories: CategoryResult[];
  /** Total attainment as a percentage, kicker applied. Null if nothing is scoreable. */
  score: number | null;
  /**
   * Same total with the Living Our Values category removed and the remaining
   * weights renormalised. This is what the parent position consumes.
   */
  scoreExLov: number | null;
  /** 1.25 when the Transaction Growth kicker fired, else 1. */
  kicker: number;
  kickerFired: boolean;
  /** How many conditions across all categories are still awaiting entry. */
  pendingCount: number;
  /** Sum of the weights of categories that could be scored. 100 = fully scoreable. */
  scoreableWeight: number;
};

// ── Stored manual input ──────────────────────────────────────────────────────

export type BonusInput = {
  storeId: string;
  periodLabel: string;
  criterionId: string;
  value: number | null;
  note: string | null;
  enteredBy: string | null;
  updatedAt: string;
};
