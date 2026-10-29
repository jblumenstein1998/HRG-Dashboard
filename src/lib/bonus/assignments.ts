/**
 * Who holds each position on a store's bonus scorecard.
 *
 * Josh's rules (2026-10-28): every store's scorecard names its GM, AGM and four
 * Directors. Names are suggested from Workstream, whose job titles are
 * "General Manager", "AGM" and "Director" — one title for all four Directors,
 * so which Director is Drive-Thru and which is Quality is decided here, on the
 * tab, and nowhere else. Any name can be typed instead of a suggestion.
 *
 * ── Carried forward ──────────────────────────────────────────────────────────
 *
 * A management team changes a few times a year, not every period, so a period
 * with no row for a position reads the latest earlier period that has one, and
 * says where it came from. Saving writes the whole team to the period being
 * looked at, so a change made in P12 never rewrites who held the job in P11.
 * Only earlier periods are consulted, which keeps a past period's answer fixed
 * however later ones are edited; approving a period for pay also writes its
 * carried names into it (`materializeAssignments`), so the approved record
 * stands on its own rows.
 *
 * ── Not behind the scorecard's edit lock ─────────────────────────────────────
 *
 * Names are not scoring entries. The edit lock exists because opening an
 * unlocked scorecard clears its entries, and making someone unlock — and so
 * risk clearing — a scorecard to fix a misspelt name would be a trap. Only the
 * pay lock freezes them.
 */

import { sql } from "../db";
import { ensureBonusSchema } from "./store";
import { parsePeriodLabel } from "./periods";
import { POSITION_ORDER, type PositionId } from "./types";
import { storeById } from "./storeMap";
import { ensureWorkstreamEmployeeSchema } from "../workstreamStore";

export type Assignment = {
  positionId: PositionId;
  name: string;
  /** Set when the name was picked from Workstream, null when typed. */
  workstreamUuid: string | null;
  /** The period the name was saved under — this one, or the earlier one it carries from. */
  fromPeriod: string;
};

type AssignmentRow = {
  period_label: string;
  position_id: string;
  name: string;
  workstream_uuid: string | null;
};

const periodNumber = (label: string): number => parsePeriodLabel(label)?.period ?? -1;

