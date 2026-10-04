/**
 * The audit's shape and its CSV serialiser — pure, so the browser can use them.
 *
 * Split out of workstreamAudit.ts for one reason: that module reaches the
 * database and PAR, so importing it into a client component would drag the
 * whole server into the bundle. Everything here is types and string building.
 *
 * Which matters because the screen already holds every row. Asking the server
 * to filter by store, or to rebuild a file the page could write itself, costs
 * a full re-read of twelve stores — measured at 7.8s whether the answer is
 * 368KB or 14KB.
 */

/**
 * How much a duplicate matters, worst first.
 *
 * The order is deliberately stable, so a row cannot change tier because
 * somebody else's data moved.
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

export const SEVERITY_ORDER: Record<AuditSeverity, number> = {
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
  state: "auto" | "confirmed" | "absent" | "ignored" | "review";
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

export const EMPTY_COUNTS: Record<AuditSeverity, number> = {
  "splitting-hours": 0,
  "duplicate-workstream": 0,
  "stray-copies": 0,
  dormant: 0,
};

/** Tally rows by severity. Used wherever a filtered view needs its own header. */
export function countBySeverity(rows: AuditRow[]): Record<AuditSeverity, number> {
  const counts = { ...EMPTY_COUNTS };
  for (const r of rows) counts[r.severity] += 1;
  return counts;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

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
export function auditToCsv(rows: AuditRow[]): string {
  const lines: string[] = [CSV_COLUMNS.join(",")];

  for (const row of rows) {
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
