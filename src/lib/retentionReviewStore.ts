/**
 * Human answers to "did this Workstream hire ever work a shift?".
 *
 * Retention counts a Workstream record as a hire only once it has clocked time
 * in PAR (workstreamRetention.ts). The two systems share nothing but a name, so
 * when the name doesn't line up — a typo, a nickname, a surname PAR shortened
 * to an initial — nobody can say automatically, and the person's store is left
 * pending until somebody does. This table is where they say it.
 *
 * Keyed by the Workstream person alone, not by period: whether someone ever
 * worked is a fact about them, and the same answer settles their 30-, 60- and
 * 90-day anniversaries, which usually land in three different periods.
 *
 * `store_id` is only set when the record has no store of its own — a leaver
 * Workstream stopped attributing before our sync first saw them — and says
 * which store their shifts were at.
 */

import { sql } from "@/lib/db";

export type RetentionOutcome = "worked" | "never_worked";

export type RetentionReview = {
  workstreamUuid: string;
  outcome: RetentionOutcome;
  storeId: string | null;
  decidedBy: string;
  decidedAt: string;
  note: string;
};

let schemaReady: Promise<void> | null = null;

export function ensureRetentionReviewSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS retention_hire_reviews (
      workstream_uuid TEXT PRIMARY KEY,
      -- 'worked' | 'never_worked'
      outcome         TEXT NOT NULL,
      store_id        TEXT,
      decided_by      TEXT NOT NULL DEFAULT '',
      decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      note            TEXT NOT NULL DEFAULT ''
    )
  `;
}

export async function listRetentionReviews(): Promise<Map<string, RetentionReview>> {
  await ensureRetentionReviewSchema();
  const rows = (await sql`
    SELECT workstream_uuid, outcome, store_id, decided_by, decided_at, note
    FROM retention_hire_reviews
  `) as {
    workstream_uuid: string;
    outcome: RetentionOutcome;
    store_id: string | null;
    decided_by: string;
    decided_at: Date | string;
    note: string;
  }[];
  return new Map(
    rows.map((r) => [
      r.workstream_uuid,
      {
        workstreamUuid: r.workstream_uuid,
        outcome: r.outcome,
        storeId: r.store_id,
        decidedBy: r.decided_by,
        decidedAt: new Date(r.decided_at).toISOString(),
        note: r.note,
      },
    ]),
  );
}

export async function saveRetentionReview(input: {
  workstreamUuid: string;
  outcome: RetentionOutcome;
  storeId?: string | null;
  decidedBy: string;
  note?: string;
}): Promise<void> {
  await ensureRetentionReviewSchema();
  await sql`
    INSERT INTO retention_hire_reviews (workstream_uuid, outcome, store_id, decided_by, note)
    VALUES (${input.workstreamUuid}, ${input.outcome}, ${input.storeId ?? null}, ${input.decidedBy}, ${input.note ?? ""})
    ON CONFLICT (workstream_uuid) DO UPDATE SET
      outcome = EXCLUDED.outcome,
      store_id = EXCLUDED.store_id,
      decided_by = EXCLUDED.decided_by,
      decided_at = now(),
      note = EXCLUDED.note
  `;
}

export async function clearRetentionReview(workstreamUuid: string): Promise<void> {
  await ensureRetentionReviewSchema();
  await sql`DELETE FROM retention_hire_reviews WHERE workstream_uuid = ${workstreamUuid}`;
}