/** One store's team for a period, each position falling back to the latest earlier period. */
export async function getAssignments(periodLabel: string, storeId: string): Promise<Assignment[]> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT period_label, position_id, name, workstream_uuid
    FROM bonus_assignments
    WHERE store_id = ${storeId}
  `) as AssignmentRow[];

  // Ordering in JS rather than SQL: period labels sort as text ("P10" < "P9"),
  // and parsePeriodLabel is the one place that knows what they mean.
  const target = periodNumber(periodLabel);
  const latest = new Map<string, AssignmentRow>();
  for (const r of rows) {
    const n = periodNumber(r.period_label);
    if (n < 0 || n > target) continue;
    const held = latest.get(r.position_id);
    if (!held || n > periodNumber(held.period_label)) latest.set(r.position_id, r);
  }

  return POSITION_ORDER.flatMap((positionId) => {
    const r = latest.get(positionId);
    // An empty name is how a position is cleared, so it carries nothing forward.
    if (!r || !r.name) return [];
    return [{ positionId, name: r.name, workstreamUuid: r.workstream_uuid, fromPeriod: r.period_label }];
  });
}

export type AssignmentWrite = {
  positionId: PositionId;
  name: string;
  workstreamUuid: string | null;
};

/**
 * Save a store's whole team for one period.
 *
 * Every position is written, blanks included: a blank saved here stops an
 * earlier period's name carrying into this one, which is what clearing a
 * position on screen means.
 */
export async function saveAssignments(
  periodLabel: string,
  storeId: string,
  writes: AssignmentWrite[],
  changedBy: string | null,
): Promise<number> {
  if (writes.length === 0) return 0;
  await ensureBonusSchema();
  await sql`
    INSERT INTO bonus_assignments (store_id, period_label, position_id, name, workstream_uuid, changed_by, changed_at)
    SELECT ${storeId}, ${periodLabel}, u.position_id, u.name, u.workstream_uuid, ${changedBy}, now()
    FROM UNNEST(
      ${writes.map((w) => w.positionId)}::text[],
      ${writes.map((w) => w.name.trim())}::text[],
      ${writes.map((w) => w.workstreamUuid)}::text[]
    ) AS u(position_id, name, workstream_uuid)
    ON CONFLICT (store_id, period_label, position_id)
    DO UPDATE SET
      name            = EXCLUDED.name,
      workstream_uuid = EXCLUDED.workstream_uuid,
      changed_by      = EXCLUDED.changed_by,
      changed_at      = now()
  `;
  return writes.length;
}

/**
 * Write every store's carried names into a period as its own rows, for the pay
 * lock. Positions already saved under the period are left alone.
 */
export async function materializeAssignments(periodLabel: string, storeIds: string[]): Promise<number> {
  let written = 0;
  for (const storeId of storeIds) {
    const carried = (await getAssignments(periodLabel, storeId)).filter((a) => a.fromPeriod !== periodLabel);
    if (carried.length === 0) continue;
    await sql`
      INSERT INTO bonus_assignments (store_id, period_label, position_id, name, workstream_uuid, changed_by, changed_at)
      SELECT ${storeId}, ${periodLabel}, u.position_id, u.name, u.workstream_uuid, 'carried forward', now()
      FROM UNNEST(
        ${carried.map((a) => a.positionId)}::text[],
        ${carried.map((a) => a.name)}::text[],
        ${carried.map((a) => a.workstreamUuid)}::text[]
      ) AS u(position_id, name, workstream_uuid)
      ON CONFLICT (store_id, period_label, position_id) DO NOTHING
    `;
    written += carried.length;
  }
  return written;
}

// ── Suggestions from Workstream ──────────────────────────────────────────────

/** Workstream's job titles for the people a scorecard names. */
export type ManagerTitle = "General Manager" | "AGM" | "Director";

const MANAGER_TITLES: ManagerTitle[] = ["General Manager", "AGM", "Director"];

/** Which Workstream title fills which scorecard position. */
export const TITLE_FOR_POSITION: Record<PositionId, ManagerTitle> = {
  gm: "General Manager",
  agm: "AGM",
  driveThru: "Director",
  quality: "Director",
  training: "Director",
  hospitality: "Director",
};

export type Candidate = {
  workstreamUuid: string;
  name: string;
  title: ManagerTitle;
  storeId: string | null;
  storeName: string | null;
};

/**
 * Workstream keeps names as typed at hire — "Shiloh MASON", "ryan white". A
 * word typed entirely in one case is capitalised; a mixed-case one ("McNeil",
 * "DeShawn") was typed deliberately and is kept.
 */
function tidyName(s: string): string {
  return s
    .trim()
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() || w === w.toLowerCase()
      ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      : w))
    .join(" ");
}

/**
 * One store's current staff with a GM, AGM or Director title.
 *
 * This store's people only (Josh, 2026-10-29). A store that is short a
 * Director has nobody to suggest for it, and offering someone from another
 * store would put a name in that slot that doesn't belong there. Anyone else
 * can still be typed.
 */
export async function listCandidates(storeId: string): Promise<Candidate[]> {
  await ensureWorkstreamEmployeeSchema();
  const rows = (await sql`
    SELECT uuid, first_name, last_name, preferred_name, store_id, job_title
    FROM workstream_employees
    WHERE status = 'active' AND termination_date IS NULL
      AND store_id = ${storeId}
      AND job_title = ANY(${MANAGER_TITLES}::text[])
    ORDER BY last_name, first_name
  `) as {
    uuid: string;
    first_name: string;
    last_name: string;
    preferred_name: string;
    store_id: string | null;
    job_title: ManagerTitle;
  }[];

  return rows.map((r) => ({
    workstreamUuid: r.uuid,
    name: tidyName(`${r.preferred_name || r.first_name} ${r.last_name}`),
    title: r.job_title,
    storeId: r.store_id,
    storeName: r.store_id ? storeById(r.store_id)?.name ?? null : null,
  }));
}
