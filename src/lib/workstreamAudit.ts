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
 *   any PAR number with no hours in 30 days     — a leaver, or left behind by a
 *                                                 transfer; alone or not
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
  auditWindowStart,
  classifyPerson,
  countBySeverity,
  type AuditParRecord,
  type AuditReport,
  type AuditRow,
  type AuditWorkstreamRecord,
} from "./workstreamAuditFormat";

// Re-exported so callers can reach the whole audit through one module.
export * from "./workstreamAuditFormat";

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
      // Already terminated in PAR is already cleaned up. Counting it would make
      // a person with one live number and one closed one a "duplicate", and
      // send HR to terminate something that is.
      if (p.parTerminated) continue;
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
  const windowStart = auditWindowStart(today);

  for (const [key, par] of parByName) {
    const ws = (wsByName.get(key) ?? []).filter(
      (e) => e.status === "active" && !e.terminationDate,
    );

    const workstream: AuditWorkstreamRecord[] = ws.map((e) => ({
      uuid: e.uuid,
      name: [e.firstName, e.lastName].filter(Boolean).join(" ").trim(),
      status: e.status,
      title: e.jobTitle,
      hourlyRate: e.hourlyRate,
      hiredDate: e.hiredDate,
      storeName: e.storeId ? (storeById(e.storeId)?.name ?? e.storeId) : null,
    }));

    // Shared with the browser, which re-runs it on each leader's slice.
    const severity = classifyPerson(par, workstream, windowStart);
    if (!severity) continue;

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
    rows.push(base);
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
