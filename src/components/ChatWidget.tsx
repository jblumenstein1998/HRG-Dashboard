"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { DashboardAgentUIMessage } from "@/lib/agents/dashboardAgent";
import MarkdownMessage from "./MarkdownMessage";
import TrendChartCard from "./TrendChartCard";

const STORAGE_KEY = "hrg-chat-history-v1";
const MAX_STORED_MESSAGES = 60;

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const loadedRef = useRef(false);

  const { messages, sendMessage, status, setMessages } = useChat<DashboardAgentUIMessage>({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  // Load persisted history once, client-side only (avoids an SSR/hydration
  // mismatch — the first render everywhere starts empty, then this effect
  // hydrates from localStorage right after mount).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      // corrupt or unavailable storage — just start fresh
    } finally {
      loadedRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist after every change, but only once the initial load above has run —
  // otherwise this fires first with the pre-load empty array and immediately
  // overwrites whatever was actually saved.
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)));
    } catch {
      // storage full/unavailable — history just won't persist this time
    }
  }, [messages]);

  // Ctrl/Cmd+K toggles the widget from anywhere on the page.
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // Focus the input whenever the widget opens (click or Ctrl+K).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && status === "ready") {
      sendMessage({ text: input });
      setInput("");
    }
  };

  const handleClear = useCallback(() => {
    setMessages([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [setMessages]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 rounded-full bg-gray-900 text-white w-14 h-14 shadow-lg hover:bg-gray-700 flex items-center justify-center text-xl"
        aria-label="Open dashboard assistant (Ctrl+K)"
        title="Ctrl+K"
      >
        💬
      </button>
    );
  }

  return (
    <div
      className={
        "fixed bottom-5 right-5 z-50 bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col " +
        (expanded ? "w-[44rem] max-w-[calc(100vw-2.5rem)] h-[80vh]" : "w-[28rem] h-[34rem]")
      }
    >
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
        <span className="font-medium text-sm text-gray-800">Dashboard Assistant</span>
        <div className="flex items-center gap-2.5">
          <button
            onClick={handleClear}
            className="text-gray-400 hover:text-gray-600 text-xs"
            aria-label="Clear chat history"
            title="Clear history"
          >
            Clear
          </button>
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-gray-400 hover:text-gray-600 text-base leading-none"
            aria-label={expanded ? "Collapse" : "Expand"}
            title={expanded ? "Collapse" : "Expand (or use Ctrl+K to toggle chat)"}
          >
            {expanded ? "⤡" : "⤢"}
          </button>
          <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600" aria-label="Close">
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-sm">
        {messages.length === 0 && (
          <p className="text-gray-400">
            Ask things like &ldquo;How much net sales did Hillcrest do YTD?&rdquo; or &ldquo;Chart Brentwood&apos;s
            sales trend this month.&rdquo;
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

                if (part.type === "tool-getSalesTrend" && part.state === "output-available") {
                  const output = part.output;
                  if (output && "points" in output) {
                    return (
                      <TrendChartCard
                        key={i}
                        store={output.store}
                        range={output.range}
                        metric={output.metric}
                        points={output.points}
                      />
                    );
                  }
                  if (output && "error" in output) {
                    return (
                      <div key={i} className="text-xs text-red-500">
                        {output.error}
                      </div>
                    );
                  }
                }

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
          ref={inputRef}
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
