/**
 * The Store Operating Targets sheet, as the dashboard actually scores it.
 *
 * Laid out like the one-page sheet (HRG Operating Targets, 2026-11-02) — same
 * sections, same rows — but every number is read from lib/bonus/rules.ts at
 * render time, so the Admin tab can only ever publish what the scorecards pay
 * on. Change a target there and this page changes with it.
 *
 * Server-only: it imports the rules. The Admin page builds it and hands the
 * plain rows to the client.
 */

import { BONUS_RULES, TRANSACTION_KICKER_FACTOR } from "@/lib/bonus/rules";
import { fmtGateValue } from "@/lib/bonus/display";
import type { Condition, Gate } from "@/lib/bonus/types";

export type TargetRow = { metric: string; threshold: string; target: string; note?: string };
export type TargetSection = { title: string; rows: TargetRow[] };
export type OperatingTargets = {
  northStar: string;
  sections: TargetSection[];
  guardrails: string[];
  /** Scored or coloured by the dashboard, but not on the sheet. */
  notOnSheet: TargetRow[];
};

type Node = { conditions?: Node[]; disqualifiers?: Node[]; categories?: Node[]; multipliers?: Node[]; id?: string; metric?: string };

function conditions(): Map<string, Condition> {
  const out = new Map<string, Condition>();
  const walk = (n: Node) => {
    if (n.metric && n.id && !out.has(n.id)) out.set(n.id, n as unknown as Condition);
    for (const k of ["categories", "conditions", "disqualifiers", "multipliers"] as const) for (const x of n[k] ?? []) walk(x);
  };
  for (const card of (Array.isArray(BONUS_RULES) ? BONUS_RULES : Object.values(BONUS_RULES)) as Node[]) walk(card);
  return out;
}

const k = (v: number) => `$${Math.round(v / 1000)}k`;
const SIGN = { gte: "≥", lte: "≤", gt: ">", lt: "<" } as const;

/** A gate as the sheet prints it; ten-point and yes/no scales read in words. */
function gate(g: Gate, unit: Condition["unit"]): string {
  if (unit === "tenPoint") return g.cmp === "between" ? `${g.value}–${g.value2} / 10` : `${SIGN[g.cmp]} ${g.value} / 10`;
  if (unit === "boolean") return g.cmp === "lte" && g.value === 0 ? "No" : "Yes";
  // As the sheet prints them: a full mark needs no "≥", nothing allowed reads 0.
  if (g.cmp === "gte" && unit === "percent" && g.value === 100) return "100%";
  if (g.cmp === "lte" && g.value === 0) return "0";
  if (g.cmp !== "between" && unit === "ratio") return `${SIGN[g.cmp]} ${g.value.toFixed(2)}`;
  return fmtGateValue(g, unit);
}

