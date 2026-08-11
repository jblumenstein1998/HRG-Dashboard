/**
 * The six bonus scorecards, transcribed from the HRG Binder Google Docs.
 *
 * Folder: https://drive.google.com/drive/folders/1WnG3G2V-7jxjV4aG150GQekkKbSa_8ig
 *
 * Several near-identical copies of these docs exist elsewhere in Drive with
 * different numbers (an older Quality doc says "105 on an external Steritech"
 * vs "100", another GM/AGM pair is split TN/VA). **The binder versions are
 * canonical** — each position below records the doc id it came from so a
 * disagreement can be settled by reading the source rather than by argument.
 *
 * This file is pure data: no logic, no env reads, safe to import from a client
 * component so the entry form and the scorecard render from the same
 * definitions the engine scores against.
 *
 * ── Conventions ──────────────────────────────────────────────────────────────
 *
 * Times are in seconds, so 1:15 is 75. Percentages are 0–100, not 0–1.
 * Booleans are 0/1. Ratings are 0 = below, 1 = Meets, 2 = Exceeds — the scale
 * every "Living Our Values" criterion uses, since the docs define its threshold
 * as a review score of "Meets" and its target as "Exceeds".
 *
 * Where a doc states only a Target and no Threshold (the GM's StandardZ
 * category), threshold and target are set identical. That's not a shortcut: it
 * makes the category correctly all-or-nothing, since there is no defined way to
 * earn 50% of it.
 *
 * Condition `id`s are the primary key manual entries are stored under
 * (`bonus_inputs.criterion_id`). **Renaming one orphans previously entered
 * data.** Change `label` instead.
 */

import { ZCASE_GOALS } from "./goals";
import type { Condition, PositionRules, PositionId } from "./types";

// ── Shared conditions ────────────────────────────────────────────────────────

/**
 * Living Our Values, identical in all five docs that carry it (the GM doc has
 * no LOV category). Each position gets its own id so the four Directors and the
 * AGM can be reviewed independently.
 */
function livingOurValues(positionId: PositionId): Condition {
  return {
    id: `lov_${positionId}`,
    label: "Living Our Values review score",
    metric: `lov_${positionId}`,
    source: "manual",
    unit: "rating",
    grain: "entered",
    threshold: { cmp: "gte", value: 1 },
    target: { cmp: "gte", value: 2 },
    note: 'Threshold = review score "Meets". Target = "Exceeds", modelling values consistently and recognised by GM/AGM at least once per quarter.',
  };
}

/**
 * Order accuracy. Both the Drive-Thru and Hospitality docs cite "order accuracy"
 * at the same 85% / 90% gates.
 *
 * Josh's call: this reads from SMG's Accuracy survey item (631215), which the
 * app already ingests per store per period. `accuracy_override` below lets a
 * period be corrected by hand if the survey figure turns out not to be what the
 * doc meant; the resolver prefers the override when one has been entered.
 */
function orderAccuracy(idSuffix: string): Condition {
  return {
    id: `order_accuracy_${idSuffix}`,
    label: "Order accuracy",
    metric: "smgAccuracy",
    source: "auto",
    unit: "percent",
    grain: "period",
    threshold: { cmp: "gte", value: 85 },
    target: { cmp: "gte", value: 90 },
    note: "SMG Accuracy top box. Override with the manual field if a period needs correcting.",
  };
}

// ── Drive-Thru Director ──────────────────────────────────────────────────────

