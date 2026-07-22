import { createAgentUIStreamResponse } from "ai";
import { dashboardAgent } from "@/lib/agents/dashboardAgent";

export async function POST(request: Request) {
  const { messages } = await request.json();

  return createAgentUIStreamResponse({
    agent: dashboardAgent,
    uiMessages: messages,
  });
}
