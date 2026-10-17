/**
 * New-hire retention, per store, from Workstream.
 *
 * The bonus scorecard has carried `t_retention_30`, `t_retention_60` and
 * `t_retention_90` since it was written, all `source: "manual"` — somebody
 * works them out and types them in. Workstream is the only system that knows a
 * hire date and a termination date, so this is where they can finally be
 * computed. Nothing here changes the scorecard yet: see the note at the bottom.
 *
 * ── What "30-day retention" is taken to mean ─────────────────────────────────
 *
 * Of the people whose **30th day fell inside the period**, the share who were
 * still employed on it.
 *
 * The cohort is pinned to the day being measured rather than the day someone
 * was hired, and that is the whole design. Score by hire date instead and a
 * period's number cannot be known until thirty days after the period ends, and
 * worse, it keeps changing after the period closes — a bonus figure that moves
 * once it has been paid. Pinning to the anniversary means every hire in the
 * cohort has already had its answer settled by the time the period is scored.
 *
 * A consequence worth saying out loud: the 90-day number for a period is about
 * people hired roughly three months earlier, so it credits the manager who has
 * them now for hiring decisions made a quarter ago. That is inherent to the
 * measure, not to this implementation.
 *
 * ── Who counts ───────────────────────────────────────────────────────────────
 *
 * Attributed to the store on the person's job assignment. Somebody whose
 * Workstream record carries no assignment has no store and is counted nowhere —
 * `unattributed` below reports how many, because a retention figure resting on
 * half the leavers would be worse than no figure at all.
 *
 * Transfers are the known soft spot. Workstream creates a *new* record when
 * somebody moves store, so a transfer can read as one person leaving and
 * another being hired. Until those are closed at source, a store that loses
 * people to transfers will look worse than it is, and the receiving store will
 * carry a new "hire" it did not recruit.
 */

import { listEmployees, employeeLocationId, EMPLOYEE_EMBED, type WsEmployee } from "./workstream";
import { BONUS_STORES, storeByWorkstreamLocation } from "./bonus/storeMap";

/** The anniversaries the bonus scorecard gates on. */
export const RETENTION_DAYS = [30, 60, 90] as const;
export type RetentionDay = (typeof RETENTION_DAYS)[number];

export type StoreRetention = {
  storeId: string;
  storeName: string;
  /** Keyed by 30 / 60 / 90. */
  byDay: Record<number, {
    /** People whose Nth day fell in the window. */
    cohort: number;
    /** How many of them were still employed on it. */
    stayed: number;
    /** stayed / cohort as a percentage, or null when nobody reached the mark. */
    percent: number | null;
  }>;
};

export type RetentionReport = {
  start: string;
  /** Inclusive. */
  end: string;
  stores: StoreRetention[];
  /**
   * Records whose Nth day fell in the window but which carry no store —
   * counted here rather than silently dropped.
   */
  unattributed: Record<number, number>;
};

/** The day someone started, preferring start_date over the hire date. */
function startedOn(e: WsEmployee): string | null {
  return e.start_date ?? e.hired_date ?? null;
}

/** ISO date `days` after `iso`. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Was this person still employed on their Nth day?
 *
 * A termination dated exactly on the anniversary counts as *not* retained: they
 * did not complete the day. The opposite reading would let a store bank a
 * 90-day hire who walked out on day ninety.
 */
function survivedTo(e: WsEmployee, anniversary: string): boolean {
  return !e.termination_date || e.termination_date > anniversary;
}

/**
 * New-hire retention for every store over one window.
 *
 * Reads the whole company once — `listEmployees` with no status filter, because
 * the leavers are the entire point and a filter on `active` would score 100%
 * every time.
 */
export async function getRetention(start: string, end: string): Promise<RetentionReport> {
  const everyone = await listEmployees({ embed: EMPLOYEE_EMBED });

  const byStore = new Map<string, StoreRetention>();
  for (const s of BONUS_STORES) {
    byStore.set(s.storeId, {
      storeId: s.storeId,
      storeName: s.name,
      byDay: Object.fromEntries(
        RETENTION_DAYS.map((d) => [d, { cohort: 0, stayed: 0, percent: null }]),
      ),
    });
  }
  const unattributed: Record<number, number> = Object.fromEntries(
    RETENTION_DAYS.map((d) => [d, 0]),
  );

  for (const e of everyone) {
    const started = startedOn(e);
    if (!started) continue;

    for (const days of RETENTION_DAYS) {
      const anniversary = addDays(started, days);
      // Only people whose anniversary has actually landed in this window.
      if (anniversary < start || anniversary > end) continue;

      const store = storeByWorkstreamLocation(employeeLocationId(e));
      if (!store) {
        unattributed[days] += 1;
        continue;
      }
      const row = byStore.get(store.storeId);
      if (!row) continue;

      row.byDay[days].cohort += 1;
      if (survivedTo(e, anniversary)) row.byDay[days].stayed += 1;
    }
  }

  for (const row of byStore.values()) {
    for (const days of RETENTION_DAYS) {
      const d = row.byDay[days];
      d.percent = d.cohort > 0 ? Math.round((d.stayed / d.cohort) * 1000) / 10 : null;
    }
  }

  return { start, end, stores: [...byStore.values()], unattributed };
}

/**
 * The same figures shaped the way bonus/metrics.ts wants them: a flat number
 * per store per metric id.
 *
 * Not wired into the scorecard. `t_retention_*` are still `source: "manual"`
 * in rules.ts, and they should stay that way until these numbers have been
 * compared against a period somebody already scored by hand — this drives pay,
 * and "the computer says 78%" is not a reason to believe it. When they agree,
 * flipping the three conditions to a computed source is a small change here and
 * three lines there.
 *
 * A store with nobody reaching the mark is **absent from the map** rather than
 * present as zero. Zero would score as total failure; absent leaves the
 * condition unmet and visible, which is the honest answer to "nobody hit ninety
 * days this period".
 */
export function retentionMetrics(report: RetentionReport): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const s of report.stores) {
    const values = new Map<string, number>();
    for (const days of RETENTION_DAYS) {
      const pct = s.byDay[days].percent;
      if (pct !== null) values.set(`t_retention_${days}`, pct);
    }
    out.set(s.storeId, values);
  }
  return out;
}