const DRIVE_THRU: PositionRules = {
  id: "driveThru",
  label: "Drive-Thru Director",
  sourceDocId: "1CK5B_GPZ6bpEGENoxVe42x2vtSVWAqXV2A2SZwuQuFQ",
  categories: [
    {
      id: "sos",
      label: "Speed of Service",
      weight: 50,
      conditions: [
        {
          id: "dt_window_time",
          label: "Window time",
          metric: "dtWindowSecs",
          source: "auto",
          unit: "seconds",
          grain: "period",
          // Placeholder gates; the tier matching weekly sales replaces them.
          threshold: { cmp: "lte", value: 75 },
          target: { cmp: "lte", value: 70 },
          tiers: [
            // ≤ $45,000/week: threshold 1:15, target 1:10
            { maxWeeklySales: 45000, threshold: { cmp: "lte", value: 75 }, target: { cmp: "lte", value: 70 } },
            // > $45,000/week: threshold 1:05, target 0:57
            { maxWeeklySales: null, threshold: { cmp: "lte", value: 65 }, target: { cmp: "lte", value: 57 } },
          ],
        },
        {
          id: "dt_total_time",
          label: "Average total time",
          metric: "dtTotalSecs",
          source: "auto",
          unit: "seconds",
          grain: "period",
          threshold: { cmp: "lte", value: 240 },
          target: { cmp: "lte", value: 220 },
          tiers: [
            // ≤ $85,000/week: threshold 4:00, target 3:40
            { maxWeeklySales: 85000, threshold: { cmp: "lte", value: 240 }, target: { cmp: "lte", value: 220 } },
            // > $85,000/week: threshold 4:30, target 4:00
            { maxWeeklySales: null, threshold: { cmp: "lte", value: 270 }, target: { cmp: "lte", value: 240 } },
          ],
        },
        {
          id: "dt_line_busting",
          label: "Line busting during peak",
          metric: "dt_line_busting",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 80 },
          target: { cmp: "gte", value: 80 },
          // The doc attaches this only to the >$85k branch of average total time.
          appliesWhen: { metric: "weeklyEquivalentSales", gate: { cmp: "gte", value: 85000 } },
          note: "Only required of stores above $85,000/week, where the doc allows the looser total-time goals in exchange for line busting ≥80% of the time during peak.",
        },
      ],
      disqualifiers: [
        {
          id: "dt_days_missing_target",
          label: "Days missing the daily target",
          metric: "dtDaysMissingTarget",
          source: "auto",
          unit: "count",
          grain: "dayCount",
          threshold: { cmp: "lte", value: 5 },
          target: { cmp: "lte", value: 5 },
          note: "Zeroes this category when more than 5 days in the period missed the target goals for the day.",
        },
      ],
      multipliers: [
        {
          factor: 1.25,
          label: "≤4 flagged pull-forwards in every week",
          mode: "all",
          conditions: [
            {
              id: "dt_pull_forwards",
              label: "Flagged pull-forwards, worst week",
              metric: "dtMaxWeeklyPullForwards",
              source: "auto",
              unit: "count",
              grain: "weeklyMax",
              threshold: { cmp: "lte", value: 4 },
              target: { cmp: "lte", value: 4 },
            },
          ],
        },
      ],
    },
    {
      id: "accuracy_gsat",
      label: "Order Accuracy & Guest Satisfaction",
      weight: 40,
      conditions: [
        orderAccuracy("dt"),
        {
          id: "dt_osat",
          label: "SMG OSAT top box",
          metric: "smgOsat",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 80 },
        },
      ],
      disqualifiers: [
        {
          id: "dt_accuracy_weekly_floor",
          label: "Lowest weekly accuracy",
          metric: "smgAccuracyMinWeekly",
          source: "auto",
          unit: "percent",
          grain: "weeklyMin",
          threshold: { cmp: "gte", value: 65 },
          target: { cmp: "gte", value: 65 },
          note: "Zeroes this category if any week fell below 65% accuracy.",
        },
      ],
      multipliers: [],
    },
    {
      id: "lov",
      label: "Living Our Values",
      weight: 10,
      isLivingOurValues: true,
      conditions: [livingOurValues("driveThru")],
      disqualifiers: [],
      multipliers: [],
    },
  ],
};

// ── Hospitality Director ─────────────────────────────────────────────────────

