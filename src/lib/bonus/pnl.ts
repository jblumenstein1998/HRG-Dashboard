/**
 * Reading a P&L for bonus — the accounting system's "Profit & Loss - Location
 * Side by Side" export, as an .xlsx.
 *
 * Its shape: a title block ("Profit & Loss - Location Side by Side - Qtr",
 * "Qtr Ending 06/28/2026"), then a header row naming each location, then one
 * row per account with the label in the first column and each location's
 * amount under its name (followed by a % of sales column, which is ignored).
 *
 * ── Stores come from the headers ─────────────────────────────────────────────
 *
 * Every store column is headed with its city and **PAR store number** —
 * "Suffolk 57001", "Chesapeake 57006" — and the number is the only part to
 * trust. The cities are the legal entity's, not the restaurant's: 57001 is
 * College, and "Chesapeake 57006" is Hillcrest, not Chesapeake. Columns with no
 * store number we know (the real-estate LLC, the corporate entity, Total) are
 * reported and skipped.
 *
 * ── What is pulled (Josh, 2026-10-29) ────────────────────────────────────────
 *
 *   Labor %             Total SALARIES AND WAGES ÷ Total Sales — wages and
 *                       bonuses only, not payroll taxes or benefits
 *   Controllable Income GROSS PROFIT AFTER COGS − Total SUPPLIES − Total OTHER
 *                       CONTROLLABLES
 *   EBITDA              the EBITDA line, as stated
 *
 * Rows are found by label, never by position, so an account added above them
 * in a later export moves nothing.
 *
 * Pure apart from the workbook read; safe to unit-test with a built workbook.
 */

import ExcelJS from "exceljs";
import { PERIODS } from "../fiscal";
import { periodLabel } from "./periods";
import { storeById } from "./storeMap";

/** The P&L lines read, keyed as stored. Labels are matched case- and space-insensitively. */
export const PNL_LINES = {
  totalSales: "Total Sales",
  salariesAndWages: "Total SALARIES AND WAGES",
  grossProfit: "GROSS PROFIT AFTER COGS",
  totalSupplies: "Total SUPPLIES",
  otherControllables: "Total OTHER CONTROLLABLES",
  ebitda: "EBITDA",
} as const;

export type PnlLineKey = keyof typeof PNL_LINES;

export type StoreFinancials = {
  storeId: string;
  /** The column header as written, e.g. "Chesapeake 57006". */
  header: string;
  lines: Record<PnlLineKey, number | null>;
  /** Percent, 0–100. Null when sales or wages are missing, or sales are zero. */
  laborPct: number | null;
  controllableIncome: number | null;
  ebitda: number | null;
};

export type ParsedPnl = {
  /** The title block, for showing what was read ("Qtr Ending 06/28/2026"). */
  title: string[];
  /** The "Ending" date in the title, ISO, if there is one. */
  endingDate: string | null;
  /** The fiscal period that date closes, if it closes one. */
  periodFromFile: string | null;
  /** True when the title says this is a quarter or a year rather than a period. */
  looksMultiPeriod: boolean;
  stores: StoreFinancials[];
  /** Column headers that name no store we know — the RE LLC, corporate, Total. */
  skippedColumns: string[];
  /** Lines that were not found anywhere on the sheet. */
  missingLines: string[];
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/** A cell's text, whatever ExcelJS hands back for it. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("result" in v && v.result !== undefined) return cellText(v.result as ExcelJS.CellValue);
    if ("text" in v) return String(v.text);
  }
  return "";
}

/**
 * A cell's number. Exports carry real numbers, but a re-saved copy can turn
 * them to text — "1,234", "(1,234)", "-1,234", "$1,234" — so those are read too.
 */
function cellNumber(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && "result" in v) return cellNumber(v.result as ExcelJS.CellValue);
  const s = cellText(v).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith("-");
  const digits = s.replace(/[()$,\s-]/g, "");
  if (!/^\d+(\.\d+)?$/.test(digits)) return null;
  return negative ? -Number(digits) : Number(digits);
}

const STORE_NUMBER = /\b(\d{5})\b/;

/** The fiscal period whose last day is `iso`, if any. */
function periodEndingOn(iso: string): string | null {
  const p = PERIODS.find((x) => x.end === iso);
  return p ? periodLabel(p) : null;
}

