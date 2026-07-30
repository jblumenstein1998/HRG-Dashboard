/**
 * Persistence for SMG guest-satisfaction data.
 *
 * Rows are stored long (one row per unit × period × metric) rather than wide.
 * SMG's own column set shifts depending on which survey items you request, and
 * we need the same underlying data pivoted several ways — per store, per
 * regional manager, HRG combined, weekly vs period — so a narrow table with a
 * SQL pivot at read time beats a wide table we'd have to migrate every time a
 * metric is added.
 */
import { sql } from "@/lib/db";
import { getLastWeekRange, getPeriodForDate, getT7Range, getTodayRange } from "@/lib/fiscal";
import {
  fetchComparison,
  fetchTrend,
  listPeriodsOfType,
  smgDate,
  smgLogin,
  type DateTypeKey,
  type LevelKey,
  type SmgSession,
  type SurveyItemKey,
  type TrendRow,
} from "@/lib/smgTrend";

export type DateBasis = "visit" | "survey";

/** SMG's own rollup row across every selected unit. */
export const COMBINED_KEY = "COMBINED";

export async function ensureSmgSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS smg_scores (
      level         TEXT    NOT NULL,
      unit_key      TEXT    NOT NULL,
      unit_name     TEXT    NOT NULL,
      date_basis    TEXT    NOT NULL,
      period_type   TEXT    NOT NULL,
      period_label  TEXT    NOT NULL,
      period_year   INTEGER,
      period_number INTEGER,
      metric        TEXT    NOT NULL,
      score         NUMERIC,
      responses     INTEGER,
      below_min     BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (level, unit_key, date_basis, period_type, period_label, metric)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS smg_scores_lookup
    ON smg_scores (level, date_basis, period_type, period_year DESC, period_number DESC)
  `;
}

/**
 * "Week 18, 2026" / "Period 6, 2026" / "Quarter 2, 2026" -> sortable parts.
 * Labels that don't match (SMG occasionally emits a date range) keep nulls and
 * simply sort last.
 */
export function parsePeriodLabel(label: string): { year: number | null; number: number | null } {
  const m = label.match(/^(?:Week|Period|Month|Quarter)\s+(\d+),\s*(\d{4})$/i);
  if (m) return { number: Number(m[1]), year: Number(m[2]) };
  const y = label.match(/(\d{4})/);
  return { year: y ? Number(y[1]) : null, number: null };
}

/** A store row keys on its PAR store id; everything else keys on its name. */
function unitKey(row: TrendRow): string {
  if (row.unitLabel === "Combined") return COMBINED_KEY;
  return row.unitId ?? row.unitName;
}

export type IngestOptions = {
  level?: LevelKey;
  dateType?: DateTypeKey;
  startPeriodId: number | string;
  endPeriodId: number | string;
  periods: number;
  items?: SurveyItemKey[];
  dateBasis?: DateBasis;
  session?: SmgSession;
};

/** Pulls one report from SMG and upserts every cell. Returns rows written. */
export async function ingestTrend(opts: IngestOptions): Promise<number> {
  const session = opts.session ?? (await smgLogin());
  const level = opts.level ?? "store";
  const dateType = opts.dateType ?? "weekly";
  const dateBasis = opts.dateBasis ?? "visit";

  const rows = await fetchTrend(session, {
    level,
    dateType,
    startPeriodId: opts.startPeriodId,
    endPeriodId: opts.endPeriodId,
    periods: opts.periods,
    items: opts.items,
    dateBasis,
  });

  await ensureSmgSchema();
  await upsertRows(rows, level, dateType, dateBasis);
  return rows.length;
}

/**
 * One statement per chunk via UNNEST rather than a round trip per row — a
 * single store-level weekly pull is ~930 cells, which would otherwise be ~930
 * sequential HTTP round trips against Neon and blow the function timeout.
 */
async function upsertRows(
  rows: TrendRow[],
  level: string,
  periodType: string,
  dateBasis: string,
  chunkSize = 500,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const parsed = chunk.map((r) => parsePeriodLabel(r.period));

    await sql`
      INSERT INTO smg_scores (
        level, unit_key, unit_name, date_basis, period_type, period_label,
        period_year, period_number, metric, score, responses, below_min, updated_at
      )
      SELECT
        ${level}, u.unit_key, u.unit_name, ${dateBasis}, ${periodType}, u.period_label,
        u.period_year, u.period_number, u.metric, u.score, u.responses, u.below_min, now()
      FROM UNNEST(
        ${chunk.map(unitKey)}::text[],
        ${chunk.map((r) => r.unitName)}::text[],
        ${chunk.map((r) => r.period)}::text[],
        ${parsed.map((p) => p.year)}::int[],
        ${parsed.map((p) => p.number)}::int[],
        ${chunk.map((r) => r.metric)}::text[],
        ${chunk.map((r) => r.score)}::numeric[],
        ${chunk.map((r) => r.responses)}::int[],
        ${chunk.map((r) => r.belowMinResponses)}::bool[]
      ) AS u(unit_key, unit_name, period_label, period_year, period_number,
             metric, score, responses, below_min)
      ON CONFLICT (level, unit_key, date_basis, period_type, period_label, metric)
      DO UPDATE SET
        unit_name  = EXCLUDED.unit_name,
        score      = EXCLUDED.score,
        responses  = EXCLUDED.responses,
        below_min  = EXCLUDED.below_min,
        updated_at = now()
    `;
  }
}

/**
 * Ingests the most recent `periods` periods, resolving period ids from SMG
 * rather than computing them (ids don't extrapolate across year boundaries).
 */
export async function ingestRecentPeriods(opts: {
  level?: LevelKey;
  dateType?: DateTypeKey;
  periods: number;
  items?: SurveyItemKey[];
  dateBasis?: DateBasis;
  session?: SmgSession;
}): Promise<{ rows: number; from: string; to: string }> {
  const session = opts.session ?? (await smgLogin());
  const dateType = opts.dateType ?? "weekly";

  const available = await listPeriodsOfType(session, dateType);
  if (!available.length) throw new Error(`SMG returned no ${dateType} periods`);

  const window = available.slice(0, opts.periods); // newest first
  const newest = window[0];
  const oldest = window[window.length - 1];

  const rows = await ingestTrend({
    ...opts,
    session,
    dateType,
    startPeriodId: oldest.id,
    endPeriodId: newest.id,
    periods: window.length,
  });

  return { rows, from: oldest.label, to: newest.label };
}

// ── snapshots (rolling / to-date windows) ─────────────────────────────────────

export type SnapshotKey = "today" | "yesterday" | "last_week" | "t7" | "wtd" | "ptd";

export const SNAPSHOT_LABELS: Record<SnapshotKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_week: "Last Week",
  t7: "Rolling 7 Days",
  wtd: "WTD",
  ptd: "PTD",
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Start date of a fiscal.ts range string ("2026-06-29T00:00:00 : ..."). */
function rangeStart(range: string): Date {
  return startOfDay(new Date(range.split(" : ")[0]));
}

/**
 * Resolves each preset to a calendar window.
 *
 * Period boundaries come from fiscal.ts so SMG lines up with the drive-thru and
 * food-cost tabs — but WTD and PTD end **yesterday**, not today, matching how
 * the drive-thru tab is read. That also avoids today's visit-date figures
 * (which are barely populated, since guests answer days after visiting)
 * dragging the to-date numbers down.
 *
 * Returns null only when the calendar can't place yesterday at all.
 */
export function resolveSnapshotWindow(key: SnapshotKey): { start: Date; end: Date } | null {
  // "Today" comes from fiscal.ts, which derives it in America/Chicago — not from
  // the server clock. Vercel runs UTC, so `new Date()` would put the cron on the
  // wrong calendar day whenever it fires before 05:00 UTC, and would disagree
  // with the Central-anchored start dates the getters below return.
  const today = rangeStart(getTodayRange().range);
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);

  if (key === "today") return { start: today, end: today };
  if (key === "yesterday") return { start: yesterday, end: yesterday };
  if (key === "last_week") {
    // The last completed Mon–Sun week. Unlike the others this one is already
    // closed, so it ends on its own Sunday rather than being clipped to
    // yesterday — clipping would make it a partial week for six days out of
    // seven, which is what WTD is for.
    const r = getLastWeekRange().range;
    return { start: rangeStart(r), end: startOfDay(new Date(r.split(" : ")[1])) };
  }
  if (key === "t7") {
    // fiscal.ts's T7 already ends yesterday
    return { start: rangeStart(getT7Range().range), end: yesterday };
  }

  // WTD and PTD anchor on YESTERDAY, not today — the window ends yesterday, so
  // the week/period it belongs to is yesterday's.
  //
  // Anchoring on today used to collapse the window on the first day of a period
  // or week: the new period had no complete day yet, resolve returned null, the
  // ingest skipped it, and the previous row was left in place. The effect was
  // that the LAST day of every period never reached a PTD snapshot at all —
  // P7 ended 7/26 but its final PTD capture only ran through 7/25.
  //
  // Anchored on yesterday the window is always whole: mid-period it behaves
  // exactly as before, and on day one it reports the period that just closed,
  // complete, instead of a stale partial of it.
  if (key === "wtd") {
    const dow = yesterday.getDay(); // 0=Sun; weeks run Mon–Sun
    const back = dow === 0 ? 6 : dow - 1;
    const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate() - back);
    return { start, end: yesterday };
  }

  const period = getPeriodForDate(yesterday);
  if (!period) return null; // yesterday falls outside the defined fiscal year
  const [y, m, d] = period.start.split("-").map(Number);
  return { start: new Date(y, m - 1, d), end: yesterday };
}

export async function ensureSnapshotSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS smg_snapshots (
      range_key   TEXT    NOT NULL,
      level       TEXT    NOT NULL,
      unit_key    TEXT    NOT NULL,
      unit_name   TEXT    NOT NULL,
      date_basis  TEXT    NOT NULL,
      metric      TEXT    NOT NULL,
      score       NUMERIC,
      responses   INTEGER,
      below_min   BOOLEAN NOT NULL DEFAULT FALSE,
      window_start DATE   NOT NULL,
      window_end   DATE   NOT NULL,
      as_of       TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (range_key, level, unit_key, date_basis, metric)
    )
  `;
}

