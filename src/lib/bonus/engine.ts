/**
 * Bonus attainment scoring.
 *
 * Pure functions over a bag of numbers — no database, no fetching, no dates.
 * Everything time-shaped or vendor-shaped happens in metrics.ts and arrives
 * here as `MetricValues`. That split is deliberate: these are the numbers
 * people get paid on, so the part that decides them has to be testable without
 * standing up SMG, PAR, Net-Chef and BerryAI first.
 *
 * ── Scoring rules, and where they came from ──────────────────────────────────
 *
 * **Strict, as written** (Josh's call): every condition in a category must hit
 * Target for 100%, else every condition must hit Threshold for 50%, else 0%.
 * No partial credit inside a category. Target is checked *first* rather than
 * assuming Target implies Threshold — it doesn't, for the GM's two-sided labor
 * gate, where 20% of sales hits the 19–21% Target while missing the 21–22%
 * Threshold entirely.
 *
 * **Pending is not zero.** A condition with no value yet leaves the category
 * unscored (`null`), never scored as a miss. Under strict scoring a single
 * missing entry would otherwise zero a category that is actually on track, and
 * most criteria in these docs have no automated source. The exception is a
 * condition that has *definitively* missed Threshold — that conclusion doesn't
 * need the rest of the category, so it resolves to 0 immediately.
 *
 * **Absent disqualifiers don't fire.** Disqualifiers describe exceptional bad
 * events (a failed health inspection, a dishonest mock audit). No record means
 * the event didn't happen, so a blank disqualifier passes rather than blocking
 * the category. It's still counted in `pendingCount`, so the UI can say the
 * score rests on unconfirmed inputs.
 *
 * **Multipliers take the highest, not the product.** Two of the docs list more
 * than one multiplier against the same pool — Training's retention category
 * offers ×1.25 at 60-day 95% and ×1.5 at 90-day 95%, and a store hitting both
 * would compound to ×1.875 if these stacked. Reading them as alternatives is
 * the conservative interpretation and matches how the other four docs phrase
 * theirs. **This is an interpretation, not something the docs state.**
 */

import {
  BONUS_RULES,
  TRANSACTION_KICKER,
  TRANSACTION_KICKER_FACTOR,
  assertWeightsValid,
  categoryOverrideId,
} from "./rules";
import { DIRECTOR_IDS } from "./types";
import type {
  Category,
  CategoryResult,
  Condition,
  ConditionResult,
  ConditionStatus,
  Gate,
  PositionId,
  PositionResult,
} from "./types";

/**
 * Every metric the engine can see, auto and manual merged.
 * A key being absent means "not known yet" — distinct from a value of 0.
 */
export type MetricValues = Map<string, number>;

// ── Gates ────────────────────────────────────────────────────────────────────

export function passesGate(value: number, gate: Gate): boolean {
  // Tested positively so the union narrows: excluding "gte" then "lte" leaves
  // TS unable to discard the first member, whose cmp is itself a union.
  if (gate.cmp === "between") return value >= gate.value && value <= gate.value2;
  return gate.cmp === "gte" ? value >= gate.value : value <= gate.value;
}

export function formatGate(gate: Gate, unit: Condition["unit"]): string {
  const n = (v: number) => {
    if (unit === "seconds") {
      const m = Math.floor(v / 60);
      return `${m}:${String(Math.round(v % 60)).padStart(2, "0")}`;
    }
    if (unit === "percent") return `${v}%`;
    if (unit === "currency") return `$${v.toLocaleString("en-US")}`;
    return String(v);
  };
  if (unit === "boolean") return gate.cmp === "lte" && gate.value === 0 ? "No" : "Yes";
  if (unit === "rating") return gate.value >= 2 ? "Exceeds" : gate.value >= 1 ? "Meets" : "—";
  if (gate.cmp === "between") return `${n(gate.value)}–${n(gate.value2)}`;
  return `${gate.cmp === "gte" ? "≥" : "≤"} ${n(gate.value)}`;
}

/**
 * Pick the gates for a condition, resolving sales tiers.
 *
 * Tiers are matched against weekly-equivalent sales and must be listed
 * ascending; the first whose bound is null or >= the store's sales wins. When
 * sales aren't known the condition's own base gates stand — better to score
 * against the stricter default than to skip a Drive-Thru time criterion
 * entirely because a sales figure was late.
 */
