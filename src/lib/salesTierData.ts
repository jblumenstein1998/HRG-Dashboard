import { PAR_LOCATIONS } from "@/lib/par";
import { resolveDateBounds } from "@/lib/tools/dateRange";
import type { RangeKey } from "@/lib/fiscal";
import {
  getNetSalesForRange,
  getLaborHoursForRange,
  getDailyRowsForRange,
} from "@/lib/parRollup";

function daysBetweenInclusive(start: string, end: string): number {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const s = new Date(sy, sm - 1, sd);
  const e = new Date(ey, em - 1, ed);
  return Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1;
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function fmtDateShort(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

function fmtDateRange(start: string, end: string): string {
  return start === end ? fmtDateShort(start) : `${fmtDateShort(start)} – ${fmtDateShort(end)}`;
}

/**
 * "Weekly-equivalent" net sales for a store over the drive-thru range, used
 * for the sales-tier bucketing (not for productivity, which always uses the
 * raw range totals — see getSalesTierData):
 *   - range is exactly 7 days   -> actual sales for that week
 *   - range is shorter than 7   -> fall back to T7 (trailing 7 days ending yesterday)
 *   - range is longer than 7    -> average of each complete Mon-Sun week fully
 *                                  inside the range (a trailing partial week, if
 *                                  any, is excluded, not just under-counted)
 * The returned label is always just the aggregate date span the value covers
 * (not a breakdown of every individual week).
 */
async function getTierSales(storeId: string, start: string, end: string, t7: { start: string; end: string }) {
  const spanDays = daysBetweenInclusive(start, end);

  if (spanDays === 7) {
    return { value: await getNetSalesForRange(storeId, start, end), label: fmtDateRange(start, end) };
  }

  if (spanDays < 7) {
    return { value: await getNetSalesForRange(storeId, t7.start, t7.end), label: fmtDateRange(t7.start, t7.end) };
  }

  // Longer than a week — average each full Mon-Sun week inside [start, end].
  // Every preset range here (period/quarter/fiscal year) starts on a Monday,
  // so chunking in consecutive 7-day blocks from `start` naturally lands on
  // week boundaries with no alignment correction needed.
  const daily = await getDailyRowsForRange(storeId, start, end);
  const byDate = new Map(daily.map(d => [d.date, d.netSales]));

  let firstWeekStart: string | null = null;
  let lastWeekEnd: string | null = null;
  const weekTotals: number[] = [];
  for (let weekStart = start; ; weekStart = addDays(weekStart, 7)) {
    const weekEnd = addDays(weekStart, 6);
    if (weekEnd > end) break; // partial trailing week — excluded, not averaged in
    let total = 0;
    for (let i = 0; i < 7; i++) total += byDate.get(addDays(weekStart, i)) ?? 0;
    weekTotals.push(total);
    firstWeekStart ??= weekStart;
    lastWeekEnd = weekEnd;
  }

  const value = weekTotals.length > 0 ? weekTotals.reduce((a, b) => a + b, 0) / weekTotals.length : 0;
  const label = firstWeekStart && lastWeekEnd ? fmtDateRange(firstWeekStart, lastWeekEnd) : "No full weeks in range";
  return { value: Math.round(value * 100) / 100, label };
}

export type SalesTierData = {
  salesByStoreId: Record<string, number>;
  productivityByStoreId: Record<string, number | null>;
  driveThruLabel: string;
  salesLabel: string;
};

/**
 * Sales-tier data for the Drive-Thru summary cards: sales (for tier bucketing,
 * per the weekly-equivalent rule above) and productivity (SPLH — always the
 * raw drive-thru range's net sales ÷ labor hours, matching the drive-thru
 * timeframe exactly, independent of the sales-tier averaging).
 */
export async function getSalesTierData(rangeKey: RangeKey): Promise<SalesTierData> {
  const { start, end } = resolveDateBounds(rangeKey);
  const driveThruLabel = fmtDateRange(start, end);
  const t7 = resolveDateBounds("t7" as RangeKey);

  const salesByStoreId: Record<string, number> = {};
  const productivityByStoreId: Record<string, number | null> = {};
  let salesLabel = "";

  for (const loc of PAR_LOCATIONS) {
    const [netSales, laborHours, tier] = await Promise.all([
      getNetSalesForRange(loc.storeId, start, end),
      getLaborHoursForRange(loc.storeId, start, end),
      getTierSales(loc.storeId, start, end, t7),
    ]);
    salesByStoreId[loc.storeId] = tier.value;
    productivityByStoreId[loc.storeId] = laborHours > 0 ? Math.round((netSales / laborHours) * 100) / 100 : null;
    salesLabel = tier.label; // identical shape for every store — just keep the last one
  }

  return { salesByStoreId, productivityByStoreId, driveThruLabel, salesLabel };
}
