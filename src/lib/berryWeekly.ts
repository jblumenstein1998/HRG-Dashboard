import { SUPERSET_BASE, SUPERSET_DASHBOARD_ID, DaypartRow, StoreRow, parseMMSS } from "./berry";
import { FISCAL_YEAR_START, PERIODS } from "./fiscal";
import { ensureSession, invalidateSession } from "./supersetSession";

const CHART_ID = 93;
const DATASOURCE_ID = 18;
const METRICS = [
  "CHAR_ lane_total_with_total_pick",
  "CHAR_total_cars",
  "CHAR_window_service",
  "CHAR_menu_board",
  "ww_flagged_pull_forward_cars",
];

export type WeeklyStorePoint = {
  lane_total_secs: number | null;
  window_service_secs: number | null;
  menu_board_secs: number | null;
  flagged_pull_forward: number | null;
};

export type WeeklyHistoryPoint = {
  weekKey: string;
  label: string;
  start: string;
  end: string;
  stores: Record<string, WeeklyStorePoint>;
};

// ── Week ranges: fiscal year start (Mon) through the end of Period 6, weekly Mon-Sun ──

function toDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function buildWeeks(): { start: string; end: string; weekKey: string; label: string }[] {
  const p6End = toDate(PERIODS[5].end);
  const weeks: { start: string; end: string; weekKey: string; label: string }[] = [];
  let cur = toDate(FISCAL_YEAR_START);
  let n = 1;
  while (cur <= p6End) {
    const weekEnd = new Date(cur);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weeks.push({
      start: fmt(cur),
      end: fmt(weekEnd),
      weekKey: `2026-W${String(n).padStart(2, "0")}`,
      label: `W${n}-26`,
    });
    cur = new Date(cur);
    cur.setDate(cur.getDate() + 7);
    n++;
  }
  return weeks;
}

// ── Rate limiter — cap concurrent weeks so we don't hammer the shared Superset session ──

class Semaphore {
  private permits: number;
  private waiters: (() => void)[] = [];
  constructor(n: number) { this.permits = n; }
  acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return Promise.resolve(); }
    return new Promise(r => this.waiters.push(r));
  }
  release(): void {
    const next = this.waiters.shift();
    if (next) next(); else this.permits++;
  }
}
const sem = new Semaphore(4);

function weightedAvgSecs(rows: DaypartRow[], timeField: keyof DaypartRow): number | null {
  let weightedSecs = 0;
  let totalCars = 0;
  for (const row of rows) {
    const secs = parseMMSS(row[timeField] as string | null);
    const cars = row.CHAR_total_cars;
    if (secs == null || cars == null || cars === 0) continue;
    weightedSecs += secs * cars;
    totalCars += cars;
  }
  if (totalCars === 0) return null;
  return weightedSecs / totalCars;
}

function sumNum(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0);
}

function totalCars(rows: DaypartRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.CHAR_total_cars != null) total += row.CHAR_total_cars;
  }
  return total;
}