const HOSPITALITY: PositionRules = {
  id: "hospitality",
  label: "Hospitality Director",
  sourceDocId: "170q5v9d-N3cQ661lkO4_srQrUrdYRomjjTvUJyxkUwA",
  categories: [
    {
      id: "gsat",
      label: "Guest Satisfaction (SMG)",
      weight: 35,
      conditions: [
        {
          id: "hosp_osat",
          label: "OSAT top box",
          metric: "smgOsat",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 80 },
        },
        {
          id: "hosp_friendliness",
          label: "Friendliness top box",
          metric: "smgFriendliness",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 80 },
        },
        {
          id: "hosp_cleanliness",
          label: "Cleanliness top box",
          metric: "smgCleanliness",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 80 },
        },
        {
          id: "hosp_response_rate",
          label: "Survey responses",
          metric: "smgResponses",
          source: "auto",
          unit: "count",
          grain: "period",
          threshold: { cmp: "gte", value: 40 },
          target: { cmp: "gte", value: 60 },
          note: 'The doc calls this "response rate ≥40 / ≥60"; SMG reports a response count (n), which is what is measured here.',
        },
      ],
      disqualifiers: [
        {
          id: "hosp_osat_weekly_floor",
          label: "Lowest weekly OSAT",
          metric: "smgOsatMinWeekly",
          source: "auto",
          unit: "percent",
          grain: "weeklyMin",
          threshold: { cmp: "gte", value: 65 },
          target: { cmp: "gte", value: 65 },
        },
        {
          id: "hosp_friendliness_weekly_floor",
          label: "Lowest weekly Friendliness",
          metric: "smgFriendlinessMinWeekly",
          source: "auto",
          unit: "percent",
          grain: "weeklyMin",
          threshold: { cmp: "gte", value: 65 },
          target: { cmp: "gte", value: 65 },
        },
        {
          id: "hosp_cleanliness_weekly_floor",
          label: "Lowest weekly Cleanliness",
          metric: "smgCleanlinessMinWeekly",
          source: "auto",
          unit: "percent",
          grain: "weeklyMin",
          threshold: { cmp: "gte", value: 65 },
          target: { cmp: "gte", value: 65 },
        },
      ],
      multipliers: [
        {
          factor: 1.25,
          label: "OSAT, Friendliness and Cleanliness all ≥90%",
          mode: "all",
          conditions: [
            {
              id: "hosp_osat_90",
              label: "OSAT ≥90%",
              metric: "smgOsat",
              source: "auto",
              unit: "percent",
              grain: "period",
              threshold: { cmp: "gte", value: 90 },
              target: { cmp: "gte", value: 90 },
            },
            {
              id: "hosp_friendliness_90",
              label: "Friendliness ≥90%",
              metric: "smgFriendliness",
              source: "auto",
              unit: "percent",
              grain: "period",
              threshold: { cmp: "gte", value: 90 },
              target: { cmp: "gte", value: 90 },
            },
            {
              id: "hosp_cleanliness_90",
              label: "Cleanliness ≥90%",
              metric: "smgCleanliness",
              source: "auto",
              unit: "percent",
              grain: "period",
              threshold: { cmp: "gte", value: 90 },
              target: { cmp: "gte", value: 90 },
            },
          ],
        },
      ],
    },
    {
      id: "z_cases",
      label: "Guest Recovery & Z-Cases",
      weight: 25,
      conditions: [
        {
          id: "hosp_zcase_resolution",
          label: "Z-Cases resolved within 24 hrs",
          metric: "hosp_zcase_resolution",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: ZCASE_GOALS.resolvedWithin24Pct.threshold },
          target: { cmp: "gte", value: ZCASE_GOALS.resolvedWithin24Pct.target },
        },
        {
          id: "hosp_zcase_count",
          label: "Z-Cases opened",
          metric: "hosp_zcase_count",
          source: "manual",
          unit: "count",
          grain: "entered",
          threshold: { cmp: "lte", value: ZCASE_GOALS.count.threshold },
          target: { cmp: "lte", value: ZCASE_GOALS.count.target },
        },
        orderAccuracy("hosp"),
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "facility",
      label: "Facility Cleanliness & Readiness",
      weight: 10,
      conditions: [
        {
          id: "hosp_facility_inspection",
          label: "Monthly inspection average",
          metric: "hosp_facility_inspection",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 90 },
          target: { cmp: "gte", value: 100 },
          note: "Lobby, restroom and exterior inspections by the above-store inspector.",
        },
      ],
      disqualifiers: [
        {
          id: "hosp_health_cleanliness_violation",
          label: "Health inspection cleanliness violation",
          metric: "hosp_health_cleanliness_violation",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
          note: "Enter 1 if a county health inspection cited lobby, restrooms or exteriors. Zeroes this category.",
        },
      ],
      multipliers: [],
    },
    {
      id: "engagement",
      label: "Team Engagement & Recognition",
      weight: 20,
      conditions: [
        {
          id: "hosp_recognition",
          label: "Recognition activities completed",
          metric: "hosp_recognition",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 100 },
          note: "GroupMe, birthdays, work anniversaries, ZU / training completions.",
        },
        {
          id: "hosp_pulse_check",
          label: "Positive monthly pulse check",
          metric: "hosp_pulse_check",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          // Only the Target level names the pulse check, so the threshold gate is
          // permanently satisfied and it can only ever cost the 100%, not the 50%.
          threshold: { cmp: "gte", value: 0 },
          target: { cmp: "gte", value: 1 },
          note: "Required for Target only — the doc does not mention it at Threshold.",
        },
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "lov",
      label: "Living Our Values",
      weight: 10,
      isLivingOurValues: true,
      conditions: [livingOurValues("hospitality")],
      disqualifiers: [],
      multipliers: [],
    },
  ],
};

