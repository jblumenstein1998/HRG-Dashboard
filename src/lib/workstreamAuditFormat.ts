/**
 * The audit's shape and the helpers over it — pure, so the browser can use them.
 *
 * Split out of workstreamAudit.ts for one reason: that module reaches the
 * database and PAR, so importing it into a client component would drag the
 * whole server into the bundle. Everything here is types and plain arithmetic.
 *
 * Which matters because the screen already holds every row, and narrowing to
 * one store should not cost another read of all twelve — measured at 7.8s
 * whether the answer is 368KB or 14KB.
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
  /** The store this record belongs to. PAR ids are unique only within one. */
  storeId: string;
  storeName: string;
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
};

export type AuditRow = {
  /** Stable id for the row: the normalised name, which is the cluster. */
  key: string;
  /** Every store this person holds a PAR record at. */
  storeIds: string[];
  storeNames: string[];
  /** The most readable spelling among the records in the cluster. */
  name: string;
  severity: AuditSeverity;
  par: AuditParRecord[];
  workstream: AuditWorkstreamRecord[];
  /**
   * What to do about it, in a sentence — which number to keep and which to
   * retire. A suggestion, not a decision anyone has recorded.
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
