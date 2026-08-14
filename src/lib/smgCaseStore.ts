/**
 * Persistence for ZCases.
 *
 * One row per case, and every number the tab shows is derived from those rows
 * at read time rather than stored as a rollup. Counts, average resolve time and
 * the >24hr metrics all roll up trivially in SQL, while the reverse — deriving
 * a case list from stored aggregates — is impossible. Outstanding *age*
 * settles it outright: it's `now() - received_at`, so a stored value would be
 * wrong the moment it was written.
 */
import { sql } from "@/lib/db";
import { pullZCases, type ZCase, type ZCaseType } from "@/lib/smgCases";
import type { SmgSession } from "@/lib/smgTrend";

export async function ensureZCaseSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS smg_zcases (
      case_key         TEXT PRIMARY KEY,
      display_key      TEXT NOT NULL,
      unit_id          TEXT NOT NULL,
      store            TEXT,
      unit_name        TEXT,
      case_type        TEXT,
      external_source  TEXT,
      event_at         TIMESTAMPTZ,
      received_at      TIMESTAMPTZ,
      resolved_at      TIMESTAMPTZ,
      resolution_hours INTEGER,
      status_key       INTEGER,
      escalated        BOOLEAN NOT NULL DEFAULT FALSE,
      target_at        TIMESTAMPTZ,
      synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  // Windows are event-date based (see CaseWindow), so that's what the indexes
  // lead on. received_at is only read for ageing open cases.
  await sql`
    CREATE INDEX IF NOT EXISTS smg_zcases_event_window
    ON smg_zcases (case_type, event_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS smg_zcases_event_store
    ON smg_zcases (store, event_at DESC)
  `;
  // Outstanding cases are a handful out of thousands and get queried on every
  // page load, so they get their own partial index.
  await sql`
    CREATE INDEX IF NOT EXISTS smg_zcases_outstanding
    ON smg_zcases (received_at)
    WHERE resolved_at IS NULL
  `;
  // Superseded by the event_at pair above when windows moved off feedback date.
  await sql`DROP INDEX IF EXISTS smg_zcases_window`;
  await sql`DROP INDEX IF EXISTS smg_zcases_store`;
}

/**
 * Pulls a window from SMG and upserts it.
 *
 * Deliberately a re-sync rather than an append: a case is created unresolved
 * and resolved hours or days later, so a run has to revisit cases it has
 * already stored. Call it with a rolling window (30–90 days) and let the
 * primary key absorb the overlap.
 */
export async function ingestZCases(opts: {
  start: Date;
  end: Date;
  session?: SmgSession;
}): Promise<{ cases: number; unmappedUnits: string[] }> {
  const { cases, unmappedUnits } = await pullZCases(opts);

  await ensureZCaseSchema();
  if (cases.length) await upsertCases(cases);

  if (unmappedUnits.length) {
    // Not fatal, but it means those cases can't be grouped by store — most
    // likely a new restaurant SMG hasn't put in the hierarchy yet.
    console.warn(`[ZCase] ${unmappedUnits.length} unit id(s) had no store: ${unmappedUnits.join(", ")}`);
  }

  return { cases: cases.length, unmappedUnits };
}

/** One statement per chunk via UNNEST — same reason as smgStore.upsertRows. */
async function upsertCases(cases: ZCase[], chunkSize = 500): Promise<void> {
  for (let i = 0; i < cases.length; i += chunkSize) {
    const chunk = cases.slice(i, i + chunkSize);

    await sql`
      INSERT INTO smg_zcases (
        case_key, display_key, unit_id, store, unit_name, case_type, external_source,
        event_at, received_at, resolved_at, resolution_hours, status_key, escalated,
        target_at, synced_at
      )
      SELECT c.case_key, c.display_key, c.unit_id, c.store, c.unit_name, c.case_type,
             c.external_source, c.event_at, c.received_at, c.resolved_at,
             c.resolution_hours, c.status_key, c.escalated, c.target_at, now()
      FROM UNNEST(
        ${chunk.map((c) => c.caseKey)}::text[],
        ${chunk.map((c) => c.displayKey)}::text[],
        ${chunk.map((c) => c.unitId)}::text[],
        ${chunk.map((c) => c.store)}::text[],
        ${chunk.map((c) => c.unitName)}::text[],
        ${chunk.map((c) => c.type)}::text[],
        ${chunk.map((c) => c.externalSource)}::text[],
        ${chunk.map((c) => c.eventAt)}::timestamptz[],
        ${chunk.map((c) => c.receivedAt)}::timestamptz[],
        ${chunk.map((c) => c.resolvedAt)}::timestamptz[],
        ${chunk.map((c) => c.resolutionHours)}::int[],
        ${chunk.map((c) => c.statusKey)}::int[],
        ${chunk.map((c) => c.escalated)}::bool[],
        ${chunk.map((c) => c.targetAt)}::timestamptz[]
      ) AS c(case_key, display_key, unit_id, store, unit_name, case_type, external_source,
             event_at, received_at, resolved_at, resolution_hours, status_key, escalated,
             target_at)
      ON CONFLICT (case_key) DO UPDATE SET
        display_key      = EXCLUDED.display_key,
        unit_id          = EXCLUDED.unit_id,
        store            = EXCLUDED.store,
        unit_name        = EXCLUDED.unit_name,
        case_type        = EXCLUDED.case_type,
        external_source  = EXCLUDED.external_source,
        event_at         = EXCLUDED.event_at,
        received_at      = EXCLUDED.received_at,
        resolved_at      = EXCLUDED.resolved_at,
        resolution_hours = EXCLUDED.resolution_hours,
        status_key       = EXCLUDED.status_key,
        escalated        = EXCLUDED.escalated,
        target_at        = EXCLUDED.target_at,
        synced_at        = now()
    `;
  }
}

