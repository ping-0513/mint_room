"use client";

import type { AppSettings, ChatMessage } from "./types";

export interface SendChatOptions {
  onDelta?: (chunk: string) => void;
}

/**
 * Calls the /api/chat route and returns the full assistant reply text.
 * Handles both the streaming (text/plain chunked) and non-streaming (JSON) paths.
 */
export async function sendChat(
  messages: ChatMessage[],
  settings: AppSettings,
  { onDelta }: SendChatOptions = {}
): Promise<string> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, settings }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(errText || `Request failed (${res.status})`);
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const data = await res.json();
    const text = data.text ?? "";
    onDelta?.(text);
    return text;
  }

  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    full += chunk;
    onDelta?.(chunk);
  }
  return full;
}
