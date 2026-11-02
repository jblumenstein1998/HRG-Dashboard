/**
 * Red / yellow / green for every goal-tied number in the store deck, in one
 * place. Green is the 100% (target) level, yellow the 50% (threshold) level, red
 * below — the Store Operating Targets sheet (2026-11-02).
 *
 * Where the bonus scorecards score a metric, the bands are read from
 * lib/bonus/rules.ts itself (ruleTone), so the deck can't drift from what's
 * paid on: productivity and TPLH (GM), Jolt (Quality), ZU and Slack (GM). The
 * rest use the dashboard tab's own module, which matches the same sheet:
 *
 *   COGS %, variance %      lib/foodCostGoals (Food Cost tab)
 *   lane / window time      lib/salesTierGoals (Drive-Thru tab), by weekly sales tier
 *   pull-forwards           ≤4 a week (Drive-Thru Director scorecard); no 50% level
 *   SMG scores              surveyMeta.scoreTone (SMG tab): 80 / 75, accuracy 90 / 85;
 *                           Experienced Problem inverted (≤5 / ≤10, the tab's own)
 *   ZCases                  bonus/goals ZCASE_GOALS
 *
 * One deliberate departure: productivity above its range stays green (Josh,
 * 2026-11-02), where the scorecard's "between" gate would miss it.
 */

import type { Tone } from "@/lib/wbr/draw";
import { cogsLevel, varianceLevel } from "@/lib/foodCostGoals";
import { TOTAL_TIME_TIERS, WINDOW_TIME_TIERS } from "@/lib/salesTierGoals";
import { scoreTone } from "@/lib/surveyMeta";
import { ZCASE_GOALS } from "@/lib/bonus/goals";
import { BONUS_RULES } from "@/lib/bonus/rules";
import { passesGate, resolveGates } from "@/lib/bonus/engine";
import type { Condition, Gate } from "@/lib/bonus/types";

// ── Bands read from the bonus rules ──────────────────────────────────────────

type Node = { conditions?: Node[]; disqualifiers?: Node[]; categories?: Node[]; id?: string; metric?: string };

/** Every scored condition by id, walking scorecards → categories → (groups →) conditions. */
const CONDITIONS: Map<string, Condition> = (() => {
  const out = new Map<string, Condition>();
  const walk = (n: Node) => {
    if (n.metric && n.id) out.set(n.id, n as unknown as Condition);
    for (const k of ["categories", "conditions", "disqualifiers"] as const) for (const x of n[k] ?? []) walk(x);
  };
  for (const card of (Array.isArray(BONUS_RULES) ? BONUS_RULES : Object.values(BONUS_RULES)) as Node[]) walk(card);
  return out;
})();

/** A condition's 50% (threshold) and 100% (target) gates, at the store's weekly sales tier. */
export function ruleGates(id: string, weeklySales?: number | null): { threshold: Gate; target: Gate } {
  const c = CONDITIONS.get(id);
  if (!c) throw new Error(`No bonus condition "${id}"`);
  return resolveGates(c, new Map(weeklySales != null ? [["weeklyEquivalentSales", weeklySales]] : []));
}

/** A range read as its floor — above the range still counts. */
const floorOf = (g: Gate): Gate => (g.cmp === "between" ? { cmp: "gte", value: g.value } : g);

export function ruleTone(id: string, v: number | null | undefined, opts: { weeklySales?: number | null; floorOnly?: boolean } = {}): Tone {
  if (v == null || !isFinite(v)) return "neutral";
  let { threshold, target } = ruleGates(id, opts.weeklySales);
  if (opts.floorOnly) {
    threshold = floorOf(threshold);
    target = floorOf(target);
  }
  return passesGate(v, target) ? "good" : passesGate(v, threshold) ? "warn" : "bad";
}

/** "$82–87", "≥ 5.25", "≥ 95%" — a gate as the sheet prints it. */
export function gateLabel(g: Gate, fmt: (v: number) => string): string {
  if (g.cmp === "between") return `${fmt(g.value)}–${fmt(g.value2)}`;
  return `${{ gte: "≥", lte: "≤", gt: ">", lt: "<" }[g.cmp]} ${fmt(g.value)}`;
}

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

export const zuTone = (pct: number | null | undefined): Tone => ruleTone("gm_zu_completion", pct);
export const joltTone = (pct: number | null | undefined): Tone => ruleTone("q_jolt_completion", pct);
export const slackTone = (pct: number | null | undefined): Tone => ruleTone("gm_slack_completion", pct);

/** Productivity (SPLH) at the store's sales tier; above the range is still green. */
export const productivityTone = (v: number | null | undefined, weeklySales: number | null | undefined): Tone =>
  ruleTone("gm_splh", v, { weeklySales, floorOnly: true });
export const tplhTone = (v: number | null | undefined): Tone => ruleTone("gm_tplh", v);