/** Pulls one preset window from SMG and replaces the stored snapshot. */
export async function ingestSnapshot(opts: {
  key: SnapshotKey;
  level?: LevelKey;
  items?: SurveyItemKey[];
  dateBasis?: DateBasis;
  session?: SmgSession;
}): Promise<{ rows: number; start: string; end: string } | null> {
  const window = resolveSnapshotWindow(opts.key);
  if (!window) return null;

  const session = opts.session ?? (await smgLogin());
  const level = opts.level ?? "store";
  const dateBasis = opts.dateBasis ?? "visit";

  const rows = await fetchComparison(session, {
    start: window.start,
    end: window.end,
    level,
    items: opts.items,
    dateBasis,
  });

  await ensureSnapshotSchema();

  const ws = smgDate(window.start);
  const we = smgDate(window.end);

  if (rows.length) {
    await sql`
      INSERT INTO smg_snapshots (
        range_key, level, unit_key, unit_name, date_basis, metric,
        score, responses, below_min, window_start, window_end, as_of
      )
      SELECT ${opts.key}, ${level}, u.unit_key, u.unit_name, ${dateBasis}, u.metric,
             u.score, u.responses, u.below_min, ${ws}::date, ${we}::date, now()
      FROM UNNEST(
        ${rows.map((r) => r.unitId ?? r.unitName)}::text[],
        ${rows.map((r) => r.unitName)}::text[],
        ${rows.map((r) => r.metric)}::text[],
        ${rows.map((r) => r.score)}::numeric[],
        ${rows.map((r) => r.responses)}::int[],
        ${rows.map((r) => r.belowMinResponses)}::bool[]
      ) AS u(unit_key, unit_name, metric, score, responses, below_min)
      ON CONFLICT (range_key, level, unit_key, date_basis, metric)
      DO UPDATE SET
        unit_name    = EXCLUDED.unit_name,
        score        = EXCLUDED.score,
        responses    = EXCLUDED.responses,
        below_min    = EXCLUDED.below_min,
        window_start = EXCLUDED.window_start,
        window_end   = EXCLUDED.window_end,
        as_of        = now()
    `;
  }

  return { rows: rows.length, start: ws, end: we };
}

