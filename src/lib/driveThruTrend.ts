/**
 * Drive-thru trend history — bucketed by week, calendar month, or fiscal period.
 *
 * Replaces the old berryWeekly.ts, which only knew how to build Monday–Sunday
 * weeks and re-queried all ~26 of them from Superset on every cold start (the
 * only cache was a per-lambda in-memory variable). Every bucket is now stored in
 * Postgres, so a page load is one SELECT instead of 26 live chart queries.
 *
 * Each bucket is fetched from Superset in its own right rather than rolled up
 * from the weekly numbers. Lane total comes from Superset's own store-level
 * aggregate (a percentile-ish "with total pick" measure), which is NOT the
 * car-weighted mean of its weeks — deriving periods from weeks would quietly
 * disagree with every other lane-total figure on the dashboard.
 */
import { SUPERSET_BASE, SUPERSET_DASHBOARD_ID, DaypartRow, StoreRow, parseMMSS } from "./berry";
import { FISCAL_YEAR_START, PERIODS, currentPeriod } from "./fiscal";
import { ensureSession, invalidateSession } from "./supersetSession";
import { sql } from "./db";

const CHART_ID = 93;
const DATASOURCE_ID = 18;
const METRICS = [
  "CHAR_ lane_total_with_total_pick",
  "CHAR_total_cars",
  "CHAR_window_service",
  "CHAR_menu_board",
  "ww_flagged_pull_forward_cars",
];

/** A rolling (still in-progress) bucket re-checks this often; closed ones never do. */
const ROLLING_TTL_MS = 6 * 60 * 60 * 1000;

export type Granularity = "week" | "month" | "period";

export const GRANULARITIES: Granularity[] = ["week", "month", "period"];

export function isGranularity(v: string | null): v is Granularity {
  return v === "week" || v === "month" || v === "period";
}

export type TrendStorePoint = {
  lane_total_secs: number | null;
  window_service_secs: number | null;
  menu_board_secs: number | null;
  flagged_pull_forward: number | null;
  total_cars: number | null;
};

export type TrendPoint = {
  granularity: Granularity;
  bucketKey: string;
  label: string;
  start: string;
  end: string;
  stores: Record<string, TrendStorePoint>;
};

type BucketDef = {
  granularity: Granularity;
  bucketKey: string;
  label: string;
  start: string;
  end: string;
};

// ── Date helpers (local-date parsing, same convention as fiscal.ts) ──────────

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

/** Today in America/Chicago — Vercel runs UTC, so the server clock can't be trusted. */
function todayCentral(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"));
}

function yesterdayCentral(): Date {
  const t = todayCentral();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1);
}

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ── Bucket definitions ───────────────────────────────────────────────────────

/**
 * Every bucket of a given granularity in the current fiscal year, from the
 * fiscal year start through the period we're currently in. Buckets that haven't
 * started yet are omitted; the one in progress is included and simply carries
 * partial numbers until it closes.
 *
 * The old buildWeeks() hardcoded its end at Period 6, so the chart silently
 * stopped a period behind as soon as P7 began — this tracks the calendar.
 */
