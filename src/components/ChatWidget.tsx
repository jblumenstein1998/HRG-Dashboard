"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { DashboardAgentUIMessage } from "@/lib/agents/dashboardAgent";
import MarkdownMessage from "./MarkdownMessage";

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat<DashboardAgentUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status === "ready") {
      sendMessage({ text: input });
      setInput("");
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-gray-900 text-white w-14 h-14 shadow-lg hover:bg-gray-700 flex items-center justify-center text-xl"
        aria-label="Open dashboard assistant"
      >
        💬
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[28rem] h-[34rem] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="font-medium text-sm text-gray-800">Dashboard Assistant</span>
        <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="text-gray-400">
            Ask things like &ldquo;How much net sales did Hillcrest do YTD?&rdquo; or &ldquo;What was total variance at Brentwood in P4?&rdquo;
          </p>
        )}
        {messages.map(message => (
          <div key={message.id} className={message.role === "user" ? "text-right" : "text-left"}>
            <div
              className={
                "inline-block rounded-lg px-3 py-2 max-w-[95%] " +
                (message.role === "user" ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-800")
              }
            >
              {message.parts.map((part, i) => {
                if (part.type === "text") return <MarkdownMessage key={i} text={part.text} />;
                if (isToolUIPart(part)) {
                  return (
                    <div key={i} className="text-xs text-gray-500 italic">
                      {part.state === "output-available" ? "looked up data" : "looking up data…"}
                    </div>
                  );
                }
                return null;
              })}
            </div>
          </div>
        ))}
        {status === "submitted" && <div className="text-gray-400 text-xs">Thinking…</div>}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-gray-200 p-2 flex gap-2">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={status !== "ready"}
          placeholder="Ask about sales, labor, variance…"
          className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
        />
        <button
          type="submit"
          disabled={status !== "ready"}
          className="bg-gray-900 text-white text-sm px-3 py-1 rounded disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
