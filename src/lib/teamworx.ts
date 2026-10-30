/**
 * Teamworx — CrunchTime's labor scheduling (zaxbys.ct-teamworx.com): each
 * store's daily sales forecast and its week's scheduled hours.
 *
 * No credentials of its own. Teamworx is reached by single sign-on from a
 * Net-Chef login (NETCHEF_USERNAME), the way Net-Chef's app switcher opens it:
 * GET /ctsso/send.ct?sso-target-app=teamworx with the Net-Chef cookies, then
 * follow the redirects by hand, collecting the Teamworx cookies on the way.
 *
 * The session answers for whichever store the Net-Chef login chose — the
 * daily metrics call ignores the laborScheduleId it is given and returns the
 * current store's forecast (Brentwood's id returned Hillcrest's numbers). So
 * every store gets its own login. Teamworx location ids are Net-Chef's.
 *
 * Synced nightly (/api/cron/teamworx) into Postgres
 * (scripts/migrate-teamworx.mjs), so the Staffing tab never waits on
 * CrunchTime:
 *   teamworx_forecast_daily     forecast sales/guests/checks per store and date
 *   teamworx_schedule_weekly    the week's forecast, scheduled hours and labor
 *                               dollars, and the schedule's status
 *
 * Daily scheduled hours are not available: for this login every per-day
 * scheduled-hours field comes back 0 (the schedule page loads its shifts
 * through a call not yet decoded), though the weekly total is right.
 */

import { sql } from "./db";
import { BONUS_STORES, type BonusStore } from "./bonus/storeMap";
import { cookiesFromHeaders, mergeCookies, ncLoginCookies } from "./netchef";
import { addDays } from "./slackReports";
import { mapLimit } from "./slackCompletion";

const NC_BASE = "https://zaxbys.net-chef.com";
const TW_BASE = "https://zaxbys.ct-teamworx.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

async function teamworxSession(netchefLocationId: number): Promise<string> {
  let cookies = await ncLoginCookies(netchefLocationId);
  let url = `${NC_BASE}/ctsso/send.ct?sso-target-app=teamworx`;
  for (let hop = 0; hop < 8; hop++) {
    const res = await fetch(url, { headers: { Cookie: cookies, "User-Agent": UA }, redirect: "manual" });
    cookies = mergeCookies(cookies, cookiesFromHeaders(res.headers));
    const next = res.headers.get("location");
    if (!next) break;
    url = new URL(next, url).href;
  }
  if (!/TSID/.test(cookies)) throw new Error("Teamworx sign-on did not return a session");
  return cookies;
}

async function twPost<T>(cookies: string, path: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(`${TW_BASE}${path}`, {
    method: "POST",
    headers: {
      Cookie: cookies,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Origin: TW_BASE,
      "User-Agent": UA,
    },
    body: new URLSearchParams(form),
  });
  if (!res.ok) throw new Error(`Teamworx ${res.status} at ${path}`);
  return (await res.json()) as T;
}

type OverviewSchedule = {
  id: number | null;
  locationId: string;
  status: string | null;
  salesForecast: number | null;
  scheduledHours: number | null;
  scheduledValue: number | null;
};
type ForecastDay = { date: string; totalSales: number | null; totalGuests: number | null; totalChecks: number | null };

export type TeamworxWeek = {
  storeId: string;
  weekEnding: string;
  laborScheduleId: number | null;
  status: string | null;
  salesForecast: number | null;
  scheduledHours: number | null;
  scheduledValue: number | null;
  days: { date: string; sales: number | null; guests: number | null; checks: number | null }[];
};

/** The Sunday that ends the Monday–Sunday week holding `iso`. */
export function weekEndingOf(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(iso, (7 - dow) % 7);
}

