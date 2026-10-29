/**
 * Are the numbers in a store's Slack reports right?
 *
 * Every "actual" here comes from the same function the dashboard's own tab
 * uses for that number (Josh, 2026-10-29: no discrepancies between tabs), so a
 * report flagged wrong here is wrong on the PAR or Drive-Thru tab too:
 *
 *   net sales, avg check, TPLH, productivity (day)  getTotalsForRange       — PAR tab
 *   comp %                                         same, vs getPriorYearRange — PAR tab comps
 *   hourly sales; shift sales / labor              getHourlyBreakdown      — PAR tab hourly
 *   total window, total lane                       getDriveThruMetrics     — Drive-Thru tab
 *                                                  (whole day, or the 11–2 / 2–5 / 5–8 daypart)
 *   Jolt %                                         fetchCompletionByLocation — Jolt tab
 *   cash over/short                                getCashSummary (PAR GetTills; no tab yet)
 *
 * The Jolt tab deliberately windows completion differently from Jolt's own app
 * (3 AM business day), so a store copying the app's figure can miss here.
 *
 * Shift reports carry the day's numbers so far, as of the end of their window:
 * a 5:30 report's net sales is everything since open through 5 PM, not just
 * 2–5. Hourly sales and lane time are the window's own.
 */

import { getHourlyBreakdown, getTotalsForRange, type HourBucket } from "./parRollup";
import { getCashSummary } from "./par";
import { getPriorYearRange } from "./fiscal";
import { getDriveThruMetrics, isClosedRange, type DriveThruPayload } from "./berryData";
import { loginBerryService } from "./berryAuth";
import { resolveSupersetTimeRange } from "./tools/dateRange";
import { fetchCompletionByLocation } from "./jolt";
import { BONUS_STORES, SLACK_CHANNEL_IDS, storeTimeZone, type BonusStore } from "./bonus/storeMap";
import { parseReportFields, type ReportFields } from "./slackFields";
import {
  addDays, fetchChannelHistory, localMidnight, placeMessage, type SlackMessage, type SlackSlot,
} from "./slackReports";
import { labelled, mapLimit, STORE_CONCURRENCY } from "./slackCompletion";
import { saveChecks } from "./slackAccuracyStore";

export type FieldKey =
  | "netSales" | "compPct" | "splh" | "tplh" | "avgCheck"
  | "windowSecs" | "laneSecs" | "joltPct" | "cashOverShort"
  | "hour11" | "hour12" | "hour13" | "hour14" | "hour15" | "hour16" | "hour17" | "hour18" | "hour19";

export type FieldCheck = {
  key: FieldKey;
  label: string;
  unit: "$" | "%" | "secs" | "num";
  posted: number;
  /** null when the system had nothing to compare against. */
  actual: number | null;
  /** null = couldn't check. */
  ok: boolean | null;
  /** In the field's own unit: the absolute allowance actually applied. */
  tolerance: number;
  /** Context shown beside the check, e.g. a till closed without a count. */
  note?: string;
};

export type ReportCheck = {
  /** The day and report this message was read as (see placeMessage). */
  date: string;
  slot: SlackSlot;
  /** Every checked field within tolerance; null when nothing could be checked. */
  accurate: boolean | null;
  checks: FieldCheck[];
};

/**
 * How close counts as right. Proposed to Josh 2026-10-29 and adopted while he
 * hadn't chosen: dollars within $1 (some stores round sales to the dollar),
 * TPLH 0.1, productivity $0.50, comp half a point, drive-thru times 5 seconds,
 * Jolt a point.
 */
export const TOLERANCE: Record<string, number> = {
  netSales: 1, avgCheck: 1, cashOverShort: 1, hour: 1,
  tplh: 0.1, splh: 0.5, compPct: 0.5, windowSecs: 5, laneSecs: 5, joltPct: 1,
};

