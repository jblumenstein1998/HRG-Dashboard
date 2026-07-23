import { NextRequest, NextResponse } from "next/server";
import twilio from "twilio";
import type { ModelMessage } from "ai";
import { dashboardAgent } from "@/lib/agents/dashboardAgent";
import { getConversation, saveConversation } from "@/lib/smsConversation";

// Twilio SMS segments cost money and long replies are hard to read on a
// phone — the agent is already instructed to answer in a sentence or two,
// this is just a hard backstop.
const MAX_REPLY_CHARS = 1200;

function allowedNumbers(): Set<string> {
  return new Set(
    (process.env.ALLOWED_SMS_NUMBERS ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean)
  );
}

function twiml(message?: string): NextResponse {
  const body = message
    ? `<Response><Message>${escapeXml(message)}</Message></Response>`
    : `<Response></Response>`;
  return new NextResponse(body, { status: 200, headers: { "Content-Type": "text/xml" } });
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[sms] TWILIO_AUTH_TOKEN not configured");
    return new NextResponse("Not configured", { status: 500 });
  }

  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }

  // Confirms this POST genuinely came from Twilio (not a forged request hitting
  // this endpoint directly) — required since /api/sms is exempted from the
  // normal berry_token cookie auth in src/proxy.ts so Twilio can reach it.
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const isValid = twilio.validateRequest(authToken, signature, request.url, params);
  if (!isValid) {
    console.warn("[sms] invalid Twilio signature, rejecting");
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const from = params.From ?? "";
  const body = (params.Body ?? "").trim();

  if (!allowedNumbers().has(from)) {
    console.warn("[sms] rejected message from unauthorized number:", from);
    return twiml(); // silent no-op — don't confirm this number reaches the bot
  }

  if (!body) return twiml();

  try {
    const history = await getConversation(from);
    const messages: ModelMessage[] = [...history, { role: "user", content: body }];

    const result = await dashboardAgent.generate({ messages });
    let reply = result.text.trim() || "Sorry, I couldn't find an answer to that.";
    if (reply.length > MAX_REPLY_CHARS) reply = reply.slice(0, MAX_REPLY_CHARS - 1) + "…";

    await saveConversation(from, [...messages, { role: "assistant", content: reply }]);

    return twiml(reply);
  } catch (err) {
    console.error("[sms] agent error:", err);
    return twiml("Sorry, something went wrong answering that — try again in a bit.");
  }
}
