/**
 * Everything the store deck shows beyond PAR, food cost and the week's
 * drive-thru: the trends behind drive times and food cost, SMG scores and
 * ZCases, and the compliance sources (ZU, Jolt, Slack).
 *
 * Every source is read through the same function its dashboard tab or the bonus
 * scorecard uses, so a slide can't disagree with the tab. Each is fetched on its
 * own and fails on its own: a dead Slack token leaves that section reading
 * "unavailable" and a warning beside the saved deck, not a broken one.
 */

import { getBerryAuth } from "@/lib/auth";
import { getTrend } from "@/lib/driveThruTrend";
import { fetchLocationReport } from "@/lib/netchef";
import { queryScores } from "@/lib/smgStore";
import { queryZCases, queryOutstanding } from "@/lib/smgCaseStore";
import { fetchZuMembers, fetchZuReport } from "@/lib/schoox";
import { fetchCompletionByLocation, fetchListCompletion, STORES_WITHOUT_JOLT } from "@/lib/jolt";
import { storeSlackReport } from "@/lib/slackCompletion";
import type { SlackDay, SlackSlot } from "@/lib/slackReports";
import { checkStoreReports } from "@/lib/slackAccuracy";
import { BONUS_STORES } from "@/lib/bonus/storeMap";
import { BONUS_ZCASE_TYPES } from "@/lib/bonus/goals";
import { FISCAL_YEAR } from "@/lib/bonus/periods";
import { FISCAL_YEAR_START } from "@/lib/fiscal";
import type { Week } from "@/lib/parWeekly";

export type DriveWeek = { laneSecs: number | null; windowSecs: number | null; cars: number | null; flagged: number | null };
export type FoodWeek = { cogsPct: number | null; variancePct: number | null };

/** The SMG items the deck shows, by SMG's own metric names (as stored). */
export const SMG_METRICS = [
  { name: "Overall Satisfaction", label: "Overall Satisfaction" },
  { name: "Temperature of Food", label: "Temperature" },
  { name: "Accuracy of Order", label: "Accuracy" },
  { name: "Friendliness of Team Members", label: "Friendliness" },
  { name: "Cleanliness", label: "Cleanliness" },
  { name: "Experienced Problem (Y/N)", label: "Experienced a Problem" },
] as const;

export type SmgWeek = { scores: Record<string, number | null>; responses: number | null };

export type ZCaseSummary = {
  /** Per trend week, cases opened (by visit date, like the SMG tab). */
  weekly: number[];
  week: { cases: number; within24Pct: number | null; avgHours: number | null };
  ptd: { cases: number; within24Pct: number | null; avgHours: number | null };
  /** Open right now, whatever their visit date. */
  outstanding: number;
};

export type Extras = {
  /** Aligned with the deck's weeks, oldest first; null where Berry has no bucket. */
  driveWeeks: (DriveWeek | null)[];
  foodWeeks: (FoodWeek | null)[];
  smgWeeks: (SmgWeek | null)[];
  zcases: ZCaseSummary | null;
  zu: {
    rate: number | null;
    people: number;
    compliant: number;
    noncompliant: number;
    /** People under 100%, lowest first — the ZU tab's roster for this store. */
    behind: { name: string; rate: number | null }[];
  } | null;
  jolt: {
    week: { completePct: number | null; onTimePct: number | null; late: number; missed: number; done: number } | null;
    ptd: { completePct: number | null; onTimePct: number | null; late: number; missed: number; done: number } | null;
    /** The store has no Jolt deployment. */
    none: boolean;
    /** This week's lists the store missed or finished late, worst first. */
    lists: { title: string; due: number; late: number; missed: number }[];
  };
  slack: {
    week: SlackDay[];
    weekPct: number | null;
    ptdPct: number | null;
    ptdRequired: number;
    ptdOnTime: number;
    /**
     * The week's posted reports whose figures didn't match the dashboard,
     * keyed "date|slot" — the Slack accuracy check the admin table runs. Null
     * when the check itself couldn't run.
     */
    inaccurate: Set<string> | null;
    /** Posted reports that could be checked, and how many of those were right. */
    checked: number;
    accurate: number;
  } | null;
  warnings: string[];
};

const shift = (iso: string, days: number) => {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const centralDate = (ts: string) => new Date(ts).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });

/** Fiscal week number for a Monday — how SMG and the drive-thru trend number weeks. */
const fiscalWeek = (monday: string) => Math.round((Date.parse(monday) - Date.parse(FISCAL_YEAR_START)) / (7 * 86_400_000)) + 1;

