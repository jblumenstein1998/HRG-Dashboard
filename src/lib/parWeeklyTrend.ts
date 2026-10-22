import { sql } from "@/lib/db";
import { PAR_LOCATIONS, type PARLocation } from "@/lib/par";
import { getPriorYearDate } from "@/lib/fiscal";

// ── Weekly trend (POS tab line chart) ─────────────────────────────────────────
// Mon–Sun week totals per store, this year and the same weeks a year earlier
// (364 days back — see getPriorYearDate — so a Monday stays a Monday). Raw sums
// only: average check, productivity and TPLH are ratios, and a group's ratio
// has to be taken over the group's summed components, so the client derives
// them at whatever grouping the store filter leaves on screen.
//
// Reads the daily rollup directly, one grouped query per year, rather than
// going through getTotalsForRange per store per week — a 6-week chart would
// otherwise be ~150 round trips. The trade-off is no live gap-fill, so the
// response says how far the rollup reaches and the chart flags a short week.

export type WeekTotals = { netSales: number; transactions: number; laborHours: number };

export type StoreWeeklyTrend = PARLocation & {
  // Aligned to `weeks`; null where the rollup has no rows for that store/week.
  ty: (WeekTotals | null)[];
  ly: (WeekTotals | null)[];
};

export type WeeklyTrend = {
  weeks: string[]; // week-beginning (Monday) dates, oldest → newest
  stores: StoreWeeklyTrend[];
  rolledUpThrough: string | null; // latest business date in the rollup
};

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

type WeekRow = { store_id: string; week_start: string; net_sales: string; order_count: string; labor_minutes: string };

// date_trunc('week') is ISO — Monday-start — which is the business week.
async function weekTotals(start: string, end: string): Promise<Map<string, WeekTotals>> {
  const rows = (await sql`
    SELECT store_id,
           date_trunc('week', business_date)::date::text AS week_start,
           SUM(net_sales) AS net_sales,
           SUM(order_count) AS order_count,
           SUM(labor_minutes) AS labor_minutes
    FROM par_daily_metrics
    WHERE business_date BETWEEN ${start} AND ${end}
    GROUP BY 1, 2
  `) as WeekRow[];

  const byKey = new Map<string, WeekTotals>();
  for (const r of rows) {
    byKey.set(`${r.store_id}|${r.week_start}`, {
      netSales: Number(r.net_sales),
      transactions: Number(r.order_count),
      laborHours: Number(r.labor_minutes) / 60,
    });
  }
  return byKey;
}

/** `firstWeek` and `lastWeek` are week-beginning Mondays, inclusive. */
export async function getWeeklyTrend(firstWeek: string, lastWeek: string): Promise<WeeklyTrend> {
  const weeks: string[] = [];
  for (let w = firstWeek; w <= lastWeek; w = addDays(w, 7)) weeks.push(w);

  const end = addDays(lastWeek, 6);
  const [ty, ly, maxRows] = await Promise.all([
    weekTotals(firstWeek, end),
    weekTotals(getPriorYearDate(firstWeek), getPriorYearDate(end)),
    sql`SELECT MAX(business_date)::text AS max_date FROM par_daily_metrics`,
  ]);

  const stores = PAR_LOCATIONS.map(loc => ({
    ...loc,
    ty: weeks.map(w => ty.get(`${loc.storeId}|${w}`) ?? null),
    ly: weeks.map(w => ly.get(`${loc.storeId}|${getPriorYearDate(w)}`) ?? null),
  }));

  return { weeks, stores, rolledUpThrough: (maxRows[0]?.max_date as string | null) ?? null };
}
