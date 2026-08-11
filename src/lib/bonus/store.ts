/**
 * Postgres persistence for bonus attainment.
 *
 * Three tables, and the split between them matters:
 *
 *   bonus_inputs        what a person typed in. The only irreplaceable data in
 *                       the feature — everything else can be recomputed from
 *                       the vendors, this cannot.
 *   bonus_results       the computed scorecard. A cache, except once a period
 *                       is locked.
 *   bonus_period_locks  the freeze. Bonus numbers drive pay, and SMG keeps
 *                       revising closed periods for weeks (the sync cron
 *                       re-pulls a rolling 12-week window because late survey
 *                       responses keep arriving). Without a lock, the number
 *                       someone was paid on in P6 quietly stops matching what
 *                       the tab shows in P8. Locking snapshots the results as
 *                       approved and stops recomputing them.
 *
 * Schema creation follows the smgStore.ts pattern: an idempotent ensure* called
 * immediately before any write, rather than a migration framework. scripts/
 * migrate-bonus.mjs mirrors it so the tables can exist before the first cron.
 */

import { sql } from "../db";
import type { BonusInput, PositionId, PositionResult } from "./types";

// ── Schema ───────────────────────────────────────────────────────────────────

/**
 * Memoised per process.
 *
 * Every read and write below calls this, and it issues eight DDL statements.
 * Unmemoised, one save — which touches inputs, metrics, locks and results —
 * fired roughly forty sequential round trips at Neon and took 38 seconds.
 * Creating the schema is idempotent and the tables cannot vanish mid-process,
 * so once per process is enough; a Vercel cold start simply pays for it again.
 * A failure clears the memo so the next caller retries rather than inheriting
 * a permanently rejected promise.
 */
let schemaReady: Promise<void> | null = null;

