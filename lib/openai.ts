// Server-only OpenAI adapter. This is the ONE place that builds the OpenAI
// request payload from app settings. UI components must never construct
// OpenAI request bodies themselves — they only edit AppSettings.
//
// Uses the OpenAI Responses API (POST /v1/responses).
// NOTE: only import this from app/api/** route handlers — never from
// client components — since it reads process.env.OPENAI_API_KEY.
import type { AppSettings, ChatMessage } from "./types";
import { AVAILABLE_MODELS } from "./types";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export interface BuildRequestResult {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Maps UI settings + conversation history to an OpenAI Responses API payload.
 *
 * Mapping notes (kept here, not scattered across the UI):
 * - developerInstructions + personaNote -> merged into `instructions`
 *   (app-level guidance). They are tracked as separate settings in the UI
 *   so a later agent can send them differently if needed.
 * - reasoningEffort -> `reasoning.effort`, only when the selected model
 *   declares support in AVAILABLE_MODELS. Sent as "default" is omitted
 *   entirely, letting the API use its own default.
 * - responseFormat "json" -> `text.format = { type: "json_object" }`.
 *   Best-effort mapping; verify against current API docs before relying on it.
 * - storeResponses -> `store`.
 * - safetyIdentifier -> `safety_identifier` (opaque, locally-generated id).
 * - promptCacheKey -> `prompt_cache_key`, only when non-empty.
 * - webSearchEnabled / imageInputEnabled / imageGenerationEnabled / toolUseEnabled
 *   are INTENTIONALLY NOT mapped yet — placeholders for later work.
 * - moderationPrecheckEnabled / moderationBehavior are app-side concerns,
 *   handled (or not yet handled) before this function is called, not sent to OpenAI.
 */
export function buildOpenAIRequest(
  messages: ChatMessage[],
  settings: AppSettings
): BuildRequestResult {
  const { response, safety } = settings;

  const instructionParts = [response.developerInstructions, response.personaNote]
    .map((s) => s.trim())
    .filter(Boolean);

  const modelInfo = AVAILABLE_MODELS.find((m) => m.id === response.model);

  const body: Record<string, unknown> = {
    model: response.model,
    input: messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    temperature: response.temperature,
    top_p: response.topP,
    max_output_tokens: response.maxOutputTokens,
    stream: response.streamingEnabled,
    store: safety.storeResponses,
    safety_identifier: safety.safetyIdentifier || undefined,
  };

  if (instructionParts.length > 0) {
    body.instructions = instructionParts.join("\n\n");
  }

  if (modelInfo?.supportsReasoningEffort && response.reasoningEffort !== "default") {
    body.reasoning = { effort: response.reasoningEffort };
  }

  if (response.responseFormat === "json") {
    body.text = { format: { type: "json_object" } };
  }

  if (safety.promptCacheKey.trim()) {
    body.prompt_cache_key = safety.promptCacheKey.trim();
  }

  return {
    url: OPENAI_RESPONSES_URL,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body,
  };
}

export function isOpenAIConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
