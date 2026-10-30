/**
 * Sales and productivity projections from the stores' morning Slack reports,
 * against what actually happened — the table at the top of the Staffing tab.
 *
 * Each morning report carries "Current Day" projections for that day (the
 * "HRG - Slack Reporting" doc: by 8:30 AM, Sales Projection and Productivity
 * Projection). So yesterday's projections come from yesterday morning's
 * report, and the actuals for that day from PAR through getTotalsForRange — the
 * same totals the PAR tab shows, productivity being net sales ÷ labor hours.
 * Today's come from this morning's report and have nothing to compare yet.
 *
 * Read live from Slack (two days of thirteen channels, a couple of seconds),
 * not stored. A store that left the projections blank — Portland posts the
 * template with both lines empty — reads as not posted, never as zero.
 *
 * Next to each, CrunchTime's own forecast for the day from Teamworx
 * (lib/teamworx.ts, synced nightly) — the number the schedule was written to.
 */

import { BONUS_STORES, SLACK_CHANNEL_IDS, storeTimeZone } from "./bonus/storeMap";
import { getTotalsForRange } from "./parRollup";
import { businessDateISO } from "./businessDay";
import { parseReportFields } from "./slackFields";
import { addDays, fetchChannelHistory, localMidnight, placeMessage } from "./slackReports";
import { labelled, mapLimit, STORE_CONCURRENCY } from "./slackCompletion";
import { getForecastSales } from "./teamworx";

export type Projection = {
  date: string;
  salesProjection: number | null;
  productivityProjection: number | null;
  /** Teamworx (CrunchTime) forecast sales for the date, if synced. */
  forecastSales: number | null;
  /** Slack ts of the report the projections were read from, if any. */
  ts: string | null;
};

export type ProjectionRow = {
  storeId: string;
  storeName: string;
  yesterday: Projection & { actualSales: number | null; actualProductivity: number | null };
  today: Projection;
  error: string | null;
};

export type ProjectionsReport = { today: string; yesterday: string; stores: ProjectionRow[] };

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getProjections(): Promise<ProjectionsReport> {
  const today = businessDateISO();
  const yesterday = addDays(today, -1);
  // A failed read leaves the forecast column blank, not the table.
  const forecasts = await getForecastSales([yesterday, today]).catch((err) => {
    console.error("[staffing] teamworx forecast read failed:", err instanceof Error ? err.message : err);
    return new Map<string, Map<string, number>>();
  });

  const stores = await mapLimit(BONUS_STORES, STORE_CONCURRENCY, async (store): Promise<ProjectionRow> => {
    const blank = (date: string): Projection => ({
      date, salesProjection: null, productivityProjection: null,
      forecastSales: forecasts.get(store.storeId)?.get(date) ?? null, ts: null,
    });
    const row: ProjectionRow = {
      storeId: store.storeId,
      storeName: store.name,
      yesterday: { ...blank(yesterday), actualSales: null, actualProductivity: null },
      today: blank(today),
      error: null,
    };
    try {
      const channel = SLACK_CHANNEL_IDS[store.storeId];
      if (!channel) throw new Error("no Slack channel mapped");
      const timeZone = storeTimeZone(store);
      const [messages, totals] = await Promise.all([
        labelled("Slack", () =>
          fetchChannelHistory(channel, localMidnight(yesterday, timeZone), Math.ceil(Date.now() / 1000) + 60),
        ),
        labelled("PAR", () => getTotalsForRange(store.storeId, yesterday, yesterday)),
      ]);

      // Oldest first, so a later correction ("the new updated slack that I
      // missed — Projected sales: 11,441") replaces the first figure posted.
      for (const m of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
        const placed = placeMessage(m, timeZone);
        if (!placed || placed.slot !== "previous_day") continue;
        const target = placed.date === today ? row.today : placed.date === yesterday ? row.yesterday : null;
        if (!target) continue;
        const f = parseReportFields(m.text ?? "");
        if (f.salesProjection !== null) { target.salesProjection = f.salesProjection; target.ts = m.ts; }
        if (f.productivityProjection !== null) { target.productivityProjection = f.productivityProjection; target.ts ??= m.ts; }
      }

      if (totals.netSales > 0) {
        row.yesterday.actualSales = round2(totals.netSales);
        row.yesterday.actualProductivity = totals.laborMinutes > 0 ? round2(totals.netSales / (totals.laborMinutes / 60)) : null;
      }
    } catch (err) {
      row.error = err instanceof Error ? err.message : String(err);
    }
    return row;
  });

  return { today, yesterday, stores };
}
