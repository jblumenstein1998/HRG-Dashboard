/**
 * One store's Slack reporting over a date range: its channel history, the days
 * it traded, and the score. The bonus resolver and the admin Slack table both
 * call this, so the table always shows exactly what the scorecard scores.
 *
 * The classification itself is pure and lives in slackReports.ts.
 */

import { getDailyRowsForRange } from "./parRollup";
import { SLACK_CHANNEL_IDS, storeTimeZone, type BonusStore } from "./bonus/storeMap";
import {
  addDays, fetchChannelHistory, localMidnight, scoreSlackReports,
  type SlackCompletion, type SlackMessage,
} from "./slackReports";

export type StoreSlackReport = {
  timeZone: string;
  channelId: string;
  messages: SlackMessage[];
  result: SlackCompletion;
};

/**
 * Throws when the store has no channel or the channel can't be read — callers
 * decide whether that means "pending" (the scorecard) or "show the error"
 * (the admin table).
 */
export async function storeSlackReport(store: BonusStore, start: string, end: string): Promise<StoreSlackReport> {
  const channelId = SLACK_CHANNEL_IDS[store.storeId];
  if (!channelId) throw new Error("no Slack channel mapped");
  const timeZone = storeTimeZone(store);

  const [messages, rows] = await Promise.all([
    fetchChannelHistory(
      channelId,
      localMidnight(start, timeZone),
      // Catch-up reports for the last days arrive after the range ends.
      localMidnight(addDays(end, 3), timeZone),
    ),
    // From the day before: the morning report on the first day covers it.
    getDailyRowsForRange(store.storeId, addDays(start, -1), end),
  ]);

  // No reports are owed for a day the store didn't trade. Where PAR has nothing
  // at all for a store (Portland before its token), every day counts.
  const openDays = rows.length > 0 ? new Set(rows.filter((r) => r.netSales > 0).map((r) => r.date)) : null;

  return { timeZone, channelId, messages, result: scoreSlackReports(messages, { timeZone, start, end, openDays }) };
}