/** "HRG Columbia BOH midday checklist" → "BOH midday checklist"; anything else unchanged. */
export function withoutStorePrefix(title: string, store: string): string {
  let t = title.trim();
  if (/^HRG\s/i.test(t)) t = t.slice(3).trimStart();
  if (t.toLowerCase().startsWith(store.toLowerCase() + " ")) t = t.slice(store.length).trimStart();
  return t;
}

async function attempt<T>(label: string, warnings: string[], run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    warnings.push(`${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function zcaseStats(cases: { resolutionHours: number | null }[]) {
  const resolved = cases.filter((c) => c.resolutionHours != null);
  return {
    cases: cases.length,
    within24Pct: resolved.length ? (resolved.filter((c) => c.resolutionHours! <= 24).length / resolved.length) * 100 : null,
    avgHours: resolved.length ? resolved.reduce((s, c) => s + c.resolutionHours!, 0) / resolved.length : null,
  };
}

const joltFigures = (l: { completePct: number | null; onTimePct: number | null; lateCount: number; missedCount: number; totalDoneCount: number } | undefined) =>
  l ? { completePct: l.completePct, onTimePct: l.onTimePct, late: l.lateCount, missed: l.missedCount, done: l.totalDoneCount } : null;

export async function buildExtras(o: { label: string; storeId: string; weeks: Week[]; ptd: { start: string; end: string } }): Promise<Extras> {
  const warnings: string[] = [];
  const week = o.weeks[o.weeks.length - 1];
  const bonusStore = BONUS_STORES.find((s) => s.storeId === o.storeId);

  const [driveWeeks, foodWeeks, smgWeeks, zcases, zu, joltWeek, joltPtd, joltLists, slack] = await Promise.all([
    // Drive-thru by week: Postgres-cached buckets, the Drive-Thru tab's trend.
    attempt("Drive-thru trend", warnings, async () => {
      const { token } = await getBerryAuth();
      const points = await getTrend(token, "week");
      return o.weeks.map((w) => {
        const p = points.find((x) => x.start === w.start);
        const key = p && Object.keys(p.stores).find((k) => k.includes(o.storeId));
        const s = key ? p!.stores[key] : null;
        return s && s.total_cars ? { laneSecs: s.lane_total_secs, windowSecs: s.window_service_secs, cars: s.total_cars, flagged: s.flagged_pull_forward } : null;
      });
    }),

    // Food cost by week: Net-Chef, the Food Cost tab's call.
    attempt("Food cost trend", warnings, async () => {
      const nc = bonusStore?.netchefLocationId;
      if (nc == null) return o.weeks.map(() => null);
      return Promise.all(
        o.weeks.map(async (w) => {
          const r = await fetchLocationReport(nc, w.start, w.end);
          return r.salesBase ? { cogsPct: r.actualCostPct, variancePct: r.variancePct } : null;
        }),
      );
    }),

    // SMG weekly scores, labelled "Week N, <FY>" as the bonus reads them.
    attempt("SMG scores", warnings, async () => {
      const rows = await queryScores({ level: "store", periodType: "weekly", units: [o.storeId], metrics: SMG_METRICS.map((m) => m.name), limit: 20 });
      return o.weeks.map((w) => {
        if (w.start < FISCAL_YEAR_START) return null;
        const label = `Week ${fiscalWeek(w.start)}, ${FISCAL_YEAR}`;
        const mine = rows.filter((r) => r.periodLabel === label);
        if (!mine.length) return null;
        const scores: Record<string, number | null> = {};
        for (const r of mine) scores[r.metric] = r.score;
        return { scores, responses: mine.find((r) => r.metric === "Overall Satisfaction")?.responses ?? null };
      });
    }),

    // ZCases: the two guest-facing types, by visit date, as the SMG tab and bonus count them.
    attempt("ZCases", warnings, async () => {
      const from = o.weeks[0].start < o.ptd.start ? o.weeks[0].start : o.ptd.start;
      const types = [...BONUS_ZCASE_TYPES];
      const [cases, open] = await Promise.all([
        queryZCases({ start: from, end: week.end, types, stores: [o.storeId] }),
        queryOutstanding(types, [o.storeId]),
      ]);
      const dated = cases.map((c) => ({ ...c, date: c.eventAt ? centralDate(c.eventAt) : "" }));
      const within = (a: string, b: string) => dated.filter((c) => c.date >= a && c.date <= b);
      return {
        weekly: o.weeks.map((w) => within(w.start, w.end).length),
        week: zcaseStats(within(week.start, week.end)),
        ptd: zcaseStats(within(o.ptd.start, o.ptd.end)),
        outstanding: open.length,
      } satisfies ZCaseSummary;
    }),

    // ZU: Schoox reports only the present, so this is a snapshot as of today.
    attempt("ZU", warnings, async () => {
      const r = await fetchZuReport();
      const s = r.stores.find((x) => x.storeId === o.storeId);
      if (!s) throw new Error("store not found in Schoox");
      const members = await fetchZuMembers(s.unitId).catch(() => []);
      const behind = members
        .filter((m) => m.complianceRate == null || m.complianceRate < 100)
        .sort((a, b) => (a.complianceRate ?? -1) - (b.complianceRate ?? -1))
        .map((m) => ({ name: m.name, rate: m.complianceRate }));
      return { rate: s.complianceRate, people: s.people, compliant: s.compliant, noncompliant: s.noncompliant, behind };
    }),

    STORES_WITHOUT_JOLT.includes(o.label)
      ? Promise.resolve(null)
      : attempt("Jolt (week)", warnings, async () => joltFigures((await fetchCompletionByLocation(week.start, week.end)).locations.find((l) => l.store === o.label))),
    STORES_WITHOUT_JOLT.includes(o.label)
      ? Promise.resolve(null)
      : attempt("Jolt (period)", warnings, async () => joltFigures((await fetchCompletionByLocation(o.ptd.start, o.ptd.end)).locations.find((l) => l.store === o.label))),

    STORES_WITHOUT_JOLT.includes(o.label)
      ? Promise.resolve(null)
      : attempt("Jolt (lists)", warnings, async () =>
          (await fetchListCompletion(week.start, week.end)).lists
            // "HRG Columbia BOH midday checklist" → "BOH midday checklist": the
            // slide already names the store.
            .map((l) => ({
              title: withoutStorePrefix(l.title, o.label),
              s: l.byStore.find((b) => b.store === o.label),
            }))
            .filter((x) => x.s && (x.s.missedCount || x.s.lateCount))
            .map((x) => ({ title: x.title, due: x.s!.listCount, late: x.s!.lateCount, missed: x.s!.missedCount }))
            .sort((a, b) => b.missed - a.missed || b.late - a.late),
        ),

    // Slack: one read over the period to date; the week is its last seven days.
    bonusStore
      ? attempt("Slack", warnings, async () => {
          const r = await storeSlackReport(bonusStore, o.ptd.start, o.ptd.end);
          const weekDays = r.result.days.filter((d) => d.date >= week.start && d.date <= week.end);
          let due = 0;
          let ok = 0;
          for (const d of weekDays) {
            for (const v of Object.values(d.slots)) {
              if (v == null || v === "upcoming") continue;
              due++;
              if (v === "on_time") ok++;
            }
          }
          // Accuracy: the same check as the admin Slack table, over the week's
          // messages, joined to the grid by the message that filled each slot.
          let inaccurate: Set<string> | null = null;
          let checked = 0;
          let accurate = 0;
          try {
            const checks = await checkStoreReports(bonusStore, r.timeZone, r.messages, week.start, week.end);
            inaccurate = new Set();
            for (const d of weekDays) {
              for (const [slot, ts] of Object.entries(d.posts) as [SlackSlot, string | null][]) {
                const c = ts ? checks.get(ts) : undefined;
                if (!c || c.accurate == null) continue;
                checked++;
                if (c.accurate) accurate++;
                else inaccurate.add(`${d.date}|${slot}`);
              }
            }
          } catch (err) {
            warnings.push(`Slack accuracy unavailable: ${err instanceof Error ? err.message : String(err)}`);
          }
          return { week: weekDays, weekPct: due ? (ok / due) * 100 : null, ptdPct: r.result.pct, ptdRequired: r.result.required, ptdOnTime: r.result.onTime, inaccurate, checked, accurate };
        })
      : Promise.resolve(null),
  ]);

  return {
    driveWeeks: driveWeeks ?? o.weeks.map(() => null),
    foodWeeks: foodWeeks ?? o.weeks.map(() => null),
    smgWeeks: smgWeeks ?? o.weeks.map(() => null),
    zcases,
    zu,
    jolt: { week: joltWeek, ptd: joltPtd, none: STORES_WITHOUT_JOLT.includes(o.label), lists: joltLists ?? [] },
    slack,
    warnings,
  };
}

export { shift as shiftDays };
