/**
 * Each store's Google star rating and review count, for the SMG tab.
 *
 * Google only ever answers "what is it now": the rating is the lifetime
 * average and the count the lifetime total, with no history behind either. So
 * the daily cron (/api/cron/google-ratings) writes one row per store per day,
 * and anything over a window — reviews gained, how far the rating moved — is
 * the difference between two of those rows. History starts the day the cron
 * first ran; a window that begins earlier has no baseline and shows blank.
 *
 * Same listings and API key as lib/storeHours.ts (GOOGLE_PLACE_IDS).
 *
 * Table google_ratings (scripts/migrate-google-ratings.mjs).
 */

import { sql } from "./db";
import { GOOGLE_PLACE_IDS } from "./bonus/storeMap";

type GPlace = {
  rating?: number;
  userRatingCount?: number;
  googleMapsLinks?: { reviewsUri?: string };
};

async function fetchRating(placeId: string): Promise<GPlace> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "rating,userRatingCount,googleMapsLinks",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${json?.error?.message ?? "request failed"}`);
  return json as GPlace;
}

export type GoogleRatingSync = { storeId: string; ok: boolean; rating?: number; reviews?: number; error?: string };

/**
 * Record today's rating for every store.
 *
 * The first read of a day is the one kept (ON CONFLICT DO NOTHING), so each
 * row is an early-morning reading and a window boundary means the same thing
 * every day. A later re-run the same day changes nothing.
 */
export async function syncGoogleRatings(): Promise<GoogleRatingSync[]> {
  return Promise.all(
    Object.entries(GOOGLE_PLACE_IDS).map(async ([storeId, placeId]): Promise<GoogleRatingSync> => {
      try {
        const place = await fetchRating(placeId);
        if (place.rating == null || place.userRatingCount == null) throw new Error("listing has no rating");
        await sql`
          INSERT INTO google_ratings (store_id, as_of, rating, review_count, reviews_uri, fetched_at)
          VALUES (
            ${storeId}, (now() AT TIME ZONE 'America/New_York')::date,
            ${place.rating}, ${place.userRatingCount}, ${place.googleMapsLinks?.reviewsUri ?? null}, now()
          )
          ON CONFLICT (store_id, as_of) DO NOTHING
        `;
        return { storeId, ok: true, rating: place.rating, reviews: place.userRatingCount };
      } catch (err) {
        return { storeId, ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

export type RatingReading = { rating: number; reviews: number; asOf: string };

export type StoreGoogleRating = {
  storeId: string;
  reviewsUri: string | null;
  /** The newest reading. */
  current: RatingReading;
  /** The reading at the start of the window, or null when history doesn't reach back that far. */
  windowStart: RatingReading | null;
  /** The reading at the end of the window (the morning after its last day, or the newest before that). */
  windowEnd: RatingReading | null;
};

const toReading = (r: Record<string, unknown>): RatingReading => ({
  rating: Number(r.rating),
  reviews: Number(r.review_count),
  asOf: String(r.as_of),
});

/**
 * Every store's rating now, plus its readings at either end of `start`–`end`
 * ("YYYY-MM-DD", both inclusive). Readings are taken each morning, so the
 * window opens on `start`'s reading and closes on the next day's.
 */
export async function googleRatingsFor(start: string | null, end: string | null) {
  const [latest, atStart, atEnd, first] = await Promise.all([
    sql`
      SELECT DISTINCT ON (store_id) store_id, as_of::text, rating, review_count, reviews_uri
      FROM google_ratings ORDER BY store_id, as_of DESC
    `,
    start
      ? sql`
          SELECT DISTINCT ON (store_id) store_id, as_of::text, rating, review_count
          FROM google_ratings WHERE as_of <= ${start}::date ORDER BY store_id, as_of DESC
        `
      : Promise.resolve([]),
    end
      ? sql`
          SELECT DISTINCT ON (store_id) store_id, as_of::text, rating, review_count
          FROM google_ratings WHERE as_of <= ${end}::date + 1 ORDER BY store_id, as_of DESC
        `
      : Promise.resolve([]),
    sql`SELECT min(as_of)::text AS d FROM google_ratings`,
  ]);

  const startBy = new Map(atStart.map((r) => [r.store_id as string, toReading(r)]));
  const endBy = new Map(atEnd.map((r) => [r.store_id as string, toReading(r)]));

  const stores: StoreGoogleRating[] = latest.map((r) => ({
    storeId: r.store_id as string,
    reviewsUri: (r.reviews_uri as string | null) ?? null,
    current: toReading(r),
    windowStart: startBy.get(r.store_id as string) ?? null,
    windowEnd: endBy.get(r.store_id as string) ?? null,
  }));
  return { historyFrom: (first[0]?.d as string | null) ?? null, stores };
}
