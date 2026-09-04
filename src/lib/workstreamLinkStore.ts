/**
 * Postgres persistence for PAR ↔ Workstream employee links.
 *
 * One table, `workstream_employee_links`, holding **decisions people made** —
 * not matches the app computed. The distinction is the point: an automatic
 * exact-name match is derived on every read and never written down, so it
 * corrects itself when a roster changes, while a human decision is durable and
 * outranks anything the matcher would have said. See workstreamLink.ts.
 *
 * Three kinds of row, distinguished by `status`:
 *
 *   confirmed   this PAR employee is this Workstream employee
 *   absent      this PAR employee has no Workstream record, and that's fine —
 *               a stopgap for people PAR carries that Workstream never had
 *   rejected    this *pair* is not the same person; drops the candidate out of
 *               the queue permanently so a near-miss is refused once, not
 *               every week
 *
 * A PAR employee may have many rejected rows and at most one confirmed or
 * absent row, which is what the first partial unique index says. The second one
 * says a Workstream employee can be confirmed to at most one PAR employee
 * *per store* — per store rather than globally, because PAR's employee ids are
 * per location, so one person working two restaurants is legitimately two PAR
 * rows pointing at the same Workstream uuid.
 *
 * Schema creation follows the smgStore.ts / adminLinksStore.ts pattern: an
 * idempotent ensure* memoised per process, called before every read and write.
 */

import { sql } from "@/lib/db";
import type { LinkDecision, LinkDecisionStatus } from "./workstreamLink";

let schemaReady: Promise<void> | null = null;