// ── read path ─────────────────────────────────────────────────────────────────

/**
 * Windows filter on `event_at` — the guest's visit — which is the "Event Date"
 * basis smg360's own ZCase filters offer and the one HRG reports on: a case
 * belongs to the period the visit happened in, not the period the guest got
 * around to complaining in. `received_at` is still what the resolution clock
 * runs from, and what ages open cases.
 *
 * `start` and `end` are calendar dates (YYYY-MM-DD), inclusive, and are read as
 * **Central** dates. SMG stores instants in UTC while fiscal.ts thinks in
 * Central wall-clock, so comparing the two raw would misfile every case between
 * 7pm and midnight Central on a boundary day into the neighbouring period.
 * Postgres does the conversion, which keeps the rule in one place.
 */
export type CaseWindow = {
  /** YYYY-MM-DD, inclusive, Central. */
  start: string;
  /** YYYY-MM-DD, inclusive, Central. */
  end: string;
  /**
   * Which ZCase types to include. Omit or pass an empty list for every type —
   * the tab asks for the two guest-facing ones and leaves the team-member
   * hotline out.
   */
  types?: ZCaseType[];
  /**
   * Store numbers to include. Omit for every store — the tab passes a list when
   * the TN/VA checkboxes narrow it.
   */
  stores?: string[];
};

/** null means "no filter", which the queries read as everything. */
const list = (values?: string[]): string[] | null => (values && values.length ? values : null);
const typeList = (types?: ZCaseType[]): string[] | null => list(types);

/**
 * Resolve time is derived from the timestamps, never from the stored
 * `resolution_hours`. It's spelled out inline in each query rather than shared
 * as a constant because the sql`` tag parameterises interpolations — a string
 * constant would arrive as a bind value, not as SQL.
 *
 * **Per case: `GREATEST(1, CEIL(hours))`** — any part of an hour counts.
 *
 * This is the smg360 **case-detail** rule, chosen deliberately over the one its
 * ZCase *list* uses, because the two screens disagree and HRG treats a started
 * hour as a used hour. Observed on the detail pages: 0.07h and 0.75h read as 1,
 * 4.03h as 5, 16.20h as 17, 29.33h as 30.
 *
 * The list instead prints `GREATEST(1, FLOOR(hours))` — SMG's raw
 * RESOLUTION_TIME field, truncated, floored at 1 — so it shows 4 and 29 for the
 * last two of those. Scored across 16 list rows that rule matched all 16, so
 * the difference is real and consistent, not noise. **Expect our per-case
 * numbers to sit an hour above the ZCase list for anything over 60 minutes.**
 *
 * (Detail is equally consistent with "stored field + 1"; nothing distinguishes
 * that from CEIL without a duration landing on an exact whole hour, which real
 * data never does. CEIL is the saner rule of the two, and GREATEST guards the
 * degenerate zero-length case so nothing ever reads 0 hours.)
 *
 * **The average runs on the unrounded durations**, and only the result is
 * rounded — it is *not* the mean of the per-case values above. Checked against
 * the caselist header over the same 87 cases: SMG prints 11, the mean of exact
 * durations is 11.378, the mean of the ceilings is 11.816, which would print
 * 12. So the average can read an hour below the cases it summarises.
 *
 * The >24hr test uses the displayed per-case value, so the flag always agrees
 * with the number beside it — and since that value rounds up, a case that truly
 * passed 24 hours is always counted.
 */

