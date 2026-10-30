/**
 * How people on the clock are grouped and labelled, wherever a roster is drawn
 * — the Staffing tab's "currently clocked in" cards and the team on duty under
 * a ZCase. One copy, so a person can't be a manager on one tab and crew on
 * another.
 *
 * Pure and client-safe.
 */

/**
 * The four tiers, keyed on Workstream's job titles.
 *
 * These are positions of record, not what someone clocked in as — Workstream is
 * where a person is hired into a job, and PAR only knows which button they
 * pressed at the terminal. That is why an earlier version of this map listed
 * PAR's titles ("SAL Mgr Asst Gen", "Hourly - Assistant Manager") and described
 * itself as provisional until payroll was integrated. It is integrated; this is
 * the replacement.
 *
 * Cook and Cashier sit in Crew: they are crew-level line positions, and between
 * them they are about a quarter of everyone active.
 *
 * Still an explicit list rather than a pattern match over the words in a title,
 * for the same reason as before — a title that is not named here appears under
 * "Other" with its real name, so a new or renamed job is something to look at
 * rather than something that silently joins the wrong tier. District Manager
 * and Director of Operations land there on purpose: they are above-store roles
 * and are not usually on a store's clock.
 */
export const JOB_GROUPS: { key: string; label: string; titles: string[] }[] = [
  { key: "crew", label: "Crew", titles: ["Crew", "Cook", "Cashier"] },
  { key: "managers", label: "Managers", titles: ["Crew Trainer", "Shift Lead"] },
  { key: "directors", label: "Directors", titles: ["Director"] },
  { key: "leadership", label: "Leadership", titles: ["AGM", "General Manager"] },
];

export const GROUP_TONE: Record<string, string> = {
  crew: "bg-blue-50 border-blue-200",
  managers: "bg-amber-50 border-amber-200",
  directors: "bg-purple-50 border-purple-200",
  leadership: "bg-emerald-50 border-emerald-200",
  other: "bg-gray-50 border-gray-200",
};

/** The tier for a Workstream position; "other" for none or one not listed. */
export function groupOf(position: string | null | undefined): string {
  if (!position) return "other";
  return JOB_GROUPS.find((g) => g.titles.includes(position))?.key ?? "other";
}

/**
 * The title to label by: Workstream's, falling back to PAR's.
 *
 * The fallback only fires for someone not yet linked to a Workstream record,
 * and groupOf will land them in "Other" because PAR's titles are not in the
 * list above. That is the honest outcome — an unlinked person's position is
 * not known, and putting them in Crew because PAR said "Cashier" would be a
 * guess wearing a fact's clothes.
 */
export function titleOf(position: string | null | undefined, job: string | null | undefined): string | null {
  return cleanJobTitle(position ?? job);
}

/**
 * A PAR job name with its payroll prefix taken off.
 *
 * PAR spells its jobs "Hourly - Assistant Manager", "Salary - General Manager",
 * "SAL Mgr Asst Gen" — the pay type welded onto the front of the position,
 * because the same role exists twice in its setup depending on how it is paid.
 * Nobody reading a roster needs that: whether a manager is salaried is visible
 * elsewhere.
 *
 * Cosmetic only, and temporary. Positions come from Workstream once somebody is
 * linked, and Workstream says "Shift Lead" without the ceremony — at which
 * point this only applies to people the reconciliation queue has not reached.
 */
export function cleanJobTitle(job: string | null | undefined): string | null {
  if (!job) return null;
  return job.replace(/^(hourly|salary|sal|hrly)\s*-\s*/i, "").trim() || null;
}
