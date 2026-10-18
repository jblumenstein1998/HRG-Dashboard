/**
 * When each store opens and closes — from its Google listing.
 *
 * PAR's own Business Hours setting turned out to be stale: five stores were
 * set to close at 7pm every day while their last clock-outs ran to midnight,
 * which turned every evening into "labor after close". The Google listing is
 * what customers are shown and is kept current for that reason, so it is the
 * source here, refreshed daily (/api/cron/store-hours), with PAR's setting as
 * the last fallback for a store Google has nothing for.
 *
 * What counts as open: the store's main hours and its drive-thru hours,
 * whichever opens earlier and closes later — labor after the lobby shuts but
 * while the window is still serving is not labor after close.
 *
 * Two kinds of row (scripts/migrate-store-hours.mjs):
 *   store_hours_weekly  the regular week, the fallback for any date
 *   store_hours_daily   the actual hours of the coming seven dates, holidays
 *                       and one-off changes included; each refresh writes the
 *                       week ahead, so past dates keep the hours they had
 */

import { sql } from "./db";
import { GOOGLE_PLACE_IDS } from "./bonus/storeMap";
import { getBusinessHours } from "./par";

/** Hours for one day, as minutes after local midnight; a close past midnight is > 1440. */
export type DayHours = { openMinutes: number; closeMinutes: number; source: "google" | "google-weekly" | "par" };

type GTime = { day?: number; hour?: number; minute?: number; date?: { year: number; month: number; day: number } };
type GPeriod = { open?: GTime; close?: GTime };
type GHours = { periods?: GPeriod[]; specialDays?: { date?: { year: number; month: number; day: number } }[] };
type GSecondary = GHours & { secondaryHoursType?: string };
type GPlace = {
  regularOpeningHours?: GHours;
  currentOpeningHours?: GHours;
  regularSecondaryOpeningHours?: GSecondary[];
  currentSecondaryOpeningHours?: GSecondary[];
};

const iso = (d: { year: number; month: number; day: number }) =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/**
 * A period as open/close minutes from the open day's midnight. A close on a
 * later day (or date) is pushed past 1440; a period with no close is open
 * around the clock, counted as 24 hours from the open.
 */
function span(p: GPeriod): { open: number; close: number } | null {
  if (!p.open) return null;
  const open = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
  if (!p.close) return { open, close: open + 1440 };
  let close = (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0);
  const nextDay = p.close.date && p.open.date
    ? iso(p.close.date) > iso(p.open.date)
    : (p.close.day ?? 0) !== (p.open.day ?? 0);
  if (nextDay || close <= open) close += 1440;
  return { open, close };
}

/** Widen `acc` to cover `s`: the earliest open and the latest close win. */
function widen(acc: { open: number; close: number } | undefined, s: { open: number; close: number }) {
  return acc ? { open: Math.min(acc.open, s.open), close: Math.max(acc.close, s.close) } : s;
}

/** The main hours plus any drive-thru hours, from one family of Google fields. */
function withDriveThru(main: GHours | undefined, secondary: GSecondary[] | undefined): GPeriod[] {
  const drive = (secondary ?? []).filter((s) => s.secondaryHoursType === "DRIVE_THROUGH");
  return [...(main?.periods ?? []), ...drive.flatMap((s) => s.periods ?? [])];
}

