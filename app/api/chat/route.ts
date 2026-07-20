import { NextRequest } from "next/server";
import { buildOpenAIRequest, isOpenAIConfigured } from "@/lib/openai";
import type { AppSettings, ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

interface ChatRequestBody {
  messages: ChatMessage[];
  settings: AppSettings;
}

function textStream(chunks: string[], delayMs = 35): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
      await new Promise((r) => setTimeout(r, delayMs));
    },
  });
}

function mockReply(lastUserMessage: string): string {
  return (
    `(mock reply — no OPENAI_API_KEY set on the server)\n\n` +
    `I heard: "${lastUserMessage.slice(0, 200)}"\n\n` +
    `Set OPENAI_API_KEY in your .env.local and restart the dev server to get real answers.`
  );
}

export async function POST(req: NextRequest) {
  let payload: ChatRequestBody;
  try {
    payload = await req.json();
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { messages, settings } = payload;
  if (!Array.isArray(messages) || messages.length === 0 || !settings) {
    return new Response("messages[] and settings are required", { status: 400 });
  }

  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  // --- Mock path: no server-side API key configured yet. ---
  if (!isOpenAIConfigured()) {
    const reply = mockReply(lastUser?.content ?? "");
    if (!settings.response.streamingEnabled) {
      return Response.json({ text: reply, mock: true });
    }
    const words = reply.split(/(\s+)/);
    return new Response(textStream(words), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Mock-Response": "true" },
    });
  }

  // --- Real OpenAI path via the single request-building adapter. ---
  const { url, headers, body } = buildOpenAIRequest(messages, settings);

  const upstream = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const errText = await upstream.text().catch(() => "");
    return new Response(errText || `OpenAI request failed (${upstream.status})`, {
      status: upstream.status,
    });
  }

  if (!settings.response.streamingEnabled || !upstream.body) {
    const data = await upstream.json();
    const text = extractOutputText(data);
    return Response.json({ text });
  }

  // Translate OpenAI's SSE event stream into a plain text delta stream so
  // the client only ever has to read+append chunks (no SSE parsing on the client).
  return new Response(sseToTextDeltas(upstream.body), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

function extractOutputText(data: unknown): string {
  const d = data as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  if (typeof d.output_text === "string") return d.output_text;
  const parts = d.output?.flatMap((item) => item.content?.map((c) => c.text ?? "") ?? []) ?? [];
  return parts.join("");
}

function sseToTextDeltas(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const evt = JSON.parse(jsonStr);
          if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
            controller.enqueue(encoder.encode(evt.delta));
          }
        } catch {
          // Ignore malformed/partial SSE lines.
        }
      }
    },
  });
}