export function resolveGates(
  condition: Condition,
  values: MetricValues
): { threshold: Gate; target: Gate } {
  if (!condition.tiers?.length) {
    return { threshold: condition.threshold, target: condition.target };
  }
  const sales = values.get("weeklyEquivalentSales");
  if (sales === undefined) {
    return { threshold: condition.threshold, target: condition.target };
  }
  const tier =
    condition.tiers.find((t) => t.maxWeeklySales === null || sales <= t.maxWeeklySales) ??
    condition.tiers[condition.tiers.length - 1];
  return { threshold: tier.threshold, target: tier.target };
}

// ── Conditions ───────────────────────────────────────────────────────────────

function evaluateCondition(condition: Condition, values: MetricValues): ConditionResult {
  const { threshold, target } = resolveGates(condition, values);
  const base = { condition, thresholdUsed: threshold, targetUsed: target, isNearMiss: false };

  if (condition.appliesWhen) {
    const gateValue = values.get(condition.appliesWhen.metric);
    // An unknown guard value is treated as "does not apply". The only user of
    // appliesWhen is line busting, which the doc requires solely of stores above
    // $85k/week — assuming it applies when we can't tell would penalise a store
    // for a missing sales figure.
    if (gateValue === undefined || !passesGate(gateValue, condition.appliesWhen.gate)) {
      return { ...base, value: null, status: "notApplicable" };
    }
  }

  const value = values.get(condition.metric);
  if (value === undefined) return { ...base, value: null, status: "pending" };

  const status: ConditionStatus = passesGate(value, target)
    ? "target"
    : passesGate(value, threshold)
      ? "threshold"
      : "missed";

  return { ...base, value, status };
}

/** Conditions that actually count toward the category score. */
function isScoreable(r: ConditionResult): boolean {
  return !r.condition.advisory && r.status !== "notApplicable";
}

// ── Categories ───────────────────────────────────────────────────────────────

function scoreCategory(
  category: Category,
  values: MetricValues,
  overrideId?: string,
): CategoryResult {
  /**
   * A decision about the outcome, entered on the category itself.
   *
   * Applied over everything — a disqualifier, a pending criterion, a computed
   * score — because its whole purpose is to say "I have seen what this says and
   * the answer is X". Overriding the inputs instead meant guessing which number
   * to bend to move a category off a miss, which is a worse thing to record
   * than the judgement itself.
   *
   * Any percentage of the category from 0 to 100, not just the three results
   * the strict ladder can produce — a category is often part-earned in a way
   * the doc has no gate for. Anything outside that range is ignored rather than
   * trusted, since a stray value here pays out. Exceeding 100% stays the
   * multipliers' job, which is where the docs put it.
   */
  const rawOverride = overrideId ? values.get(overrideId) : undefined;
  const scoreOverride =
    typeof rawOverride === "number" && Number.isFinite(rawOverride) && rawOverride >= 0 && rawOverride <= 100
      ? rawOverride
      : null;
  const overrideScore = scoreOverride === null ? null : scoreOverride / 100;

  const conditions = category.conditions.map((c) => evaluateCondition(c, values));
  const disqualifiers = category.disqualifiers.map((c) => evaluateCondition(c, values));

  // A disqualifier fires only on a value we actually have that fails its gate.
  const fired = disqualifiers.find((d) => d.value !== null && d.status === "missed");
  const pendingDisqualifiers = disqualifiers.filter((d) => d.status === "pending").length;

  const scoreable = conditions.filter(isScoreable);
  const pendingConditions = scoreable.filter((r) => r.status === "pending").length;
  const pendingCount = pendingConditions + pendingDisqualifiers;

  // Evaluated up front and unconditionally: the scorecard has to show these
  // criteria (and let them be entered) even when the category is disqualified
  // or its multiplier can't apply.
  const groups = category.multipliers.map((m) => {
    const results = m.conditions.map((c) => evaluateCondition(c, values));
    const hit =
      m.mode === "any"
        ? results.some((r) => r.status === "target")
        : results.length > 0 && results.every((r) => r.status === "target");
    return { factor: m.factor, label: m.label, mode: m.mode, fired: hit, results };
  });

  if (fired) {
    return {
      category,
      score: overrideScore ?? 0,
      computedScore: 0,
      multiplier: 1,
      payout: category.weight * (overrideScore ?? 0),
      scoreOverride,
      conditions,
      disqualifiers,
      multiplierGroups: groups.map((g) => ({ ...g, fired: false })),
      multipliersFired: [],
      disqualifiedBy: fired.condition.label,
      pendingCount,
    };
  }

  let score: number | null;
  if (category.scoreMode === "proportionalTen") {
    // The mark IS the attainment: 8 out of 10 earns 80% of the category, not a
    // pass or a fail. This is the one place partial credit exists, so it sits
    // ahead of the strict ladder rather than inside it — every branch below
    // assumes a category is won or lost outright.
    const only = scoreable[0];
    const mark = only?.value ?? null;
    score = mark === null ? null : Math.min(1, Math.max(0, mark / 10));
  } else if (scoreable.length === 0) {
    // A category with nothing to score (the derived ones) is filled in later by
    // the rollup; treat it as pending here rather than as a perfect zero.
    score = null;
  } else if (scoreable.some((r) => r.status === "missed")) {
    // Definitive: one condition missed even the Threshold gate, so no
    // combination of the remaining values can lift this category off zero.
    score = 0;
  } else if (pendingConditions > 0) {
    score = null;
  } else if (scoreable.every((r) => r.status === "target")) {
    score = 1;
  } else if (scoreable.every((r) => passesGate(r.value as number, r.thresholdUsed))) {
    score = 0.5;
  } else {
    // Reachable only with two-sided gates, where a value can clear Target while
    // failing Threshold and vice versa across different conditions.
    score = 0;
  }

  // Kept before the override replaces it: the card shows both, so the reader
  // can see what was decided and what it was decided against.
  const computedScore = score;
  if (overrideScore !== null) score = overrideScore;

  // A multiplier can only lift a category that scored something — there is
  // nothing to multiply a zero or an unscored category by.
  const eligible = score !== null && score > 0;
  const applied = groups.map((g) => ({ ...g, fired: eligible && g.fired }));
  const multipliersFired = applied
    .filter((g) => g.fired)
    .map((g) => ({ factor: g.factor, label: g.label }));
  // Highest, not product — see the note at the top of this file.
  const multiplier = multipliersFired.reduce((best, m) => Math.max(best, m.factor), 1);

  // A near miss is "one condition short of the next level up", which has no
  // meaning where the score is a gradient — and a 5 out of 10 lands on exactly
  // the 0.5 the flag keys off, so without this it would be labelled as one.
  // A near miss explains a computed score; it says nothing about one that was
  // decided, so it is not marked on an overridden category either.
  if (category.scoreMode !== "proportionalTen" && scoreOverride === null) {
    markNearMisses(scoreable, score);
  }

  return {
    category,
    score,
    multiplier,
    payout: score === null ? null : category.weight * score * multiplier,
    conditions,
    disqualifiers,
    multiplierGroups: applied,
    multipliersFired,
    disqualifiedBy: null,
    pendingCount,
    scoreOverride,
    computedScore,
  };
}