export function ensureWorkstreamLinkSchema(): Promise<void> {
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
    CREATE TABLE IF NOT EXISTS workstream_employee_links (
      par_store_id    TEXT NOT NULL,
      par_employee_id TEXT NOT NULL,
      -- Empty string for an 'absent' decision: there is no counterpart to name,
      -- and NULL would defeat the primary key.
      workstream_uuid TEXT NOT NULL DEFAULT '',
      status          TEXT NOT NULL,
      -- The email of whoever decided. Blank only for rows written by a script.
      decided_by      TEXT NOT NULL DEFAULT '',
      decided_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      -- Free text from the reviewer, e.g. "transferred from Hampton in March".
      note            TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (par_store_id, par_employee_id, workstream_uuid)
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS workstream_links_one_per_par_employee
      ON workstream_employee_links (par_store_id, par_employee_id)
      WHERE status <> 'rejected'
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS workstream_links_one_per_workstream_person
      ON workstream_employee_links (par_store_id, workstream_uuid)
      WHERE status = 'confirmed'
  `;
}

type Row = {
  par_store_id: string;
  par_employee_id: string;
  workstream_uuid: string;
  status: string;
  decided_by: string;
  decided_at: string;
  note: string;
};

function toDecision(r: Row): LinkDecision & { note: string } {
  return {
    parStoreId: r.par_store_id,
    parEmployeeId: r.par_employee_id,
    workstreamUuid: r.workstream_uuid,
    status: r.status as LinkDecisionStatus,
    decidedBy: r.decided_by,
    decidedAt: new Date(r.decided_at).toISOString(),
    note: r.note,
  };
}

/** Every decision, or every decision for one store. */
export async function listDecisions(storeId?: string): Promise<(LinkDecision & { note: string })[]> {
  await ensureWorkstreamLinkSchema();
  const rows = (storeId
    ? await sql`
        SELECT * FROM workstream_employee_links
        WHERE par_store_id = ${storeId}
        ORDER BY par_employee_id, status
      `
    : await sql`
        SELECT * FROM workstream_employee_links
        ORDER BY par_store_id, par_employee_id, status
      `) as Row[];
  return rows.map(toDecision);
}

export type DecisionInput = {
  parStoreId: string;
  parEmployeeId: string;
  /** Required for confirm and reject; ignored for absent. */
  workstreamUuid?: string;
  decidedBy: string;
  note?: string;
};

/**
 * Record that a PAR employee is a particular Workstream employee.
 *
 * Clears any previous confirmed/absent row for that PAR employee, and any
 * confirmed row that already claimed this Workstream person at this store —
 * re-pointing a link is the common correction, and it should not need a delete
 * step the reviewer has to think about. Rejections are left alone: they are
 * statements about pairs, and confirming one pair says nothing about another.
 */
export async function confirmLink(input: DecisionInput): Promise<void> {
  const uuid = (input.workstreamUuid ?? "").trim();
  if (!uuid) throw new Error("confirmLink needs a workstream uuid");
  await ensureWorkstreamLinkSchema();

  await sql`
    DELETE FROM workstream_employee_links
    WHERE par_store_id = ${input.parStoreId}
      AND status <> 'rejected'
      AND (par_employee_id = ${input.parEmployeeId} OR workstream_uuid = ${uuid})
  `;

  // A pair confirmed by hand is no longer rejected — the reviewer has just
  // overruled the earlier refusal, and leaving the old row would suppress the
  // link they asked for.
  await sql`
    DELETE FROM workstream_employee_links
    WHERE par_store_id = ${input.parStoreId}
      AND par_employee_id = ${input.parEmployeeId}
      AND workstream_uuid = ${uuid}
      AND status = 'rejected'
  `;

  await sql`
    INSERT INTO workstream_employee_links
      (par_store_id, par_employee_id, workstream_uuid, status, decided_by, note)
    VALUES
      (${input.parStoreId}, ${input.parEmployeeId}, ${uuid}, 'confirmed', ${input.decidedBy}, ${input.note ?? ""})
  `;
}

/** Record that a PAR employee has no Workstream record at all. */
export async function markAbsent(input: DecisionInput): Promise<void> {
  await ensureWorkstreamLinkSchema();
  await sql`
    DELETE FROM workstream_employee_links
    WHERE par_store_id = ${input.parStoreId}
      AND par_employee_id = ${input.parEmployeeId}
      AND status <> 'rejected'
  `;
  await sql`
    INSERT INTO workstream_employee_links
      (par_store_id, par_employee_id, workstream_uuid, status, decided_by, note)
    VALUES
      (${input.parStoreId}, ${input.parEmployeeId}, '', 'absent', ${input.decidedBy}, ${input.note ?? ""})
  `;
}

/**
 * Record that a suggested pair is two different people.
 *
 * This is the row that makes the queue converge. Without it, the same wrong
 * "Chris Miller" is offered every week and the reviewer's earlier judgement is
 * thrown away — which is how a review surface turns into something people stop
 * opening.
 */
export async function rejectPair(input: DecisionInput): Promise<void> {
  const uuid = (input.workstreamUuid ?? "").trim();
  if (!uuid) throw new Error("rejectPair needs a workstream uuid");
  await ensureWorkstreamLinkSchema();

  // If this pair was the confirmed link, rejecting it also unlinks it.
  await sql`
    DELETE FROM workstream_employee_links
    WHERE par_store_id = ${input.parStoreId}
      AND par_employee_id = ${input.parEmployeeId}
      AND workstream_uuid = ${uuid}
  `;

  await sql`
    INSERT INTO workstream_employee_links
      (par_store_id, par_employee_id, workstream_uuid, status, decided_by, note)
    VALUES
      (${input.parStoreId}, ${input.parEmployeeId}, ${uuid}, 'rejected', ${input.decidedBy}, ${input.note ?? ""})
  `;
}

/**
 * Undo a decision and put the employee back in the queue.
 *
 * With a uuid it drops that one row — the way to un-reject a candidate that was
 * refused by mistake. Without one it drops the confirmed or absent row and
 * leaves rejections standing, which is "this link is wrong, but I still know
 * those other people aren't them".
 */
export async function clearDecision(
  parStoreId: string,
  parEmployeeId: string,
  workstreamUuid?: string,
): Promise<void> {
  await ensureWorkstreamLinkSchema();
  if (workstreamUuid) {
    await sql`
      DELETE FROM workstream_employee_links
      WHERE par_store_id = ${parStoreId}
        AND par_employee_id = ${parEmployeeId}
        AND workstream_uuid = ${workstreamUuid}
    `;
    return;
  }
  await sql`
    DELETE FROM workstream_employee_links
    WHERE par_store_id = ${parStoreId}
      AND par_employee_id = ${parEmployeeId}
      AND status <> 'rejected'
  `;
}
