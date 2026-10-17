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

// ── Printable report ─────────────────────────────────────────────────────────

/** Minutes as "18.5h". */
function hrs(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

/** "YYYY-MM-DD" as "Oct 4, 2026", read as a plain date rather than an instant. */
function longDate(iso: string | null): string {
  if (!iso) return "never";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Text going into HTML. Names come from two vendor systems; assume nothing. */
function esc(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function personBlock(r: AuditRow): string {
  return `
    <article class="person">
      <header>
        <h3>${esc(r.name)}</h3>
        <span class="stores">${esc(r.storeNames.join(" · "))}</span>
      </header>
      <table>
        <thead>
          <tr><th>System</th><th>Record</th><th>Store</th><th>Role</th>
              <th class="num">Hours (30d)</th><th>Last worked</th></tr>
        </thead>
        <tbody>
          ${r.par.map((p) => `
            <tr${p.recentMinutes > 0 ? ' class="live"' : ""}>
              <td>PAR</td>
              <td class="mono">#${esc(p.employeeId)}</td>
              <td>${esc(p.storeName)}</td>
              <td>${esc(p.job ?? "—")}</td>
              <td class="num">${hrs(p.recentMinutes)}</td>
              <td>${esc(longDate(p.lastWorked))}</td>
            </tr>`).join("")}
          ${r.workstream.map((w) => `
            <tr>
              <td>Workstream</td>
              <td>${esc(w.name)}</td>
              <td>${esc(w.storeName ?? "no store assigned")}</td>
              <td>${esc(w.title ?? "—")}</td>
              <td class="num">—</td>
              <td>${esc(w.hiredDate ? `hired ${longDate(w.hiredDate)}` : "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
      <p class="action"><strong>Action:</strong> ${esc(r.recommendedAction)}</p>
    </article>`;
}

/**
 * The audit as a self-contained HTML document, built for paper.
 *
 * Printed rather than written as a PDF directly: a real PDF writer is a
 * megabyte of dependency to reproduce what every browser already does, and the
 * print pipeline hands the reader page setup and a filename for free. The
 * document title is what Chrome offers as that filename, which is why it is
 * built from the ribbon's scope.
 *
 * Dormant duplicates are summarised rather than listed. They are several
 * hundred records nobody has touched in a month, and a report nobody finishes
 * is worse than a shorter one — the count is stated so their absence reads as
 * a decision rather than an omission.
 */
export function auditToReportHtml(opts: {
  title: string;
  scope: string;
  today: string;
  rows: AuditRow[];
}): string {
  const { title, scope, today, rows } = opts;
  const counts = countBySeverity(rows);
  const listed: AuditSeverity[] = ["splitting-hours", "duplicate-workstream", "stray-copies"];

  const section = (sev: AuditSeverity): string => {
    const items = rows.filter((r) => r.severity === sev);
    if (items.length === 0) return "";
    return `
      <section class="tier">
        <h2>${esc(SEVERITY_LABELS[sev])} <span class="count">${items.length}</span></h2>
        ${items.map(personBlock).join("")}
      </section>`;
  };

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.45 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         color: #111; margin: 0; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  .sub { color: #555; font-size: 11px; margin: 0 0 14px; }
  .summary { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px;
             margin-bottom: 18px; background: #fafafa; }
  .summary span { display: inline-block; margin-right: 18px; }
  .summary b { font-size: 14px; }
  .tier { margin-bottom: 18px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em;
       border-bottom: 1.5px solid #111; padding-bottom: 3px; margin: 0 0 10px; }
  h2 .count { color: #777; font-weight: normal; }
  /* Keep a person whole on one page: a split record list is unreadable, and a
     recommendation orphaned from its evidence is worse than useless. */
  .person { page-break-inside: avoid; break-inside: avoid;
            border: 1px solid #e3e3e3; border-radius: 6px; padding: 9px 11px;
            margin-bottom: 10px; }
  .person header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  h3 { font-size: 13px; margin: 0; }
  .stores { color: #666; font-size: 10.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  th { text-align: left; font-weight: 600; color: #555; border-bottom: 1px solid #ddd;
       padding: 3px 6px 3px 0; }
  td { padding: 3px 6px 3px 0; border-bottom: 1px solid #f0f0f0; }
  tr.live td { font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, Menlo, Consolas, monospace; }
  .action { margin: 7px 0 0; padding: 6px 8px; background: #f6f6f6;
            border-left: 2.5px solid #111; font-size: 10.5px; }
  footer { margin-top: 18px; color: #777; font-size: 10px;
           border-top: 1px solid #ddd; padding-top: 7px; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(scope)} · hours measured over the 30 days to ${esc(longDate(today))}</p>

  <div class="summary">
    <span><b>${counts["splitting-hours"]}</b> splitting hours</span>
    <span><b>${counts["duplicate-workstream"]}</b> duplicate Workstream profiles</span>
    <span><b>${counts["stray-copies"]}</b> stray PAR copies</span>
  </div>

  ${listed.map(section).join("")}

  <footer>
    ${counts.dormant} dormant duplicate${counts.dormant === 1 ? "" : "s"} not listed —
    every copy has no recorded hours in the last 30 days.
    Generated from the HRG staffing dashboard.
  </footer>
</body></html>`;
}
