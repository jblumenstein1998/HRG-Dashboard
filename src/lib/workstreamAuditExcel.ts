/**
 * The HR Cleanup report as an Excel workbook — the same report as the PDF, in
 * a format somebody can work through in a spreadsheet.
 *
 * Same report, not a sibling: who is listed and in what order comes from
 * reportPeople, the title and count lines are the PDF's own, and the columns
 * are the PDF's columns. Only the layout is Excel's — each person a shaded name
 * bar over their records, with a blank row before the next. Live PAR numbers
 * are bold, as they are on paper.
 *
 * exceljs is imported dynamically, so its weight is paid on the click rather
 * than by every visit to the tab.
 */

import type { Row, Worksheet } from "exceljs";
import {
  NO_RECENT_HOURS_LABEL,
  reportCountLine,
  reportPeople,
  reportSubtitle,
  type AuditRow,
} from "./workstreamAuditFormat";

/** The PDF's own columns, in its order. */
const COLUMNS = [
  { header: "System", width: 13 },
  { header: "Record", width: 24 },
  { header: "Store", width: 16 },
  { header: "Role", width: 28 },
  { header: "Pay rate", width: 11 },
  { header: "Hours (30d)", width: 12 },
  { header: "Last worked", width: 20 },
];

/** "YYYY-MM-DD" as "Oct 4, 2026" — the same wording as the PDF. */
function longDate(iso: string | null): string {
  if (!iso) return "never";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function rightAlignNumbers(row: Row) {
  row.getCell(5).alignment = { horizontal: "right" };
  row.getCell(6).alignment = { horizontal: "right" };
}

function addPerson(ws: Worksheet, person: AuditRow) {
  // The name bar: shaded across every column with a rule above it, so each
  // person starts visibly fresh however far down the sheet they are.
  const bar = ws.addRow([person.name, person.storeNames.join(" · ")]);
  bar.font = { bold: true };
  bar.getCell(2).font = { color: { argb: "FF666666" } };
  for (let c = 1; c <= COLUMNS.length; c++) {
    const cell = bar.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF2" } };
    cell.border = { top: { style: "thin", color: { argb: "FF999999" } } };
  }

  for (const p of person.par) {
    const row = ws.addRow([
      "PAR",
      `#${p.employeeId}`,
      p.storeName,
      p.job ?? "—",
      p.payRate && p.payRate > 0 ? p.payRate : "—",
      p.recentMinutes / 60,
      longDate(p.lastWorked),
    ]);
    row.getCell(5).numFmt = '"$"#,##0.00';
    row.getCell(6).numFmt = '0.0"h"';
    if (p.recentMinutes > 0) row.font = { bold: true };
    rightAlignNumbers(row);
  }
  for (const w of person.workstream) {
    const row = ws.addRow([
      "Workstream",
      w.name,
      w.storeName ?? "no store assigned",
      w.title ?? "—",
      w.hourlyRate && w.hourlyRate > 0 ? w.hourlyRate : "—",
      "—",
      w.hiredDate ? `hired ${longDate(w.hiredDate)}` : "—",
    ]);
    row.getCell(5).numFmt = '"$"#,##0.00';
    rightAlignNumbers(row);
  }

  ws.addRow([]);
}

export async function auditToXlsx(opts: {
  title: string;
  scope: string;
  today: string;
  rows: AuditRow[];
}): Promise<Blob> {
  // exceljs is CommonJS: depending on the bundler's interop, a dynamic import
  // puts the classes on the module or under `default`.
  const mod = await import("exceljs");
  const { Workbook } = (mod as unknown as { default?: typeof mod }).default ?? mod;
  const wb = new Workbook();
  wb.title = opts.title;

  const people = reportPeople(opts.rows);

  // The PDF's heading block, then the column headers frozen beneath it.
  const ws = wb.addWorksheet("HR Cleanup", { views: [{ state: "frozen", ySplit: 5 }] });
  ws.columns = COLUMNS.map((c) => ({ width: c.width }));
  ws.addRow([opts.title]).font = { bold: true, size: 14 };
  ws.addRow([reportSubtitle(opts.scope, opts.today)]).font = { color: { argb: "FF555555" } };
  ws.addRow([reportCountLine(people)]).font = { bold: true };
  ws.addRow([]);
  const header = ws.addRow(COLUMNS.map((c) => c.header));
  header.font = { bold: true };
  header.border = { bottom: { style: "medium" } };
  rightAlignNumbers(header);
  ws.addRow([]);

  for (const person of people.active) addPerson(ws, person);

  if (people.noRecentHours.length) {
    const label = ws.addRow([NO_RECENT_HOURS_LABEL]);
    label.font = { bold: true, color: { argb: "FF555555" } };
    label.border = { bottom: { style: "thin", color: { argb: "FF999999" } } };
    ws.addRow([]);
    for (const person of people.noRecentHours) addPerson(ws, person);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