// ── Quality Director ─────────────────────────────────────────────────────────

const QUALITY: PositionRules = {
  id: "quality",
  label: "Quality Director",
  sourceDocId: "1g72aVfeslGWYaHkyRsuiosXcl7S2RTdSNVi22OmfIEk",
  categories: [
    {
      id: "food_safety",
      label: "Food Safety, Compliance & Jolt Execution",
      weight: 40,
      conditions: [
        {
          id: "q_jolt_completion",
          label: "Jolt checklist completion",
          metric: "q_jolt_completion",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 95 },
          target: { cmp: "gte", value: 100 },
        },
        {
          id: "q_mock_steritech_weekly",
          label: "Mock Food Safety Steritech completed weekly",
          metric: "q_mock_steritech_weekly",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
          note: "Required at both Threshold and Target — 1x per week, every week of the period.",
        },
      ],
      disqualifiers: [
        {
          id: "q_health_inspection_score",
          label: "Lowest county health inspection score",
          metric: "q_health_inspection_score",
          source: "manual",
          unit: "count",
          grain: "entered",
          threshold: { cmp: "gte", value: 95 },
          target: { cmp: "gte", value: 95 },
          note: "Zeroes this category if the store scored below 95, or failed, on any county health inspection in the period. Leave blank if there was no inspection.",
        },
        {
          id: "q_mock_steritech_dishonest",
          label: "Mock inspection not thoroughly or honestly completed",
          metric: "q_mock_steritech_dishonest",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
        },
        {
          id: "q_high_risk",
          label: "High Risk on RER or Food Safety",
          metric: "q_high_risk",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
        },
      ],
      multipliers: [
        {
          factor: 1.5,
          label: "100% county health inspection or 105 external Steritech",
          mode: "any",
          conditions: [
            {
              id: "q_health_inspection_100",
              label: "100% county health inspection score",
              metric: "q_health_inspection_100",
              source: "manual",
              unit: "boolean",
              grain: "entered",
              threshold: { cmp: "gte", value: 1 },
              target: { cmp: "gte", value: 1 },
            },
            {
              id: "q_steritech_105",
              label: "105 on an external Food Safety Steritech report",
              metric: "q_steritech_105",
              source: "manual",
              unit: "boolean",
              grain: "entered",
              threshold: { cmp: "gte", value: 1 },
              target: { cmp: "gte", value: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "cogs",
      label: "COGS, Production & Variance Control",
      weight: 40,
      conditions: [
        {
          id: "q_food_cost",
          label: "Food cost",
          metric: "cogsPct",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "lte", value: 30.0 },
          target: { cmp: "lte", value: 28.5 },
        },
        {
          id: "q_food_cost_variance",
          label: "Food cost variance vs theoretical",
          metric: "varianceAbsPct",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "lte", value: 1.5 },
          target: { cmp: "lte", value: 1.0 },
          note: "Measured as absolute variance, since the doc's ±1.5% / ±1% bands are symmetric.",
        },
        {
          id: "q_inventory_counts",
          label: "Inventory counts",
          metric: "q_inventory_counts",
          source: "manual",
          unit: "rating",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 2 },
          note: "0 = not completed. 1 = completed (full at beginning of week + daily critical). 2 = all counts completed accurately.",
        },
        {
          id: "q_truck_order_resolution",
          label: "Truck order discrepancy resolution",
          metric: "q_truck_order_resolution",
          source: "manual",
          unit: "count",
          grain: "entered",
          threshold: { cmp: "lte", value: 72 },
          target: { cmp: "lte", value: 48 },
          note: "Hours to resolve, with truck orders placed on time. Enter the worst case in the period.",
        },
      ],
      disqualifiers: [],
      multipliers: [],
      // ArrowStream is deliberately absent: the doc awards the Quality Director
      // at the store with the largest ArrowStream credits "the full dollar
      // amount of credits received as a one-time bonus". That is a flat dollar
      // payment, not a multiplier on percentage attainment, so it has no
      // representation in a percentage scorecard. Track it outside this tab.
    },
    {
      id: "reporting",
      label: "Reporting & Accountability",
      weight: 10,
      conditions: [
        {
          id: "q_reports_24h",
          label: "Quality reports submitted within 24 hrs",
          metric: "q_reports_24h",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 75 },
          target: { cmp: "gte", value: 100 },
          note: "Steritech focus areas / actions, and equipment needing maintenance, over email or Slack.",
        },
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "lov",
      label: "Living Our Values",
      weight: 10,
      isLivingOurValues: true,
      conditions: [livingOurValues("quality")],
      disqualifiers: [],
      multipliers: [],
    },
  ],
};

// ── Training Director ────────────────────────────────────────────────────────

const TRAINING: PositionRules = {
  id: "training",
  label: "Training Director",
  sourceDocId: "1L6ExPi1i1YlYnlInUMJ8o9510HYBpXOV2adLAeTq3XM",
  categories: [
    {
      id: "onboarding",
      label: "New Hire Onboarding & Compliance",
      weight: 30,
      conditions: [
        {
          id: "t_onboarding_completion",
          label: "Week 1 & 2 onboarding completed on time",
          metric: "t_onboarding_completion",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 90 },
          target: { cmp: "gte", value: 100 },
        },
        {
          id: "t_lto_compliance",
          label: "Full-staff LTO compliance",
          metric: "t_lto_compliance",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 95 },
          target: { cmp: "gte", value: 100 },
        },
        {
          id: "t_onboarding_slack",
          label: "Weekly checklist photo + summary in Slack",
          metric: "t_onboarding_slack",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
          note: 'Photo of the onboarding checklist posted at the end of each week with a brief summary ("new hire is doing well with X and needs to work on Y"). Required at both levels.',
        },
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "training_execution",
      label: "Training Execution",
      weight: 30,
      conditions: [
        {
          id: "t_focus_area_improvement",
          label: "Improvement in identified focus area",
          metric: "t_focus_area_improvement",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 5 },
          target: { cmp: "gte", value: 10 },
          note: "Focus area is identified by the DM / Director of Operations from the End-of-Period Review.",
        },
      ],
      disqualifiers: [
        {
          id: "t_bin_management",
          label: "Bin management",
          metric: "t_bin_management",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 85 },
          target: { cmp: "gte", value: 85 },
          note: "Zeroes this category below 85%.",
        },
      ],
      multipliers: [],
    },
    {
      id: "retention",
      label: "Retention & Engagement",
      weight: 20,
      conditions: [
        {
          id: "t_retention_30",
          label: "30-day new hire retention",
          metric: "t_retention_30",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 70 },
          target: { cmp: "gte", value: 80 },
        },
        {
          id: "t_retention_60",
          label: "60-day new hire retention",
          metric: "t_retention_60",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 60 },
          target: { cmp: "gte", value: 70 },
        },
        {
          id: "t_retention_90",
          label: "90-day new hire retention",
          metric: "t_retention_90",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 60 },
          target: { cmp: "gte", value: 70 },
        },
      ],
      disqualifiers: [],
      multipliers: [
        {
          factor: 1.5,
          label: "90-day retention ≥95%",
          mode: "all",
          conditions: [
            {
              id: "t_retention_90_95",
              label: "90-day retention ≥95%",
              metric: "t_retention_90",
              source: "manual",
              unit: "percent",
              grain: "entered",
              threshold: { cmp: "gte", value: 95 },
              target: { cmp: "gte", value: 95 },
            },
          ],
        },
        {
          factor: 1.25,
          label: "60-day retention ≥95%",
          mode: "all",
          conditions: [
            {
              id: "t_retention_60_95",
              label: "60-day retention ≥95%",
              metric: "t_retention_60",
              source: "manual",
              unit: "percent",
              grain: "entered",
              threshold: { cmp: "gte", value: 95 },
              target: { cmp: "gte", value: 95 },
            },
          ],
        },
      ],
    },
    {
      id: "pipeline",
      label: "Leadership Pipeline & Development",
      weight: 10,
      conditions: [
        {
          id: "t_shift_lead_pipeline",
          label: "Shift Lead candidates",
          metric: "t_shift_lead_pipeline",
          source: "manual",
          unit: "count",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 2 },
          note: "Threshold = at least 1 candidate in active training. Target = at least 2 Shift Lead–ready team members documented in the pipeline.",
        },
        {
          id: "t_workstream_current",
          label: "Workstream up to date",
          metric: "t_workstream_current",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
        },
      ],
      disqualifiers: [],
      multipliers: [
        {
          factor: 1.25,
          label: "Employee placed as a Director or above at a new or acquired store",
          mode: "all",
          conditions: [
            {
              id: "t_pipeline_promotion",
              label: "Employee promoted into a new or acquired store",
              metric: "t_pipeline_promotion",
              source: "manual",
              unit: "boolean",
              grain: "entered",
              threshold: { cmp: "gte", value: 1 },
              target: { cmp: "gte", value: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "lov",
      label: "Living Our Values",
      weight: 10,
      isLivingOurValues: true,
      conditions: [livingOurValues("training")],
      disqualifiers: [],
      multipliers: [],
    },
  ],
};

// ── Assistant General Manager ────────────────────────────────────────────────

const AGM: PositionRules = {
  id: "agm",
  label: "Assistant GM",
  sourceDocId: "16mueP-6zsW0Pv3HKZZl9Blpkjg5t-MHX0ujuVBJyiGM",
  categories: [
    {
      id: "director_performance",
      label: "Director Performance",
      weight: 90,
      derivedFrom: ["driveThru", "quality", "training", "hospitality"],
      conditions: [],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "rer",
      label: "RER",
      weight: 5,
      conditions: [
        {
          id: "agm_mock_rer_weekly",
          label: "Mock RER Steritech completed weekly",
          metric: "agm_mock_rer_weekly",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
          note: "1x per week, every week of the period.",
        },
      ],
      disqualifiers: [
        {
          id: "agm_mock_rer_dishonest",
          label: "Mock RER not thoroughly or honestly completed",
          metric: "agm_mock_rer_dishonest",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
        },
      ],
      multipliers: [
        {
          factor: 1.5,
          label: "100 on an external RER Steritech report",
          mode: "all",
          conditions: [
            {
              id: "agm_rer_external_100",
              label: "100 on an external RER Steritech report",
              metric: "agm_rer_external_100",
              source: "manual",
              unit: "boolean",
              grain: "entered",
              threshold: { cmp: "gte", value: 1 },
              target: { cmp: "gte", value: 1 },
            },
          ],
        },
      ],
    },
    {
      id: "lov",
      label: "Living Our Values",
      weight: 5,
      isLivingOurValues: true,
      conditions: [livingOurValues("agm")],
      disqualifiers: [],
      multipliers: [],
    },
  ],
};

// ── General Manager ──────────────────────────────────────────────────────────

const GM: PositionRules = {
  id: "gm",
  label: "General Manager",
  sourceDocId: "1F09mvMPk-3ATXtkUYdjRrY-Rnixa70rS2usaadwDLvw",
  categories: [
    {
      id: "agm_performance",
      label: "AGM Performance",
      weight: 50,
      derivedFrom: ["agm"],
      conditions: [
        {
          id: "gm_monday_meetings",
          label: "Monday manager meetings",
          metric: "gm_monday_meetings",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
          advisory: true,
          note: "Recorded but not scored — the doc lists this under AGM Performance with no weight or threshold of its own. Conducted consistently, with clear goals and follow-up communicated to people@hudsonrestaurantgroup.com.",
        },
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "financial_ops",
      label: "Financial & Operations",
      weight: 25,
      conditions: [
        {
          id: "gm_labor_pct",
          label: "Labor % of sales",
          metric: "gm_labor_pct",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "between", value: 21, value2: 22 },
          target: { cmp: "between", value: 19, value2: 21 },
          note: "Manual entry — PAR exposes labor minutes but never labor dollars, and no connected system holds pay rates. Both gates are two-sided: below 19% misses Target as surely as above 21% does.",
        },
        {
          id: "gm_splh",
          label: "SPLH",
          metric: "splh",
          source: "auto",
          unit: "ratio",
          grain: "period",
          threshold: { cmp: "between", value: 82, value2: 87 },
          target: { cmp: "between", value: 82, value2: 87 },
          tiers: [
            // ≤ $75,000/week: 82–87 at both levels.
            { maxWeeklySales: 75000, threshold: { cmp: "between", value: 82, value2: 87 }, target: { cmp: "between", value: 82, value2: 87 } },
            // > $75,000/week: threshold stays 82–87, target rises to 87–92.
            { maxWeeklySales: null, threshold: { cmp: "between", value: 82, value2: 87 }, target: { cmp: "between", value: 87, value2: 92 } },
          ],
        },
        {
          id: "gm_tplh",
          label: "TPLH",
          metric: "tplh",
          source: "auto",
          unit: "ratio",
          grain: "period",
          threshold: { cmp: "gte", value: 5.0 },
          target: { cmp: "gte", value: 5.25 },
        },
        {
          id: "gm_cogs",
          label: "COGS",
          metric: "cogsPct",
          source: "auto",
          unit: "percent",
          grain: "period",
          threshold: { cmp: "lte", value: 30.0 },
          target: { cmp: "lte", value: 28.5 },
        },
      ],
      disqualifiers: [],
      multipliers: [],
    },
    {
      id: "standardz",
      label: "StandardZ Compliance",
      weight: 25,
      conditions: [
        // The doc states a Target for this category and no Threshold, so every
        // gate below is identical at both levels: there is no defined way to
        // earn 50% of StandardZ, only 0% or 100%.
        {
          id: "gm_zu_completion",
          label: "ZU completion rate",
          metric: "gm_zu_completion",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 100 },
          target: { cmp: "gte", value: 100 },
        },
        {
          id: "gm_servesafe",
          label: "ServeSafe certifications current",
          metric: "gm_servesafe",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "gte", value: 1 },
          target: { cmp: "gte", value: 1 },
          note: "100% current, no lapses.",
        },
        {
          id: "gm_missed_lto_deadlines",
          label: "Missed POP / LTO deadlines",
          metric: "gm_missed_lto_deadlines",
          source: "manual",
          unit: "count",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
        },
        {
          id: "gm_slack_completion",
          label: "Slack completion rate",
          metric: "gm_slack_completion",
          source: "manual",
          unit: "percent",
          grain: "entered",
          threshold: { cmp: "gte", value: 95 },
          target: { cmp: "gte", value: 95 },
        },
      ],
      disqualifiers: [
        {
          id: "gm_zu_completed_for_someone",
          label: "Completed someone else's ZU for them",
          metric: "gm_zu_completed_for_someone",
          source: "manual",
          unit: "boolean",
          grain: "entered",
          threshold: { cmp: "lte", value: 0 },
          target: { cmp: "lte", value: 0 },
        },
      ],
      multipliers: [],
    },
  ],
};

