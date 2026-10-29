import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { BONUS_STORES, storeById } from "@/lib/bonus/storeMap";
import { businessDateISO } from "@/lib/businessDay";
import { mapLimit, STORE_CONCURRENCY, storeSlackReport } from "@/lib/slackCompletion";
import { checkStoreReports, type ReportCheck } from "@/lib/slackAccuracy";
import { getChecks } from "@/lib/slackAccuracyStore";
import { addDays, fetchUserNames, GRACE_MINUTES, localParts, placeMessage, SLACK_SLOTS } from "@/lib/slackReports";

/**
 * The Slack reporting table on the admin tab — what the GM's Slack completion
 * criterion scores, laid out so the classification can be checked by eye before
 * it is shown to stores.
 *
 * GET /api/admin/slack-reports?start=2026-10-01&end=2026-10-28
 *     → every store: totals, and per day which report filled each slot
 * GET /api/admin/slack-reports?start=…&end=…&store=56301
 *     → that store again, plus every message in the window and how it was read
 *
 * Reads Slack live on every call and stores nothing (Josh, 2026-10-29: this
 * isn't needed forever). The workspace keeps 90 days of history, so a start
 * older than that is moved up to the oldest day Slack still has, and the
 * response says so. The end can be today: slots not yet due are shown as
 * upcoming and not counted (see scoreSlackReports).
 */

export const maxDuration = 60;

const TEXT_LIMIT = 600;

/** Days of history the Slack workspace keeps. */
const HISTORY_DAYS = 90;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${m}${h < 12 ? "a" : "p"}`;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const today = businessDateISO();
  const maxEnd = today;
  const historyStart = addDays(today, -(HISTORY_DAYS - 1));

  const qs = req.nextUrl.searchParams;
  const reqStart = qs.get("start") ?? "";
  const reqEnd = qs.get("end") ?? "";
  if (!ISO.test(reqStart) || !ISO.test(reqEnd)) {
    return NextResponse.json({ error: "start and end are required, as YYYY-MM-DD" }, { status: 400 });
  }
  const end = reqEnd > maxEnd ? maxEnd : reqEnd;
  const start = reqStart < historyStart ? historyStart : reqStart;
  if (start > end) {
    return NextResponse.json(
      { error: `Nothing to show: Slack history runs ${historyStart} to ${maxEnd}` },
      { status: 400 },
    );
  }

  const storeParam = qs.get("store");
  const one = storeParam ? storeById(storeParam) : null;
  if (storeParam && !one) return NextResponse.json({ error: `Unknown store "${storeParam}"` }, { status: 400 });

  const stores = await mapLimit(one ? [one] : BONUS_STORES, STORE_CONCURRENCY,
    async (store) => {
      try {
        const { timeZone, channelId, messages, result } = await storeSlackReport(store, start, end);
        const postedAt = (ts: string | null) => {
          if (!ts) return null;
          const p = localParts(ts, timeZone);
          return { ts, date: p.date, time: hhmm(p.minutes) };
        };
        const days = result.days.map((d) => ({
          date: d.date,
          slots: Object.fromEntries(
            SLACK_SLOTS.map(({ id }) => [
              id,
              { status: d.slots[id], post: postedAt(d.posts[id]), grace: d.grace[id] },
            ]),
          ),
        }));

        // Accuracy: past days from the nightly checks, today checked live.
        const lastStored = end < today ? end : addDays(today, -1);
        const [stored, live] = await Promise.all([
          start <= lastStored ? getChecks(store.storeId, start, lastStored) : new Map<string, ReportCheck>(),
          end >= today
            ? checkStoreReports(store, timeZone, messages, today, today)
            : new Map<string, ReportCheck>(),
        ]);
        const checks = new Map([...stored, ...live]);
        // % Accurate is by item, not by report (Josh, 2026-10-29): every figure
        // a report posted counts once, so a report with one figure off is 9/10
        // rather than a miss. "Data not available" counts as correct. A report
        // with nothing checkable at all stays out entirely.
        const decided = [...checks.values()].filter((c) => c.accurate !== null);
        const items = decided.flatMap((c) => c.checks);
        const itemsAccurate = items.filter((f) => f.ok !== false).length;
        const accuracy = {
          reports: decided.length,
          reportsAccurate: decided.filter((c) => c.accurate).length,
          items: items.length,
          itemsAccurate,
          pct: items.length > 0 ? Math.round((itemsAccurate / items.length) * 1000) / 10 : null,
        };

        let detail = null;
        if (one) {
          const names = await fetchUserNames(messages.map((m) => m.user).filter((u): u is string => !!u));
          detail = messages
            .slice()
            .sort((a, b) => Number(a.ts) - Number(b.ts))
            .map((m) => {
              const p = localParts(m.ts, timeZone);
              const placed = placeMessage(m, timeZone);
              const text = m.text ?? "";
              return {
                ts: m.ts,
                date: p.date,
                time: hhmm(p.minutes),
                user: m.user ? (names.get(m.user) ?? m.user) : (m.bot_id ? "bot" : "—"),
                text: text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)}…` : text,
                files: (m as { files?: unknown[] }).files?.length ?? 0,
                placed: placed && {
                  date: placed.date, slot: placed.slot, onTime: placed.onTime,
                  inGrace: placed.inGrace, by: placed.by,
                },
                check: checks.get(m.ts) ?? null,
              };
            });
        }

        return {
          storeId: store.storeId, name: store.name, channelId, timeZone,
          required: result.required, onTime: result.onTime, inGrace: result.inGrace,
          late: result.late, missed: result.missed, pct: result.pct,
          days, messages: detail, accuracy, error: null,
        };
      } catch (err) {
        return {
          storeId: store.storeId, name: store.name, channelId: null, timeZone: null,
          required: 0, onTime: 0, inGrace: 0, late: 0, missed: 0, pct: null,
          days: [], messages: null, accuracy: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  return NextResponse.json({
    start,
    end,
    /** Set when the requested start was older than Slack keeps. */
    clampedFrom: start !== reqStart ? reqStart : null,
    historyStart,
    maxEnd,
    graceMinutes: GRACE_MINUTES,
    slots: SLACK_SLOTS,
    stores,
  });
}
