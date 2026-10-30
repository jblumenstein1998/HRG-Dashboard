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
 *                                                  (morning report only: BerryAI lags too far
 *                                                  behind for the 2/5/8 PM reports)
 *   Jolt %                                         fetchStoreLists completePct — Jolt tab
 *   cash over/short                                getCashSummary (PAR GetTills; no tab yet)
 *
 * Same functions isn't enough on its own: the figures derived from PAR totals
 * go through lib/parFigures.ts, the formulas and rounding the tabs use, and
 * BerryAI ranges are keyed by canonicalTimeRange, so this check and the
 * Drive-Thru tab read one cached copy of a day rather than two.
 *
 * Jolt is the tab's figure, not Jolt's own List Completion Report
 * (fetchCompletionByLocation). The tab counts a list on its deadline day, the
 * day ending at 3 AM; Jolt's report counts it on the day it was handed out,
 * midnight to midnight, so its denominators drift by a list or two. Over 169
 * morning reports (2026-10-29) stores' posted Jolt % matched the tab 110 times
 * and Jolt's report 69 — Columbia matches the tab every day. Spring Hill posts
 * figures no list count can produce (91.98% on an 18-of-18 day), likely a
 * task-level number from another Jolt screen.
 *
 * Shift reports carry the day's numbers so far, as of the end of their window:
 * a 5:30 report's net sales is everything since open through 5 PM, not just
 * 2–5. Hourly sales are the window's own. Lane time isn't checked on them.
 */

import { getHourlyBreakdown, getHourlyBreakdownMany, getPastDays, getTotalsForRange, type HourBucket } from "./parRollup";
import { getCashSummary, getCashSummaryMany } from "./par";
import { avgCheck, compPct, productivity, roundedTotals, tplh } from "./parFigures";
import { getPriorYearRange, resolveRange } from "./fiscal";
import { businessDateISO } from "./businessDay";
import { cachedDriveThruDays, dayTimeRange, getDriveThruMetrics, type DriveThruPayload } from "./berryData";
import { loginBerryService } from "./berryAuth";
import { completionByDay, fetchStoreLists, type StoreListsReport } from "./jolt";
import { BONUS_STORES, SLACK_CHANNEL_IDS, storeTimeZone, type BonusStore } from "./bonus/storeMap";
import { parseReportFields, type ReportFields } from "./slackFields";
import {
  addDays, fetchChannelHistory, localMidnight, placeMessage, type SlackMessage, type SlackSlot,
} from "./slackReports";
import { labelled, mapLimit, STORE_CONCURRENCY } from "./slackCompletion";

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