export type SnapshotRow = {
  rangeKey: string;
  unitKey: string;
  unitName: string;
  metric: string;
  score: number | null;
  responses: number | null;
  belowMin: boolean;
  windowStart: string;
  windowEnd: string;
  asOf: string;
};

export async function querySnapshots(
  level: LevelKey = "store",
  dateBasis: DateBasis = "visit",
): Promise<SnapshotRow[]> {
  const rows = await sql`
    SELECT range_key, unit_key, unit_name, metric, score, responses, below_min,
           window_start, window_end, as_of
    FROM smg_snapshots
    WHERE level = ${level} AND date_basis = ${dateBasis}
    ORDER BY unit_name, metric
  `;
  return (rows as Record<string, unknown>[]).map((r) => ({
    rangeKey: String(r.range_key),
    unitKey: String(r.unit_key),
    unitName: String(r.unit_name),
    metric: String(r.metric),
    score: r.score === null ? null : Number(r.score),
    responses: r.responses === null ? null : Number(r.responses),
    belowMin: Boolean(r.below_min),
    windowStart: String(r.window_start),
    windowEnd: String(r.window_end),
    asOf: String(r.as_of),
  }));
}

// ── read path ─────────────────────────────────────────────────────────────────

export type ScoreQuery = {
  level?: LevelKey;
  dateBasis?: DateBasis;
  periodType?: DateTypeKey;
  /** Restrict to these unit keys (store ids, RM names, or COMBINED). */
  units?: string[];
  metrics?: string[];
  /** Most recent N periods. */
  limit?: number;
};