export async function parsePnl(file: ArrayBuffer | Buffer): Promise<ParsedPnl> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's typings want its own Buffer flavour; both inputs are bytes.
  await wb.xlsx.load(file as unknown as ExcelJS.Buffer);

  // The first sheet that carries the lines we read. Exports have one sheet,
  // but a workbook someone has added a notes tab to should still work.
  const sheet = wb.worksheets.find((ws) => {
    let found = false;
    ws.eachRow((row) => {
      row.eachCell((c) => { if (norm(cellText(c.value)) === norm(PNL_LINES.totalSales)) found = true; });
    });
    return found;
  });
  if (!sheet) {
    throw new Error(`No "${PNL_LINES.totalSales}" line found — is this a Profit & Loss export?`);
  }

  // The header row: the first row with a cell naming one of our stores.
  let headerRow: ExcelJS.Row | null = null;
  sheet.eachRow((row) => {
    if (headerRow) return;
    row.eachCell((c) => {
      const m = cellText(c.value).match(STORE_NUMBER);
      if (m && storeById(m[1])) headerRow = row;
    });
  });
  if (!headerRow) {
    throw new Error("No column header names a store number (e.g. \"Suffolk 57001\").");
  }
  const header: ExcelJS.Row = headerRow;

  const title: string[] = [];
  for (let r = 1; r < header.number; r++) {
    const text = sheet.getRow(r).values as ExcelJS.CellValue[];
    const line = (Array.isArray(text) ? text : []).map(cellText).filter(Boolean).join(" ").trim();
    if (line) title.push(line);
  }
  const titleText = title.join(" ");
  const ending = titleText.match(/ending\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  const endingDate = ending
    ? `${ending[3]}-${ending[1].padStart(2, "0")}-${ending[2].padStart(2, "0")}`
    : null;

  const columns: { col: number; storeId: string; header: string }[] = [];
  const skippedColumns: string[] = [];
  header.eachCell((c, col) => {
    const text = cellText(c.value).trim();
    if (!text) return;
    const m = text.match(STORE_NUMBER);
    if (m && storeById(m[1])) columns.push({ col, storeId: m[1], header: text });
    else skippedColumns.push(text);
  });

  // Each line's row, found by label in any column left of the first store.
  const firstStoreCol = Math.min(...columns.map((c) => c.col));
  const rowFor = new Map<PnlLineKey, ExcelJS.Row>();
  sheet.eachRow((row) => {
    if (row.number <= header.number) return;
    for (let col = 1; col < firstStoreCol; col++) {
      const label = norm(cellText(row.getCell(col).value));
      if (!label) continue;
      for (const [key, wanted] of Object.entries(PNL_LINES) as [PnlLineKey, string][]) {
        // The first match wins: "EBITDA" also starts the ITDA section's label
        // further down, but that one reads "INTEREST, TAXES, …", not "EBITDA".
        if (label === norm(wanted) && !rowFor.has(key)) rowFor.set(key, row);
      }
    }
  });
  const missingLines = (Object.keys(PNL_LINES) as PnlLineKey[])
    .filter((k) => !rowFor.has(k))
    .map((k) => PNL_LINES[k]);

  const stores: StoreFinancials[] = columns.map(({ col, storeId, header: h }) => {
    const lines = Object.fromEntries(
      (Object.keys(PNL_LINES) as PnlLineKey[]).map((k) => {
        const row = rowFor.get(k);
        return [k, row ? cellNumber(row.getCell(col).value) : null];
      })
    ) as Record<PnlLineKey, number | null>;

    const { totalSales, salariesAndWages, grossProfit, totalSupplies, otherControllables, ebitda } = lines;
    const laborPct = totalSales && salariesAndWages !== null ? (salariesAndWages / totalSales) * 100 : null;
    const controllableIncome =
      grossProfit !== null && totalSupplies !== null && otherControllables !== null
        ? grossProfit - totalSupplies - otherControllables
        : null;
    return { storeId, header: h, lines, laborPct, controllableIncome, ebitda };
  });

  return {
    title,
    endingDate,
    periodFromFile: endingDate ? periodEndingOn(endingDate) : null,
    looksMultiPeriod: /\b(qtr|quarter|year|ytd|annual)\b/i.test(titleText),
    stores,
    skippedColumns,
    missingLines,
  };
}
