import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "crypto";
import type { ModelMessage } from "ai";
import { dashboardAgent } from "@/lib/agents/dashboardAgent";
import { getConversation, saveConversation } from "@/lib/slackConversation";
import { markdownToSlackBlocks, fallbackText, type SlackBlock } from "@/lib/slackFormat";

// Requests older than this are rejected even with a valid signature — blocks
// replay of a captured request (Slack's own recommended window).
const MAX_TIMESTAMP_SKEW_SECONDS = 60 * 5;

function allowedUserIds(): Set<string> {
  return new Set(
    (process.env.ALLOWED_SLACK_USER_IDS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
  );
}

// Confirms this POST genuinely came from Slack (not a forged request hitting
// this endpoint directly) — required since /api/slack is exempted from the
// normal berry_token cookie auth in src/proxy.ts so Slack can reach it.
function isValidSlackSignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_TIMESTAMP_SKEW_SECONDS) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected = "v0=" + crypto.createHmac("sha256", signingSecret).update(base).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function sendMessage(channelId: string, text: string, blocks?: SlackBlock[]) {
  const token = process.env.SLACK_BOT_TOKEN;
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, text, ...(blocks?.length ? { blocks } : {}) }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("[slack] chat.postMessage failed:", data.error);
}

async function handleMessage(channelId: string, text: string) {
  try {
    const history = await getConversation(channelId);
    const messages: ModelMessage[] = [...history, { role: "user", content: text }];

    const result = await dashboardAgent.generate({ messages });
    const reply = result.text.trim() || "Sorry, I couldn't find an answer to that.";

    // Save the agent's original Markdown to history (not the Slack-reformatted
    // version) so a follow-up question feeds back clean, familiar formatting
    // rather than teaching the agent to imitate its own reformatted output.
    await saveConversation(channelId, [...messages, { role: "assistant", content: reply }]);

    await sendMessage(channelId, fallbackText(reply), markdownToSlackBlocks(reply));
  } catch (err) {
    console.error("[slack] agent error:", err);
    await sendMessage(channelId, "Sorry, something went wrong answering that — try again in a bit.");
  }
}

export async function POST(request: NextRequest) {
  if (!process.env.SLACK_SIGNING_SECRET || !process.env.SLACK_BOT_TOKEN) {
    console.error("[slack] SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN not configured");
    return new NextResponse("Not configured", { status: 500 });
  }

  const rawBody = await request.text();
  const valid = isValidSlackSignature(
    rawBody,
    request.headers.get("x-slack-request-timestamp"),
    request.headers.get("x-slack-signature")
  );
  if (!valid) {
    console.warn("[slack] invalid request signature, rejecting");
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const payload = JSON.parse(rawBody);

  // One-time handshake Slack performs when you save the Event Subscriptions URL.
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }

  // Slack retries an event if we don't ack within ~3s — our agent call can
  // easily take longer than that, so skip reprocessing retries entirely
  // rather than risk sending a duplicate reply.
  if (request.headers.get("x-slack-retry-num")) {
    return NextResponse.json({ ok: true });
  }

  const event = payload.event;
  const isDirectMessage =
    event?.type === "message" && event.channel_type === "im" && !event.bot_id && !event.subtype;

  if (isDirectMessage && event.text && event.user) {
    if (!allowedUserIds().has(event.user)) {
      console.warn("[slack] rejected message from unauthorized user id:", event.user);
      // Revealing the Slack user ID isn't sensitive (unlike the dashboard data
      // itself) — it just lets an admin self-service adding them to the allowlist.
      after(() => sendMessage(event.channel, `You're not authorized to use this bot. Your Slack user ID is ${event.user} — ask an admin to add it to ALLOWED_SLACK_USER_IDS.`));
    } else {
      // Ack Slack immediately (it expects a response within ~3s) and finish
      // the agent call + reply in the background.
      after(() => handleMessage(event.channel, event.text));
    }
  }

  return NextResponse.json({ ok: true });
}