export type ScoreRow = {
  unitKey: string;
  unitName: string;
  periodLabel: string;
  periodYear: number | null;
  periodNumber: number | null;
  metric: string;
  score: number | null;
  responses: number | null;
  belowMin: boolean;
};

export async function queryScores(q: ScoreQuery = {}): Promise<ScoreRow[]> {
  const level = q.level ?? "store";
  const dateBasis = q.dateBasis ?? "visit";
  const periodType = q.periodType ?? "weekly";

  // Empty arrays mean "no filter" — passing them straight into = ANY() would
  // otherwise match nothing.
  const units = q.units?.length ? q.units : null;
  const metrics = q.metrics?.length ? q.metrics : null;
  const limit = q.limit ?? 52;

  const rows = await sql`
    SELECT unit_key, unit_name, period_label, period_year, period_number,
           metric, score, responses, below_min
    FROM smg_scores
    WHERE level = ${level}
      AND date_basis = ${dateBasis}
      AND period_type = ${periodType}
      AND (${units}::text[] IS NULL OR unit_key = ANY(${units}::text[]))
      AND (${metrics}::text[] IS NULL OR metric = ANY(${metrics}::text[]))
      AND (period_year, period_number) IN (
        SELECT DISTINCT period_year, period_number
        FROM smg_scores
        WHERE level = ${level} AND date_basis = ${dateBasis} AND period_type = ${periodType}
        ORDER BY period_year DESC NULLS LAST, period_number DESC NULLS LAST
        LIMIT ${limit}
      )
    ORDER BY period_year, period_number, unit_name, metric
  `;

  return (rows as Record<string, unknown>[]).map((r) => ({
    unitKey: String(r.unit_key),
    unitName: String(r.unit_name),
    periodLabel: String(r.period_label),
    periodYear: r.period_year === null ? null : Number(r.period_year),
    periodNumber: r.period_number === null ? null : Number(r.period_number),
    metric: String(r.metric),
    score: r.score === null ? null : Number(r.score),
    responses: r.responses === null ? null : Number(r.responses),
    belowMin: Boolean(r.below_min),
  }));
}

/** Distinct metrics present for a cut — drives the column set in the UI. */
export async function listStoredMetrics(
  level: LevelKey = "store",
  periodType: DateTypeKey = "weekly",
): Promise<string[]> {
  const rows = await sql`
    SELECT DISTINCT metric FROM smg_scores
    WHERE level = ${level} AND period_type = ${periodType}
    ORDER BY metric
  `;
  return (rows as { metric: string }[]).map((r) => r.metric);
}
