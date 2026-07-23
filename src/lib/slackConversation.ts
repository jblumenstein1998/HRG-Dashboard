import type { ModelMessage } from "ai";
import { sql } from "./db";

// Bounds how much history we replay into the agent on each message — keeps
// token cost/latency down and avoids unbounded row growth per DM channel.
const MAX_HISTORY_MESSAGES = 20;

export async function getConversation(channelId: string): Promise<ModelMessage[]> {
  const rows = await sql`SELECT messages FROM slack_conversations WHERE channel_id = ${channelId}`;
  if (rows.length === 0) return [];
  return (rows[0] as { messages: ModelMessage[] }).messages ?? [];
}

export async function saveConversation(channelId: string, messages: ModelMessage[]): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  await sql`
    INSERT INTO slack_conversations (channel_id, messages, updated_at)
    VALUES (${channelId}, ${JSON.stringify(trimmed)}::jsonb, now())
    ON CONFLICT (channel_id)
    DO UPDATE SET messages = EXCLUDED.messages, updated_at = EXCLUDED.updated_at
  `;
}
