/**
 * The numbers behind the WBR sales and productivity slides, one block per
 * above-store leader.
 *
 * Nothing here computes a metric of its own: daily rows come from
 * getDailyRowsForRange (what /api/par/data serves the POS Sales tab) and the
 * weekly SPLH/TPLH from lib/parWeekly (what that tab renders), so a slide can
 * only ever show a number the dashboard would show for the same week.
 */

import { PAR_LOCATIONS } from "@/lib/par";
import { getDailyRowsForRange, type PARDailyRow } from "@/lib/parRollup";
import { getPriorYearRange } from "@/lib/fiscal";
import { bucketDaily, lastNWeeks, productivityOf, tplhOf, type Bucket, type Week } from "@/lib/parWeekly";
import { listLeaders, type Leader } from "@/lib/users/leaders";
import { ALL_STORES } from "@/lib/stores";
import { WBR_TARGETS, type StoreTargets } from "@/lib/wbr/targets";

/** Weeks of productivity history printed under each store (incl. the current one). */
export const TREND_WEEKS = 3;

export type SalesFigures = {
  netSales: number;
  transactions: number;
  avgCheck: number | null;
};

export type StoreWeek = {
  label: string;
  storeId: string;
  current: SalesFigures;
  prior: SalesFigures;
  /** Null when the store has no complete week a year ago (a new store). */
  priorYear: SalesFigures | null;
  /** Oldest → newest, TREND_WEEKS long; the last entry is the current week. */
  splh: (number | null)[];
  tplh: (number | null)[];
  targets: StoreTargets | null;
  /** Days in the current week with no rollup row — the total is short if non-empty. */
  missingDays: string[];
};

export type DistrictWeek = {
  leader: string;
  market: "TN" | "VA" | "TN/VA";
  stores: StoreWeek[];
  total: {
    current: SalesFigures;
    prior: SalesFigures;
    priorYear: SalesFigures | null;
    /** This week across only the stores that have a prior-year week — what YoY compares. */
    currentLegacy: SalesFigures;
  };
  /** Whether the YoY total had to leave out stores with no prior-year week. */
  yoyLegacyOnly: boolean;
};

export type WbrWeek = {
  week: Week;
  priorWeek: Week;
  priorYearWeek: { start: string; end: string };
  trendWeeks: Week[];
  districts: DistrictWeek[];
};

const figuresOf = (b: Bucket): SalesFigures => ({
  netSales: b.netSales,
  transactions: b.transactions,
  avgCheck: b.transactions > 0 ? b.netSales / b.transactions : null,
});

function sumFigures(list: SalesFigures[]): SalesFigures {
  const netSales = list.reduce((s, f) => s + f.netSales, 0);
  const transactions = list.reduce((s, f) => s + f.transactions, 0);
  return { netSales, transactions, avgCheck: transactions > 0 ? netSales / transactions : null };
}

const datesIn = (start: string, end: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(start + "T00:00:00Z"); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
};

async function storeWeek(label: string, storeId: string, trendWeeks: Week[], py: { start: string; end: string }): Promise<StoreWeek> {
  const first = trendWeeks[0];
  const week = trendWeeks[trendWeeks.length - 1];
  const [daily, pyDaily] = await Promise.all([
    getDailyRowsForRange(storeId, first.start, week.end),
    getDailyRowsForRange(storeId, py.start, py.end),
  ]);

  const buckets = bucketDaily(daily, trendWeeks);
  const current = buckets[buckets.length - 1];
  const prior = buckets[buckets.length - 2];

  // A prior-year week only counts when every day of it rang sales — a store
  // that opened mid-week last year would otherwise post a huge fake YoY.
  const pyFull = pyDaily.filter((d: PARDailyRow) => d.netSales > 0).length === 7;
  const have = new Set(daily.map(d => d.date));

  return {
    label,
    storeId,
    current: figuresOf(current),
    prior: figuresOf(prior),
    priorYear: pyFull ? figuresOf(bucketDaily(pyDaily, [py])[0]) : null,
    splh: buckets.map(productivityOf),
    tplh: buckets.map(tplhOf),
    targets: WBR_TARGETS[label] ?? null,
    missingDays: datesIn(week.start, week.end).filter(d => !have.has(d)),
  };
}

/**
 * Builds the week ending `weekEnd` (a Sunday, YYYY-MM-DD), or the most recent
 * completed week when omitted.
 */
export async function buildWbrWeek(weekEnd?: string): Promise<WbrWeek> {
  const trendWeeks = lastNWeeks(Math.max(TREND_WEEKS, 2), weekEnd);
  const week = trendWeeks[trendWeeks.length - 1];
  const priorWeek = trendWeeks[trendWeeks.length - 2];
  const priorYearWeek = getPriorYearRange(week.start, week.end);

  const leaders = districtLeaders(await listLeaders());
  const order = new Map(ALL_STORES.map((s, i) => [s.label, i]));
  const byLabel = new Map(PAR_LOCATIONS.map(l => [l.name, l]));

  const districts = await Promise.all(
    leaders.map(async (leader): Promise<DistrictWeek> => {
        const labels = [...leader.stores].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
        const stores = await Promise.all(
          labels
            .filter(label => byLabel.has(label))
            .map(label => storeWeek(label, byLabel.get(label)!.storeId, trendWeeks, priorYearWeek)),
        );
        const markets = new Set(labels.map(l => ALL_STORES.find(s => s.label === l)?.section));
        const legacy = stores.filter(s => s.priorYear);
        return {
          leader: leader.name,
          market: markets.size > 1 ? "TN/VA" : markets.has("Virginia") ? "VA" : "TN",
          stores,
          total: {
            current: sumFigures(stores.map(s => s.current)),
            prior: sumFigures(stores.map(s => s.prior)),
            priorYear: legacy.length ? sumFigures(legacy.map(s => s.priorYear!)) : null,
            currentLegacy: sumFigures(legacy.map(s => s.current)),
          },
          yoyLegacyOnly: legacy.length > 0 && legacy.length < stores.length,
        };
      }),
  );

  // TN before VA, then by first store's display order — the order the deck runs in.
  districts.sort((a, b) => {
    const first = (d: DistrictWeek) => order.get(d.stores[0]?.label ?? "") ?? 99;
    return first(a) - first(b);
  });

  return { week, priorWeek, priorYearWeek, trendWeeks: trendWeeks.slice(-TREND_WEEKS), districts };
}

/**
 * The leaders who get a slide: district managers, not the regional managers
 * above them. Users & Access records both the same way, so a leader whose
 * stores fully contain another leader's is taken to be that leader's RM and
 * left out — their stores already appear under the DMs.
 */
export function districtLeaders(leaders: Leader[]): Leader[] {
  const withStores = leaders.filter(l => l.stores.length > 0);
  return withStores.filter(
    l => !withStores.some(o => o.id !== l.id && o.stores.length < l.stores.length && o.stores.every(s => l.stores.includes(s))),
  );
}