/** One store's week from Teamworx. A week whose schedule isn't started comes back with no days. */
export async function fetchTeamworxWeek(store: BonusStore, weekEnding: string): Promise<TeamworxWeek> {
  const cookies = await teamworxSession(store.netchefLocationId);
  const overview = await twPost<{ data?: { laborSchedules?: OverviewSchedule[] } }>(
    cookies, "/json/n/scheduleOverview/getScheduleOverviewPageData", { weekEndingDate: weekEnding },
  );
  const sched = overview.data?.laborSchedules?.find((s) => Number(s.locationId) === store.netchefLocationId) ?? null;
  const week: TeamworxWeek = {
    storeId: store.storeId,
    weekEnding,
    laborScheduleId: sched?.id ?? null,
    status: sched?.status ?? null,
    salesForecast: sched?.salesForecast ?? null,
    scheduledHours: sched?.scheduledHours ?? null,
    scheduledValue: sched?.scheduledValue ?? null,
    days: [],
  };
  // A "Not Started" week has a forecast but no schedule id yet, and the daily
  // call is a 400 without one.
  if (!sched?.id) return week;

  const dates = Array.from({ length: 7 }, (_, i) => addDays(weekEnding, i - 6));
  const metrics = await twPost<{ data?: { weeklyForecast?: { salesForecastDays?: ForecastDay[] } } }>(
    cookies, "/json/mn/laborSchedule/getWbWeeklyShiftMetrics",
    // laborDateString is required — without it the call is a 400.
    { laborScheduleId: String(sched.id), weekEndingDate: weekEnding, laborDateString: JSON.stringify(dates) },
  );
  week.days = (metrics.data?.weeklyForecast?.salesForecastDays ?? [])
    .filter((d) => dates.includes(d.date))
    .map((d) => ({ date: d.date, sales: d.totalSales ?? null, guests: d.totalGuests ?? null, checks: d.totalChecks ?? null }));
  return week;
}

export type TeamworxSyncResult = { storeId: string; weekEnding: string; ok: boolean; days: number; error?: string };

/**
 * Pulls the given weeks for every store and writes them. Each run overwrites
 * the weeks it pulls, so a forecast changed in CrunchTime is picked up; past
 * weeks that are no longer pulled keep the last forecast they had.
 */
export async function syncTeamworx(weekEndings: string[]): Promise<TeamworxSyncResult[]> {
  const jobs = BONUS_STORES.flatMap((store) => weekEndings.map((weekEnding) => ({ store, weekEnding })));
  // Each job is a fresh Net-Chef login; a few at a time.
  return mapLimit(jobs, 3, async ({ store, weekEnding }): Promise<TeamworxSyncResult> => {
    try {
      const w = await fetchTeamworxWeek(store, weekEnding);
      await sql`
        INSERT INTO teamworx_schedule_weekly
          (store_id, week_ending, labor_schedule_id, status, sales_forecast, scheduled_hours, scheduled_value, fetched_at)
        VALUES (${w.storeId}, ${w.weekEnding}, ${w.laborScheduleId}, ${w.status}, ${w.salesForecast},
                ${w.scheduledHours}, ${w.scheduledValue}, now())
        ON CONFLICT (store_id, week_ending) DO UPDATE SET
          labor_schedule_id = EXCLUDED.labor_schedule_id, status = EXCLUDED.status,
          sales_forecast = EXCLUDED.sales_forecast, scheduled_hours = EXCLUDED.scheduled_hours,
          scheduled_value = EXCLUDED.scheduled_value, fetched_at = now()
      `;
      for (const d of w.days) {
        await sql`
          INSERT INTO teamworx_forecast_daily (store_id, business_date, forecast_sales, forecast_guests, forecast_checks, fetched_at)
          VALUES (${w.storeId}, ${d.date}, ${d.sales}, ${d.guests}, ${d.checks}, now())
          ON CONFLICT (store_id, business_date) DO UPDATE SET
            forecast_sales = EXCLUDED.forecast_sales, forecast_guests = EXCLUDED.forecast_guests,
            forecast_checks = EXCLUDED.forecast_checks, fetched_at = now()
        `;
      }
      return { storeId: store.storeId, weekEnding, ok: true, days: w.days.length };
    } catch (err) {
      return { storeId: store.storeId, weekEnding, ok: false, days: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** Stored forecast sales per store for the given dates: storeId → date → dollars. */
export async function getForecastSales(dates: string[]): Promise<Map<string, Map<string, number>>> {
  const rows = (await sql`
    SELECT store_id, to_char(business_date, 'YYYY-MM-DD') AS date, forecast_sales
    FROM teamworx_forecast_daily
    WHERE business_date = ANY(${dates}::date[]) AND forecast_sales IS NOT NULL
  `) as { store_id: string; date: string; forecast_sales: string | number }[];
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!out.has(r.store_id)) out.set(r.store_id, new Map());
    out.get(r.store_id)!.set(r.date, Number(r.forecast_sales));
  }
  return out;
}
