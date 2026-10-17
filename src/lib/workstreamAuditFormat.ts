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
  dormant: "No recent hours",
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

// ── Who is listed, and where ─────────────────────────────────────────────────
//
// Here rather than in workstreamAudit.ts because the browser runs it too: the
// leader filter narrows each person to the records at that leader's stores and
// then has to decide again whether they still belong on the list. One copy of
// the rule means the server and the screen cannot disagree about it.

/** The activity window, in days, behind every "no recent hours" decision. */
export const ACTIVITY_DAYS = 30;

/** A calendar date `days` away from `iso`, both "YYYY-MM-DD". */
export function shiftDate(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First day of the activity window ending on `today`. */
export function auditWindowStart(today: string): string {
  return shiftDate(today, -ACTIVITY_DAYS);
}

/** A PAR record counts as live if it has worked at all in the window. */
export function isLive(r: AuditParRecord): boolean {
  return r.recentMinutes > 0;
}

/**
 * Whether a person is listed, and in which group — null for "not listed".
 *
 * Listed for a duplicate (two numbers at one store, or two live Workstream
 * profiles) or for any PAR number with no hours in the window, alone or not,
 * at their own store or another. Those are the leavers PAR was never told about
 * and the numbers left behind by a transfer. Two numbers that are both *in use*
 * at two stores is somebody covering two restaurants, and is left alone.
 *
 * Not yet started is not gone: a new hire exists in PAR before their first
 * shift and looks exactly like a leaver. When no hours is the only reason to
 * list somebody and Workstream has them hired inside the window, they are left
 * off. A new hire with two Workstream profiles is still a duplicate to fix.
 */
export function classifyPerson(
  par: AuditParRecord[],
  workstream: AuditWorkstreamRecord[],
  windowStart: string,
): AuditSeverity | null {
  const perStore = new Map<string, AuditParRecord[]>();
  for (const r of par) perStore.set(r.storeId, [...(perStore.get(r.storeId) ?? []), r]);
  const stores = [...perStore.values()];

  const anyStoreHasDupes = stores.some((rs) => rs.length >= 2);
  const anyUnused = par.some((r) => !isLive(r));
  const liveCount = par.filter(isLive).length;

  if (!anyStoreHasDupes && workstream.length < 2 && !anyUnused) return null;
  if (
    !anyStoreHasDupes
    && workstream.length < 2
    && liveCount === 0
    && workstream.some((w) => (w.hiredDate ?? "") >= windowStart)
  ) return null;

  // Two live numbers at one store is the hours problem. Two live numbers at
  // two stores is a person with two jobs.
  if (stores.some((rs) => rs.filter(isLive).length >= 2)) return "splitting-hours";
  if (workstream.length >= 2) return "duplicate-workstream";
  return liveCount >= 1 ? "stray-copies" : "dormant";
}

/**
 * One person, as seen by somebody who runs only `storeIds`.
 *
 * A person is a name across the whole estate, so without this a leader saw
 * every record that name holds anywhere — another store's dead numbers, and
 * unrelated namesakes merged in by name. Narrowing to the records at their
 * stores, then deciding again, gives each leader exactly the numbers they can
 * act on, in the group those numbers alone put the person in. Workstream
 * profiles are not per store and stay as they are.
 *
 * Null when nothing at those stores needs doing.
 */
export function scopeRow(row: AuditRow, storeIds: Set<string>, windowStart: string): AuditRow | null {
  const par = row.par.filter((r) => storeIds.has(r.storeId));
  if (par.length === 0) return null;
  const severity = classifyPerson(par, row.workstream, windowStart);
  if (!severity) return null;
  return {
    ...row,
    par,
    severity,
    storeIds: [...new Set(par.map((r) => r.storeId))],
    storeNames: [...new Set(par.map((r) => r.storeName))],
  };
}

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

/** An hourly rate as "$14.50". Salaried staff carry none in PAR. */
function rate(amount: number | null): string {
  return amount != null && amount > 0 ? `$${amount.toFixed(2)}` : "—";
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

/** People A to Z. */
function byName(rows: AuditRow[]): AuditRow[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

/**
 * Who the report lists, and in what order — the one decision both exports
 * share.
 *
 * The PDF and the Excel are two formats of one report, not two reports, so
 * neither filters or orders anything on its own: both take this and only lay
 * it out. A person missing from one file but not the other was exactly the bug
 * this exists to prevent.
 *
 * Everyone is listed. People with hours in the last 30 days come first, then
 * those whose every record has none — still duplicates somebody has to
 * deactivate, just not the urgent ones.
 */
export function reportPeople(rows: AuditRow[]): { active: AuditRow[]; noRecentHours: AuditRow[] } {
  return {
    active: byName(rows.filter((r) => r.severity !== "dormant")),
    noRecentHours: byName(rows.filter((r) => r.severity === "dormant")),
  };
}

/** The line under the title in both exports. */
export function reportSubtitle(scope: string, today: string): string {
  return `${scope} · hours measured over the 30 days to ${longDate(today)}`;
}

/** The line at the top of both exports, so the two can be checked at a glance. */
export function reportCountLine(people: ReturnType<typeof reportPeople>): string {
  const total = people.active.length + people.noRecentHours.length;
  return `${total} ${total === 1 ? "person" : "people"} to clean up`
    + (people.noRecentHours.length ? ` (${people.noRecentHours.length} with no recent hours)` : "");
}

/** The label above the people with no recent hours, in both exports. */
export const NO_RECENT_HOURS_LABEL = "No recent hours — no record has worked in the last 30 days";

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
              <th class="num">Pay rate</th><th class="num">Hours (30d)</th><th>Last worked</th></tr>
        </thead>
        <tbody>
          ${r.par.map((p) => `
            <tr${p.recentMinutes > 0 ? ' class="live"' : ""}>
              <td>PAR</td>
              <td class="mono">#${esc(p.employeeId)}</td>
              <td>${esc(p.storeName)}</td>
              <td>${esc(p.job ?? "—")}</td>
              <td class="num">${rate(p.payRate)}</td>
              <td class="num">${hrs(p.recentMinutes)}</td>
              <td>${esc(longDate(p.lastWorked))}</td>
            </tr>`).join("")}
          ${r.workstream.map((w) => `
            <tr>
              <td>Workstream</td>
              <td>${esc(w.name)}</td>
              <td>${esc(w.storeName ?? "no store assigned")}</td>
              <td>${esc(w.title ?? "—")}</td>
              <td class="num">${rate(w.hourlyRate)}</td>
              <td class="num">—</td>
              <td>${esc(w.hiredDate ? `hired ${longDate(w.hiredDate)}` : "—")}</td>
            </tr>`).join("")}
        </tbody>
      </table>
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
 * People A to Z, with no category headings. A person often has problems in
 * both systems at once, so filing them under one category named half of it and
 * hid the other half — the table under each name already shows everything.
 * Who is listed comes from reportPeople, shared with the Excel export.
 */
export function auditToReportHtml(opts: {
  title: string;
  scope: string;
  today: string;
  rows: AuditRow[];
}): string {
  const { title, scope, today, rows } = opts;
  const people = reportPeople(rows);

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
  h2 { font-size: 12px; color: #555; font-weight: 600; border-bottom: 1px solid #ccc;
       padding-bottom: 3px; margin: 22px 0 10px; break-after: avoid; }
  /* Keep a person whole on one page: a split record list is unreadable. */
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
  footer { margin-top: 18px; color: #777; font-size: 10px;
           border-top: 1px solid #ddd; padding-top: 7px; }
</style></head>
<body>
  <h1>${esc(title)}</h1>
  <p class="sub">${esc(reportSubtitle(scope, today))}</p>

  <div class="summary">${esc(reportCountLine(people))}</div>

  ${people.active.map(personBlock).join("")}

  ${people.noRecentHours.length
    ? `<h2>${esc(NO_RECENT_HOURS_LABEL)}</h2>${people.noRecentHours.map(personBlock).join("")}`
    : ""}

  <footer>
    Generated from the HRG staffing dashboard.
  </footer>
</body></html>`;
}