// ── Transaction Growth kicker ────────────────────────────────────────────────

/**
 * Carried identically by all six docs: 1.25× the total payout if the store grew
 * transactions year over year in **every** week of the period, nothing if a
 * single week missed. Applied to the position total, not to any one category.
 *
 * The all-or-nothing shape is why this is one metric rather than a weekly
 * evaluation — `txnAllWeeksGrew` is 1 only when every week grew.
 */
export const TRANSACTION_KICKER: Condition = {
  id: "txn_growth_kicker",
  label: "YoY transaction growth every week",
  metric: "txnAllWeeksGrew",
  source: "auto",
  unit: "boolean",
  grain: "allWeeks",
  threshold: { cmp: "gte", value: 1 },
  target: { cmp: "gte", value: 1 },
};

export const TRANSACTION_KICKER_FACTOR = 1.25;

// ── Registry ─────────────────────────────────────────────────────────────────

export const BONUS_RULES: Record<PositionId, PositionRules> = {
  gm: GM,
  agm: AGM,
  driveThru: DRIVE_THRU,
  quality: QUALITY,
  training: TRAINING,
  hospitality: HOSPITALITY,
};

/**
 * Every manual criterion for a position — drives the data entry form.
 *
 * Deduped by **metric, not by id**. Training's retention multipliers
 * (`t_retention_60_95`, `t_retention_90_95`) are separate conditions that read
 * the same numbers the scored retention criteria already collect; listing them
 * would ask whoever is entering data for the 90-day retention figure twice and
 * let the two answers disagree. Category conditions are walked before
 * multipliers, so the primary criterion is the one that wins.
 */
