import { NextRequest } from "next/server";
import { getBerryAuth } from "@/lib/auth";
import { SUPERSET_BASE, SUPERSET_DASHBOARD_ID, DaypartRow, StoreRow, DaypartMetrics, StoreMetrics, parseMMSS } from "@/lib/berry";
import { resolveRange, RangeKey } from "@/lib/fiscal";
import { ensureSession, invalidateSession } from "@/lib/supersetSession";

const CHART_ID = 93;
const DATASOURCE_ID = 18;
const EMBEDDED_UUID = "7f63aaec-1db2-4d23-8fb4-3175a1110259";

// ---------------------------------------------------------------------------
// Data cache — keyed by resolved time_range string
// Historical ranges (closed date windows) are cached for 60 min.
// Rolling ranges (today / wtd / mtd / qtd / ytd) are cached for 5 min.
// ---------------------------------------------------------------------------
const ROLLING_RANGES = new Set(["today", "yesterday", "wtd", "mtd", "qtd", "ytd"]);
const dataCache = new Map<string, { data: unknown; expiresAt: number }>();

function dataTTL(rangeKey: RangeKey): number {
  return ROLLING_RANGES.has(rangeKey) ? 5 * 60 * 1000 : 60 * 60 * 1000;
}

const METRICS = [
  "CHAR_ lane_total_with_total_pick",
  "CHAR_total_cars",
  "CHAR_window_service",
  "CHAR_lane_queue",
  "CHAR_pre_menu_queue",
];

const PEAK_DAYPARTS = new Set([2, 4]);
const NONPEAK_DAYPARTS = new Set([1, 3, 5, 6]);


function secsToMMSS(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function avgMMSS(values: (string | null | undefined)[]): string | null {
  const valid = values.map((v) => parseMMSS(v)).filter((s): s is number => s !== null);
  if (valid.length === 0) return null;
  return secsToMMSS(valid.reduce((a, b) => a + b, 0) / valid.length);
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

function avgNum(values: (number | null | undefined)[]): number | null {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
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
      }));

    results.push({
      store_name_and_id: store,
      overall: {
        // Use Superset's store-level aggregation directly (matches Berry dashboard)
        lane_total:     overallByStore.get(store) ?? null,
        total_cars:     sumNum(storeRows.map((r) => r.CHAR_total_cars)),
        window_service: weightedAvgMMSS(storeRows, "CHAR_window_service"),
        pre_menu_queue: weightedAvgMMSS(storeRows, "CHAR_pre_menu_queue"),
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

export async function GET(request: NextRequest) {
  const { token } = await getBerryAuth();
  if (!token) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rangeKey = (request.nextUrl.searchParams.get("range") ?? "mtd") as RangeKey;
  const { range: timeRange, label: rangeLabel } = resolveRange(rangeKey);
  const bust = request.nextUrl.searchParams.get("bust") === "1";

  // --- Data cache check (skip if manual refresh) ---
  const cacheKey = rangeKey;
  if (!bust) {
    const cached = dataCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return Response.json(cached.data);
    }
  }

  // --- Auth session (cached in supersetSession module) ---
  let session;
  try {
    session = await ensureSession(token);
  } catch {
    return Response.json({ error: "Failed to establish Superset session" }, { status: 502 });
  }
  const { guestToken: guest_token, sessionCookie, csrfToken } = session;

  // Step 4: Fetch per-store, per-daypart metrics + store-level overall lane total
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

  const chartData = await chartRes.json();
  if (!chartRes.ok) {
    // Invalidate auth cache on 401/403 so next request re-authenticates
    if (chartRes.status === 401 || chartRes.status === 403) invalidateSession();
    return Response.json(
      { error: "Failed to fetch chart data", detail: chartData, status: chartRes.status },
      { status: chartRes.status }
    );
  }

  const rawRows: DaypartRow[] = chartData?.result?.[0]?.data ?? [];

  // Build a store→overall lane total map from the store-level query (result[1])
  const storeRows: StoreRow[] = chartData?.result?.[1]?.data ?? [];
  const overallByStore = new Map<string, string | null>();
  for (const r of storeRows) {
    overallByStore.set(r.store_name_and_id, r["CHAR_ lane_total_with_total_pick"] ?? null);
  }

  const stores = computeStoreMetrics(rawRows, overallByStore);

  const payload = {
    time_range: timeRange,
    range_label: rangeLabel,
    stores,
    store_count: stores.length,
    raw_row_count: rawRows.length,
    _debug: {
      query_time_range: timeRange,
      superset_status: chartRes.status,
      result_keys: Object.keys(chartData?.result?.[0] ?? {}),
      sample_rows: rawRows.slice(0, 3),
      applied_filters: chartData?.result?.[0]?.applied_filters ?? [],
      rejected_filters: chartData?.result?.[0]?.rejected_filters ?? [],
    },
  };

  // Store in data cache
  dataCache.set(cacheKey, { data: payload, expiresAt: Date.now() + dataTTL(rangeKey) });

  return Response.json(payload);
}
