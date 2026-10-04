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

import { PAR_LOCATIONS } from "./par";
import { getAllLinkViews } from "./workstreamRoster";
import { listStoredRoster } from "./workstreamStore";
import { normalizeName } from "./workstreamLink";
import { storeById } from "./bonus/storeMap";
import type { LinkProposal } from "./workstreamLink";

/**
 * How much a duplicate matters, worst first.
 *
 * The numbers are the sort order and are deliberately stable, so a row cannot
 * change tier just because somebody else's data moved.
 */
export type AuditSeverity =
  /** Two or more PAR records with hours in the activity window. */
  | "splitting-hours"
  /** Two or more live Workstream profiles. Nothing can auto-link. */
  | "duplicate-workstream"
  /** One live PAR record, plus copies nobody has used. */
  | "stray-copies"
  /** Every copy is dormant. Cleanup, no urgency. */
  | "dormant";

const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  "splitting-hours": 0,
  "duplicate-workstream": 1,
  "stray-copies": 2,
  dormant: 3,
};

export const SEVERITY_LABELS: Record<AuditSeverity, string> = {
  "splitting-hours": "Splitting hours",
  "duplicate-workstream": "Duplicate Workstream profile",
  "stray-copies": "Stray PAR copies",
  dormant: "Dormant duplicates",
};

/** One PAR employee record inside a cluster. */
export type AuditParRecord = {
  employeeId: string;
  name: string;
  job: string | null;
  payRate: number | null;
  state: LinkProposal["state"];
  workstreamUuid: string | null;
  /** Minutes worked in the activity window, and when they last worked. */
  recentMinutes: number;
  lastWorked: string | null;
  terminated: boolean;
};

/** One Workstream record inside a cluster. */
export type AuditWorkstreamRecord = {
  uuid: string;
  name: string;
  status: string;
  title: string | null;
  hourlyRate: number | null;
  hiredDate: string | null;
  /** The store Workstream assigns them to, as a name. Null when unassigned. */
  storeName: string | null;
  /** True when Workstream has them somewhere other than the cluster's store. */
  elsewhere: boolean;
};

export type AuditRow = {
  /** Stable id for the row: store plus the normalised name. */
  key: string;
  storeId: string;
  storeName: string;
  /** The most readable spelling among the records in the cluster. */
  name: string;
  severity: AuditSeverity;
  par: AuditParRecord[];
  workstream: AuditWorkstreamRecord[];
  /**
   * What to do about it, stated so the row can be forwarded without a covering
   * note. A suggestion, not a decision anyone has recorded.
   */
  recommendedAction: string;
};

export type AuditReport = {
  rows: AuditRow[];
  counts: Record<AuditSeverity, number>;
  /** Business date the activity window ends on. */
  today: string;
  fetchedAt: number;
};

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

  const counts: Record<AuditSeverity, number> = {
    "splitting-hours": 0,
    "duplicate-workstream": 0,
    "stray-copies": 0,
    dormant: 0,
  };
  for (const r of rows) counts[r.severity] += 1;

  return { rows, counts, today, fetchedAt: Date.now() };
}

function sumMinutes(row: AuditRow): number {
  return row.par.reduce((n, r) => n + r.recentMinutes, 0);
}

/** Store ids in the order the rest of the app lists them. */
export const AUDIT_STORE_IDS = PAR_LOCATIONS.map((l) => l.storeId);

// ── Export ───────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "store",
  "person",
  "severity",
  "system",
  "record_id",
  "status",
  "job_title",
  "pay_rate",
  "hired_date",
  "last_worked",
  "hours_last_30_days",
  "linked_to",
  "recommended_action",
] as const;

/** RFC 4180 quoting: wrap in quotes and double any quote inside. */
function cell(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The audit as CSV, one row per **record** rather than per person.
 *
 * Per record because of who receives it. A cluster is the right unit for
 * understanding the problem and the wrong one for fixing it: the person doing
 * the cleanup has to go into PAR or Workstream and act on one specific employee
 * number, so that number needs its own line with its own recommended action.
 *
 * The person and the recommendation repeat down the rows of a cluster, which is
 * redundant to read and exactly right for sorting and filtering in a
 * spreadsheet — which is what actually happens to a file like this.
 */
export function auditToCsv(report: AuditReport): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];

  for (const row of report.rows) {
    for (const r of row.par) {
      lines.push([
        cell(row.storeName),
        cell(row.name),
        cell(SEVERITY_LABELS[row.severity]),
        "PAR",
        cell(r.employeeId),
        cell(r.terminated ? "terminated" : r.state),
        cell(r.job),
        cell(r.payRate),
        "",
        cell(r.lastWorked),
        cell((r.recentMinutes / 60).toFixed(1)),
        cell(r.workstreamUuid),
        cell(row.recommendedAction),
      ].join(","));
    }
    for (const w of row.workstream) {
      lines.push([
        cell(row.storeName),
        cell(row.name),
        cell(SEVERITY_LABELS[row.severity]),
        "Workstream",
        cell(w.uuid),
        cell(w.status),
        cell(w.title),
        cell(w.hourlyRate),
        cell(w.hiredDate),
        "",
        "",
        "",
        cell(row.recommendedAction),
      ].join(","));
    }
  }

  // Trailing newline: some spreadsheet importers drop the final row without it.
  return lines.join("\r\n") + "\r\n";
}
