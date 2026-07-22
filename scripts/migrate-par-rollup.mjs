// Run with:  node --env-file=.env.local scripts/migrate-par-rollup.mjs
// Creates the par_daily_metrics rollup table in Neon. Safe to re-run (IF NOT EXISTS).
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

await sql`
  CREATE TABLE IF NOT EXISTS par_daily_metrics (
    store_id      text NOT NULL,
    business_date date NOT NULL,
    net_sales     numeric NOT NULL,
    order_count   integer NOT NULL,
    labor_minutes integer NOT NULL,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (store_id, business_date)
  )
`;

console.log("par_daily_metrics ready.");