export function buildOperatingTargets(): OperatingTargets {
  const byId = conditions();
  const c = (id: string) => {
    const x = byId.get(id);
    if (!x) throw new Error(`Operating targets: no bonus condition "${id}"`);
    return x;
  };

  /** One row, or one per sales tier ("… | sales ≤$45k/wk"). */
  /**
   * `allOrNothing`: the sheet gives no threshold — the rules set threshold =
   * target so the category pays all or nothing — and prints "—" for it.
   * `words`: print these instead of the gates (Living Our Values' Meets /
   * Exceeds, which the rules hold as display gates on a ten-point review).
   */
  const row = (
    id: string,
    metric: string,
    opts: { note?: string; target?: (t: string) => string; both?: (s: string) => string; allOrNothing?: boolean; words?: [string, string] } = {},
  ): TargetRow[] => {
    const x = c(id);
    if (opts.words) return [{ metric, threshold: opts.words[0], target: opts.words[1], note: opts.note }];
    const b = opts.both ?? ((s: string) => s);
    const t = (s: string) => (opts.target ?? ((v: string) => v))(b(s));
    if (opts.allOrNothing) return [{ metric, threshold: "—", target: t(gate(x.target, x.unit)), note: opts.note }];
    if (!x.tiers?.length) return [{ metric, threshold: b(gate(x.threshold, x.unit)), target: t(gate(x.target, x.unit)), note: opts.note }];
    let prev: number | null = null;
    return x.tiers.map((tier) => {
      const band = tier.maxWeeklySales === null ? `sales >${k(prev!)}/wk` : `sales ≤${k(tier.maxWeeklySales)}/wk`;
      prev = tier.maxWeeklySales ?? prev;
      return { metric: `${metric} | ${band}`, threshold: b(gate(tier.threshold, x.unit)), target: t(gate(tier.target, x.unit)), note: opts.note };
    });
  };

  const dq = (id: string, text: (pass: string) => string) => {
    const x = c(id);
    return text(gate(x.target, x.unit));
  };

  return {
    northStar: `Grow transactions year over year in EVERY week of the bonus period — ${TRANSACTION_KICKER_FACTOR}× total bonus kicker across all six plans; one missed week means no kicker.`,
    sections: [
      {
        title: "Guest experience & drive-thru",
        rows: [
          ...row("dt_window_time", "Drive-thru window"),
          ...row("dt_total_time", "Drive-thru total"),
          ...row("order_accuracy_hosp", "Order accuracy"),
          ...row("hosp_osat", "SMG top-box | OSAT, friendly, clean", { note: "each" }),
          ...row("hosp_response_rate", "SMG survey count"),
          ...row("hosp_zcase_resolution", "Z-Cases resolved within 24 hours"),
          ...row("hosp_zcase_count", "Z-Cases | total count"),
          ...row("hosp_facility_inspection", "Monthly guest-area inspection"),
        ],
      },
      {
        title: "Financial & inventory control",
        rows: [
          ...row("gm_labor_pct", "Labor as % of sales"),
          ...row("gm_splh", "Productivity (SPLH)"),
          ...row("gm_tplh", "Transactions per labor hour (TPLH)"),
          ...row("gm_cogs", "COGS / food cost"),
          ...row("q_food_cost_variance", "Food-cost variance vs. theoretical", { both: (s) => s.replace("≤ ", "± ") }),
          ...row("q_critical_counts", "Daily critical inventory completion"),
          ...row("q_truck_order_resolution", "Truck-order discrepancies resolved (hrs)"),
        ],
      },
      {
        title: "Food safety & reporting",
        rows: [
          ...row("q_jolt_completion", "Jolt checklist completion"),
          ...row("q_mock_steritech_weekly", "Mock Food Safety Steritech weekly"),
          ...row("agm_mock_rer_weekly", "Mock RER Steritech weekly"),
          ...row("q_reports_24h", "Quality reports sent within 24 hrs"),
        ],
      },
      {
        title: "Training & people development",
        rows: [
          ...row("t_onboarding_completion", "Week 1 / Week 2 onboarding on time"),
          ...row("t_lto_compliance", "Full-team LTO training compliance"),
          ...row("t_focus_area_improvement", "End-of-period training focus lift"),
          ...row("t_retention_30", "30-day new-hire retention"),
          ...row("t_retention_60", "60-day new-hire retention"),
          ...row("t_retention_90", "90-day new-hire retention"),
          ...row("t_shift_lead_pipeline", "Shift Lead bench (candidates)"),
        ],
      },
      {
        title: "StandardZ, culture & execution",
        rows: [
          ...row("gm_zu_completion", "ZU course completion", { allOrNothing: true }),
          ...row("gm_servesafe", "ServSafe certifications current", {
            allOrNothing: true,
            target: () => "100%",
            note: "at least one person at 100% on ServSafe Manager in ZU",
          }),
          ...row("gm_missed_lto_deadlines", "Missed POP / LTO deadlines", { allOrNothing: true }),
          ...row("gm_slack_completion", "Slack completion rate", { allOrNothing: true }),
          ...row("hosp_recognition", "Team recognition activities", { target: (t) => `${t} + positive pulse check` }),
          ...row("lov_hospitality", "Living Our Values review", { words: ["Meets", "Exceeds"] }),
        ],
      },
    ],
    guardrails: [
      dq("dt_days_missing_target", (p) => `Speed of service: missed-target days must be ${p} a period`),
      dq("dt_accuracy_weekly_floor", (p) => `Order accuracy ${p} in every week`),
      dq("hosp_osat_weekly_floor", (p) => `SMG OSAT, Friendliness and Cleanliness ${p} in every week`),
      dq("q_jolt_on_time", (p) => `Jolt on-time completion ${p}`),
      dq("q_health_inspection_score", (p) => `County health score ${p}, no failure`),
      "No high-risk RER or Food Safety finding; no guest-area cleanliness violation",
      "Weekly mocks completed thoroughly and honestly",
      dq("t_bin_management", (p) => `Bin management ${p}`),
      "Never complete another person's ZU",
    ],
    notOnSheet: [
      {
        metric: "Flagged drive-thru pull-forwards, every week",
        threshold: "—",
        target: gate(c("dt_pull_forwards").target, "count"),
        note: "Drive-Thru Director: 1.25× on Speed of Service when met every week",
      },
      { metric: "SMG Experienced a Problem", threshold: "≤ 10%", target: "≤ 5%", note: "Colouring only — SMG tab and store presentation" },
    ],
  };
}
