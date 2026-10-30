import { sql } from "@/lib/db";
import { businessDateISO } from "@/lib/businessDay";

/**
 * Finished days from PAR and Jolt, kept in Postgres so every screen reads one
 * copy (Josh, 2026-10-30: a Slack accuracy check must never disagree with a
 * tab). Database first; a day that isn't here yet, or isn't final yet, comes
 * from the source and is saved for the next reader.
 *
 * Today is never stored — it's still moving, and its readers go live.
 *
 * A day is final at 12:00 UTC (7 AM Central) the next day: past PAR's 2:15 AM
 * end of day, plus the hours BerryAI and Jolt take to catch up. A copy fetched
 * before then refreshes after FRESH_MS, so a day read at 3 AM doesn't stick.
 */

export type CacheSource = "par_hourly" | "par_cash" | "jolt_store_lists";

const FRESH_MS = 5 * 60_000;

/** How long a day stays here. Slack keeps 90 days, and the checks are the reason for storing. */
export const KEEP_DAYS = 120;

let ready: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  ready ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS source_cache (
        source     text        NOT NULL,
        key        text        NOT NULL,
        last_date  date        NOT NULL,
        payload    jsonb       NOT NULL,
        fetched_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (source, key)
      )
    `;
  })().catch((err) => {
    ready = null;
    throw err;
  });
  return ready;
}

/** The moment a day's numbers stop changing: 12:00 UTC the day after. */
export function finalAfter(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1, 12);
}

/** True for a day before today's business date — one that may be stored. */
export function isPastDay(day: string): boolean {
  return day < businessDateISO();
}

/** A stored copy that can be served without going back to the source. */
function usable(lastDate: string, fetchedAt: Date): boolean {
  return fetchedAt.getTime() >= finalAfter(lastDate) || Date.now() - fetchedAt.getTime() < FRESH_MS;
}

const isoDate = (v: string | Date) => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));

/**
 * The stored copy if it's usable, else `fetch` — saved before it's returned.
 * `lastDate` is the last business date the payload covers; a range that
 * includes today skips storage entirely.
 */
export async function readThrough<T>(
  source: CacheSource,
  key: string,
  lastDate: string,
  fetch: () => Promise<T>,
  opts: { bust?: boolean } = {},
): Promise<T> {
  if (!isPastDay(lastDate)) return fetch();
  await ensureTable();
  if (!opts.bust) {
    const rows = (await sql`
      SELECT payload, fetched_at FROM source_cache WHERE source = ${source} AND key = ${key}
    `) as { payload: T; fetched_at: string }[];
    if (rows[0] && usable(lastDate, new Date(rows[0].fetched_at))) return rows[0].payload;
  }
  const value = await fetch();
  await sql`
    INSERT INTO source_cache (source, key, last_date, payload, fetched_at)
    VALUES (${source}, ${key}, ${lastDate}, ${JSON.stringify(value)}, now())
    ON CONFLICT (source, key)
    DO UPDATE SET last_date = EXCLUDED.last_date, payload = EXCLUDED.payload, fetched_at = now()
  `;
  return value;
}

/**
 * Many stored copies in one query, for a screen that needs a whole range.
 * Returns only usable copies; the caller sends the rest through readThrough.
 */
export async function readMany(
  source: CacheSource,
  keys: string[],
): Promise<Map<string, unknown>> {
  if (keys.length === 0) return new Map();
  await ensureTable();
  const rows = (await sql`
    SELECT key, last_date, fetched_at, payload FROM source_cache
    WHERE source = ${source} AND key = ANY(${keys}::text[])
  `) as { key: string; last_date: string | Date; fetched_at: string; payload: unknown }[];
  return new Map(rows.filter((r) => usable(isoDate(r.last_date), new Date(r.fetched_at))).map((r) => [r.key, r.payload]));
}

/**
 * readMany, but picking parts of each payload in the database (name → jsonpath,
 * each giving an array), so a large payload isn't shipped whole when one
 * figure per store is wanted.
 */
export async function readManyPaths(
  source: CacheSource,
  keys: string[],
  paths: Record<string, string>,
): Promise<Map<string, Record<string, unknown[]>>> {
  if (keys.length === 0) return new Map();
  await ensureTable();
  const names = Object.keys(paths);
  const exprs = names.map((n) => paths[n]);
  const rows = (await sql`
    SELECT key, last_date, fetched_at,
      (SELECT jsonb_agg(jsonb_path_query_array(payload, p::jsonpath) ORDER BY i)
         FROM unnest(${exprs}::text[]) WITH ORDINALITY AS t(p, i)) AS picked
    FROM source_cache
    WHERE source = ${source} AND key = ANY(${keys}::text[])
  `) as { key: string; last_date: string | Date; fetched_at: string; picked: unknown[][] }[];
  const out = new Map<string, Record<string, unknown[]>>();
  for (const r of rows) {
    if (!usable(isoDate(r.last_date), new Date(r.fetched_at))) continue;
    out.set(r.key, Object.fromEntries(names.map((n, i) => [n, r.picked[i] ?? []])));
  }
  return out;
}

/** Drops days older than `before`. Returns how many went. */
export async function pruneSourceCache(before: string): Promise<number> {
  await ensureTable();
  const rows = (await sql`DELETE FROM source_cache WHERE last_date < ${before} RETURNING 1`) as unknown[];
  return rows.length;
}