/**
 * Flag the single condition that held a category back.
 *
 * Only meaningful when exactly one condition fell short — if three conditions
 * missed Target there is no "the one that cost it", and highlighting all three
 * would just restate the table. This is the whole point of scoring strictly
 * rather than averaging: the scorecard should say what to go fix.
 */
function markNearMisses(scoreable: ConditionResult[], score: number | null): void {
  if (score === null) return;
  if (score === 0.5) {
    const short = scoreable.filter((r) => r.status !== "target");
    if (short.length === 1) short[0].isNearMiss = true;
  } else if (score === 0) {
    const short = scoreable.filter((r) => r.status === "missed");
    if (short.length === 1) short[0].isNearMiss = true;
  }
}

// ── Positions ────────────────────────────────────────────────────────────────

/**
 * Score one position for one store and period.
 *
 * Derived categories (the AGM's Director Performance, the GM's AGM Performance)
 * come back unscored — `scorePeriod` fills them in once their children exist.
 */
export function scorePosition(
  positionId: PositionId,
  storeId: string,
  periodLabel: string,
  values: MetricValues
): PositionResult {
  const rules = BONUS_RULES[positionId];
  const categories = rules.categories.map((c) =>
    scoreCategory(c, values, categoryOverrideId(positionId, c.id)),
  );

  const kickerResult = evaluateCondition(TRANSACTION_KICKER, values);
  const kickerFired = kickerResult.status === "target";
  const kicker = kickerFired ? TRANSACTION_KICKER_FACTOR : 1;

  return {
    positionId,
    storeId,
    periodLabel,
    categories,
    ...totals(categories, kicker),
    kicker,
    kickerFired,
    pendingCount: categories.reduce((s, c) => s + c.pendingCount, 0),
  };
}