/**
 * A shift report's running totals (net sales, productivity, TPLH) are read off
 * a live screen at some moment around the window's end, so they move minute by
 * minute: across a week of reports the median miss was 2.5% even where every
 * hourly bucket matched to the cent. These get 5% instead of the fixed
 * allowance. The hourly buckets, avg check and lane stay strict.
 */
export const SHIFT_RUNNING_PCT = 5;

const SHIFT_WINDOW: Record<Exclude<SlackSlot, "previous_day">, { startHour: number; endHour: number; daypart: number }> = {
  lunch: { startHour: 11, endHour: 14, daypart: 2 },
  midday: { startHour: 14, endHour: 17, daypart: 3 },
  dinner: { startHour: 17, endHour: 20, daypart: 4 },
};

function clockSecs(v: string | null | undefined): number | null {
  if (!v) return null;
  const m = String(v).match(/(\d+):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── BerryAI, shared across stores ───────────────────────────────────────────
// One login and one fetch per day for every store, not one per store: BerryAI
// answered thirteen simultaneous logins with "Invalid credentials" for most of
// them (2026-10-29), and the day's payload is the same for all stores anyway.

const BERRY_LOGIN_TTL_MS = 20 * 60_000;
const BERRY_DAY_TTL_MS = 5 * 60_000;
let berryLogin: { token: Promise<string>; at: number } | null = null;
const berryDays = new Map<string, { payload: Promise<DriveThruPayload>; at: number }>();

function sharedBerryToken(): Promise<string> {
  if (!berryLogin || Date.now() - berryLogin.at > BERRY_LOGIN_TTL_MS) {
    const token = loginBerryService();
    berryLogin = { token, at: Date.now() };
    token.catch(() => {
      if (berryLogin?.token === token) berryLogin = null;
    });
  }
  return berryLogin.token;
}

async function driveThruDay(day: string): Promise<DriveThruPayload | null> {
  const range = resolveSupersetTimeRange({ startDate: day, endDate: day });
  if ("error" in range) return null;
  const cached = berryDays.get(day);
  if (cached && Date.now() - cached.at < BERRY_DAY_TTL_MS) return cached.payload;
  const payload = (async () => {
    const token = await sharedBerryToken();
    return getDriveThruMetrics(token, range.timeRange, range.label, { bust: !isClosedRange(range.timeRange) });
  })();
  berryDays.set(day, { payload, at: Date.now() });
  payload.catch(() => {
    if (berryDays.get(day)?.payload === payload) berryDays.delete(day);
  });
  return payload;
}

function check(
  out: FieldCheck[], key: FieldKey, label: string, unit: FieldCheck["unit"],
  posted: number | null, actual: number | null, tolerance: number,
  opts: { pct?: number; note?: string } = {},
) {
  if (posted === null) return;
  const a = actual === null ? null : unit === "secs" ? Math.round(actual) : round2(actual);
  const allowed = opts.pct && a !== null ? round2((Math.abs(a) * opts.pct) / 100) : tolerance;
  out.push({
    key, label, unit, posted, actual: a, tolerance: allowed,
    ok: a === null ? null : Math.abs(posted - a) <= allowed + 1e-9,
    ...(opts.note ? { note: opts.note } : {}),
  });
}

/**
 * Check one store's reports. Returns a check per message ts, for messages that
 * are reports dated within [start, end].
 *
 * Each day in the range costs a PAR orders pull (14 cold days took 72s), so
 * this runs nightly for the days just gone (runNightlyChecks, stored in
 * slack_report_checks) and live only for today.
 *
 * `strict` is for those stored checks: a source that still fails after its
 * retries throws, so the store's day is reported failed and left to re-run
 * instead of being saved with "couldn't check" in place of real numbers. The
 * live check for today is lenient and shows what it could get.
 */
export async function checkStoreReports(
  store: BonusStore,
  timeZone: string,
  messages: SlackMessage[],
  start: string,
  end: string,
  opts: { strict?: boolean } = {},
): Promise<Map<string, ReportCheck>> {
  const placed = messages
    .map((m) => ({ m, p: placeMessage(m, timeZone) }))
    .filter((x): x is { m: SlackMessage; p: NonNullable<typeof x.p> } => !!x.p && x.p.date >= start && x.p.date <= end);
  if (placed.length === 0) return new Map();

  /** One fetch per (source, day), shared by every report that needs it, retried on a dropped connection. */
  function memo<T>(source: string, fn: (day: string) => Promise<T>): (day: string) => Promise<T | null> {
    const cache = new Map<string, Promise<T | null>>();
    return (day) => {
      if (!cache.has(day)) {
        cache.set(day, labelled(source, () => fn(day)).catch((err) => {
          if (opts.strict) throw err;
          return null;
        }));
      }
      return cache.get(day)!;
    };
  }

  // ── System figures, fetched once per day ────────────────────────────────
  const totals = memo("PAR totals", (day) => getTotalsForRange(store.storeId, day, day));
  const priorTotals = memo("PAR prior year", (day) => {
    const py = getPriorYearRange(day, day);
    return getTotalsForRange(store.storeId, py.start, py.end);
  });
  const hourly = memo("PAR hourly", async (day) => {
    const buckets = await getHourlyBreakdown(store.storeId, day);
    // getHourlyBreakdown answers a failed orders pull with empty hours; a day
    // with reports in it and no sales at all is that, not a closed store.
    if (!buckets.some((b) => b.netSales > 0)) throw new Error(`fetch failed (no orders for ${day})`);
    return buckets;
  });
  const cash = memo("PAR tills", (day) => getCashSummary(store.storeId, day));
  const jolt = memo("Jolt", async (day) => {
    const report = await fetchCompletionByLocation(day, day);
    return report.locations.find((l) => l.store === store.name)?.completePct ?? null;
  });
  const drive = memo("BerryAI", async (day): Promise<DriveThruPayload["stores"][number] | null> => {
    const payload = await driveThruDay(day);
    if (!payload) return null;
    return payload.stores.find((s) => s.store_name_and_id.includes(store.storeId)) ?? null;
  });

  const out = new Map<string, ReportCheck>();
  await Promise.all(
    placed.map(async ({ m, p }) => {
      const f: ReportFields = parseReportFields(m.text ?? "");
      const checks: FieldCheck[] = [];

      if (p.slot === "previous_day") {
        const day = addDays(p.date, -1);
        const [t, py, d, j, c] = await Promise.all([
          totals(day), priorTotals(day), drive(day),
          f.joltPct !== null ? jolt(day) : null,
          f.cashOverShort !== null ? cash(day) : null,
        ]);
        const hours = t ? t.laborMinutes / 60 : 0;
        check(checks, "netSales", "Net sales", "$", f.netSales, t?.netSales ?? null, TOLERANCE.netSales);
        check(checks, "compPct", "Comp", "%", f.compPct,
          t && py && py.netSales > 0 ? ((t.netSales - py.netSales) / py.netSales) * 100 : null, TOLERANCE.compPct);
        check(checks, "splh", "Productivity", "$", f.splh, t && hours > 0 ? t.netSales / hours : null, TOLERANCE.splh);
        check(checks, "tplh", "TPLH", "num", f.tplh, t && hours > 0 ? t.orderCount / hours : null, TOLERANCE.tplh);
        check(checks, "avgCheck", "Avg check", "$", f.avgCheck,
          t && t.orderCount > 0 ? t.netSales / t.orderCount : null, TOLERANCE.avgCheck);
        check(checks, "windowSecs", "Total window", "secs", f.windowSecs, clockSecs(d?.overall.window_service), TOLERANCE.windowSecs);
        check(checks, "laneSecs", "Total lane", "secs", f.laneSecs, clockSecs(d?.overall.lane_total), TOLERANCE.laneSecs);
        check(checks, "joltPct", "Jolt", "%", f.joltPct, j, TOLERANCE.joltPct);
        check(checks, "cashOverShort", "Cash over/short", "$", f.cashOverShort, c?.overShort ?? null, TOLERANCE.cashOverShort, {
          note: c?.uncountedTills
            ? `${c.uncountedTills} till${c.uncountedTills === 1 ? "" : "s"} closed in PAR without a count — left out`
            : undefined,
        });
      } else {
        const w = SHIFT_WINDOW[p.slot];
        const [buckets, d] = await Promise.all([hourly(p.date), drive(p.date)]);
        const sum = (bs: HourBucket[] | null, from: number, to: number) => {
          if (!bs) return null;
          const inRange = bs.filter((b) => b.hour >= from && b.hour < to);
          return {
            netSales: inRange.reduce((s, b) => s + b.netSales, 0),
            orders: inRange.reduce((s, b) => s + b.orderCount, 0),
            hours: inRange.reduce((s, b) => s + b.laborHours, 0),
          };
        };
        // Day so far, through the end of the window.
        const sofar = sum(buckets, 0, w.endHour);
        const running = { pct: SHIFT_RUNNING_PCT };
        check(checks, "netSales", "Net sales", "$", f.netSales, sofar?.netSales ?? null, TOLERANCE.netSales, running);
        for (let h = w.startHour; h < w.endHour; h++) {
          const bucket = buckets?.find((b) => b.hour === h) ?? null;
          const key = `hour${h}` as FieldKey;
          const label = `${((h + 11) % 12) + 1}–${((h + 12) % 12) + 1}`;
          check(checks, key, label, "$", f.hourly[h] ?? null, bucket?.netSales ?? null, TOLERANCE.hour);
        }
        check(checks, "splh", "Productivity", "$", f.splh,
          sofar && sofar.hours > 0 ? sofar.netSales / sofar.hours : null, TOLERANCE.splh, running);
        check(checks, "tplh", "TPLH", "num", f.tplh,
          sofar && sofar.hours > 0 ? sofar.orders / sofar.hours : null, TOLERANCE.tplh, running);
        check(checks, "avgCheck", "Avg check", "$", f.avgCheck,
          sofar && sofar.orders > 0 ? sofar.netSales / sofar.orders : null, TOLERANCE.avgCheck);
        const part = d?.dayparts.find((x) => x.index === w.daypart) ?? null;
        check(checks, "laneSecs", "Lane", "secs", f.laneSecs, clockSecs(part?.lane_total), TOLERANCE.laneSecs);
        // No window check: leadership dropped window time from the 2/5/8 PM
        // reports on 2026-09-18 (#all-hudson-restaurant-group), so a window
        // figure there is extra, not owed.
      }

      const decided = checks.filter((c) => c.ok !== null);
      out.set(m.ts, {
        date: p.date,
        slot: p.slot,
        accurate: decided.length === 0 ? null : decided.every((c) => c.ok),
        checks,
      });
    }),
  );
  return out;
}

export type NightlyResult = { store: string; saved: number; error?: string };

/**
 * Check every store's reports dated within [start, end] and store the results.
 * What the nightly cron runs (for the last two days, so a report posted a day
 * late still gets checked) and what a backfill runs one day at a time.
 */
export async function runNightlyChecks(start: string, end: string): Promise<NightlyResult[]> {
  return mapLimit(BONUS_STORES, STORE_CONCURRENCY, async (store) => {
    try {
      const channel = SLACK_CHANNEL_IDS[store.storeId];
      if (!channel) return { store: store.name, saved: 0, error: "no Slack channel" };
      const timeZone = storeTimeZone(store);
      // Catch-up reports for these days can arrive up to a few days later.
      const messages = await labelled("Slack", () =>
        fetchChannelHistory(channel, localMidnight(start, timeZone), localMidnight(addDays(end, 3), timeZone)),
      );
      const checks = await checkStoreReports(store, timeZone, messages, start, end, { strict: true });
      return { store: store.name, saved: await labelled("Postgres", () => saveChecks(store.storeId, checks)) };
    } catch (err) {
      return { store: store.name, saved: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
