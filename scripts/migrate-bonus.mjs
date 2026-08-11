// Run with:  node --env-file=.env.local scripts/migrate-bonus.mjs
// Creates the bonus attainment tables in Neon. Safe to re-run (IF NOT EXISTS).
//
// Mirrors ensureBonusSchema() in src/lib/bonus/store.ts. That runs at write
// time, so strictly this script isn't required — but the /bonus tab reads
// before anything has ever written, and running this first means the tab comes
// up empty rather than relying on the missing-table fallback in the API route.
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

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
await sql`CREATE INDEX IF NOT EXISTS bonus_inputs_period ON bonus_inputs (period_label, store_id)`;

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
await sql`CREATE INDEX IF NOT EXISTS bonus_results_period ON bonus_results (period_label)`;

// The automatic half of a scorecard, cached per store per period, so that
// saving a manual entry rescores from Postgres instead of re-pulling four
// vendors for twelve stores.
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

console.log("bonus_inputs, bonus_metrics, bonus_results, bonus_period_locks, netchef_costs ready.");