async function fetchPlace(placeId: string): Promise<GPlace> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error("GOOGLE_PLACES_API_KEY is not set");
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}`, {
    headers: {
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask":
        "regularOpeningHours,currentOpeningHours,regularSecondaryOpeningHours,currentSecondaryOpeningHours",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`Google Places ${res.status}: ${json?.error?.message ?? "request failed"}`);
  return json as GPlace;
}

export type StoreHoursSync = { storeId: string; ok: boolean; weekDays: number; dates: number; error?: string };

/** Re-read every store's listing and store its regular week and coming dates. */
export async function syncStoreHours(): Promise<StoreHoursSync[]> {
  return Promise.all(
    Object.entries(GOOGLE_PLACE_IDS).map(async ([storeId, placeId]): Promise<StoreHoursSync> => {
      try {
        const place = await fetchPlace(placeId);

        const weekly = new Map<number, { open: number; close: number }>();
        for (const p of withDriveThru(place.regularOpeningHours, place.regularSecondaryOpeningHours)) {
          const s = span(p);
          if (s && p.open?.day !== undefined) weekly.set(p.open.day, widen(weekly.get(p.open.day), s));
        }

        const dated = new Map<string, { open: number; close: number }>();
        for (const p of withDriveThru(place.currentOpeningHours, place.currentSecondaryOpeningHours)) {
          const s = span(p);
          if (s && p.open?.date) dated.set(iso(p.open.date), widen(dated.get(iso(p.open.date)), s));
        }
        // A special day with no hours at all is a closure (a holiday).
        const closedDates = (place.currentOpeningHours?.specialDays ?? [])
          .map((d) => (d.date ? iso(d.date) : null))
          .filter((d): d is string => d !== null && !dated.has(d));

        const days = [...weekly.entries()];
        const dates = [...dated.entries()];
        await sql.transaction([
          sql`DELETE FROM store_hours_weekly WHERE store_id = ${storeId}`,
          sql`
            INSERT INTO store_hours_weekly (store_id, day_of_week, open_minutes, close_minutes, fetched_at)
            SELECT ${storeId}, * , now() FROM UNNEST(
              ${days.map(([d]) => d)}::int[], ${days.map(([, s]) => s.open)}::int[], ${days.map(([, s]) => s.close)}::int[]
            )
          `,
          sql`
            INSERT INTO store_hours_daily (store_id, business_date, open_minutes, close_minutes, closed, fetched_at)
            SELECT ${storeId}, d::date, o, c, false, now() FROM UNNEST(
              ${dates.map(([d]) => d)}::text[], ${dates.map(([, s]) => s.open)}::int[], ${dates.map(([, s]) => s.close)}::int[]
            ) AS t(d, o, c)
            ON CONFLICT (store_id, business_date) DO UPDATE SET
              open_minutes = EXCLUDED.open_minutes, close_minutes = EXCLUDED.close_minutes,
              closed = false, fetched_at = now()
          `,
          sql`
            INSERT INTO store_hours_daily (store_id, business_date, open_minutes, close_minutes, closed, fetched_at)
            SELECT ${storeId}, d::date, NULL, NULL, true, now() FROM UNNEST(${closedDates}::text[]) AS t(d)
            ON CONFLICT (store_id, business_date) DO UPDATE SET
              open_minutes = NULL, close_minutes = NULL, closed = true, fetched_at = now()
          `,
        ]);
        return { storeId, ok: true, weekDays: days.length, dates: dates.length + closedDates.length };
      } catch (err) {
        return { storeId, ok: false, weekDays: 0, dates: 0, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );
}

/**
 * One store's hours for each of `dates` ("YYYY-MM-DD", local): the dated
 * Google row where there is one, else Google's regular week, else PAR's
 * Business Hours. Null for a date the store was closed (a holiday).
 */
export async function storeHoursFor(storeId: string, dates: string[]): Promise<Map<string, DayHours | null>> {
  const [daily, weekly] = await Promise.all([
    sql`
      SELECT business_date::text AS d, open_minutes, close_minutes, closed FROM store_hours_daily
      WHERE store_id = ${storeId} AND business_date = ANY(${dates}::date[])
    `.catch(() => []),
    sql`SELECT day_of_week, open_minutes, close_minutes FROM store_hours_weekly WHERE store_id = ${storeId}`.catch(() => []),
  ]);
  const byDate = new Map(daily.map((r) => [r.d as string, r]));
  const byDow = new Map(weekly.map((r) => [r.day_of_week as number, r]));
  const par = byDow.size ? null : await getBusinessHours(storeId).catch(() => []);
  const parByDow = new Map((par ?? []).map((h) => [h.dayOfWeek, h]));

  const out = new Map<string, DayHours | null>();
  for (const date of dates) {
    const d = byDate.get(date);
    if (d?.closed) { out.set(date, null); continue; }
    if (d) { out.set(date, { openMinutes: d.open_minutes, closeMinutes: d.close_minutes, source: "google" }); continue; }
    const [y, m, day] = date.split("-").map(Number);
    const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    const w = byDow.get(dow);
    if (w) { out.set(date, { openMinutes: w.open_minutes, closeMinutes: w.close_minutes, source: "google-weekly" }); continue; }
    // Google has this store's week but no hours on this weekday: closed.
    if (byDow.size) { out.set(date, null); continue; }
    const p = parByDow.get(dow);
    out.set(date, p ? { openMinutes: p.openMinutes, closeMinutes: p.closeMinutes, source: "par" } : null);
  }
  return out;
}
