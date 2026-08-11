/**
 * Persisted Net-Chef food cost, per store per fiscal period.
 *
 * Net-Chef is the only one of the four vendors with no durable storage in this
 * app: netchef.ts caches every report in a module-level Map, which on Vercel
 * lives and dies with a single serverless instance. That's tolerable for the
 * Food Cost tab, where a cold start costs one round of fetches for one date
 * range the user is looking at.
 *
 * It is not tolerable for bonus attainment. COGS and variance feed two
 * categories (the Quality Director's 40% COGS category and the GM's Financial &
 * Operations), across 12 stores and every historical period — a cold page load
 * would be a hundred-plus live vendor calls before a single number rendered.
 * So the bonus cron writes them here and the scorer reads Postgres.
 *
 * Only the period grain is stored: no bonus doc tests food cost weekly. Both
 * criteria that use it ("Food cost ≤ 30.0% / ≤ 28.5%" and "variance within
 * ±1.5% / ±1%") are period-level.
 */

import { sql } from "./db";
import { fetchLocationReport } from "./netchef";
import { BONUS_STORES } from "./bonus/storeMap";
import { ensureBonusSchema } from "./bonus/store";

export type StoreCost = {
  storeId: string;
  cogsPct: number | null;
  /** Signed, as Net-Chef reports it. The scorer takes the absolute value. */
  variancePct: number | null;
  windowStart: string;
  windowEnd: string;
};

export type CostBucket = {
  /** Period label from bonus/periods.ts, e.g. "P7 FY2026". */
  bucketKey: string;
  start: string;
  end: string;
};

type CostRow = {
  store_id: string;
  cogs_pct: string | number | null;
  variance_pct: string | number | null;
  window_start: Date;
  window_end: Date;
};

/** Postgres DATE columns arrive as timestamps stamped UTC on Vercel — read UTC components. */
function dateOnly(d: Date): string {
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${m}-${day}`;
}

export async function getPeriodCosts(bucketKey: string): Promise<Map<string, StoreCost>> {
  await ensureBonusSchema();
  const rows = (await sql`
    SELECT store_id, cogs_pct, variance_pct, window_start, window_end
    FROM netchef_costs
    WHERE grain = 'period' AND bucket_key = ${bucketKey}
  `) as CostRow[];
  return new Map(
    rows.map((r) => [
      r.store_id,
      {
        storeId: r.store_id,
        cogsPct: r.cogs_pct === null ? null : Number(r.cogs_pct),
        variancePct: r.variance_pct === null ? null : Number(r.variance_pct),
        windowStart: dateOnly(r.window_start),
        windowEnd: dateOnly(r.window_end),
      },
    ])
  );
}

/**
 * Fetch and store food cost for every store across one period window.
 *
 * A stored row whose window already matches what's being asked for is skipped
 * unless `refresh` is set — closed periods can't change, so re-pulling them
 * every night would be twelve pointless vendor calls per period of history. The
 * open period's window moves forward a day at a time, so its stored window
 * won't match and it re-fetches naturally.
 *
 * Per-store failures are collected rather than thrown: one store's Net-Chef
 * hiccup should leave the other eleven scored, with that store's criteria
 * showing as pending.
 */
export async function ingestPeriodCosts(
  bucket: CostBucket,
  opts: { refresh?: boolean } = {}
): Promise<{ bucketKey: string; written: number; skipped: number; errors: string[] }> {
  await ensureBonusSchema();

  const existing = await getPeriodCosts(bucket.bucketKey);
  const errors: string[] = [];
  let skipped = 0;

  const results = await Promise.all(
    BONUS_STORES.map(async (store) => {
      const prior = existing.get(store.storeId);
      if (
        !opts.refresh &&
        prior &&
        prior.windowStart === bucket.start &&
        prior.windowEnd === bucket.end &&
        prior.cogsPct !== null
      ) {
        skipped++;
        return null;
      }
      try {
        const report = await fetchLocationReport(store.netchefLocationId, bucket.start, bucket.end);

        // Net-Chef answers with empty summaries often enough that netchef.ts
        // already retries once and then gives up, returning nulls. Writing
        // those over a figure we previously had would turn a working food-cost
        // criterion into "pending" — and on the open period, whose window moves
        // every day, that re-fetch happens nightly. Keep the last good value.
        if (report.actualCostPct === null && prior?.cogsPct != null) {
          errors.push(`${store.name}: Net-Chef returned no data; kept the previous figure`);
          skipped++;
          return null;
        }

        return {
          storeId: store.storeId,
          cogsPct: report.actualCostPct,
          variancePct: report.variancePct,
        };
      } catch (err) {
        errors.push(`${store.name}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    })
  );

  const writes = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (writes.length > 0) {
    await sql`
      INSERT INTO netchef_costs
        (store_id, grain, bucket_key, window_start, window_end, cogs_pct, variance_pct, updated_at)
      SELECT u.store_id, 'period', ${bucket.bucketKey}, ${bucket.start}::date, ${bucket.end}::date,
             u.cogs_pct, u.variance_pct, now()
      FROM UNNEST(
        ${writes.map((w) => w.storeId)}::text[],
        ${writes.map((w) => w.cogsPct)}::numeric[],
        ${writes.map((w) => w.variancePct)}::numeric[]
      ) AS u(store_id, cogs_pct, variance_pct)
      ON CONFLICT (store_id, grain, bucket_key)
      DO UPDATE SET
        window_start = EXCLUDED.window_start,
        window_end   = EXCLUDED.window_end,
        cogs_pct     = EXCLUDED.cogs_pct,
        variance_pct = EXCLUDED.variance_pct,
        updated_at   = now()
    `;
  }

  return { bucketKey: bucket.bucketKey, written: writes.length, skipped, errors };
}
