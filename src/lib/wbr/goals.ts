/**
 * Red / yellow / green for every goal-tied number in the store deck, in one
 * place. Each band is the one the matching dashboard tab or bonus scorecard
 * already uses — the deck adds none of its own except where noted:
 *
 *   COGS %, variance %      lib/foodCostGoals (Food Cost tab)
 *   lane / window time      lib/salesTierGoals (Drive-Thru tab), by weekly sales tier
 *   pull-forwards           ≤4 a week (Drive-Thru Director scorecard); no yellow defined
 *   SMG scores              surveyMeta.scoreTone (SMG tab): ≥80 / ≥75; Experienced Problem inverted
 *   ZCases opened           bonus/goals ZCASE_GOALS: ≤4 / ≤8 a period
 *   ZCases within 24 hrs    bonus/goals ZCASE_GOALS: 100% / ≥95%
 *   ZU compliance           ZU tab: 100% / ≥95%
 *   Jolt completion         Jolt tab and Quality Director scorecard: 100% / ≥95%
 *   Slack completion        GM scorecard target 95%. The scorecard has no lower
 *                           band; the deck reads 90–95% as yellow. (deck's own)
 *   SPLH / TPLH             the store's WBR target floor (lib/wbr/targets) is
 *                           green. Within 5% under it reads yellow — for TN's
 *                           5.25 TPLH that lands on the GM scorecard's 5.0
 *                           threshold. (deck's own)
 */

import type { Tone } from "@/lib/wbr/draw";
import { cogsLevel, varianceLevel } from "@/lib/foodCostGoals";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS } from "@/lib/salesTierGoals";
import { scoreTone } from "@/lib/surveyMeta";
import { ZCASE_GOALS } from "@/lib/bonus/goals";

const band = (v: number | null | undefined, green: (v: number) => boolean, yellow: (v: number) => boolean): Tone =>
  v == null || !isFinite(v) ? "neutral" : green(v) ? "good" : yellow(v) ? "warn" : "bad";

const level = (l: "good" | "warn" | "bad" | null): Tone => l ?? "neutral";

export const cogsTone = (v: number | null | undefined): Tone => level(cogsLevel(v ?? null));
export const varianceTone = (v: number | null | undefined): Tone => level(varianceLevel(v ?? null));

/** Lane or window seconds against the Drive-Thru tab's goal for the store's weekly sales tier. */
export function driveTone(secs: number | null | undefined, weeklySales: number | null | undefined, field: "lane" | "window"): Tone {
  if (secs == null || weeklySales == null) return "neutral";
  const tier = (field === "lane" ? TOTAL_TIME_TIERS : WINDOW_TIME_TIERS).find((t) => t.test(weeklySales));
  return tier ? band(secs, (s) => s <= tier.greenMax, (s) => s <= tier.yellowMax) : "neutral";
}

/** The goal and the edge of yellow, in seconds, for charting as lines. */
export function driveGoal(weeklySales: number | null | undefined, field: "lane" | "window"): { green: number; yellow: number; tier: string } | null {
  if (weeklySales == null) return null;
  const tier = (field === "lane" ? TOTAL_TIME_TIERS : WINDOW_TIME_TIERS).find((t) => t.test(weeklySales));
  return tier ? { green: tier.greenMax, yellow: tier.yellowMax, tier: tier.label } : null;
}

export const PULL_FORWARD_GOAL = 4;
export const pullForwardTone = (n: number | null | undefined): Tone => band(n, (v) => v <= PULL_FORWARD_GOAL, () => false);

export function smgTone(score: number | null | undefined, metric: string): Tone {
  const t = scoreTone(score ?? null, metric);
  return t === "good" ? "good" : t === "ok" ? "warn" : t === "bad" ? "bad" : "neutral";
}

export const zcaseCountTone = (n: number | null | undefined): Tone =>
  band(n, (v) => v <= ZCASE_GOALS.count.target, (v) => v <= ZCASE_GOALS.count.threshold);
export const zcase24Tone = (pct: number | null | undefined): Tone =>
  band(pct, (v) => v >= ZCASE_GOALS.resolvedWithin24Pct.target, (v) => v >= ZCASE_GOALS.resolvedWithin24Pct.threshold);

export const zuTone = (pct: number | null | undefined): Tone => band(pct, (v) => v >= 100, (v) => v >= 95);
export const joltTone = (pct: number | null | undefined): Tone => band(pct, (v) => v >= 100, (v) => v >= 95);
export const slackTone = (pct: number | null | undefined): Tone => band(pct, (v) => v >= 95, (v) => v >= 90);

/** SPLH or TPLH against the store's WBR floor; yellow within 5% under it. */
export const productivityTone = (v: number | null | undefined, floor: number | null | undefined): Tone =>
  floor == null ? "neutral" : band(v, (x) => x >= floor, (x) => x >= floor * 0.95);
