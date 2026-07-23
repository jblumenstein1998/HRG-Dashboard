import { PAR_LOCATIONS, type PARLocation } from "@/lib/par";
import { getNetSalesForRange, getOrderCountForRange } from "@/lib/parRollup";
import { resolveDateBounds } from "@/lib/tools/dateRange";
import { getPriorYearRange, type RangeKey } from "@/lib/fiscal";

// yesterday/wtd/ptd(mtd)/ytd all resolve through yesterday already (see
// fiscal.ts) — no live "today" data ever enters these tables.
const RANGE_FIELDS = ["yesterday", "wtd", "ptd", "ytd"] as const;
type RangeField = (typeof RANGE_FIELDS)[number];
const FIELD_TO_KEY: Record<RangeField, RangeKey> = {
  yesterday: "yesterday",
  wtd: "wtd",
  ptd: "mtd",
  ytd: "ytd",
};

export type NetSalesFigure = { value: number; prior: number; compPct: number | null };
export type StoreNetSales = {
  storeId: string;
  name: string;
  state: PARLocation["state"];
} & Record<RangeField, NetSalesFigure>;

function compPct(value: number, prior: number): number | null {
  if (prior === 0) return null;
  return ((value - prior) / prior) * 100;
}

type MetricFn = (storeId: string, start: string, end: string) => Promise<number>;

async function figureForRange(storeId: string, field: RangeField, metricFn: MetricFn): Promise<NetSalesFigure> {
  const { start, end } = resolveDateBounds(FIELD_TO_KEY[field]);
  const prior = getPriorYearRange(start, end);
  const [value, priorValue] = await Promise.all([
    metricFn(storeId, start, end),
    metricFn(storeId, prior.start, prior.end),
  ]);
  return { value, prior: priorValue, compPct: compPct(value, priorValue) };
}

async function getComp(metricFn: MetricFn): Promise<StoreNetSales[]> {
  return Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
      const figures = {} as Record<RangeField, NetSalesFigure>;
      for (const field of RANGE_FIELDS) {
        figures[field] = await figureForRange(loc.storeId, field, metricFn);
      }
      return { storeId: loc.storeId, name: loc.name, state: loc.state, ...figures };
    })
  );
}

export async function getNetSalesComp(): Promise<StoreNetSales[]> {
  return getComp(getNetSalesForRange);
}

export async function getTransactionsComp(): Promise<StoreNetSales[]> {
  return getComp(getOrderCountForRange);
}

// ── Average check ────────────────────────────────────────────────────────────
// Average check can't be summed like net sales/transactions can — a group's
// average check is (group net sales / group transactions), not the average of
// its stores' individual average checks. So this returns the raw net-sales and
// transaction components per store/range instead of a pre-derived figure,
// letting the caller compute a correctly-weighted average at any grouping
// level (store, state, or company-wide).

export type AvgCheckRaw = { netSalesTY: number; netSalesLY: number; txTY: number; txLY: number };
export type StoreAvgCheckRaw = {
  storeId: string;
  name: string;
  state: PARLocation["state"];
} & Record<RangeField, AvgCheckRaw>;

async function avgCheckRawForRange(storeId: string, field: RangeField): Promise<AvgCheckRaw> {
  const { start, end } = resolveDateBounds(FIELD_TO_KEY[field]);
  const prior = getPriorYearRange(start, end);
  const [netSalesTY, netSalesLY, txTY, txLY] = await Promise.all([
    getNetSalesForRange(storeId, start, end),
    getNetSalesForRange(storeId, prior.start, prior.end),
    getOrderCountForRange(storeId, start, end),
    getOrderCountForRange(storeId, prior.start, prior.end),
  ]);
  return { netSalesTY, netSalesLY, txTY, txLY };
}

export async function getAvgCheckRawComp(): Promise<StoreAvgCheckRaw[]> {
  return Promise.all(
    PAR_LOCATIONS.map(async (loc) => {
      const figures = {} as Record<RangeField, AvgCheckRaw>;
      for (const field of RANGE_FIELDS) {
        figures[field] = await avgCheckRawForRange(loc.storeId, field);
      }
      return { storeId: loc.storeId, name: loc.name, state: loc.state, ...figures };
    })
  );
}