async function fetchWeek(
  guestToken: string,
  sessionCookie: string,
  csrfToken: string,
  timeRange: string,
): Promise<Record<string, WeeklyStorePoint>> {
  const chartBody = {
    datasource: { id: DATASOURCE_ID, type: "table" },
    force: true,
    queries: [
      {
        time_range: timeRange,
        granularity: "datetime_local",
        filters: [],
        extras: { having: "", where: "", time_grain_sqla: null },
        applied_time_extras: { __time_range: timeRange },
        columns: ["store_name_and_id", "daypart_index"],
        metrics: METRICS,
        orderby: [["store_name_and_id", true]],
        annotation_layers: [],
        row_limit: 1000,
        series_limit: 0,
        group_others_when_limit_reached: false,
        order_desc: false,
        url_params: { uiConfig: "1" },
        custom_params: {},
        custom_form_data: {},
      },
      {
        time_range: timeRange,
        granularity: "datetime_local",
        filters: [],
        extras: { having: "", where: "", time_grain_sqla: null },
        applied_time_extras: { __time_range: timeRange },
        columns: ["store_name_and_id"],
        metrics: ["CHAR_ lane_total_with_total_pick"],
        orderby: [["store_name_and_id", true]],
        annotation_layers: [],
        row_limit: 1000,
        series_limit: 0,
        group_others_when_limit_reached: false,
        order_desc: false,
        url_params: { uiConfig: "1" },
        custom_params: {},
        custom_form_data: {},
      },
    ],
    form_data: {
      datasource: `${DATASOURCE_ID}__table`,
      viz_type: "pivot_table_v2",
      slice_id: CHART_ID,
      groupbyRows: ["store_name_and_id"],
      groupbyColumns: ["daypart_index"],
      metrics: METRICS,
      aggregateFunction: "Average",
      granularity_sqla: "datetime_local",
      time_range: timeRange,
      adhoc_filters: [
        {
          clause: "WHERE",
          comparator: timeRange,
          expressionType: "SIMPLE",
          isExtra: true,
          operator: "TEMPORAL_RANGE",
          subject: "datetime_local",
          filterOptionName: "filter_b9van5d4yrv_jzbqxhpclq",
        },
      ],
      extra_form_data: {
        time_range: timeRange,
        granularity_sqla: "datetime_local",
      },
      dashboardId: Number(SUPERSET_DASHBOARD_ID),
      force: true,
      result_format: "json",
      result_type: "full",
    },
    result_format: "json",
    result_type: "full",
  };

  await sem.acquire();
  try {
    const res = await fetch(`${SUPERSET_BASE}/api/v1/chart/data`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GuestToken": guestToken,
        ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      },
      body: JSON.stringify(chartBody),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) invalidateSession();
      return {};
    }

    const data = await res.json().catch(() => ({}));
    const rawRows: DaypartRow[] = data?.result?.[0]?.data ?? [];
    const storeRows: StoreRow[] = data?.result?.[1]?.data ?? [];

    const overallByStore = new Map<string, string | null>();
    for (const r of storeRows) {
      overallByStore.set(r.store_name_and_id, r["CHAR_ lane_total_with_total_pick"] ?? null);
    }

    const byStore = new Map<string, DaypartRow[]>();
    for (const row of rawRows) {
      const key = row.store_name_and_id;
      if (!byStore.has(key)) byStore.set(key, []);
      byStore.get(key)!.push(row);
    }

    const result: Record<string, WeeklyStorePoint> = {};
    for (const [store, rows] of byStore) {
      // No cars at all this week means the store had no real drive-thru activity — Superset
      // still returns a row for it with 0-filled metrics rather than omitting it, so treat
      // the whole point as missing (null) rather than plotting a false "0" on the charts.
      if (totalCars(rows) === 0) {
        result[store] = {
          lane_total_secs: null,
          window_service_secs: null,
          menu_board_secs: null,
          flagged_pull_forward: null,
        };
        continue;
      }

      const laneStr = overallByStore.get(store) ?? null;
      const laneSecs = laneStr != null ? parseMMSS(laneStr) : null;
      const windowSecsAvg = weightedAvgSecs(rows, "CHAR_window_service");
      const menuBoardSecsAvg = weightedAvgSecs(rows, "CHAR_menu_board");
      result[store] = {
        lane_total_secs: laneSecs,
        window_service_secs: windowSecsAvg,
        menu_board_secs: menuBoardSecsAvg,
        flagged_pull_forward: sumNum(rows.map(r => r.ww_flagged_pull_forward_cars)),
      };
    }
    return result;
  } finally {
    sem.release();
  }
}

export async function fetchWeeklyHistory(berryToken: string): Promise<WeeklyHistoryPoint[]> {
  const session = await ensureSession(berryToken);
  const { guestToken, sessionCookie, csrfToken } = session;
  const weeks = buildWeeks();

  const results = await Promise.all(
    weeks.map(async w => {
      const timeRange = `${w.start}T00:00:00 : ${w.end}T23:59:59`;
      const stores = await fetchWeek(guestToken, sessionCookie, csrfToken, timeRange).catch(() => ({}));
      return { ...w, stores };
    })
  );

  return results;
}
