import type { ModelMessage } from "ai";
import { sql } from "./db";

// Bounds how much history we replay into the agent on each text — keeps
// token cost/latency down and avoids unbounded row growth per phone number.
const MAX_HISTORY_MESSAGES = 20;

export async function getConversation(phoneNumber: string): Promise<ModelMessage[]> {
  const rows = await sql`SELECT messages FROM sms_conversations WHERE phone_number = ${phoneNumber}`;
  if (rows.length === 0) return [];
  return (rows[0] as { messages: ModelMessage[] }).messages ?? [];
}

export async function saveConversation(phoneNumber: string, messages: ModelMessage[]): Promise<void> {
  const trimmed = messages.slice(-MAX_HISTORY_MESSAGES);
  await sql`
    INSERT INTO sms_conversations (phone_number, messages, updated_at)
    VALUES (${phoneNumber}, ${JSON.stringify(trimmed)}::jsonb, now())
    ON CONFLICT (phone_number)
    DO UPDATE SET messages = EXCLUDED.messages, updated_at = EXCLUDED.updated_at
  `;
}