/**
 * Note there's no `outstanding` here, or on CaseTotals.
 *
 * Everything these two return is scoped to the window; an open-case count
 * isn't. A case that's still open is open regardless of which period you're
 * looking at, and windowing the count means the one case you most need to see
 * disappears the moment its visit date falls out of the selected period — while
 * still showing in the outstanding list, which reads as a bug. Callers pair
 * these with queryOutstanding and count that instead.
 */
export type StoreRollup = {
  store: string | null;
  unitName: string | null;
  cases: number;
  /** Whole hours, rounded up like smg360. Null when nothing resolved yet. */
  avgResolveHours: number | null;
  over24: number;
  over24Pct: number | null;
  escalated: number;
};

/** The store table: one row per store for the selected window. */
export async function rollupByStore(w: CaseWindow): Promise<StoreRollup[]> {
  const types = typeList(w.types);
  const stores = list(w.stores);

  const rows = await sql`
    SELECT
      store,
      MIN(unit_name) AS unit_name,
      COUNT(*)::int AS cases,
      ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 3600)
            FILTER (WHERE resolved_at IS NOT NULL))::int AS avg_resolve_hours,
      COUNT(*) FILTER (
        WHERE resolved_at IS NOT NULL
          AND GREATEST(1, CEIL(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 3600)) > 24
      )::int AS over_24,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
      COUNT(*) FILTER (WHERE escalated)::int AS escalated
    FROM smg_zcases
    WHERE (event_at AT TIME ZONE 'America/Chicago')::date
            BETWEEN ${w.start}::date AND ${w.end}::date
      AND (${types}::text[] IS NULL OR case_type = ANY(${types}::text[]))
      AND (${stores}::text[] IS NULL OR store = ANY(${stores}::text[]))
    GROUP BY store
    ORDER BY cases DESC, store
  `;

  return (rows as Record<string, unknown>[]).map((r) => {
    const resolved = Number(r.resolved);
    const over24 = Number(r.over_24);
    return {
      store: r.store === null ? null : String(r.store),
      unitName: r.unit_name === null ? null : String(r.unit_name),
      cases: Number(r.cases),
      avgResolveHours: r.avg_resolve_hours === null ? null : Number(r.avg_resolve_hours),
      over24,
      // Percentage of *resolved* cases, not of all cases — an outstanding case
      // hasn't had its chance to breach 24 hours yet, so counting it in the
      // denominator would understate the miss rate.
      over24Pct: resolved === 0 ? null : Math.round((over24 / resolved) * 100),
      escalated: Number(r.escalated),
    };
  });
}

export type CaseTotals = {
  cases: number;
  avgResolveHours: number | null;
  over24: number;
  over24Pct: number | null;
  escalated: number;
};

/**
 * Window totals, aggregated in SQL rather than summed from the store rollups.
 *
 * Averaging the per-store averages would weight a store with three cases the
 * same as one with fourteen, and summing them depends on the caller having
 * asked for the detail rows at all. One aggregate over the same window keeps
 * the header tiles honest regardless of what else was queried.
 */
export async function queryTotals(w: CaseWindow): Promise<CaseTotals> {
  const types = typeList(w.types);
  const stores = list(w.stores);

  const rows = (await sql`
    SELECT
      COUNT(*)::int AS cases,
      ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 3600)
            FILTER (WHERE resolved_at IS NOT NULL))::int AS avg_resolve_hours,
      COUNT(*) FILTER (
        WHERE resolved_at IS NOT NULL
          AND GREATEST(1, CEIL(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 3600)) > 24
      )::int AS over_24,
      COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved,
      COUNT(*) FILTER (WHERE escalated)::int AS escalated
    FROM smg_zcases
    WHERE (event_at AT TIME ZONE 'America/Chicago')::date
            BETWEEN ${w.start}::date AND ${w.end}::date
      AND (${types}::text[] IS NULL OR case_type = ANY(${types}::text[]))
      AND (${stores}::text[] IS NULL OR store = ANY(${stores}::text[]))
  `) as Record<string, unknown>[];

  const r = rows[0] ?? {};
  const resolved = Number(r.resolved ?? 0);
  const over24 = Number(r.over_24 ?? 0);

  return {
    cases: Number(r.cases ?? 0),
    avgResolveHours: r.avg_resolve_hours == null ? null : Number(r.avg_resolve_hours),
    over24,
    over24Pct: resolved === 0 ? null : Math.round((over24 / resolved) * 100),
    escalated: Number(r.escalated ?? 0),
  };
}