const SHIFT_WINDOW: Record<Exclude<SlackSlot, "previous_day">, { startHour: number; endHour: number }> = {
  lunch: { startHour: 11, endHour: 14 },
  midday: { startHour: 14, endHour: 17 },
  dinner: { startHour: 17, endHour: 20 },
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

/**
 * A day's drive-thru numbers, asked for exactly as the Drive-Thru tab asks
 * (Josh, 2026-10-30): today is the tab's own Today range, a past day the
 * key its Yesterday uses, and never a forced refetch — the tab only busts
 * on its Refresh button. So both read the one cached copy. The in-memory map
 * only joins requests already in flight (thirteen stores at once); it never
 * keeps a copy of its own that could be older than the shared one.
 */
async function driveThruDay(day: string): Promise<DriveThruPayload | null> {
  const inFlight = berryDays.get(day);
  if (inFlight) return inFlight.payload;
  const { range, label } = day === businessDateISO() ? resolveRange("today") : { range: dayTimeRange(day), label: day };
  const payload = (async () => getDriveThruMetrics(await sharedBerryToken(), range, label))();
  berryDays.set(day, { payload, at: Date.now() });
  payload.finally(() => {
    if (berryDays.get(day)?.payload === payload) berryDays.delete(day);
  }).catch(() => {});
  return payload;
}

// ── Jolt, shared across stores ───────────────────────────────────────────────
// fetchStoreLists returns every store's lists for the day; one in-flight fetch
// per day serves all thirteen stores rather than each pulling the same pages.

const joltDays = new Map<string, { report: Promise<StoreListsReport>; at: number }>();

function joltDay(day: string): Promise<StoreListsReport> {
  const cached = joltDays.get(day);
  if (cached && Date.now() - cached.at < BERRY_DAY_TTL_MS) return cached.report;
  const report = fetchStoreLists(day, day);
  joltDays.set(day, { report, at: Date.now() });
  report.catch(() => {
    if (joltDays.get(day)?.report === report) joltDays.delete(day);
  });
  return report;
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
 * Runs every time the table opens, over its whole range. Past days come from
 * the stored copies the tabs read too (a few batched queries per store), so it
 * is quick once the nightly run has stored them; a day not stored yet costs a
 * source pull (a cold PAR orders day is slow — 14 took 72s) and is saved.
 * Today is live, as on the tabs.
 *
 * `strict` is for the nightly run: a source that still fails after its retries
 * throws, so the store is reported failed and re-run rather than left with
 * "couldn't check". The table is lenient and shows what it could get.
 * `shared` is loadSharedDays' drive-thru and Jolt days, loaded once for all
 * stores.
 */
export async function checkStoreReports(
  store: BonusStore,
  timeZone: string,
  messages: SlackMessage[],
  start: string,
  end: string,
  opts: { strict?: boolean; shared?: SharedDays } = {},
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

  // ── Past days, read in a few queries for the whole range ────────────────
  // The same stored rows the tabs read (the rollup, source_cache), batched so a
  // 90-day table costs a handful of queries per store instead of one per day.
  // Anything not stored yet falls through to the single-day function below,
  // which fetches it from the source and saves it.
  const today = businessDateISO();
  const pastDays = (days: string[]) => [...new Set(days)].filter((d) => d < today).sort();
  const morningDays = pastDays(placed.filter((x) => x.p.slot === "previous_day").map((x) => addDays(x.p.date, -1)));
  const shiftDays = pastDays(placed.filter((x) => x.p.slot !== "previous_day").map((x) => x.p.date));
  const firstLast = (days: string[]) => (days.length ? [days[0], days[days.length - 1]] as const : null);
  const loaded = (async () => {
    const span = firstLast(morningDays);
    const pySpan = span && getPriorYearRange(span[0], span[1]);
    const [ty, ly, hours, tills] = await Promise.all([
      span ? getPastDays(store.storeId, span[0], span[1]) : null,
      pySpan ? getPastDays(store.storeId, pySpan.start, pySpan.end) : null,
      getHourlyBreakdownMany(store.storeId, shiftDays),
      getCashSummaryMany(store.storeId, morningDays),
    ]);
    return { ty: ty?.days, ly: ly?.days, hours, tills };
  })();
  // A failed batch read isn't fatal: every figure has its single-day path.
  const batch = loaded.catch(() => null);

  // ── System figures, fetched once per day ────────────────────────────────
  const totals = memo("PAR totals", async (day) =>
    (await batch)?.ty?.get(day) ?? getTotalsForRange(store.storeId, day, day));
  const priorTotals = memo("PAR prior year", async (day) => {
    const py = getPriorYearRange(day, day);
    return (py.start === py.end ? (await batch)?.ly?.get(py.start) : undefined)
      ?? getTotalsForRange(store.storeId, py.start, py.end);
  });
  const hourly = memo("PAR hourly", async (day) => {
    const buckets = (await batch)?.hours.get(day) ?? await getHourlyBreakdown(store.storeId, day);
    // getHourlyBreakdown answers a failed orders pull with empty hours; a day
    // with reports in it and no sales at all is that, not a closed store.
    if (!buckets.some((b) => b.netSales > 0)) throw new Error(`fetch failed (no orders for ${day})`);
    return buckets;
  });
  const cash = memo("PAR tills", async (day) => (await batch)?.tills.get(day) ?? getCashSummary(store.storeId, day));
  const jolt = memo("Jolt", async (day) => {
    const shared = opts.shared?.jolt.get(day);
    if (shared) return shared.get(store.name) ?? null;
    const report = await joltDay(day);
    return report.stores.find((s) => s.store === store.name)?.completePct ?? null;
  });
  const drive = memo("BerryAI", async (day): Promise<DriveThruPayload["stores"][number] | null> => {
    const payload = opts.shared?.drive.get(day) ?? await driveThruDay(day);
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
        // Rounded the way the PAR tab's snapshot carries them, then the tab's own formulas.
        const r = t ? roundedTotals(t) : null;
        const pyNet = py ? roundedTotals(py).netSales : null;
        check(checks, "netSales", "Net sales", "$", f.netSales, r?.netSales ?? null, TOLERANCE.netSales);
        check(checks, "compPct", "Comp", "%", f.compPct, r && pyNet !== null ? compPct(r.netSales, pyNet) : null, TOLERANCE.compPct);
        check(checks, "splh", "Productivity", "$", f.splh, r ? productivity(r.netSales, r.laborHours) : null, TOLERANCE.splh);
        check(checks, "tplh", "TPLH", "num", f.tplh, r ? tplh(r.transactions, r.laborHours) : null, TOLERANCE.tplh);
        check(checks, "avgCheck", "Avg check", "$", f.avgCheck,
          r && r.transactions > 0 ? avgCheck(r.netSales, r.transactions) : null, TOLERANCE.avgCheck);
        check(checks, "windowSecs", "Total window", "secs", f.windowSecs, d?.overall.total_cars ? clockSecs(d.overall.window_service) : null, TOLERANCE.windowSecs);
        check(checks, "laneSecs", "Total lane", "secs", f.laneSecs, d?.overall.total_cars ? clockSecs(d.overall.lane_total) : null, TOLERANCE.laneSecs);
        check(checks, "joltPct", "Jolt", "%", f.joltPct, j, TOLERANCE.joltPct);
        check(checks, "cashOverShort", "Cash over/short", "$", f.cashOverShort, c?.overShort ?? null, TOLERANCE.cashOverShort, {
          note: c?.uncountedTills
            ? `${c.uncountedTills} till${c.uncountedTills === 1 ? "" : "s"} closed in PAR without a count — left out`
            : undefined,
        });
      } else {
        const w = SHIFT_WINDOW[p.slot];
        const buckets = await hourly(p.date);
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
          sofar ? productivity(sofar.netSales, sofar.hours) : null, TOLERANCE.splh, running);
        check(checks, "tplh", "TPLH", "num", f.tplh,
          sofar ? tplh(sofar.orders, sofar.hours) : null, TOLERANCE.tplh, running);
        check(checks, "avgCheck", "Avg check", "$", f.avgCheck,
          sofar && sofar.orders > 0 ? avgCheck(sofar.netSales, sofar.orders) : null, TOLERANCE.avgCheck);
        // No lane or window check on shift reports. Lane: BerryAI lags hours
        // behind the store (at 5:20 PM on 10/29 every store's 2–5 daypart still
        // read 0 cars), so a report posted at the window's end can't be held to
        // it — lane is checked on the morning report only (Josh, 2026-10-30).
        // Window: leadership dropped it from the 2/5/8 PM reports on 2026-09-18
        // (#all-hudson-restaurant-group), so a figure there is extra, not owed.
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

export type NightlyResult = { store: string; checked: number; error?: string };

/**
 * Check every store's reports dated within [start, end], strictly, so every
 * figure they need is read from its source and stored (source_cache, the
 * rollup, drive_thru_cache) before anyone opens the table. No results are
 * kept: the table recomputes them from that stored data each time it opens,
 * so a check can never drift from the tab showing the same data. What the
 * nightly cron runs (for the last two days, so a report posted a day late is
 * covered) and what a backfill runs one day at a time.
 */
export async function runNightlyChecks(start: string, end: string): Promise<NightlyResult[]> {
  const shared = await loadSharedDays(start, end);
  return mapLimit(BONUS_STORES, STORE_CONCURRENCY, async (store) => {
    try {
      const channel = SLACK_CHANNEL_IDS[store.storeId];
      if (!channel) return { store: store.name, checked: 0, error: "no Slack channel" };
      const timeZone = storeTimeZone(store);
      // Catch-up reports for these days can arrive up to a few days later.
      const messages = await labelled("Slack", () =>
        fetchChannelHistory(channel, localMidnight(start, timeZone), localMidnight(addDays(end, 3), timeZone)),
      );
      const checks = await checkStoreReports(store, timeZone, messages, start, end, { strict: true, shared });
      return { store: store.name, checked: checks.size };
    } catch (err) {
      return { store: store.name, checked: 0, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

/** The past days, drive-thru and Jolt, that one payload serves for every store. */
export type SharedDays = {
  drive: Map<string, DriveThruPayload>;
  jolt: Map<string, Map<string, number | null>>;
};

/**
 * Load the shared sources for a range once per request rather than once per
 * store. Only morning reports use them, and those are checked against the day
 * before, so the range is shifted a day early. Days not stored yet are left to
 * each store's single-day path, which fetches and saves them.
 */
export async function loadSharedDays(start: string, end: string): Promise<SharedDays> {
  const today = businessDateISO();
  const days: string[] = [];
  for (let d = addDays(start, -1); d < end && d < today; d = addDays(d, 1)) days.push(d);
  const [drive, jolt] = await Promise.all([
    cachedDriveThruDays(days).catch(() => new Map<string, DriveThruPayload>()),
    completionByDay(days).catch(() => new Map<string, Map<string, number | null>>()),
  ]);
  return { drive, jolt };
}