export function buildBuckets(granularity: Granularity): BucketDef[] {
  const today = todayCentral();
  const fyStart = toDate(FISCAL_YEAR_START);
  const cur = currentPeriod();
  const horizon = toDate(cur.end);
  const fyLabel = String(toDate(PERIODS[0].end).getFullYear()).slice(2);

  const buckets: BucketDef[] = [];

  if (granularity === "week") {
    let cursor = new Date(fyStart);
    let n = 1;
    while (cursor <= horizon) {
      const end = new Date(cursor);
      end.setDate(end.getDate() + 6);
      buckets.push({
        granularity,
        bucketKey: `${fyLabel}-W${String(n).padStart(2, "0")}`,
        label: `W${n}-${fyLabel}`,
        start: fmt(cursor),
        end: fmt(end),
      });
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 7);
      n++;
    }
  } else if (granularity === "period") {
    for (const p of PERIODS) {
      if (toDate(p.start) > horizon) break;
      buckets.push({
        granularity,
        bucketKey: `${fyLabel}-P${String(p.period).padStart(2, "0")}`,
        label: `P${p.period}-${fyLabel}`,
        start: p.start,
        end: p.end,
      });
    }
  } else {
    // Calendar months. FY2026 opens on Dec 29, 2025, so the first calendar month
    // inside the fiscal year is a 3-day stub — a bar for "Dec 25" built from
    // three days would read as a real month-over-month swing on the chart, so
    // monthly starts at the first month that begins on or after the FY start.
    let cursor = new Date(fyStart.getFullYear(), fyStart.getMonth(), 1);
    if (cursor < fyStart) cursor = new Date(fyStart.getFullYear(), fyStart.getMonth() + 1, 1);
    while (cursor <= horizon) {
      const end = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
      const yy = String(cursor.getFullYear()).slice(2);
      buckets.push({
        granularity,
        bucketKey: `${cursor.getFullYear()}-M${String(cursor.getMonth() + 1).padStart(2, "0")}`,
        label: `${MONTH_ABBR[cursor.getMonth()]} ${yy}`,
        start: fmt(cursor),
        end: fmt(end),
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  // Drop buckets that haven't begun yet (a period horizon can run past today).
  return buckets.filter(b => toDate(b.start) <= today);
}

/** A bucket whose end date is already past can never change again. */
function isClosed(bucket: BucketDef): boolean {
  return toDate(bucket.end) < todayCentral();
}

/**
 * The window we actually ask Superset for. An in-progress bucket is truncated
 * at yesterday: today is still accumulating cars, and including a half-day
 * would drag the average around every time someone reloaded the page.
 */
function queryRange(bucket: BucketDef): string | null {
  const lastClosedDay = yesterdayCentral();
  const start = toDate(bucket.start);
  if (start > lastClosedDay) return null;
  const end = toDate(bucket.end) <= lastClosedDay ? toDate(bucket.end) : lastClosedDay;
  return `${fmt(start)}T00:00:00 : ${fmt(end)}T23:59:59`;
}

// ── Rate limiter — cap concurrent Superset queries on the shared session ─────

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
  let cars = 0;
  for (const row of rows) {
    const secs = parseMMSS(row[timeField] as string | null);
    const c = row.CHAR_total_cars;
    if (secs == null || c == null || c === 0) continue;
    weightedSecs += secs * c;
    cars += c;
  }
  if (cars === 0) return null;
  return weightedSecs / cars;
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

async function fetchRange(
  guestToken: string,
  sessionCookie: string,
  csrfToken: string,
  timeRange: string,
): Promise<Record<string, TrendStorePoint>> {
  const query = (columns: string[], metrics: string[]) => ({
    time_range: timeRange,
    granularity: "datetime_local",
    filters: [],
    extras: { having: "", where: "", time_grain_sqla: null },
    applied_time_extras: { __time_range: timeRange },
    columns,
    metrics,
    orderby: [["store_name_and_id", true]],
    annotation_layers: [],
    row_limit: 1000,
    series_limit: 0,
    group_others_when_limit_reached: false,
    order_desc: false,
    url_params: { uiConfig: "1" },
    custom_params: {},
    custom_form_data: {},
  });

  const chartBody = {
    datasource: { id: DATASOURCE_ID, type: "table" },
    force: true,
    queries: [
      query(["store_name_and_id", "daypart_index"], METRICS),
      query(["store_name_and_id"], ["CHAR_ lane_total_with_total_pick"]),
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
      extra_form_data: { time_range: timeRange, granularity_sqla: "datetime_local" },
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
      if (res.status === 401 || res.status === 403) await invalidateSession();
      throw new Error(`Superset ${res.status}`);
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

    const result: Record<string, TrendStorePoint> = {};
    for (const [store, rows] of byStore) {
      // No cars at all means the store had no real drive-thru activity in this
      // window — Superset still returns a 0-filled row rather than omitting it,
      // so treat the point as missing instead of plotting a false "0".
      const cars = totalCars(rows);
      if (cars === 0) {
        result[store] = {
          lane_total_secs: null,
          window_service_secs: null,
          menu_board_secs: null,
          flagged_pull_forward: null,
          total_cars: null,
        };
        continue;
      }

      const laneStr = overallByStore.get(store) ?? null;
      result[store] = {
        lane_total_secs: laneStr != null ? parseMMSS(laneStr) : null,
        window_service_secs: weightedAvgSecs(rows, "CHAR_window_service"),
        menu_board_secs: weightedAvgSecs(rows, "CHAR_menu_board"),
        flagged_pull_forward: sumNum(rows.map(r => r.ww_flagged_pull_forward_cars)),
        total_cars: cars,
      };
    }
    return result;
  } finally {
    sem.release();
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function ensureTrendSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS drive_thru_trend (
      granularity  TEXT NOT NULL,
      bucket_key   TEXT NOT NULL,
      bucket_label TEXT NOT NULL,
      start_date   DATE NOT NULL,
      end_date     DATE NOT NULL,
      stores       JSONB NOT NULL,
      closed       BOOLEAN NOT NULL DEFAULT FALSE,
      fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (granularity, bucket_key)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS drive_thru_trend_lookup
    ON drive_thru_trend (granularity, start_date)
  `;
}

type StoredRow = {
  granularity: Granularity;
  bucket_key: string;
  bucket_label: string;
  start_date: string;
  end_date: string;
  stores: Record<string, TrendStorePoint>;
  closed: boolean;
  fetched_at: string;
};

async function readStored(granularity: Granularity): Promise<Map<string, StoredRow>> {
  const rows = (await sql`
    SELECT granularity, bucket_key, bucket_label,
           to_char(start_date, 'YYYY-MM-DD') AS start_date,
           to_char(end_date,   'YYYY-MM-DD') AS end_date,
           stores, closed, fetched_at
    FROM drive_thru_trend
    WHERE granularity = ${granularity}
  `) as StoredRow[];
  return new Map(rows.map(r => [r.bucket_key, r]));
}

async function writeBucket(bucket: BucketDef, stores: Record<string, TrendStorePoint>): Promise<void> {
  await sql`
    INSERT INTO drive_thru_trend
      (granularity, bucket_key, bucket_label, start_date, end_date, stores, closed, fetched_at)
    VALUES
      (${bucket.granularity}, ${bucket.bucketKey}, ${bucket.label}, ${bucket.start}, ${bucket.end},
       ${JSON.stringify(stores)}, ${isClosed(bucket)}, now())
    ON CONFLICT (granularity, bucket_key) DO UPDATE SET
      bucket_label = EXCLUDED.bucket_label,
      start_date   = EXCLUDED.start_date,
      end_date     = EXCLUDED.end_date,
      stores       = EXCLUDED.stores,
      closed       = EXCLUDED.closed,
      fetched_at   = now()
  `;
}

/** A stored bucket is reusable if it's closed, or rolling but still fresh. */
function isFresh(stored: StoredRow | undefined): boolean {
  if (!stored) return false;
  if (stored.closed) return true;
  return Date.now() - new Date(stored.fetched_at).getTime() < ROLLING_TTL_MS;
}

/**
 * The trend series for one granularity, served from Postgres. Buckets that are
 * missing or stale are fetched from Superset and persisted; in steady state
 * (after the cron has run) that's zero or one bucket, so the page load is a
 * single SELECT rather than ~26 live chart queries.
 *
 * `refresh` forces every bucket to be re-fetched, for the backfill/cron path.
 */
export async function getTrend(
  berryToken: string,
  granularity: Granularity,
  opts: { refresh?: boolean } = {},
): Promise<TrendPoint[]> {
  await ensureTrendSchema();

  const buckets = buildBuckets(granularity);
  const stored = await readStored(granularity);

  const missing = opts.refresh ? buckets : buckets.filter(b => !isFresh(stored.get(b.bucketKey)));

  if (missing.length > 0) {
    const session = await ensureSession(berryToken);
    const { guestToken, sessionCookie, csrfToken } = session;

    const fetched = await Promise.all(
      missing.map(async b => {
        const range = queryRange(b);
        if (!range) return null;
        try {
          const stores = await fetchRange(guestToken, sessionCookie, csrfToken, range);
          await writeBucket(b, stores);
          return { bucket: b, stores };
        } catch {
          // Keep whatever we already had for this bucket rather than blanking
          // the chart because one window failed.
          return null;
        }
      })
    );

    for (const f of fetched) {
      if (!f) continue;
      stored.set(f.bucket.bucketKey, {
        granularity,
        bucket_key: f.bucket.bucketKey,
        bucket_label: f.bucket.label,
        start_date: f.bucket.start,
        end_date: f.bucket.end,
        stores: f.stores,
        closed: isClosed(f.bucket),
        fetched_at: new Date().toISOString(),
      });
    }
  }

  return buckets.map(b => {
    const row = stored.get(b.bucketKey);
    return {
      granularity,
      bucketKey: b.bucketKey,
      label: b.label,
      start: b.start,
      end: b.end,
      stores: row?.stores ?? {},
    };
  });
}

/** Refresh every granularity — used by the daily cron. */
export async function refreshAllTrends(berryToken: string): Promise<Record<Granularity, number>> {
  const out = {} as Record<Granularity, number>;
  for (const g of GRANULARITIES) {
    // Only re-fetch what isn't already closed-and-stored; a full refresh would
    // re-query the entire fiscal year every night for no benefit.
    const points = await getTrend(berryToken, g);
    out[g] = points.length;
  }
  return out;
}
