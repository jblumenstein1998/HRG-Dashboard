import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import crypto from "crypto";
import type { ModelMessage } from "ai";
import { dashboardAgent } from "@/lib/agents/dashboardAgent";
import { getConversation, saveConversation } from "@/lib/slackConversation";

// Slack hard-caps a single message at 40,000 chars but anything near that is
// unreadable in a DM — the agent is already instructed to answer in a
// sentence or two, this is just a hard backstop.
const MAX_REPLY_CHARS = 3900;

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

async function sendMessage(channelId: string, text: string) {
  const token = process.env.SLACK_BOT_TOKEN;
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel: channelId, text }),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) console.error("[slack] chat.postMessage failed:", data.error);
}

// The agent writes standard Markdown (it's shared with the web chat UI, which
// renders that fine), but Slack's "mrkdwn" format has no table syntax and no
// double-asterisk bold — a raw markdown table shows up as literal pipes and
// dashes. Converts **bold** to Slack's *bold*, and reflows any markdown table
// into a fixed-width plain-text table inside a monospace code block, which is
// the standard way to show tabular data in Slack.
function toSlackMrkdwn(markdown: string): string {
  let out = markdown.replace(/\*\*(.+?)\*\*/g, "*$1*");

  const tableRegex = /^\|.*\|\r?\n\|[-:| ]+\|\r?\n(?:\|.*\|\r?\n?)+/gm;
  out = out.replace(tableRegex, (block) => {
    const rows = block
      .trim()
      .split("\n")
      .filter((_, i) => i !== 1) // drop the header/body separator row
      .map((line) =>
        line
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim().replace(/\*/g, ""))
      );
    const colCount = rows[0].length;
    const widths = Array.from({ length: colCount }, (_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length)));
    const formatted = rows.map((r) => r.map((cell, i) => (cell ?? "").padEnd(widths[i])).join("  ").trimEnd()).join("\n");
    return "```\n" + formatted + "\n```\n";
  });

  return out;
}

async function handleMessage(channelId: string, text: string) {
  try {
    const history = await getConversation(channelId);
    const messages: ModelMessage[] = [...history, { role: "user", content: text }];

    const result = await dashboardAgent.generate({ messages });
    const reply = result.text.trim() || "Sorry, I couldn't find an answer to that.";

    // Save the agent's original Markdown to history (not the Slack-reformatted
    // version) so a follow-up question feeds back clean, familiar formatting
    // rather than teaching the agent to imitate its own code-block output.
    await saveConversation(channelId, [...messages, { role: "assistant", content: reply }]);

    let slackText = toSlackMrkdwn(reply);
    if (slackText.length > MAX_REPLY_CHARS) {
      slackText = slackText.slice(0, MAX_REPLY_CHARS - 4) + "…";
      if ((slackText.match(/```/g) ?? []).length % 2 === 1) slackText += "\n```";
    }
    await sendMessage(channelId, slackText);
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
