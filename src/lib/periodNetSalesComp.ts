import { PAR_LOCATIONS, type PARLocation } from "@/lib/par";
import { getNetSalesForRange } from "@/lib/parRollup";
import { PERIODS, getPriorYearRange } from "@/lib/fiscal";

export type NetSalesFigure = { value: number; prior: number; compPct: number | null };
export type StorePeriodNetSales = {
  storeId: string;
  name: string;
  state: PARLocation["state"];
  periods: Record<number, NetSalesFigure>;
};

function compPct(value: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((value - prior) / prior) * 100;
}

async function figureForPeriod(storeId: string, periodNum: number): Promise<NetSalesFigure> {
  const period = PERIODS.find((p) => p.period === periodNum);
  if (!period) return { value: 0, prior: 0, compPct: null };
  const prior = getPriorYearRange(period.start, period.end);
  const [value, priorValue] = await Promise.all([
    getNetSalesForRange(storeId, period.start, period.end),
    getNetSalesForRange(storeId, prior.start, prior.end),
  ]);
  return { value, prior: priorValue, compPct: compPct(value, priorValue) };
}

/** Net sales with prior-year comp for a set of fiscal periods, per store. */
export async function getPeriodNetSalesComp(periodNums: number[]): Promise<StorePeriodNetSales[]> {
  return Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
      const periods: Record<number, NetSalesFigure> = {};
      for (const periodNum of periodNums) {
        periods[periodNum] = await figureForPeriod(loc.storeId, periodNum);
      }
      return { storeId: loc.storeId, name: loc.name, state: loc.state, periods };
    })
  );
}
