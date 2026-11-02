/**
 * Each store's period financials, from the P&L dropped onto the Bonus tab.
 *
 * Three figures matter to bonus (pnl.ts says how each is derived):
 *
 *   Labor %              scores the GM's "Labor % of sales" criterion —
 *                        written into the period's cached metrics here, and
 *                        read again by the nightly resolver, so it survives
 *                        every recompute
 *   Controllable Income  sizes the store-level bonus pools
 *   EBITDA               sizes the above-store pools
 *
 * The last two are stored for the $ payouts, which are not built yet.
 *
 * One row per store per period; dropping in a newer P&L for the same period
 * replaces it, and stores the new file doesn't carry are left as they were.
 */

import { sql } from "../db";
import { ensureBonusSchema, getMetrics, saveMetrics } from "./store";
import type { PnlLineKey, StoreFinancials } from "./pnl";

/** The metric the GM's labor criterion reads (rules.ts, `gm_labor_pct`). */
export const LABOR_METRIC = "gm_labor_pct";

export type StoredFinancials = {
  storeId: string;
  periodLabel: string;
  laborPct: number | null;
  controllableIncome: number | null;
  ebitda: number | null;
  totalSales: number | null;
  lines: Record<PnlLineKey, number | null>;
  sourceFile: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
};

type Row = {
  store_id: string;
  period_label: string;
  labor_pct: string | number | null;
  controllable_income: string | number | null;
  ebitda: string | number | null;
  total_sales: string | number | null;
  lines: Record<PnlLineKey, number | null>;
  source_file: string | null;
  uploaded_by: string | null;
  uploaded_at: Date | string;
};

const num = (v: string | number | null) => (v === null ? null : Number(v));

export async function getFinancials(periodLabel: string): Promise<StoredFinancials[]> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT * FROM bonus_financials WHERE period_label = ${periodLabel} ORDER BY store_id
  `) as Row[];
  return rows.map((r) => ({
    storeId: r.store_id,
    periodLabel: r.period_label,
    laborPct: num(r.labor_pct),
    controllableIncome: num(r.controllable_income),
    ebitda: num(r.ebitda),
    totalSales: num(r.total_sales),
    lines: r.lines,
    sourceFile: r.source_file,
    uploadedBy: r.uploaded_by,
    uploadedAt: typeof r.uploaded_at === "string" ? r.uploaded_at : r.uploaded_at.toISOString(),
  }));
}

export async function saveFinancials(
  periodLabel: string,
  stores: StoreFinancials[],
  sourceFile: string | null,
  uploadedBy: string | null,
): Promise<number> {
  if (stores.length === 0) return 0;
  await ensureBonusSchema();
  await sql`
    INSERT INTO bonus_financials (
      store_id, period_label, labor_pct, controllable_income, ebitda, total_sales,
      lines, source_file, uploaded_by, uploaded_at
    )
    SELECT u.store_id, ${periodLabel}, u.labor_pct, u.controllable_income, u.ebitda, u.total_sales,
           u.lines, ${sourceFile}, ${uploadedBy}, now()
    FROM UNNEST(
      ${stores.map((s) => s.storeId)}::text[],
      ${stores.map((s) => s.laborPct)}::numeric[],
      ${stores.map((s) => s.controllableIncome)}::numeric[],
      ${stores.map((s) => s.ebitda)}::numeric[],
      ${stores.map((s) => s.lines.totalSales)}::numeric[],
      ${stores.map((s) => JSON.stringify(s.lines))}::jsonb[]
    ) AS u(store_id, labor_pct, controllable_income, ebitda, total_sales, lines)
    ON CONFLICT (store_id, period_label) DO UPDATE SET
      labor_pct           = EXCLUDED.labor_pct,
      controllable_income = EXCLUDED.controllable_income,
      ebitda              = EXCLUDED.ebitda,
      total_sales         = EXCLUDED.total_sales,
      lines               = EXCLUDED.lines,
      source_file         = EXCLUDED.source_file,
      uploaded_by         = EXCLUDED.uploaded_by,
      uploaded_at         = now()
  `;
  return stores.length;
}

/** Labor % per store for a period, for the nightly metric resolver. */
export async function laborPctByStore(periodLabel: string): Promise<Map<string, number>> {
  const rows = await getFinancials(periodLabel);
  return new Map(rows.flatMap((r) => (r.laborPct === null ? [] : [[r.storeId, r.laborPct] as [string, number]])));
}

/**
 * Write the P&L's Labor % into a period's cached metrics, so the next rescore
 * reads it without waiting for the nightly run. Returns false when the period
 * has never been computed — the nightly run picks the figures up itself.
 */
export async function applyLaborToMetrics(periodLabel: string, stores: StoreFinancials[]): Promise<boolean> {
  const byStore = await getMetrics(periodLabel);
  if (byStore.size === 0) return false;
  for (const s of stores) {
    const values = byStore.get(s.storeId) ?? new Map<string, number>();
    if (s.laborPct === null) values.delete(LABOR_METRIC);
    else values.set(LABOR_METRIC, s.laborPct);
    byStore.set(s.storeId, values);
  }
  await saveMetrics(periodLabel, byStore);
  return true;
}
