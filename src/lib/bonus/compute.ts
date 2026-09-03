/**
 * Computing and storing bonus attainment for a period.
 *
 * Ties the four pieces together: resolve the automatic metrics, merge in what
 * people typed, score all six positions per store, write the results.
 *
 * Nothing here is called from a page request. The scorecard route reads
 * bonus_results and never recomputes — a single period costs one Superset query
 * per day of the period the first time it's built, and a page load must not
 * wait on that.
 */

import { ingestPeriodCosts } from "../netchefRollup";
import { BONUS_STORES } from "./storeMap";
import { resolveBonusWindow } from "./periods";
import { scoreStore } from "./engine";
import type { MetricValues } from "./engine";
import { OVERRIDE_PREFIX } from "./rules";

/**
 * Metrics whose source can only ever report the present, so a closed period's
 * value has to be remembered rather than re-derived. See the freeze below.
 */
const POINT_IN_TIME_METRICS = ["zuComplianceRate", "gmServeSafeCurrent"] as const;
import {
  getInputs, getMetrics, indexInputs, isLocked, saveMetrics, upsertResults,
  type ResultWrite,
} from "./store";
import { POSITION_ORDER } from "./types";

export type ComputeReport = {
  periodLabel: string;
  windowStart: string;
  windowEnd: string;
  isPartial: boolean;
  stores: number;
  positions: number;
  skipped?: "locked" | "no-window";
  warnings: string[];
};

/**
 * Merge the automatic metrics with a store's manual entries.
 *
 * Manual values are written **after** the automatic ones so an entry always
 * wins, and any input named `override_<metric>` replaces that metric outright.
 * Overrides are applied last of all, so a deliberate correction beats both the
 * vendor figure and any same-named criterion.
 */
export function mergeInputs(auto: MetricValues, manual: Map<string, number> | undefined): MetricValues {
  const merged = new Map(auto);
  if (!manual) return merged;

  const overrides: [string, number][] = [];
  for (const [criterionId, value] of manual) {
    if (criterionId.startsWith(OVERRIDE_PREFIX)) {
      overrides.push([criterionId.slice(OVERRIDE_PREFIX.length), value]);
      continue;
    }
    merged.set(criterionId, value);
  }
  for (const [metric, value] of overrides) merged.set(metric, value);
  return merged;
}

/**
 * Score one period for every store and persist the results.
 *
 * A locked period is left alone. Locking exists because SMG keeps revising
 * closed periods for weeks after they end (the sync cron re-pulls a rolling
 * 12-week window), and a bonus that was approved and paid must not quietly
 * change afterwards — so once approved, this refuses to overwrite it.
 */
