export const BERRY_API_BASE = "https://board-api.berry-ai.com";
export const SUPERSET_BASE = "https://board.berry-ai.com/superset";
export const SUPERSET_DASHBOARD_ID = "15";

export type BranchStore = {
  id: string;
  name: string;
  client_branch_id: string | null;
  location: string;
  timezone: string;
  brand?: { name: string };
};

/** Raw row returned from Superset when grouped by store + daypart */
export type DaypartRow = {
  store_name_and_id: string;
  daypart_index: number;
  "CHAR_ lane_total_with_total_pick"?: string | null;
  CHAR_total_cars?: number | null;
  CHAR_window_service?: string | null;
  CHAR_lane_queue?: string | null;
  CHAR_pre_menu_queue?: string | null;
  [key: string]: unknown;
};

/** Raw row returned from Superset when grouped by store only (no daypart) */
export type StoreRow = {
  store_name_and_id: string;
  "CHAR_ lane_total_with_total_pick"?: string | null;
  [key: string]: unknown;
};

export type DaypartMetrics = {
  index: number;
  lane_total: string | null;
  total_cars: number | null;
  pre_menu_queue: string | null;
  window_service: string | null;
};

/** Per-store metrics after peak/non-peak computation */
export type StoreMetrics = {
  store_name_and_id: string;
  overall: {
    lane_total: string | null;
    total_cars: number | null;
    window_service: string | null;
    pre_menu_queue: string | null;
  };
  peak: {
    lane_total: string | null;
    pre_menu_queue: string | null;
    window_service: string | null;
  };
  nonpeak: {
    lane_total: string | null;
    pre_menu_queue: string | null;
    window_service: string | null;
  };
  dayparts: DaypartMetrics[];
};

/** Lane total: ≤3:30 green, ≤4:00 yellow, higher red */
export function laneColor(secs: number | null): string {
  if (secs == null) return "text-gray-300";
  if (secs <= 210) return "text-green-600";
  if (secs <= 240) return "text-yellow-600";
  return "text-red-600";
}

/** Pre-menu queue: ≤35s green, ≤60s yellow, higher red */
export function preMenuColor(secs: number | null): string {
  if (secs == null) return "text-gray-300";
  if (secs <= 35) return "text-green-600";
  if (secs <= 60) return "text-yellow-600";
  return "text-red-600";
}

/** Window service: ≤52.5s green, ≤60s yellow, higher red */
export function windowColor(secs: number | null): string {
  if (secs == null) return "text-gray-300";
  if (secs <= 52.5) return "text-green-600";
  if (secs <= 60) return "text-yellow-600";
  return "text-red-600";
}

/** Parse "MM:SS" string to total seconds, returns null if unparseable */
export function parseMMSS(val: string | null | undefined): number | null {
  if (!val || typeof val !== "string") return null;
  const [m, s] = val.split(":").map(Number);
  if (isNaN(m) || isNaN(s)) return null;
  return m * 60 + s;
}

/** Returns MTD time range string for Superset: "YYYY-MM-01 : YYYY-MM-DD" */
export function getMtdTimeRange(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-01 : ${y}-${m}-${d}`;
}