/**
 * Roll categories up into the two position totals.
 *
 * `score` sums only the categories that could be scored, so a store with three
 * of five categories filled in reports what those three earned rather than
 * nothing at all. `scoreableWeight` says how much of the scorecard that
 * represents — the two must always be read together, which is why the grid
 * prints the pending count next to every cell.
 *
 * `scoreExLov` drops the Living Our Values category and renormalises the
 * remaining weights back to 100. Both the AGM and GM docs exclude it explicitly
 * ("GM bonus is not reduced if AGM does not achieve their full Living Our
 * Values bonus"). It also deliberately excludes the kicker: the parent's own
 * scorecard carries the same store's transaction growth, so passing an already
 * multiplied score upward would apply it twice.
 */
function totals(
  categories: CategoryResult[],
  kicker: number
): { score: number | null; scoreExLov: number | null; scoreableWeight: number } {
  const scored = categories.filter((c) => c.payout !== null);
  const scoreableWeight = scored.reduce((s, c) => s + c.category.weight, 0);
  if (scored.length === 0) {
    return { score: null, scoreExLov: null, scoreableWeight: 0 };
  }

  const score = scored.reduce((s, c) => s + (c.payout as number), 0) * kicker;

  const exLov = scored.filter((c) => !c.category.isLivingOurValues);
  const exLovWeight = exLov.reduce((s, c) => s + c.category.weight, 0);
  const scoreExLov =
    exLovWeight === 0
      ? null
      : (exLov.reduce((s, c) => s + (c.payout as number), 0) / exLovWeight) * 100;

  return { score, scoreExLov, scoreableWeight };
}

// ── Rollup ───────────────────────────────────────────────────────────────────

/**
 * Score all six positions for a store, in dependency order.
 *
 * Directors first, because the AGM's 90% Director Performance category is the
 * mean of their four ex-LOV scores; then the AGM, because the GM's 50% AGM
 * Performance category is the AGM's ex-LOV score. A Director that can't be
 * scored at all is left out of the mean rather than counted as zero — with most
 * Director criteria awaiting manual entry, averaging in zeros would make every
 * AGM and GM in the company look like they were failing.
 */
export function scoreStore(
  storeId: string,
  periodLabel: string,
  values: MetricValues
): Record<PositionId, PositionResult> {
  assertWeightsValid();

  const results = {} as Record<PositionId, PositionResult>;

  for (const id of DIRECTOR_IDS) {
    results[id] = scorePosition(id, storeId, periodLabel, values);
  }

  const directorScores = DIRECTOR_IDS.map((id) => results[id].scoreExLov).filter(
    (s): s is number => s !== null
  );
  results.agm = applyDerived(
    scorePosition("agm", storeId, periodLabel, values),
    "director_performance",
    directorScores.length ? directorScores.reduce((a, b) => a + b, 0) / directorScores.length : null,
    `${directorScores.length} of ${DIRECTOR_IDS.length} Directors scored`
  );

  results.gm = applyDerived(
    scorePosition("gm", storeId, periodLabel, values),
    "agm_performance",
    results.agm.scoreExLov,
    "AGM scorecard excluding Living Our Values"
  );

  return results;
}

/**
 * Fill a derived category in and recompute the position's totals.
 *
 * `derivedPct` is an attainment percentage (0–100), so a category weighted at
 * 90 with an 85% input contributes 76.5 points — which is exactly the worked
 * example in the AGM doc ("If Directors average 85% attainment, AGM earns 85%
 * of their Director Performance pool").
 */
function applyDerived(
  result: PositionResult,
  categoryId: string,
  derivedPct: number | null,
  sourceLabel: string
): PositionResult {
  const categories = result.categories.map((c) => {
    if (c.category.id !== categoryId) return c;

    // This runs after scoreCategory, so it has to put back anything that stage
    // decided. An override on a derived category was being dropped outright:
    // the score was overwritten with the rolled-up figure and the decision
    // lost, silently, on the two categories a GM and an AGM are largely
    // judged by.
    const overrideScore = c.scoreOverride === null ? null : c.scoreOverride / 100;

    if (derivedPct === null) {
      return {
        ...c,
        score: overrideScore,
        computedScore: null,
        payout: overrideScore === null ? null : c.category.weight * overrideScore,
        disqualifiedBy: null,
      };
    }

    const derived = derivedPct / 100;
    const score = overrideScore ?? derived;
    return {
      ...c,
      score,
      // The rolled-up figure is what this category computes to, so it is what
      // the card shows beside an override.
      computedScore: derived,
      multiplier: 1,
      payout: c.category.weight * score,
      multipliersFired: [{ factor: 1, label: sourceLabel }],
    };
  });

  return {
    ...result,
    categories,
    ...totals(categories, result.kicker),
    pendingCount: categories.reduce((s, c) => s + c.pendingCount, 0),
  };
}
