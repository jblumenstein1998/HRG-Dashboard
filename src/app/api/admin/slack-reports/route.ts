import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/users/adminGuard";
import { BONUS_STORES, storeById } from "@/lib/bonus/storeMap";
import { currentPeriodLabel, listBonusPeriods, resolveBonusWindow } from "@/lib/bonus/periods";
import { storeSlackReport } from "@/lib/slackCompletion";
import { fetchUserNames, localParts, placeMessage, SLACK_SLOTS } from "@/lib/slackReports";

/**
 * The Slack reporting table on the admin tab — what the GM's Slack completion
 * criterion scores, laid out so the classification can be checked by eye before
 * it is shown to stores.
 *
 * GET /api/admin/slack-reports?period=P11%20FY2026
 *     → every store: totals, and per day which report filled each slot
 * GET /api/admin/slack-reports?period=…&store=56301
 *     → that store again, plus every message in the window and how it was read
 *
 * Reads Slack live on every call (thirteen channels), so nothing here is
 * cached and the page loads it on demand.
 */

export const maxDuration = 60;

const TEXT_LIMIT = 600;

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = String(minutes % 60).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${m}${h < 12 ? "a" : "p"}`;
}

export async function GET(req: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;

  const period = req.nextUrl.searchParams.get("period") || currentPeriodLabel();
  const window = resolveBonusWindow(period);
  if (!window) return NextResponse.json({ error: `${period} has no completed day yet` }, { status: 400 });

  const storeParam = req.nextUrl.searchParams.get("store");
  const one = storeParam ? storeById(storeParam) : null;
  if (storeParam && !one) return NextResponse.json({ error: `Unknown store "${storeParam}"` }, { status: 400 });

  const stores = await Promise.all(
    (one ? [one] : BONUS_STORES).map(async (store) => {
      try {
        const { timeZone, channelId, messages, result } = await storeSlackReport(store, window.start, window.end);
        const postedAt = (ts: string | null) => {
          if (!ts) return null;
          const p = localParts(ts, timeZone);
          return { ts, date: p.date, time: hhmm(p.minutes) };
        };
        const days = result.days.map((d) => ({
          date: d.date,
          slots: Object.fromEntries(
            SLACK_SLOTS.map(({ id }) => [id, { status: d.slots[id], post: postedAt(d.posts[id]) }]),
          ),
        }));

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
                placed: placed && { date: placed.date, slot: placed.slot, onTime: placed.onTime, by: placed.by },
              };
            });
        }

        return {
          storeId: store.storeId, name: store.name, channelId, timeZone,
          required: result.required, onTime: result.onTime, late: result.late,
          missed: result.missed, pct: result.pct, days, messages: detail, error: null,
        };
      } catch (err) {
        return {
          storeId: store.storeId, name: store.name, channelId: null, timeZone: null,
          required: 0, onTime: 0, late: 0, missed: 0, pct: null, days: [], messages: null,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return NextResponse.json({
    period,
    periods: listBonusPeriods().map((p) => p.label),
    start: window.start,
    end: window.end,
    slots: SLACK_SLOTS,
    stores,
  });
}