export type StoredZCase = {
  caseKey: string;
  displayKey: string;
  store: string | null;
  unitName: string | null;
  type: string | null;
  receivedAt: string | null;
  eventAt: string | null;
  resolvedAt: string | null;
  /** Whole hours to resolve, rounded up like smg360. Null while outstanding. */
  resolutionHours: number | null;
  escalated: boolean;
  /** Whole hours open, computed now. Null once resolved. */
  openHours: number | null;
};

const toStored = (r: Record<string, unknown>): StoredZCase => ({
  caseKey: String(r.case_key),
  displayKey: String(r.display_key),
  store: r.store === null ? null : String(r.store),
  unitName: r.unit_name === null ? null : String(r.unit_name),
  type: r.case_type === null ? null : String(r.case_type),
  receivedAt: r.received_at === null ? null : String(r.received_at),
  eventAt: r.event_at === null ? null : String(r.event_at),
  resolvedAt: r.resolved_at === null ? null : String(r.resolved_at),
  resolutionHours: r.resolution_hours === null ? null : Number(r.resolution_hours),
  escalated: Boolean(r.escalated),
  openHours: r.open_hours === null || r.open_hours === undefined ? null : Number(r.open_hours),
});

/** Individual cases — drives the expandable store rows. */
export async function queryZCases(w: CaseWindow): Promise<StoredZCase[]> {
  const types = typeList(w.types);
  const stores = list(w.stores);

  const rows = await sql`
    SELECT case_key, display_key, store, unit_name, case_type, received_at, event_at,
           resolved_at, escalated,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (resolved_at - received_at)) / 3600)) AS resolution_hours,
           CASE WHEN resolved_at IS NULL
                THEN GREATEST(1, CEIL(EXTRACT(EPOCH FROM (now() - received_at)) / 3600))
           END AS open_hours
    FROM smg_zcases
    WHERE (event_at AT TIME ZONE 'America/Chicago')::date
            BETWEEN ${w.start}::date AND ${w.end}::date
      AND (${types}::text[] IS NULL OR case_type = ANY(${types}::text[]))
      AND (${stores}::text[] IS NULL OR store = ANY(${stores}::text[]))
    ORDER BY event_at DESC
  `;
  return (rows as Record<string, unknown>[]).map(toStored);
}

/**
 * Open cases, oldest first.
 *
 * Deliberately ignores the timeframe filter: a case that's still open is open
 * regardless of which period you happen to be looking at, and an open case
 * ageing out of the selected window is exactly the one you'd least want hidden.
 */
export async function queryOutstanding(
  types?: ZCaseType[],
  storeKeys?: string[],
): Promise<StoredZCase[]> {
  const t = typeList(types);
  // The store filter *does* apply here, unlike the window: hiding TN should
  // hide TN's open cases too, or the tile and the list stop describing the
  // same set of restaurants.
  const stores = list(storeKeys);

  const rows = await sql`
    SELECT case_key, display_key, store, unit_name, case_type, received_at, event_at,
           resolved_at, escalated,
           NULL::numeric AS resolution_hours,
           GREATEST(1, CEIL(EXTRACT(EPOCH FROM (now() - received_at)) / 3600)) AS open_hours
    FROM smg_zcases
    WHERE resolved_at IS NULL
      AND (${t}::text[] IS NULL OR case_type = ANY(${t}::text[]))
      AND (${stores}::text[] IS NULL OR store = ANY(${stores}::text[]))
    ORDER BY received_at ASC
  `;
  return (rows as Record<string, unknown>[]).map(toStored);
}

/**
 * Narrows a list of case keys to the ones that are open right now.
 *
 * Guards the detail route: descriptions are fetched live and never stored, and
 * they're only meant to be readable while a case still needs working. Doing the
 * check here rather than trusting the caller means the route can't be turned
 * into a way to read back the text of every case SMG has ever raised.
 */
export async function filterOutstandingKeys(caseKeys: string[]): Promise<string[]> {
  if (caseKeys.length === 0) return [];

  const rows = (await sql`
    SELECT case_key
    FROM smg_zcases
    WHERE resolved_at IS NULL
      AND case_key = ANY(${caseKeys}::text[])
  `) as { case_key: string }[];

  return rows.map((r) => String(r.case_key));
}

/** When the data was last refreshed — feeds the "updated N min ago" label. */
export async function lastSyncedAt(): Promise<string | null> {
  const rows = (await sql`SELECT MAX(synced_at) AS at FROM smg_zcases`) as { at: string | null }[];
  return rows[0]?.at ?? null;
}
