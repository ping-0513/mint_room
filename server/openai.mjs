// Single OpenAI boundary for mint room.
// ALL OpenAI request payload construction lives here. UI components must not
// build payloads; they send app-level settings + messages to /api/chat and
// this module maps them to the OpenAI Responses API.

// Model list is intentionally configurable here, not hardcoded in the request
// function. Capability flags gate model-dependent settings (the UI mirrors
// these flags via GET /api/status).
export const MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini (fast, default)", supportsTemperature: true, supportsReasoningEffort: false },
  { id: "gpt-4.1", label: "GPT-4.1", supportsTemperature: true, supportsReasoningEffort: false },
  { id: "gpt-4o-mini", label: "GPT-4o mini", supportsTemperature: true, supportsReasoningEffort: false },
  { id: "o4-mini", label: "o4-mini (reasoning)", supportsTemperature: false, supportsReasoningEffort: true },
];

export const DEFAULT_MODEL = "gpt-4.1-mini";

const OPENAI_URL = "https://api.openai.com/v1/responses";

export function findModel(id) {
  return MODELS.find((m) => m.id === id) || null;
}

/**
 * Map app settings + chat history to an OpenAI Responses API payload.
 *
 * Mapping (UI setting -> API parameter):
 *  - settings.model            -> model
 *  - settings.developerInstructions + settings.persona
 *                              -> instructions (persona is appended as a
 *                                 clearly separated app-level style note)
 *  - messages[]                -> input (role/content list; trimmed by
 *                                 settings.historyLimit, app-only)
 *  - settings.temperature      -> temperature (omitted for models that do not
 *                                 support it, e.g. o4-mini)
 *  - settings.topP             -> top_p
 *  - settings.maxOutputTokens  -> max_output_tokens
 *  - settings.reasoningEffort  -> reasoning.effort (only when the model
 *                                 supports it and value is not "default")
 *  - settings.responseFormat "json" -> text.format { type: "json_object" }
 *  - settings.store            -> store (privacy-preserving default: false)
 *  - safetyIdentifier (server-provided, stable, non-PII) -> safety_identifier
 *
 * App-only settings, intentionally NOT sent to OpenAI:
 *  - safetyMode, moderationBehavior (app-side handling policy)
 *  - historyLimit (applied before building `input`)
 *  - theme and all Tools toggles (placeholders; see docs/agent-handoff.md)
 *
 * Placeholders (documented, not yet functional):
 *  - moderationPrecheck: should call the moderation endpoint server-side
 *    before generation. Not implemented in this pass.
 *  - promptCacheKey: developer placeholder, not sent.
 */
export function buildResponsesPayload(settings, messages, safetyIdentifier) {
  const model = findModel(settings.model) || findModel(DEFAULT_MODEL);

  const instructionParts = [];
  if (typeof settings.developerInstructions === "string" && settings.developerInstructions.trim()) {
    instructionParts.push(settings.developerInstructions.trim());
  }
  if (typeof settings.persona === "string" && settings.persona.trim()) {
    instructionParts.push(`Assistant style/persona note (app-level): ${settings.persona.trim()}`);
  }

  const historyLimit = clampInt(settings.historyLimit, 1, 100, 20);
  const input = messages.slice(-historyLimit).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? ""),
  }));

  const payload = { model: model.id, input, store: settings.store === true };

  if (instructionParts.length) payload.instructions = instructionParts.join("\n\n");

  if (model.supportsTemperature) {
    const t = clampNum(settings.temperature, 0, 2);
    if (t !== null) payload.temperature = t;
    const p = clampNum(settings.topP, 0, 1);
    if (p !== null) payload.top_p = p;
  }

  const maxTok = clampInt(settings.maxOutputTokens, 16, 32768, null);
  if (maxTok !== null) payload.max_output_tokens = maxTok;

  if (model.supportsReasoningEffort && ["low", "medium", "high"].includes(settings.reasoningEffort)) {
    payload.reasoning = { effort: settings.reasoningEffort };
  }

  if (settings.responseFormat === "json") {
    payload.text = { format: { type: "json_object" } };
  }

  if (safetyIdentifier) payload.safety_identifier = safetyIdentifier;

  return payload;
}

/** Call OpenAI (non-streaming). Returns { ok, text?, error? }. Never throws. */
export async function createChatResponse(settings, messages, safetyIdentifier) {
  const apiKey = process.env.OPENAI_API_KEY;
  const payload = buildResponsesPayload(settings, messages, safetyIdentifier);

  if (!apiKey) {
    // Mock mode so the UI is fully testable without a key. Clearly labeled.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return {
      ok: true,
      mock: true,
      text:
        `🌱 (mock mode — no OPENAI_API_KEY set)\n\nYou said: "${truncate(lastUser?.content ?? "", 200)}"\n\n` +
        `This is a placeholder reply from model "${payload.model}". Set OPENAI_API_KEY and restart the server for real responses.`,
    };
  }

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || `OpenAI API error (HTTP ${res.status})`;
      return { ok: false, error: msg };
    }
    return { ok: true, text: extractOutputText(data) };
  } catch (err) {
    return { ok: false, error: `Network error reaching OpenAI: ${err?.message ?? err}` };
  }
}

// Responses API: prefer output_text convenience field; fall back to walking output items.
function extractOutputText(data) {
  if (typeof data?.output_text === "string" && data.output_text) return data.output_text;
  const parts = [];
  for (const item of data?.output ?? []) {
    for (const c of item?.content ?? []) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("") || "(empty response)";
}

function clampNum(v, min, max) {
  const n = typeof v === "number" ? v : parseFloat(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

function clampInt(v, min, max, fallback) {
  const n = typeof v === "number" ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}
