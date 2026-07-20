"use client";

import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/lib/settings-context";
import { useLocalStorageState } from "@/lib/use-local-storage";
import { sendChat } from "@/lib/chat-client";
import type { ChatMessage } from "@/lib/types";

const HISTORY_KEY = "mintroom.chat.history";

function newId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function historyForRequest(messages: ChatMessage[], strategy: string): ChatMessage[] {
  const clean = messages.filter((m) => !m.pending && !m.error);
  if (strategy === "recent-10") return clean.slice(-10);
  if (strategy === "recent-20") return clean.slice(-20);
  return clean;
}

export default function ChatTab() {
  const { settings } = useSettings();
  const [messages, setMessages] = useLocalStorageState<ChatMessage[]>(HISTORY_KEY, []);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function runAssistantReply(historyForApi: ChatMessage[], assistantId: string) {
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", createdAt: Date.now(), pending: true },
    ]);
    try {
      const full = await sendChat(historyForApi, settings, {
        onDelta: (chunk) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + chunk } : m))
          );
        },
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, content: full || m.content, pending: false } : m))
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, pending: false, error: message } : m))
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || isSending) return; // prevent accidental double-send
    setIsSending(true);
    setInput(""); // clear input immediately on successful send

    const userMsg: ChatMessage = { id: newId(), role: "user", content: text, createdAt: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);

    const apiHistory = historyForRequest(nextMessages, settings.tools.contextStrategy);
    await runAssistantReply(apiHistory, newId());
  }

  async function handleRegenerate() {
    if (isSending) return;
    // Find the last user message; drop any assistant message(s) after it,
    // then regenerate — this must NOT re-send/duplicate the user turn.
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx === -1) return;

    const trimmed = messages.slice(0, lastUserIdx + 1);
    setMessages(trimmed);
    setIsSending(true);
    const apiHistory = historyForRequest(trimmed, settings.tools.contextStrategy);
    await runAssistantReply(apiHistory, newId());
  }

  async function handleRetry(userMessageBeforeError: ChatMessage[]) {
    if (isSending) return;
    setIsSending(true);
    const apiHistory = historyForRequest(userMessageBeforeError, settings.tools.contextStrategy);
    await runAssistantReply(apiHistory, newId());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const lastMessage = messages[messages.length - 1];
  const canRegenerate = !isSending && messages.some((m) => m.role === "user");

  return (
    <div className="sparkle-bg flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-mint-100 bg-white/70 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60">
        <div>
          <h1 className="text-base font-semibold text-mint-800 dark:text-mint-100">Chat</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {settings.response.model} · {settings.response.streamingEnabled ? "streaming" : "single response"}
          </p>
        </div>
        <button
          onClick={handleRegenerate}
          disabled={!canRegenerate}
          className="rounded-full border border-mint-200 px-3 py-1.5 text-xs font-medium text-mint-700 transition hover:bg-mint-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-mint-200 dark:hover:bg-slate-800"
        >
          ↻ Regenerate
        </button>
      </header>

      <div ref={scrollRef} className="scrollbar-thin flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-10 max-w-sm rounded-xl2 bg-white/70 p-4 text-center text-sm text-slate-500 shadow-sm dark:bg-slate-900/50 dark:text-slate-400">
            Say hi ✨ — this is your mint room. Ask anything to get started.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] whitespace-pre-wrap rounded-xl2 px-4 py-2.5 text-sm shadow-sm ${
                m.role === "user"
                  ? "bg-mint-400 text-white dark:bg-mint-600"
                  : "bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100"
              }`}
            >
              {m.content || (m.pending ? "…" : "")}
              {m.error && (
                <div className="mt-2 flex items-center gap-2 text-xs text-rose-500">
                  <span>⚠ {m.error}</span>
                  <button
                    className="rounded-full border border-rose-300 px-2 py-0.5 font-medium hover:bg-rose-50 dark:hover:bg-rose-950"
                    onClick={() => handleRetry(messages.slice(0, messages.indexOf(m)))}
                    disabled={isSending}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {isSending && lastMessage?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="rounded-xl2 bg-white px-4 py-2.5 text-sm text-slate-400 shadow-sm dark:bg-slate-800">
              thinking…
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-mint-100 bg-white/80 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
            rows={1}
            className="max-h-40 flex-1 resize-none rounded-xl2 border border-mint-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-mint-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            onClick={handleSend}
            disabled={isSending || !input.trim()}
            className="shrink-0 rounded-xl2 bg-mint-500 px-4 py-2.5 text-sm font-semibold text-white shadow-glow transition hover:bg-mint-600 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-mint-600"
          >
            {isSending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