export async function computePeriod(
  periodLabel: string,
  berryToken: string | null,
  opts: { refreshCosts?: boolean; force?: boolean } = {}
): Promise<ComputeReport> {
  const window = resolveBonusWindow(periodLabel);
  if (!window) {
    return {
      periodLabel, windowStart: "", windowEnd: "", isPartial: false,
      stores: 0, positions: 0, skipped: "no-window",
      warnings: [`${periodLabel} has no completed day to score yet`],
    };
  }

  if (!opts.force && (await isLocked(periodLabel))) {
    return {
      periodLabel, windowStart: window.start, windowEnd: window.end,
      isPartial: window.isPartial, stores: 0, positions: 0, skipped: "locked",
      warnings: [`${periodLabel} is locked; results left as approved`],
    };
  }

  const warnings: string[] = [];

  // Food cost has to be pulled and stored before the metrics are resolved —
  // the resolver reads netchef_costs, not Net-Chef.
  const cost = await ingestPeriodCosts(
    { bucketKey: window.periodLabel, start: window.start, end: window.end },
    { refresh: opts.refreshCosts }
  );
  warnings.push(...cost.errors);

  // Imported lazily so the module graph for the read-only routes doesn't drag
  // in every vendor client.
  const { resolvePeriodMetrics } = await import("./metrics");
  const { byStore, diagnostics } = await resolvePeriodMetrics(window, berryToken);
  warnings.push(...diagnostics.warnings);

  // Carry forward anything this run couldn't resolve.
  //
  // Vendors fail transiently — a BerryAI login timing out or Net-Chef returning
  // empty summaries has already happened here. Without this, one bad night
  // silently replaced every drive-thru figure with "pending" and the scorecards
  // lost categories they had legitimately scored the day before. A stale value
  // carried forward is far better than a category that quietly stops being
  // scoreable, and the next good run overwrites it anyway.
  const existing = await getMetrics(periodLabel);
  let retained = 0;
  for (const [storeId, values] of byStore) {
    const prior = existing.get(storeId);
    if (!prior) continue;
    for (const [metric, value] of prior) {
      if (!values.has(metric)) {
        values.set(metric, value);
        retained++;
      }
    }
  }
  if (retained > 0) {
    warnings.push(`${retained} metric values carried forward from the previous run (a vendor did not respond)`);
  }

  // Freeze the point-in-time metrics once the period is over.
  //
  // Schoox reports only the present: there is no way to ask what a store's ZU
  // compliance was on a date that has passed. So these have to move while the
  // period is open and stop the moment it closes, or a scorecard would keep
  // drifting after the period it describes had ended — and a bonus already
  // approved would quietly change.
  //
  // Whatever was stored first wins, which in practice is the last run while the
  // period was still open, or the first run after it closed. This is not the
  // generic carry-forward above: that only fills gaps, and here a freshly
  // resolved live value must be actively discarded in favour of the snapshot.
  if (!window.isPartial) {
    let frozen = 0;
    let dropped = 0;
    for (const [storeId, values] of byStore) {
      const prior = existing.get(storeId);
      for (const metric of POINT_IN_TIME_METRICS) {
        const snapshot = prior?.get(metric);
        if (snapshot !== undefined) {
          values.set(metric, snapshot);
          frozen++;
        } else if (values.delete(metric)) {
          // No snapshot, and the period is already closed — so this was never
          // observed while it was open and today's reading describes some other
          // period. Dropped rather than stored: the engine reads an absent
          // metric as pending, and "we do not know" is the honest answer where
          // "here is a number from months later" is not.
          //
          // Only ever hits periods that closed before this was wired up. A
          // period computed even once while open has a snapshot to freeze.
          dropped++;
        }
      }
    }
    if (frozen > 0) warnings.push(`${frozen} point-in-time values held at their period-end snapshot`);
    if (dropped > 0) {
      warnings.push(
        `${dropped} point-in-time values left pending: this period closed without ever being ` +
          `observed, and today's reading describes a different one`,
      );
    }
  }

  // Cached so a later rescore (someone typing a number) needs no vendor calls.
  await saveMetrics(periodLabel, byStore);

  const inputs = indexInputs(await getInputs(periodLabel));
  const writes = scoreAll(periodLabel, window.start, window.end, byStore, inputs);
  await upsertResults(writes);

  return {
    periodLabel,
    windowStart: window.start,
    windowEnd: window.end,
    isPartial: window.isPartial,
    stores: BONUS_STORES.length,
    positions: writes.length,
    warnings,
  };
}

function scoreAll(
  periodLabel: string,
  windowStart: string,
  windowEnd: string,
  byStore: Map<string, MetricValues>,
  inputs: Map<string, Map<string, number>>,
  onlyStoreId?: string
): ResultWrite[] {
  const writes: ResultWrite[] = [];
  const targets = onlyStoreId ? BONUS_STORES.filter((s) => s.storeId === onlyStoreId) : BONUS_STORES;
  for (const store of targets) {
    const values = mergeInputs(byStore.get(store.storeId) ?? new Map(), inputs.get(store.storeId));
    const results = scoreStore(store.storeId, periodLabel, values);
    for (const positionId of POSITION_ORDER) {
      writes.push({ result: results[positionId], windowStart, windowEnd });
    }
  }
  return writes;
}

/**
 * Rescore a period from cached metrics — no vendor calls at all.
 *
 * This is what the entry form uses on save. Someone types a Living Our Values
 * score and expects the grid to move; going back to BerryAI, SMG, Net-Chef and
 * PAR to re-derive numbers that haven't changed took close to a minute per
 * keystroke-batch, which made the form unusable.
 *
 * Returns null when the period has never been computed, so the caller can fall
 * back to a full `computePeriod`.
 *
 * **The caller must check `isLocked` first.** Unlike `computePeriod` this does
 * not re-check, because its only caller has already rejected the write with a
 * 409 and a second round trip to Neon is a real cost on this path.
 */
export async function rescoreFromStored(
  periodLabel: string,
  storeId?: string
): Promise<ComputeReport | null> {
  const window = resolveBonusWindow(periodLabel);
  if (!window) return null;

  const byStore = await getMetrics(periodLabel);
  if (byStore.size === 0) return null;

  // Scoped to the store that changed when one is named. Every position's score
  // depends only on its own store — the AGM and GM roll up from that store's
  // Directors, never across stores — so rescoring the other eleven would write
  // 66 identical rows for nothing.
  const inputs = indexInputs(await getInputs(periodLabel, storeId));
  const writes = scoreAll(periodLabel, window.start, window.end, byStore, inputs, storeId);
  await upsertResults(writes);

  return {
    periodLabel,
    windowStart: window.start,
    windowEnd: window.end,
    isPartial: window.isPartial,
    stores: storeId ? 1 : byStore.size,
    positions: writes.length,
    warnings: [],
  };
}
