/**
 * Duplicate audit: one row per human, across both systems.
 *
 * The reconciliation queue is organised by record — one card per PAR employee —
 * which is the right shape for "who is this person" and the wrong shape for
 * "how many times does this person exist". A duplicate reads there as two
 * unrelated problems on two separate cards, and the thing that makes it a
 * problem (that they are the same human) is exactly what the layout hides.
 *
 * So this clusters by normalised name and reports people, not records.
 *
 * ── Why severity is the organising principle ─────────────────────────────────
 *
 * Measured across the twelve stores: 560 PAR duplicate-name clusters covering
 * 1,185 records. Sorted by name or by store, that is an unreadable list and the
 * urgent cases are somewhere in the middle of it. Sorted by severity:
 *
 *   2    people working under two live clock numbers right now
 *   1    people with two live Workstream profiles, which blocks auto-linking
 *   102  one live record with dormant twins — untidy, nothing broken
 *   456  duplicates where every copy is long dead — hygiene only
 *
 * Two rows need attention today. The other 558 are an export. A surface that
 * does not say which is which is not an audit, it is a list.
 *
 * ── Why hours are on the row ─────────────────────────────────────────────────
 *
 * "18.5h + 12.0h" is what makes a duplicate undeniable and what says which
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

function recommend(row: Omit<AuditRow, "recommendedAction">): string {
  const live = row.par.filter(isLive).sort((a, b) => b.recentMinutes - a.recentMinutes);
  const dormant = row.par.filter((r) => !isLive(r));

  if (row.severity === "splitting-hours") {
    const [keep, ...rest] = live;
    return (
      `Merge PAR ${rest.map((r) => `#${r.employeeId}`).join(" and ")} into #${keep.employeeId}`
      + ` (${hours(keep.recentMinutes)} vs ${rest.map((r) => hours(r.recentMinutes)).join(" and ")}`
      + ` in the last 30 days), then retire the spare number.`
    );
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
    return "Two live Workstream profiles. Terminate whichever is not in use, then link.";
  }

  if (row.severity === "stray-copies") {
    const keep = live[0];
    return (
      `PAR #${keep.employeeId} is the one in use. Deactivate`
      + ` ${dormant.map((r) => `#${r.employeeId}`).join(", ")} so they stop appearing.`
    );
  }

  return `No recent hours on any copy. Deactivate all but one in PAR when convenient.`;
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

  const rows: AuditRow[] = [];

  for (const view of views) {
    if (view.error) continue;
    const storeName = view.storeName;

    const byName = new Map<string, LinkProposal[]>();
    for (const p of view.proposals) {
      const key = normalizeName(p.parName);
      if (!key) continue;
      const list = byName.get(key) ?? [];
      list.push(p);
      byName.set(key, list);
    }

    for (const [key, proposals] of byName) {
      const ws = (wsByName.get(key) ?? []).filter(
        (e) => e.status === "active" && !e.terminationDate,
      );

      // A cluster is worth a row if either system holds the person twice.
      if (proposals.length < 2 && ws.length < 2) continue;

      const par: AuditParRecord[] = proposals.map((p) => ({
        employeeId: p.parEmployeeId,
        name: p.parName,
        job: p.parJob,
        payRate: p.parPayRate,
        state: p.state,
        workstreamUuid: p.workstreamUuid,
        recentMinutes: p.parRecentMinutes,
        lastWorked: p.parLastWorked,
        terminated: p.parTerminated,
      }));

      const workstream: AuditWorkstreamRecord[] = ws.map((e) => ({
        uuid: e.uuid,
        name: [e.firstName, e.lastName].filter(Boolean).join(" ").trim(),
        status: e.status,
        title: e.jobTitle,
        hourlyRate: e.hourlyRate,
        hiredDate: e.hiredDate,
        storeName: e.storeId ? (storeById(e.storeId)?.name ?? e.storeId) : null,
        elsewhere: e.storeId !== view.storeId,
      }));

      const liveCount = par.filter(isLive).length;
      const severity: AuditSeverity =
        liveCount >= 2
          ? "splitting-hours"
          : workstream.length >= 2
            ? "duplicate-workstream"
            : liveCount === 1
              ? "stray-copies"
              : "dormant";

      const base = {
        key: `${view.storeId}:${key}`,
        storeId: view.storeId,
        storeName,
        name: bestName(par.map((r) => r.name)),
        severity,
        par,
        workstream,
      };
      rows.push({ ...base, recommendedAction: recommend(base) });
    }
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

  const counts = countBySeverity(rows);

  return { rows, counts, today, fetchedAt: Date.now() };
}

function sumMinutes(row: AuditRow): number {
  return row.par.reduce((n, r) => n + r.recentMinutes, 0);
}

