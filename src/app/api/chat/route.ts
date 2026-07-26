import { createAgentUIStreamResponse, isToolUIPart } from "ai";
import {
  dashboardAgent,
  type DashboardAgentUIMessage,
} from "@/lib/agents/dashboardAgent";

// The client posts its whole thread on every question. Past tool results ride
// along with it, and they dominate the payload — getSalesTrend returns a point
// per day, so a couple of charts is tens of thousands of tokens replayed on
// every call, twice per question.
//
// Rather than truncating the conversation hard, drop the payloads and keep the
// turns: an assistant reply already restates its own answer in text (the system
// prompt requires it), so the thread stays intelligible for follow-ups at a
// fraction of the size. This matches what the Slack path has always persisted.
//
// Capped and stripped server-side because it's the only place the limit can't
// be bypassed by a stale client or old localStorage.
const MAX_HISTORY_MESSAGES = 20;

// Every tool part in the incoming history belongs to a completed earlier turn —
// the current turn's tool calls are made inside the agent loop and never come
// from the client. So all of them can go.
function stripToolPayloads(
  messages: DashboardAgentUIMessage[],
): DashboardAgentUIMessage[] {
  return messages.flatMap(message => {
    if (message.role !== "assistant") return [message];

    const parts = message.parts.filter(part => !isToolUIPart(part));

    // An assistant turn whose only content was a tool call has nothing left to
    // say — drop it rather than sending a contentless message.
    const hasText = parts.some(
      part => part.type === "text" && part.text.trim() !== "",
    );
    return hasText ? [{ ...message, parts }] : [];
  });
}

function trimHistory(
  messages: DashboardAgentUIMessage[],
): DashboardAgentUIMessage[] {
  const recent = messages.slice(-MAX_HISTORY_MESSAGES);
  // Slicing can land mid-exchange and leave an assistant turn first; the
  // conversation has to open on a user turn.
  const firstUser = recent.findIndex(m => m.role === "user");
  return firstUser > 0 ? recent.slice(firstUser) : recent;
}

export async function POST(request: Request) {
  const { messages } = (await request.json()) as {
    messages: DashboardAgentUIMessage[];
  };

  return createAgentUIStreamResponse({
    agent: dashboardAgent,
    uiMessages: trimHistory(stripToolPayloads(messages)),
  });
}
