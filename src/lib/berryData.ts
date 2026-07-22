import { SUPERSET_BASE, SUPERSET_DASHBOARD_ID, DaypartRow, StoreRow, DaypartMetrics, StoreMetrics, parseMMSS } from "@/lib/berry";
import { ensureSession, invalidateSession } from "@/lib/supersetSession";
import { sql } from "@/lib/db";
import { resolveRange, type RangeKey } from "@/lib/fiscal";

const CHART_ID = 93;
const DATASOURCE_ID = 18;

// ---------------------------------------------------------------------------
// Postgres-backed cache — keyed by the resolved Superset time_range string
// (unique per preset rangeKey AND per custom start/end window), so it survives
// cold starts and is shared across every request instead of living in one
// serverless instance's memory.
//
// A range whose end date has already passed is CLOSED — its numbers can't
// change anymore, so it's cached permanently (no TTL, never re-fetched unless
// explicitly busted). A range still in progress (ends in "now", or ends today
// or later) is ROLLING and needs a short-lived refresh instead.
// ---------------------------------------------------------------------------
const ROLLING_TTL_MS = 5 * 60 * 1000;
const ROLLING_TTL_MS_LONG_RANGE = 30 * 60 * 1000; // qtd/ytd-sized ranges — expensive to recompute, ok to be less fresh

function todayCentralISO(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** A range is "closed" (permanent, never changes again) once its end date is before today. */
function isClosedRange(timeRange: string): boolean {
  const [, endRaw] = timeRange.split(" : ").map(s => s.trim());
  if (endRaw === "now") return false;
  const endDate = endRaw.split("T")[0];
  return endDate < todayCentralISO();
}

function rollingTTL(timeRange: string): number {
  const [startRaw, endRaw] = timeRange.split(" : ").map(s => s.trim());
  const startDate = startRaw.split("T")[0];
  const endDate = endRaw === "now" ? todayCentralISO() : endRaw.split("T")[0];
  const spanDays = (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86_400_000;
  return spanDays > 60 ? ROLLING_TTL_MS_LONG_RANGE : ROLLING_TTL_MS;
}

async function getCachedPayload(timeRange: string): Promise<{ payload: DriveThruPayload; fetchedAt: Date } | null> {
  const rows = await sql`SELECT payload, fetched_at FROM drive_thru_cache WHERE time_range = ${timeRange}`;
  if (rows.length === 0) return null;
  const row = rows[0] as { payload: DriveThruPayload; fetched_at: string };
  return { payload: row.payload, fetchedAt: new Date(row.fetched_at) };
}

async function setCachedPayload(timeRange: string, rangeLabel: string, payload: DriveThruPayload): Promise<void> {
  await sql`
    INSERT INTO drive_thru_cache (time_range, range_label, payload, fetched_at)
    VALUES (${timeRange}, ${rangeLabel}, ${JSON.stringify(payload)}, now())
    ON CONFLICT (time_range)
    DO UPDATE SET range_label = EXCLUDED.range_label, payload = EXCLUDED.payload, fetched_at = now()
  `;
}

const METRICS = [
  "CHAR_ lane_total_with_total_pick",
  "CHAR_total_cars",
  "CHAR_window_service",
  "CHAR_lane_queue",
  "CHAR_pre_menu_queue",
  "ww_flagged_pull_forward_cars",
];

const PEAK_DAYPARTS = new Set([2, 4]);
const NONPEAK_DAYPARTS = new Set([1, 3, 5, 6]);

function secsToMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Weighted average of a time metric, weighted by car count per row. */
function weightedAvgMMSS(rows: DaypartRow[], timeField: keyof DaypartRow): string | null {
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
  return secsToMMSS(weightedSecs / totalCars);
}

function sumNum(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0);
}

function computeStoreMetrics(
  rows: DaypartRow[],
  overallByStore: Map<string, string | null>,
): StoreMetrics[] {
  const byStore = new Map<string, DaypartRow[]>();
  for (const row of rows) {
    const key = row.store_name_and_id;
    if (!byStore.has(key)) byStore.set(key, []);
    byStore.get(key)!.push(row);
  }

  const results: StoreMetrics[] = [];
  for (const [store, storeRows] of byStore) {
    const peakRows = storeRows.filter((r) => PEAK_DAYPARTS.has(r.daypart_index));
    const nonpeakRows = storeRows.filter((r) => NONPEAK_DAYPARTS.has(r.daypart_index));

    const dayparts: DaypartMetrics[] = storeRows
      .slice()
      .sort((a, b) => a.daypart_index - b.daypart_index)
      .map((r) => ({
        index: r.daypart_index,
        lane_total: r["CHAR_ lane_total_with_total_pick"] ?? null,
        total_cars: r.CHAR_total_cars ?? null,
        pre_menu_queue: r.CHAR_pre_menu_queue ?? null,
        window_service: r.CHAR_window_service ?? null,
        flagged_pull_forward: r.ww_flagged_pull_forward_cars ?? null,
      }));

    results.push({
      store_name_and_id: store,
      overall: {
        // Use Superset's store-level aggregation directly (matches Berry dashboard)
        lane_total:            overallByStore.get(store) ?? null,
        total_cars:            sumNum(storeRows.map((r) => r.CHAR_total_cars)),
        flagged_pull_forward:  sumNum(storeRows.map((r) => r.ww_flagged_pull_forward_cars)),
        window_service:        weightedAvgMMSS(storeRows, "CHAR_window_service"),
        pre_menu_queue:        weightedAvgMMSS(storeRows, "CHAR_pre_menu_queue"),
      },
      peak: {
        lane_total:     weightedAvgMMSS(peakRows,    "CHAR_ lane_total_with_total_pick"),
        pre_menu_queue: weightedAvgMMSS(peakRows,    "CHAR_pre_menu_queue"),
        window_service: weightedAvgMMSS(peakRows,    "CHAR_window_service"),
      },
      nonpeak: {
        lane_total:     weightedAvgMMSS(nonpeakRows,    "CHAR_ lane_total_with_total_pick"),
        pre_menu_queue: weightedAvgMMSS(nonpeakRows,    "CHAR_pre_menu_queue"),
        window_service: weightedAvgMMSS(nonpeakRows,    "CHAR_window_service"),
      },
      dayparts,
    });
  }

  return results;
}

export class ChartFetchError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown) {
    super(`Failed to fetch chart data (status ${status})`);
    this.status = status;
    this.detail = detail;
  }
}