export function manualConditions(positionId: PositionId): Condition[] {
  const rules = BONUS_RULES[positionId];
  const out: Condition[] = [];
  const seen = new Set<string>();
  const ordered = [
    ...rules.categories.flatMap((c) => c.conditions),
    ...rules.categories.flatMap((c) => c.disqualifiers),
    ...rules.categories.flatMap((c) => c.multipliers.flatMap((m) => m.conditions)),
  ];
  for (const c of ordered) {
    if (c.source !== "manual" || seen.has(c.metric)) continue;
    seen.add(c.metric);
    out.push(c);
  }
  return out;
}

/**
 * Automatic metrics that a person may override for a period.
 *
 * Kept deliberately short. An override is stored as a manual input under
 * `override_<metric>` and replaces the computed figure for that store and
 * period only, so it leaves an audit trail rather than silently editing
 * vendor data.
 *
 * Order accuracy is here because the docs cite "SMG surveys, order accuracy
 * reports" — the app reads SMG's Accuracy top box, and if a period turns out to
 * need the other number, it can be corrected without a code change.
 */
export const OVERRIDABLE_METRICS: { metric: string; label: string; unit: Condition["unit"] }[] = [
  { metric: "smgAccuracy", label: "Order accuracy (overrides SMG Accuracy top box)", unit: "percent" },
  { metric: "cogsPct", label: "Food cost % (overrides Net-Chef)", unit: "percent" },
  { metric: "varianceAbsPct", label: "Food cost variance % (overrides Net-Chef)", unit: "percent" },
];

export const OVERRIDE_PREFIX = "override_";

/**
 * Sanity check that every position's weights sum to 100. Called by the engine
 * on first use — a transcription slip here would silently rescale someone's
 * bonus, which is the kind of bug that only shows up in a payroll dispute.
 */
export function assertWeightsValid(): void {
  for (const [id, rules] of Object.entries(BONUS_RULES)) {
    const total = rules.categories.reduce((s, c) => s + c.weight, 0);
    if (total !== 100) {
      throw new Error(`[Bonus] ${id} category weights sum to ${total}, expected 100`);
    }
  }
}
