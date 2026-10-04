/**
 * Duplicate audit: one row per human, across both systems and all stores.
 *
 * The reconciliation queue is organised by record — one card per PAR employee —
 * which is the right shape for "who is this person" and the wrong shape for
 * "how many times does this person exist". A duplicate reads there as two
 * unrelated problems on two separate cards, and the thing that makes it a
 * problem (that they are the same human) is exactly what the layout hides.
 *
 * ── Why the cluster is estate-wide ───────────────────────────────────────────
 *
 * Clustering per store repeated that mistake one level up. Devon Stein has five
 * PAR records across three stores and two Workstream profiles, and he appeared
 * as three cards — each one restating the same pair of Workstream profiles and
 * the same instruction to terminate one of them. Three cards for one decision.
 *
 * So a cluster is a name, not a name-at-a-store. Each PAR record carries its
 * own store, because PAR ids are per location and so is every action on one.
 *
 * ── What counts as a duplicate ───────────────────────────────────────────────
 *
 * Working at two restaurants is not a duplicate. PAR ids are per location, so
 * somebody genuinely covering two stores *must* have two records — clustering
 * estate-wide would otherwise turn every multi-store employee into a finding.
 *
 * A row therefore needs one of:
 *
 *   two or more PAR records at the same store   — one person, two clock numbers
 *   two or more live Workstream profiles        — blocks automatic linking
 *
 * ── Why severity is the organising principle ─────────────────────────────────
 *
 * Several hundred clusters, of which a handful are costing somebody hours
 * today. Sorted by name or by store that is an unreadable list with the urgent
 * cases somewhere in the middle. Sorted by severity the two tiers that matter
 * fit on a screen, and the rest are a count you expand if you want them.
 *
 * ── Why hours are on the row ─────────────────────────────────────────────────
 *
 * "175.6h + 15.5h" is what makes a duplicate undeniable and what says which
 * number to keep: the one they actually use. It also states the cost. PAR
 * splits regular and overtime minutes per employee record, so thirty hours on
 * one number and fifteen on another may never cross forty on either — the
 * duplicate is not only untidy, it is plausibly underpaying somebody.
 */

import { getAllLinkViews } from "./workstreamRoster";
import { listStoredRoster } from "./workstreamStore";
import { normalizeName } from "./workstreamLink";
import { storeById } from "./bonus/storeMap";
import type { LinkProposal } from "./workstreamLink";
import {
  SEVERITY_ORDER,
  countBySeverity,
  type AuditParRecord,
  type AuditReport,
  type AuditRow,
  type AuditSeverity,
  type AuditWorkstreamRecord,
} from "./workstreamAuditFormat";

// Re-exported so callers can reach the whole audit through one module.
export * from "./workstreamAuditFormat";

/** Minutes as "18.5h", for the recommendation text. */
function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

/** A PAR record counts as live if it has worked at all in the window. */
function isLive(r: AuditParRecord): boolean {
  return r.recentMinutes > 0;
}

/**
 * The spelling to show for a cluster.
 *
 * Longest wins, which in practice picks the one with a full surname over a
 * truncation, and a properly capitalised one over "vincent thomas" — PAR
 * carries both for the same human and either could be the first row.
 */
function bestName(names: string[]): string {
  return names.reduce((best, n) => (n.trim().length > best.trim().length ? n : best), names[0] ?? "");
}

/** Group a person's PAR records by the store each belongs to. */
function byStore(par: AuditParRecord[]): Map<string, AuditParRecord[]> {
  const out = new Map<string, AuditParRecord[]>();
  for (const r of par) {
    const list = out.get(r.storeId) ?? [];
    list.push(r);
    out.set(r.storeId, list);
  }
  return out;
}

function recommend(row: Omit<AuditRow, "recommendedAction">): string {
  if (row.severity === "splitting-hours") {
    /*
     * Name the store the duplication is in.
     *
     * A person covering three restaurants must not be told to merge records
     * that belong to different ones — those are supposed to be separate.
     */
    const offending = [...byStore(row.par).values()]
      .map((rs) => rs.filter(isLive).sort((a, b) => b.recentMinutes - a.recentMinutes))
      .filter((rs) => rs.length >= 2);

    return offending
      .map((rs) => {
        const [keep, ...rest] = rs;
        return (
          `At ${keep.storeName}, merge PAR ${rest.map((r) => `#${r.employeeId}`).join(" and ")}`
          + ` into #${keep.employeeId} (${hours(keep.recentMinutes)} vs`
          + ` ${rest.map((r) => hours(r.recentMinutes)).join(" and ")} in the last 30 days),`
          + ` then retire the spare number.`
        );
      })
      .join(" ");
  }

  if (row.severity === "duplicate-workstream") {
    const assigned = row.workstream.filter((w) => w.storeName);
    const unassigned = row.workstream.filter((w) => !w.storeName);
    if (unassigned.length && assigned.length) {
      return (
        `Two live Workstream profiles. Keep the one assigned to ${assigned[0].storeName}`
        + ` and terminate the unassigned duplicate.`
      );
    }
    const where = assigned.map((w) => w.storeName).join(" and ");
    return (
      `Live Workstream profiles at ${where}. Terminate whichever is not in use,`
      + ` then link the PAR records to the survivor.`
    );
  }

  if (row.severity === "stray-copies") {
    const keep = row.par.filter(isLive)[0];
    const dormant = row.par.filter((r) => !isLive(r) && r.storeId === keep.storeId);
    return (
      `PAR #${keep.employeeId} at ${keep.storeName} is the one in use. Deactivate`
      + ` ${dormant.map((r) => `#${r.employeeId}`).join(", ")} so they stop appearing.`
    );
  }

  return "No recent hours on any copy. Deactivate all but one in PAR when convenient.";
}

