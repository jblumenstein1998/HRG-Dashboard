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
  addDays, fetchChannelHistory, localMidnight, localParts, scoreSlackReports,
  type SlackCompletion, type SlackMessage,
} from "./slackReports";

export type StoreSlackReport = {
  timeZone: string;
  channelId: string;
  messages: SlackMessage[];
  result: SlackCompletion;
};

/** A connection that dropped before any answer — worth another try. */
function isTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|Error connecting to database/i.test(msg);
}

/**
 * Runs one source, retrying a dropped connection twice, and names the source
 * and the underlying network cause in any error that survives — a bare "fetch
 * failed" doesn't say whether Slack or the database dropped.
 *
 * Seen 2026-10-29 loading the admin table: a handful of the thirteen stores
 * came back "fetch failed", a different handful each time, from both Slack
 * and Neon. Retries plus loading a few stores at a time (mapLimit) cleared it.
 */
async function labelled<T>(source: string, run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt < 2 && isTransient(err)) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const e = err as Error & { cause?: { code?: string; message?: string; cause?: { code?: string } } };
      const cause = e.cause?.code ?? e.cause?.cause?.code ?? e.cause?.message;
      throw new Error(`${source}: ${e.message}${cause ? ` (${cause})` : ""}`);
    }
  }
}

/** Promise.all over `items`, at most `limit` at a time, results in order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** How many stores are read at once. */
export const STORE_CONCURRENCY = 4;

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
    labelled("Slack", () =>
      fetchChannelHistory(
        channelId,
        localMidnight(start, timeZone),
        // Catch-up reports for the last days arrive after the range ends.
        localMidnight(addDays(end, 3), timeZone),
      ),
    ),
    // From the day before: the morning report on the first day covers it.
    labelled("PAR", () => getDailyRowsForRange(store.storeId, addDays(start, -1), end)),
  ]);

  // No reports are owed for a day the store didn't trade — including every day
  // before it opened. (An earlier version counted every day when PAR had no
  // rows at all, and Portland showed 60 missed reports for an August it wasn't
  // open.) A PAR gap therefore reads as "nothing due", which is visible as an
  // empty row rather than a false run of misses.
  const openDays = new Set(rows.filter((r) => r.netSales > 0).map((r) => r.date));

  // The store's own clock, so a range reaching today only counts what's due.
  const now = localParts(String(Date.now() / 1000), timeZone);

  return { timeZone, channelId, messages, result: scoreSlackReports(messages, { timeZone, start, end, openDays, now }) };
}