export type DriveThruPayload = {
  time_range: string;
  range_label: string;
  stores: StoreMetrics[];
  store_count: number;
  raw_row_count: number;
};

/**
 * Fetches per-store drive-thru metrics (lane total, pre-menu queue, window
 * service, peak/non-peak breakdown) for a resolved Superset time_range
 * string. Shared by the /api/berry/data route and the chat tool so both use
 * the same query, computation, and cache.
 */
export async function getDriveThruMetrics(
  token: string,
  timeRange: string,
  rangeLabel: string,
  opts: { bust?: boolean } = {},
): Promise<DriveThruPayload> {
  const closed = isClosedRange(timeRange);

  if (!opts.bust) {
    const cached = await getCachedPayload(timeRange);
    if (cached) {
      if (closed) return cached.payload; // permanent — the period is over, numbers can't change
      if (Date.now() - cached.fetchedAt.getTime() < rollingTTL(timeRange)) return cached.payload;
    }
  }

  const session = await ensureSession(token);
  const { guestToken: guest_token, sessionCookie, csrfToken } = session;

  const chartBody = {
    datasource: { id: DATASOURCE_ID, type: "table" },
    force: true,
    queries: [
      // Query 0: per-store per-daypart (for daypart breakdown + peak/nonpeak)
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
      // Query 1: per-store only — Superset's own aggregation of lane total (matches Berry dashboard)
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

  const chartRes = await fetch(`${SUPERSET_BASE}/api/v1/chart/data`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GuestToken": guest_token,
      ...(csrfToken ? { "X-CSRFToken": csrfToken } : {}),
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    },
    body: JSON.stringify(chartBody),
  });

  const chartData = await chartRes.json().catch(() => ({}));
  if (!chartRes.ok) {
    if (chartRes.status === 401 || chartRes.status === 403) invalidateSession();
    throw new ChartFetchError(chartRes.status, chartData);
  }

  const rawRows: DaypartRow[] = chartData?.result?.[0]?.data ?? [];

  const storeRows: StoreRow[] = chartData?.result?.[1]?.data ?? [];
  const overallByStore = new Map<string, string | null>();
  for (const r of storeRows) {
    overallByStore.set(r.store_name_and_id, r["CHAR_ lane_total_with_total_pick"] ?? null);
  }

  const stores = computeStoreMetrics(rawRows, overallByStore);

  const payload: DriveThruPayload = {
    time_range: timeRange,
    range_label: rangeLabel,
    stores,
    store_count: stores.length,
    raw_row_count: rawRows.length,
  };

  // Skip caching empty results so a transient Superset miss doesn't lock out
  // valid data for the full TTL window (or permanently, for a closed range).
  if (stores.length > 0) {
    await setCachedPayload(timeRange, rangeLabel, payload);
  }

  return payload;
}

// ── Opportunistic pre-warming ─────────────────────────────────────────────────
// BerryAI has no service credential — only a live user session can fetch this
// data (see getBerryAuth), so there's no cron to pre-warm the cache on a
// schedule the way the PAR rollup does. Instead, whenever a valid session
// happens to be available (someone loaded the dashboard or asked the chatbot
// a drive-thru question), opportunistically refresh any of these commonly-
// asked ranges that are missing or stale, using that same session — so the
// *next* request for any of them (from anyone) hits a warm cache instead of
// waiting on a live Superset call. Call via next/server's after() so it runs
// post-response and never slows down the request that triggered it.
const STANDARD_RANGE_KEYS: RangeKey[] = ["today", "yesterday", "wtd", "last_week", "mtd", "ytd"];

export async function warmStandardRanges(token: string): Promise<void> {
  for (const rangeKey of STANDARD_RANGE_KEYS) {
    const { range, label } = resolveRange(rangeKey);
    try {
      await getDriveThruMetrics(token, range, label); // no-ops internally if already fresh/permanent
    } catch {
      // Best-effort — a failed pre-warm just means the next real request pays the live cost.
    }
  }
}
