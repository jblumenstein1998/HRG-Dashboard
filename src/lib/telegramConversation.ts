import type { ModelMessage } from "ai";
import { sql } from "./db";

// Bounds how much history we replay into the agent on each message — keeps
// token cost/latency down and avoids unbounded row growth per chat.
const MAX_HISTORY_MESSAGES = 20;

export async function getConversation(chatId: string): Promise<ModelMessage[]> {
  const rows = await sql`SELECT messages FROM telegram_conversations WHERE chat_id = ${chatId}`;
  if (rows.length === 0) return [];
  return (rows[0] as { messages: ModelMessage[] }).messages ?? [];
}

export async function saveConversation(chatId: string, messages: ModelMessage[]): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  await sql`
    INSERT INTO telegram_conversations (chat_id, messages, updated_at)
    VALUES (${chatId}, ${JSON.stringify(trimmed)}::jsonb, now())
    ON CONFLICT (chat_id)
    DO UPDATE SET messages = EXCLUDED.messages, updated_at = EXCLUDED.updated_at
  `;
}