/**
 * Build the audit.
 *
 * Reads the same per-store link views the reconciliation queue uses, so the two
 * surfaces can never disagree about a link, plus the Workstream roster for the
 * duplicate-profile side.
 */
export async function getDuplicateAudit(today: string): Promise<AuditReport> {
  const [views, roster] = await Promise.all([
    getAllLinkViews(today),
    listStoredRoster(),
  ]);

  /*
   * Workstream duplicates are estate-wide, not per store.
   *
   * A person's second profile is frequently the one carrying no store at all —
   * that is how it got duplicated — so grouping by store first would hide
   * exactly the pairs worth finding.
   */
  const wsByName = new Map<string, typeof roster>();
  for (const e of roster) {
    const key = normalizeName(`${e.firstName} ${e.lastName}`);
    if (!key) continue;
    const list = wsByName.get(key) ?? [];
    list.push(e);
    wsByName.set(key, list);
  }

  // PAR records for one person, gathered from every store at once.
  const parByName = new Map<string, AuditParRecord[]>();
  for (const view of views) {
    if (view.error) continue;
    for (const p of view.proposals as LinkProposal[]) {
      const key = normalizeName(p.parName);
      if (!key) continue;
      const list = parByName.get(key) ?? [];
      list.push({
        employeeId: p.parEmployeeId,
        name: p.parName,
        storeId: view.storeId,
        storeName: view.storeName,
        job: p.parJob,
        payRate: p.parPayRate,
        state: p.state,
        workstreamUuid: p.workstreamUuid,
        recentMinutes: p.parRecentMinutes,
        lastWorked: p.parLastWorked,
        terminated: p.parTerminated,
      });
      parByName.set(key, list);
    }
  }

  const rows: AuditRow[] = [];

  for (const [key, par] of parByName) {
    const ws = (wsByName.get(key) ?? []).filter(
      (e) => e.status === "active" && !e.terminationDate,
    );

    const perStore = byStore(par);
    const anyStoreHasDupes = [...perStore.values()].some((rs) => rs.length >= 2);

    /*
     * Only a real duplicate earns a row.
     *
     * Two records at two stores is somebody covering two restaurants, which is
     * exactly how PAR models it and is nobody's cleanup job.
     */
    if (!anyStoreHasDupes && ws.length < 2) continue;

    const workstream: AuditWorkstreamRecord[] = ws.map((e) => ({
      uuid: e.uuid,
      name: [e.firstName, e.lastName].filter(Boolean).join(" ").trim(),
      status: e.status,
      title: e.jobTitle,
      hourlyRate: e.hourlyRate,
      hiredDate: e.hiredDate,
      storeName: e.storeId ? (storeById(e.storeId)?.name ?? e.storeId) : null,
    }));

    // Two live numbers at one store is the hours problem. Two live numbers at
    // two stores is a person with two jobs.
    const splitting = [...perStore.values()].some((rs) => rs.filter(isLive).length >= 2);
    const liveCount = par.filter(isLive).length;

    const severity: AuditSeverity = splitting
      ? "splitting-hours"
      : workstream.length >= 2
        ? "duplicate-workstream"
        : liveCount >= 1
          ? "stray-copies"
          : "dormant";

    // Store by store, busiest number first, so the list reads in the order
    // somebody would work through it.
    par.sort(
      (a, b) => a.storeName.localeCompare(b.storeName) || b.recentMinutes - a.recentMinutes,
    );

    const base = {
      key,
      storeIds: [...new Set(par.map((r) => r.storeId))],
      storeNames: [...new Set(par.map((r) => r.storeName))],
      name: bestName(par.map((r) => r.name)),
      severity,
      par,
      workstream,
    };
    rows.push({ ...base, recommendedAction: recommend(base) });
  }

  rows.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
      // Within a tier, the biggest problem first: most hours at stake, then
      // most records, then alphabetical so the order is stable between reads.
      || sumMinutes(b) - sumMinutes(a)
      || b.par.length - a.par.length
      || a.name.localeCompare(b.name),
  );

  return { rows, counts: countBySeverity(rows), today, fetchedAt: Date.now() };
}

function sumMinutes(row: AuditRow): number {
  return row.par.reduce((n, r) => n + r.recentMinutes, 0);
}
