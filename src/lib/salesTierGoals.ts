import type { BranchStore, StoreMetrics } from "@/lib/berry";

export type TierGoal = { label: string; test: (v: number) => boolean; greenMax: number; yellowMax: number };

// greenMax/yellowMax are goal thresholds in seconds: <= greenMax is green,
// <= yellowMax is yellow, anything higher is red. Each sales bucket has its
// own goal since a busier store is expected to run a bit slower.
export const TOTAL_TIME_TIERS: TierGoal[] = [
  { label: "≤ $85k", test: (v) => v <= 85000, greenMax: 220, yellowMax: 240 }, // ≤3:40 green, ≤4:00 yellow
  { label: "> $85k", test: (v) => v > 85000, greenMax: 240, yellowMax: 270 }, // ≤4:00 green, ≤4:30 yellow
];

// Same sales/productivity data as the Total Time tiers above, just bucketed
// at a lower sales threshold and applied to window service time instead of
// overall lane total.
export const WINDOW_TIME_TIERS: TierGoal[] = [
  { label: "≤ $45k", test: (v) => v <= 45000, greenMax: 70, yellowMax: 75 }, // ≤1:10 green, ≤1:15 yellow
  { label: "> $45k", test: (v) => v > 45000, greenMax: 57, yellowMax: 65 }, // ≤0:57 green, ≤1:05 yellow
];

export function fmtGoalSecs(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function goalColor(secs: number | null, greenMax: number, yellowMax: number): string {
  if (secs == null) return "text-gray-300";
  if (secs <= greenMax) return "text-green-600";
  if (secs <= yellowMax) return "text-yellow-600";
  return "text-red-600";
}

/** Colors an overall lane-total or window-service time by the sales-volume goal bucket it falls into. */
export function salesTierColor(sales: number | null | undefined, secs: number | null, metricField: "lane_total" | "window_service"): string {
  if (sales == null) return "text-gray-300";
  const tiers = metricField === "lane_total" ? TOTAL_TIME_TIERS : WINDOW_TIME_TIERS;
  const tier = tiers.find(t => t.test(sales));
  if (!tier) return "text-gray-300";
  return goalColor(secs, tier.greenMax, tier.yellowMax);
}

export function lookupMetric<T>(branch: BranchStore, metrics: StoreMetrics | null, map: Record<string, T>): T | undefined {
  if (branch.client_branch_id) {
    const v = map[branch.client_branch_id];
    if (v != null) return v;
  }
  const sni = metrics?.store_name_and_id ?? branch.name ?? "";
  for (const [key, val] of Object.entries(map)) {
    if (sni.includes(key)) return val;
  }
  return undefined;
}
