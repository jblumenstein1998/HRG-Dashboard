/**
 * Stored accuracy checks for Slack reports — one row per report message.
 *
 * Checking a report costs a PAR orders pull for its day, too slow to do for a
 * whole range on page load (14 cold days took 72s). So a nightly cron
 * (/api/cron/slack-accuracy) checks the previous days' reports once and keeps
 * the result here; the admin table reads these and only checks today live.
 *
 * Kept for 90 days to match the Slack workspace's history (Josh, 2026-10-29):
 * past that there is no message left to show a check beside.
 */

import { sql } from "./db";
import type { ReportCheck } from "./slackAccuracy";

export const KEEP_DAYS = 90;

let schemaReady: Promise<void> | null = null;

export function ensureSlackAccuracySchema(): Promise<void> {
  schemaReady ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS slack_report_checks (
        store_id    text        NOT NULL,
        ts          text        NOT NULL,
        report_date date        NOT NULL,
        slot        text        NOT NULL,
        accurate    boolean,
        checks      jsonb       NOT NULL,
        checked_at  timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (store_id, ts)
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS slack_report_checks_store_date ON slack_report_checks (store_id, report_date)`;
  })().catch((err) => {
    schemaReady = null;
    throw err;
  });
  return schemaReady;
}

export async function saveChecks(storeId: string, checks: Map<string, ReportCheck>): Promise<number> {
  if (checks.size === 0) return 0;
  await ensureSlackAccuracySchema();
  const rows = [...checks.entries()].map(([ts, c]) => ({
    store_id: storeId, ts, report_date: c.date, slot: c.slot, accurate: c.accurate, checks: c.checks,
  }));
  await sql`
    INSERT INTO slack_report_checks (store_id, ts, report_date, slot, accurate, checks)
    SELECT store_id, ts, report_date::date, slot, accurate, checks
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      AS r(store_id text, ts text, report_date text, slot text, accurate boolean, checks jsonb)
    ON CONFLICT (store_id, ts) DO UPDATE SET
      report_date = EXCLUDED.report_date,
      slot        = EXCLUDED.slot,
      accurate    = EXCLUDED.accurate,
      checks      = EXCLUDED.checks,
      checked_at  = now()
  `;
  return rows.length;
}

/** Stored checks for a store's reports dated within [start, end]. */
export async function getChecks(storeId: string, start: string, end: string): Promise<Map<string, ReportCheck>> {
  await ensureSlackAccuracySchema();
  const rows = (await sql`
    SELECT ts, report_date::text AS report_date, slot, accurate, checks
    FROM slack_report_checks
    WHERE store_id = ${storeId} AND report_date BETWEEN ${start} AND ${end}
  `) as { ts: string; report_date: string; slot: ReportCheck["slot"]; accurate: boolean | null; checks: ReportCheck["checks"] }[];
  return new Map(rows.map((r) => [r.ts, { date: r.report_date.slice(0, 10), slot: r.slot, accurate: r.accurate, checks: r.checks }]));
}

export async function pruneChecks(before: string): Promise<number> {
  await ensureSlackAccuracySchema();
  const rows = (await sql`DELETE FROM slack_report_checks WHERE report_date < ${before} RETURNING 1`) as unknown[];
  return rows.length;
}
