import { NextRequest, NextResponse } from "next/server";
import type { ModelMessage } from "ai";
import { dashboardAgent } from "@/lib/agents/dashboardAgent";
import { getConversation, saveConversation } from "@/lib/telegramConversation";

// Telegram's hard per-message cap is 4096 chars — the agent is already
// instructed to answer in a sentence or two, this is just a hard backstop.
const MAX_REPLY_CHARS = 3900;

function allowedIds(): Set<string> {
  return new Set(
    (process.env.ALLOWED_TELEGRAM_IDS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
  );
}

async function sendMessage(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.error("[telegram] sendMessage failed:", res.status, await res.text().catch(() => ""));
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!webhookSecret || !process.env.TELEGRAM_BOT_TOKEN) {
    console.error("[telegram] TELEGRAM_WEBHOOK_SECRET or TELEGRAM_BOT_TOKEN not configured");
    return new NextResponse("Not configured", { status: 500 });
  }

  // Confirms this POST genuinely came from Telegram (not a forged request hitting
  // this endpoint directly) — required since /api/telegram is exempted from the
  // normal berry_token cookie auth in src/proxy.ts so Telegram can reach it.
  // Set via the `secret_token` param when registering the webhook (setWebhook).
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token");
  if (headerSecret !== webhookSecret) {
    console.warn("[telegram] invalid webhook secret, rejecting");
    return new NextResponse("Unauthorized", { status: 403 });
  }

  const update = await request.json();
  const message = update.message;
  const text: string | undefined = message?.text?.trim();
  const chatId: number | undefined = message?.chat?.id;
  const fromId: number | undefined = message?.from?.id;

  if (!text || chatId == null) return NextResponse.json({ ok: true }); // ignore non-text updates

  if (!fromId || !allowedIds().has(String(fromId))) {
    console.warn("[telegram] rejected message from unauthorized user id:", fromId);
    // Revealing the numeric Telegram ID isn't sensitive (unlike the dashboard
    // data itself) — it just lets an admin self-service adding them to the allowlist.
    await sendMessage(
      chatId,
      `You're not authorized to use this bot. Your Telegram user ID is ${fromId} — ask an admin to add it to ALLOWED_TELEGRAM_IDS.`
    );
    return NextResponse.json({ ok: true });
  }

  try {
    const history = await getConversation(String(chatId));
    const messages: ModelMessage[] = [...history, { role: "user", content: text }];

    const result = await dashboardAgent.generate({ messages });
    let reply = result.text.trim() || "Sorry, I couldn't find an answer to that.";
    if (reply.length > MAX_REPLY_CHARS) reply = reply.slice(0, MAX_REPLY_CHARS - 1) + "…";

    await saveConversation(String(chatId), [...messages, { role: "assistant", content: reply }]);
    await sendMessage(chatId, reply);
  } catch (err) {
    console.error("[telegram] agent error:", err);
    await sendMessage(chatId, "Sorry, something went wrong answering that — try again in a bit.");
  }

  return NextResponse.json({ ok: true });
}
