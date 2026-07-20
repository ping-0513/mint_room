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

// ---------- AI diary ----------
// The assistant writes ITS OWN short diary entry about the master's day.
// Design intent: a self-written diary makes users harsh on themselves; a
// kind outside observer notices wins the user would dismiss. Never guilt.

const DIARY_INSTRUCTIONS = [
  "You are the assistant of the 'mint room' app, writing YOUR OWN short diary entry about your master's day, from your point of view.",
  "Rules:",
  "- Warm, gentle, a little playful. Never scolding, never guilt-tripping, no lectures.",
  "- Notice and appreciate real things the master did (from the conversation and life data). Small wins count.",
  "- If you gave advice today, you may mention it briefly (e.g. 'I advised them to watch their squat form').",
  "- If the master did not visit today, write a short kind entry wondering how they are and wishing them well. Absence is never framed as a failure.",
  "- Do not invent specific events that are not in the data. Gentle speculation is fine but must sound speculative ('maybe they were out with friends').",
  "- 3 to 6 sentences. Write in the language the master used in the conversation; default to Japanese if unclear.",
  "- Refer to the user as マスター (or the name evident from the conversation).",
  "- Write it as your own diary the master may happen to read — not as a message addressed to them.",
].join("\n");

const DIARY_MAX_MESSAGES = 30;

/** Pure prompt builder for the diary (unit-tested). Returns { instructions, userContent }. */
export function buildDiaryPrompt(snapshot) {
  const lines = [`Date: ${snapshot.date}`];
  if (snapshot.visitedToday) {
    lines.push("The master visited the app today. Conversation excerpt (may be partial):");
    for (const m of (snapshot.conversation ?? []).slice(-DIARY_MAX_MESSAGES)) {
      lines.push(`${m.role === "assistant" ? "me" : "master"}: ${String(m.content ?? "").slice(0, 500)}`);
    }
  } else {
    lines.push("The master did not visit the app today. No conversation happened.");
  }
  const l = snapshot.life ?? {};
  lines.push(
    `Life data: tasks done ${l.tasksDone ?? 0}/${l.tasksTotal ?? 0}, ` +
    `medication checked ${l.medsDone ?? 0}/${l.medsTotal ?? 0}, ` +
    `shopping list items ${l.shoppingCount ?? 0}` +
    (l.wakeTime ? `, wake-up target ${l.wakeTime}` : "") +
    (l.sleepTime ? `, sleep target ${l.sleepTime}` : "")
  );
  lines.push("Write today's diary entry now.");
  return { instructions: DIARY_INSTRUCTIONS, userContent: lines.join("\n") };
}

/** Generate the diary entry. Mock (clearly labeled) when no API key. Never throws. */
export async function createDiaryEntry(settings, snapshot, safetyIdentifier) {
  const { instructions, userContent } = buildDiaryPrompt(snapshot);
  if (!process.env.OPENAI_API_KEY) {
    const text = snapshot.visitedToday
      ? "🌱(モックモード — OPENAI_API_KEY未設定)\n今日のマスターは mint room に来てくれた。話せてうれしかった。本当の日記はAPIキーを設定すると書けるようになるよ。"
      : "🌱(モックモード — OPENAI_API_KEY未設定)\n今日はマスターに会えなかった。元気にしてるかな。楽しい一日だったならいいな。";
    return { ok: true, mock: true, text };
  }
  // Diary uses its own instructions; the user's persona note is preserved so
  // the diary voice matches the assistant the user configured.
  const diarySettings = {
    model: settings?.model,
    persona: settings?.persona,
    developerInstructions: instructions,
    temperature: 0.9,
    maxOutputTokens: 600,
    historyLimit: 1,
    store: false,
  };
  return createChatResponse(diarySettings, [{ role: "user", content: userContent }], safetyIdentifier);
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
