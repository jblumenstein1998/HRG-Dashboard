/**
 * Who holds each position on a store's bonus scorecard.
 *
 * Josh's rules (2026-10-28/29): every store's scorecard lists its team — the
 * GM, AGM and four Directors — as rows of position + name, and more rows can be
 * added, such as a second GM. **Two people in one position split that
 * position's bonus** (to matter once $ payouts are built). Names are suggested
 * from the store's own Workstream staff, whose job titles are "General
 * Manager", "AGM" and "Director" — one title for all four Directors, so which
 * Director is Drive-Thru and which is Quality is decided here, on the tab, and
 * nowhere else. Any name can be typed instead of a suggestion.
 *
 * ── Carried forward ──────────────────────────────────────────────────────────
 *
 * A management team changes a few times a year, not every period, so a period
 * with no team saved reads the team of the latest earlier period that has one,
 * and says where it came from. A team is saved whole, for the period being
 * looked at, so a change made in P12 never rewrites who held the job in P11.
 * Only earlier periods are consulted, which keeps a past period's answer fixed
 * however later ones are edited; approving a period for pay also writes its
 * carried team into it (`materializeTeam`), so the approved record stands on
 * its own rows.
 *
 * A team saved with no rows at all is stored as a single marker row (an empty
 * position), so "nobody" is a saved answer and doesn't fall back to an older
 * period's team.
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

export type TeamMember = {
  positionId: PositionId;
  /** May be empty: a position on the team with nobody named yet. */
  name: string;
  /** Set when the name was picked from Workstream, null when typed. */
  workstreamUuid: string | null;
};

export type Team = {
  members: TeamMember[];
  /** The period the team was saved under — this one, an earlier one it carries from, or null if never saved. */
  fromPeriod: string | null;
};

type TeamRow = {
  period_label: string;
  slot: number;
  position_id: string;
  name: string;
  workstream_uuid: string | null;
};

const periodNumber = (label: string): number => parsePeriodLabel(label)?.period ?? -1;
const isPosition = (id: string): id is PositionId => (POSITION_ORDER as string[]).includes(id);

/** One store's team for a period, falling back to the latest earlier period with one. */
export async function getTeam(periodLabel: string, storeId: string): Promise<Team> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT period_label, slot, position_id, name, workstream_uuid
    FROM bonus_team
    WHERE store_id = ${storeId}
  `) as TeamRow[];

  // Ordering in JS rather than SQL: period labels sort as text ("P10" < "P9"),
  // and parsePeriodLabel is the one place that knows what they mean.
  const target = periodNumber(periodLabel);
  let from: string | null = null;
  for (const r of rows) {
    const n = periodNumber(r.period_label);
    if (n < 0 || n > target) continue;
    if (from === null || n > periodNumber(from)) from = r.period_label;
  }
  if (from === null) return { members: [], fromPeriod: null };

  const members = rows
    .filter((r) => r.period_label === from && isPosition(r.position_id))
    .sort((a, b) => a.slot - b.slot)
    .map((r) => ({ positionId: r.position_id as PositionId, name: r.name, workstreamUuid: r.workstream_uuid }));
  return { members, fromPeriod: from };
}

/** Replace a store's team for one period with these rows, in this order. */
export async function saveTeam(
  periodLabel: string,
  storeId: string,
  members: TeamMember[],
  changedBy: string | null,
): Promise<void> {
  await ensureBonusSchema();
  // An empty team is saved as one marker row; see the header.
  const rows = members.length
    ? members.map((m) => ({ positionId: m.positionId as string, name: m.name.trim(), uuid: m.name.trim() ? m.workstreamUuid : null }))
    : [{ positionId: "", name: "", uuid: null }];

  await sql.transaction([
    sql`DELETE FROM bonus_team WHERE store_id = ${storeId} AND period_label = ${periodLabel}`,
    sql`
      INSERT INTO bonus_team (store_id, period_label, slot, position_id, name, workstream_uuid, changed_by, changed_at)
      SELECT ${storeId}, ${periodLabel}, u.slot, u.position_id, u.name, u.workstream_uuid, ${changedBy}, now()
      FROM UNNEST(
        ${rows.map((_, i) => i)}::int[],
        ${rows.map((r) => r.positionId)}::text[],
        ${rows.map((r) => r.name)}::text[],
        ${rows.map((r) => r.uuid)}::text[]
      ) AS u(slot, position_id, name, workstream_uuid)
    `,
  ]);
}

/**
 * Write every store's carried team into a period as its own rows, for the pay
 * lock. A store whose team was already saved under the period is left alone.
 */
export async function materializeTeam(periodLabel: string, storeIds: string[]): Promise<number> {
  let written = 0;
  for (const storeId of storeIds) {
    const team = await getTeam(periodLabel, storeId);
    if (team.fromPeriod === null || team.fromPeriod === periodLabel) continue;
    await saveTeam(periodLabel, storeId, team.members, "carried forward");
    written += 1;
  }
  return written;
}

// ── Suggestions from Workstream ──────────────────────────────────────────────

/** Workstream's job titles for the people a scorecard names. */
export type ManagerTitle = "General Manager" | "AGM" | "Director";

const MANAGER_TITLES: ManagerTitle[] = ["General Manager", "AGM", "Director"];

export type Candidate = {
  workstreamUuid: string;
  name: string;
  title: ManagerTitle;
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
  if (!storeById(storeId)) return [];
  await ensureWorkstreamEmployeeSchema();
  const rows = (await sql`
    SELECT uuid, first_name, last_name, preferred_name, job_title
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
    job_title: ManagerTitle;
  }[];

  return rows.map((r) => ({
    workstreamUuid: r.uuid,
    name: tidyName(`${r.preferred_name || r.first_name} ${r.last_name}`),
    title: r.job_title,
  }));
}
