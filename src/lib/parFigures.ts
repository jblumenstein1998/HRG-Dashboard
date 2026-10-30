/**
 * The PAR figures every screen derives from net sales, transactions and labor —
 * one definition, so the PAR tab, the Drive-Thru tab's cards and the Slack
 * accuracy check can't disagree on a number. Rounding included: the tabs round
 * net sales and labor hours to the cent before dividing, and the check used to
 * divide the raw sums, landing a cent off the figure on screen.
 *
 * Pure — no server imports — so client components can use it too.
 */

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Labor hours as every screen shows them: minutes / 60, to the cent. */
export function laborHours(laborMinutes: number): number {
  return round2(laborMinutes / 60);
}

/** Productivity (SPLH): net sales per labor hour. */
export function productivity(netSales: number, hours: number): number | null {
  return hours > 0 ? netSales / hours : null;
}

/** TPLH: transactions per labor hour. */
export function tplh(transactions: number, hours: number): number | null {
  return hours > 0 ? transactions / hours : null;
}

/** Average check; 0 for a day with no transactions, as the tabs show it. */
export function avgCheck(netSales: number, transactions: number): number {
  return transactions > 0 ? netSales / transactions : 0;
}

/** Comp % against the prior year; null when there was nothing a year ago. */
export function compPct(value: number, prior: number): number | null {
  return prior === 0 ? null : ((value - prior) / prior) * 100;
}

/**
 * A store's totals for a span, in the rounded form the tabs carry them
 * (salesSnapshot's StoreSnapshotRaw, parRollup's daily rows).
 */
export function roundedTotals(t: { netSales: number; orderCount: number; laborMinutes: number }) {
  return { netSales: round2(t.netSales), transactions: t.orderCount, laborHours: laborHours(t.laborMinutes) };
}