export function ensureBonusSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createBonusSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createBonusSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_inputs (
      store_id     TEXT        NOT NULL,
      period_label TEXT        NOT NULL,
      criterion_id TEXT        NOT NULL,
      value        NUMERIC,
      note         TEXT,
      entered_by   TEXT,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (store_id, period_label, criterion_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS bonus_inputs_period
    ON bonus_inputs (period_label, store_id)
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_results (
      store_id       TEXT        NOT NULL,
      period_label   TEXT        NOT NULL,
      position_id    TEXT        NOT NULL,
      score          NUMERIC,
      score_ex_lov   NUMERIC,
      pending_count  INTEGER     NOT NULL DEFAULT 0,
      scoreable_wt   NUMERIC     NOT NULL DEFAULT 0,
      kicker_fired   BOOLEAN     NOT NULL DEFAULT FALSE,
      window_start   DATE,
      window_end     DATE,
      detail         JSONB       NOT NULL,
      computed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (store_id, period_label, position_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS bonus_results_period
    ON bonus_results (period_label)
  `;
  // The automatic half of a scorecard, cached per store per period.
  //
  // Without this, saving a single typed number meant re-resolving all four
  // vendors for all twelve stores — a BerryAI login, Superset fetches for any
  // rolling bucket, and 24 PAR queries — which took the better part of a
  // minute. Nobody types a Living Our Values score and waits a minute. The
  // cron writes these once; a save reads them back, merges the inputs and
  // rescores, which is pure Postgres.
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_metrics (
      store_id     TEXT        NOT NULL,
      period_label TEXT        NOT NULL,
      values       JSONB       NOT NULL,
      resolved_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (store_id, period_label)
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bonus_period_locks (
      period_label TEXT        NOT NULL PRIMARY KEY,
      locked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      locked_by    TEXT,
      note         TEXT,
      snapshot     JSONB       NOT NULL
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS netchef_costs (
      store_id     TEXT        NOT NULL,
      grain        TEXT        NOT NULL,
      bucket_key   TEXT        NOT NULL,
      window_start DATE        NOT NULL,
      window_end   DATE        NOT NULL,
      cogs_pct     NUMERIC,
      variance_pct NUMERIC,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (store_id, grain, bucket_key)
    )
  `;
}

// ── Manual inputs ────────────────────────────────────────────────────────────

type InputRow = {
  store_id: string;
  period_label: string;
  criterion_id: string;
  value: string | number | null;
  note: string | null;
  entered_by: string | null;
  updated_at: Date | string;
};

function toInput(r: InputRow): BonusInput {
  return {
    storeId: r.store_id,
    periodLabel: r.period_label,
    criterionId: r.criterion_id,
    value: r.value === null ? null : Number(r.value),
    note: r.note,
    enteredBy: r.entered_by,
    updatedAt: typeof r.updated_at === "string" ? r.updated_at : r.updated_at.toISOString(),
  };
}

export async function getInputs(periodLabel: string, storeId?: string): Promise<BonusInput[]> {
  await ensureBonusSchema();
  const rows = storeId
    ? await sql`
        SELECT * FROM bonus_inputs
        WHERE period_label = ${periodLabel} AND store_id = ${storeId}
      `
    : await sql`SELECT * FROM bonus_inputs WHERE period_label = ${periodLabel}`;
  return (rows as InputRow[]).map(toInput);
}

/**
 * Index inputs as store → criterion → value for the engine.
 *
 * A criterion present with a NULL value is deliberately kept out of the map:
 * the engine distinguishes "not entered yet" (pending) from "entered as zero"
 * (a real, scoreable miss), and collapsing the two would turn every blank into
 * a failing grade.
 */
export function indexInputs(inputs: BonusInput[]): Map<string, Map<string, number>> {
  const byStore = new Map<string, Map<string, number>>();
  for (const i of inputs) {
    if (i.value === null) continue;
    let m = byStore.get(i.storeId);
    if (!m) {
      m = new Map<string, number>();
      byStore.set(i.storeId, m);
    }
    m.set(i.criterionId, i.value);
  }
  return byStore;
}

export type InputWrite = {
  storeId: string;
  periodLabel: string;
  criterionId: string;
  value: number | null;
  note?: string | null;
  enteredBy?: string | null;
};

export async function saveInputs(writes: InputWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  await ensureBonusSchema();

  // One statement via UNNEST rather than a round trip per field: the entry form
  // saves a whole position's criteria at once (Training alone has 13), and
  // per-row inserts against Neon add up fast inside a serverless function.
  await sql`
    INSERT INTO bonus_inputs (store_id, period_label, criterion_id, value, note, entered_by, updated_at)
    SELECT u.store_id, u.period_label, u.criterion_id, u.value, u.note, u.entered_by, now()
    FROM UNNEST(
      ${writes.map((w) => w.storeId)}::text[],
      ${writes.map((w) => w.periodLabel)}::text[],
      ${writes.map((w) => w.criterionId)}::text[],
      ${writes.map((w) => w.value)}::numeric[],
      ${writes.map((w) => w.note ?? null)}::text[],
      ${writes.map((w) => w.enteredBy ?? null)}::text[]
    ) AS u(store_id, period_label, criterion_id, value, note, entered_by)
    ON CONFLICT (store_id, period_label, criterion_id)
    DO UPDATE SET
      value      = EXCLUDED.value,
      note       = EXCLUDED.note,
      entered_by = EXCLUDED.entered_by,
      updated_at = now()
  `;
  return writes.length;
}

// ── Cached automatic metrics ─────────────────────────────────────────────────

/** Persist the resolved automatic metrics so a later rescore needs no vendor calls. */
export async function saveMetrics(
  periodLabel: string,
  byStore: Map<string, Map<string, number>>
): Promise<number> {
  if (byStore.size === 0) return 0;
  await ensureBonusSchema();

  const rows = [...byStore.entries()].map(([storeId, values]) => ({
    storeId,
    json: JSON.stringify(Object.fromEntries(values)),
  }));

  await sql`
    INSERT INTO bonus_metrics (store_id, period_label, values, resolved_at)
    SELECT u.store_id, ${periodLabel}, u.values, now()
    FROM UNNEST(
      ${rows.map((r) => r.storeId)}::text[],
      ${rows.map((r) => r.json)}::jsonb[]
    ) AS u(store_id, values)
    ON CONFLICT (store_id, period_label)
    DO UPDATE SET values = EXCLUDED.values, resolved_at = now()
  `;
  return rows.length;
}

export async function getMetrics(periodLabel: string): Promise<Map<string, Map<string, number>>> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT store_id, values FROM bonus_metrics WHERE period_label = ${periodLabel}
  `) as { store_id: string; values: Record<string, number> }[];
  return new Map(rows.map((r) => [r.store_id, new Map(Object.entries(r.values))]));
}

// ── Computed results ─────────────────────────────────────────────────────────

export type StoredResult = {
  storeId: string;
  periodLabel: string;
  positionId: PositionId;
  score: number | null;
  scoreExLov: number | null;
  pendingCount: number;
  scoreableWeight: number;
  kickerFired: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  detail: PositionResult;
  computedAt: string;
};

type ResultRow = {
  store_id: string;
  period_label: string;
  position_id: string;
  score: string | number | null;
  score_ex_lov: string | number | null;
  pending_count: number;
  scoreable_wt: string | number;
  kicker_fired: boolean;
  window_start: Date | null;
  window_end: Date | null;
  detail: PositionResult;
  computed_at: Date | string;
};

/** Postgres DATE columns arrive as timestamps stamped UTC on Vercel — read UTC components. */
function dateOnly(d: Date | null): string | null {
  if (!d) return null;
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

function toResult(r: ResultRow): StoredResult {
  return {
    storeId: r.store_id,
    periodLabel: r.period_label,
    positionId: r.position_id as PositionId,
    score: r.score === null ? null : Number(r.score),
    scoreExLov: r.score_ex_lov === null ? null : Number(r.score_ex_lov),
    pendingCount: r.pending_count,
    scoreableWeight: Number(r.scoreable_wt),
    kickerFired: r.kicker_fired,
    windowStart: dateOnly(r.window_start),
    windowEnd: dateOnly(r.window_end),
    detail: r.detail,
    computedAt: typeof r.computed_at === "string" ? r.computed_at : r.computed_at.toISOString(),
  };
}

export async function getResults(periodLabel: string, storeId?: string): Promise<StoredResult[]> {
  await ensureBonusSchema();
  const rows = storeId
    ? await sql`
        SELECT * FROM bonus_results
        WHERE period_label = ${periodLabel} AND store_id = ${storeId}
      `
    : await sql`SELECT * FROM bonus_results WHERE period_label = ${periodLabel}`;
  return (rows as ResultRow[]).map(toResult);
}

export type ResultWrite = {
  result: PositionResult;
  windowStart: string;
  windowEnd: string;
};

export async function upsertResults(writes: ResultWrite[]): Promise<number> {
  if (writes.length === 0) return 0;
  await ensureBonusSchema();

  const chunkSize = 200;
  for (let i = 0; i < writes.length; i += chunkSize) {
    const chunk = writes.slice(i, i + chunkSize);
    await sql`
      INSERT INTO bonus_results (
        store_id, period_label, position_id, score, score_ex_lov,
        pending_count, scoreable_wt, kicker_fired, window_start, window_end,
        detail, computed_at
      )
      SELECT
        u.store_id, u.period_label, u.position_id, u.score, u.score_ex_lov,
        u.pending_count, u.scoreable_wt, u.kicker_fired, u.window_start, u.window_end,
        u.detail, now()
      FROM UNNEST(
        ${chunk.map((w) => w.result.storeId)}::text[],
        ${chunk.map((w) => w.result.periodLabel)}::text[],
        ${chunk.map((w) => w.result.positionId)}::text[],
        ${chunk.map((w) => w.result.score)}::numeric[],
        ${chunk.map((w) => w.result.scoreExLov)}::numeric[],
        ${chunk.map((w) => w.result.pendingCount)}::int[],
        ${chunk.map((w) => w.result.scoreableWeight)}::numeric[],
        ${chunk.map((w) => w.result.kickerFired)}::bool[],
        ${chunk.map((w) => w.windowStart)}::date[],
        ${chunk.map((w) => w.windowEnd)}::date[],
        ${chunk.map((w) => JSON.stringify(w.result))}::jsonb[]
      ) AS u(store_id, period_label, position_id, score, score_ex_lov,
             pending_count, scoreable_wt, kicker_fired, window_start, window_end, detail)
      ON CONFLICT (store_id, period_label, position_id)
      DO UPDATE SET
        score         = EXCLUDED.score,
        score_ex_lov  = EXCLUDED.score_ex_lov,
        pending_count = EXCLUDED.pending_count,
        scoreable_wt  = EXCLUDED.scoreable_wt,
        kicker_fired  = EXCLUDED.kicker_fired,
        window_start  = EXCLUDED.window_start,
        window_end    = EXCLUDED.window_end,
        detail        = EXCLUDED.detail,
        computed_at   = now()
    `;
  }
  return writes.length;
}

// ── Period locks ─────────────────────────────────────────────────────────────

export type PeriodLock = {
  periodLabel: string;
  lockedAt: string;
  lockedBy: string | null;
  note: string | null;
};

export async function listLocks(): Promise<PeriodLock[]> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT period_label, locked_at, locked_by, note FROM bonus_period_locks
  `) as { period_label: string; locked_at: Date | string; locked_by: string | null; note: string | null }[];
  return rows.map((r) => ({
    periodLabel: r.period_label,
    lockedAt: typeof r.locked_at === "string" ? r.locked_at : r.locked_at.toISOString(),
    lockedBy: r.locked_by,
    note: r.note,
  }));
}

export async function isLocked(periodLabel: string): Promise<boolean> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT 1 FROM bonus_period_locks WHERE period_label = ${periodLabel}
  `) as unknown[];
  return rows.length > 0;
}

/**
 * Freeze a period. The snapshot is a full copy of every stored result at the
 * moment of approval, kept separately from bonus_results so that even if
 * something later recomputes that period by mistake, what was approved is still
 * recoverable.
 */
export async function lockPeriod(
  periodLabel: string,
  lockedBy: string | null,
  note: string | null
): Promise<number> {
  await ensureBonusSchema();
  const results = await getResults(periodLabel);
  await sql`
    INSERT INTO bonus_period_locks (period_label, locked_at, locked_by, note, snapshot)
    VALUES (${periodLabel}, now(), ${lockedBy}, ${note}, ${JSON.stringify(results)}::jsonb)
    ON CONFLICT (period_label) DO NOTHING
  `;
  return results.length;
}

export async function unlockPeriod(periodLabel: string): Promise<void> {
  await ensureBonusSchema();
  await sql`DELETE FROM bonus_period_locks WHERE period_label = ${periodLabel}`;
}
