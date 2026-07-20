// Single OpenAI boundary for mint room.
// ALL OpenAI request payload construction lives here. UI components must not
// build payloads; they send app-level settings + messages to /api/chat and
// this module maps them to the OpenAI Responses API.

import { getSkillInstructionBlocks, selectSkillPack, toActiveSkill } from "./skills.mjs";
import { createUsageEvent } from "./costs.mjs";

// Model list is intentionally configurable here, not hardcoded in the request
// function. Capability flags gate model-dependent settings (the UI mirrors
// these flags via GET /api/status).
export const MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini (fast, default)", supportsTemperature: true, supportsReasoningEffort: false },
  { id: "gpt-4.1", label: "GPT-4.1", supportsTemperature: true, supportsReasoningEffort: false },
  { id: "gpt-4o-2024-11-20", label: "GPT-4o (2024-11-20・固定)", supportsTemperature: true, supportsReasoningEffort: false },
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
 *  - activeSkillIds (server-selected fixed allowlist)
 *                              -> instructions (built-in skill block)
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
export function buildResponsesPayload(settings = {}, messages = [], safetyIdentifier, activeSkillIds = []) {
  settings = normalizeSettings(settings);
  messages = Array.isArray(messages) ? messages : [];
  const requestedModel = settings.model === undefined || settings.model === null ? DEFAULT_MODEL : settings.model;
  const model = findModel(requestedModel);
  if (!model) throw invalidModelError(requestedModel);

  const instructionParts = [];
  if (typeof settings.developerInstructions === "string" && settings.developerInstructions.trim()) {
    instructionParts.push(settings.developerInstructions.trim());
  }
  // Skill IDはサーバー固定レジストリで再解決し、内部指示だけを開発者指示として挿入する。
  instructionParts.push(...getSkillInstructionBlocks(activeSkillIds));
  if (typeof settings.persona === "string" && settings.persona.trim()) {
    instructionParts.push(`Assistant style/persona note (app-level): ${settings.persona.trim()}`);
  }

  const historyLimit = clampInt(settings.historyLimit, 1, 100, 20);
  const input = messages.slice(-historyLimit).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content ?? ""),
  }));

  const payload = { model: model.id, input, store: settings.store === true, service_tier: "default" };

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

// 通常チャットだけがautoSkillsを明示し、日記・ニュースなど内部用途は既定で無効になる。
export function resolveActiveSkills(settings = {}, messages = [], options = {}) {
  settings = normalizeSettings(settings);
  if (options.autoSkills !== true || settings.skillPacksEnabled === false) return [];
  const pack = selectSkillPack(messages);
  return pack ? [toActiveSkill(pack)] : [];
}

/** OpenAIを非ストリーミングで呼び、保存可能なusageEventsも返す。例外は外へ投げない。 */
export async function createChatResponse(settings = {}, messages = [], safetyIdentifier, options = {}) {
  settings = normalizeSettings(settings);
  messages = Array.isArray(messages) ? messages : [];
  const apiKey = process.env.OPENAI_API_KEY;
  const activeSkills = resolveActiveSkills(settings, messages, options);
  let payload;
  try {
    payload = buildResponsesPayload(settings, messages, safetyIdentifier, activeSkills.map((skill) => skill.id));
  } catch (err) {
    if (err?.code === "invalid_model") {
      return { ok: false, errorCode: err.code, error: err.message, activeSkills, usageEvents: [] };
    }
    return { ok: false, error: `Could not build OpenAI request: ${err?.message ?? err}`, activeSkills, usageEvents: [] };
  }

  if (!apiKey) {
    // Mock mode so the UI is fully testable without a key. Clearly labeled.
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    return {
      ok: true,
      mock: true,
      activeSkills,
      usageEvents: [],
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
      return { ok: false, error: msg, activeSkills, usageEvents: [] };
    }
    const usageEvent = createUsageEvent({
      eventId: data?.id,
      requestedModel: payload.model,
      actualModel: data?.model,
      requestedServiceTier: payload.service_tier,
      actualServiceTier: data?.service_tier,
      usage: data?.usage,
      purpose: options.purpose,
      occurredAt: normalizeProviderCreatedAt(data?.created_at),
    });
    return { ok: true, text: extractOutputText(data), activeSkills, usageEvents: [usageEvent] };
  } catch (err) {
    return { ok: false, error: `Network error reaching OpenAI: ${err?.message ?? err}`, activeSkills, usageEvents: [] };
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
  const modelError = validateConfiguredModel(settings);
  if (modelError) return { ok: false, errorCode: modelError.code, error: modelError.message, usageEvents: [] };
  const { instructions, userContent } = buildDiaryPrompt(snapshot);
  if (!process.env.OPENAI_API_KEY) {
    const text = snapshot.visitedToday
      ? "🌱(モックモード — OPENAI_API_KEY未設定)\n今日のマスターは mint room に来てくれた。話せてうれしかった。本当の日記はAPIキーを設定すると書けるようになるよ。"
      : "🌱(モックモード — OPENAI_API_KEY未設定)\n今日はマスターに会えなかった。元気にしてるかな。楽しい一日だったならいいな。";
    return { ok: true, mock: true, text, usageEvents: [] };
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
  return createChatResponse(
    diarySettings,
    [{ role: "user", content: userContent }],
    safetyIdentifier,
    { purpose: "diary" }
  );
}

// ---------- やさしいニュース分類 ----------
// 設計: docs/gentle-news-design.md
// バッチ1回の呼び出しで全記事を分類する(コスト管理)。出力は内部データであり
// ユーザーにそのまま見せる文章は gentle_summary と ai_comment のみ。

const NEWS_INSTRUCTIONS = [
  "You classify news items for a gentle news reader used by a person who avoids distressing news but wants to stay connected to the world.",
  "For EACH item return: lane, distress, gentle_summary, confidence, ai_comment, matched_topics.",
  "- lane: 'interest' (matches the user's registered topics), 'essential' (things everyone should know judged by real-life impact: disasters, recalls, policy/money changes, major outages — NOT sensational crime), 'rumor' (community buzz / unconfirmed but fun, e.g. 'this model suddenly feels smarter'), or 'drop' (violent crime detail, gore, abuse, suicide reporting, tragedy detail — unless it matches a registered interest, then keep but soften).",
  "- distress: 'none' | 'mild' | 'heavy'. 'heavy' items that are essential must still be included with a fact-level softened summary (no graphic detail); the reader decides whether to open the link.",
  "- gentle_summary: 1-2 sentences in Japanese, fact-level, no graphic detail, no editorializing. For interest-matched dark topics (e.g. cybercrime) focus on tactics/defenses, never victim tragedy detail.",
  "- confidence: 'confirmed' (official announcement / primary source), 'reported' (multiple outlets), 'rumor' (community reports), 'speculation' (analysis/guess). Never present rumor as fact.",
  "- ai_comment: one short honest Japanese sentence sharing excitement or context WITH the confidence made clear (e.g. 公式発表はまだないけど体感報告が増えてるよ。楽しみだね). May be null.",
  "- matched_topics: subset of the user's registered topics.",
  'Return STRICT JSON: {"items":[{"id":"...","lane":"...","distress":"...","gentle_summary":"...","confidence":"...","ai_comment":"...","matched_topics":[]}]} — one entry per input id, no extra text.',
].join("\n");

const NEWS_LANES = ["interest", "essential", "rumor", "drop"];
const NEWS_DISTRESS = ["none", "mild", "heavy"];
const NEWS_CONFIDENCE = ["confirmed", "reported", "rumor", "speculation"];

/** ニュース分類プロンプトの純関数(テスト対象)。 */
export function buildNewsPrompt(items, prefs = {}) {
  const lines = [
    `User's registered interest topics: ${JSON.stringify(prefs.interests ?? [])}`,
    `User's blocked categories (drop or soften): ${JSON.stringify(prefs.blockedCategories ?? ["violent crime detail", "gore", "abuse", "suicide reporting"])}`,
    "Items:",
  ];
  for (const it of items) {
    lines.push(JSON.stringify({ id: it.id, source: it.source, title: it.title, summary: it.summary }));
  }
  return { instructions: NEWS_INSTRUCTIONS, userContent: lines.join("\n") };
}

/**
 * LLMバッチ分類。キー無し・失敗・不正JSONはすべて { ok: false } で返し、
 * 呼び出し側(server.mjs)がキーワード簡易フィルタに黙ってフォールバックする。
 */
export async function classifyNews(settings, items, prefs, safetyIdentifier) {
  const modelError = validateConfiguredModel(settings);
  if (modelError) {
    return {
      ok: false,
      reason: modelError.message,
      errorCode: modelError.code,
      classificationFallbackReason: "invalid_model",
      usageEvents: [],
    };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, reason: "no_key", classificationFallbackReason: "no_key", usageEvents: [] };
  }
  if (!items.length) {
    return { ok: true, classifications: new Map(), classificationFallbackReason: null, usageEvents: [] };
  }
  const { instructions, userContent } = buildNewsPrompt(items, prefs);
  const result = await createChatResponse(
    {
      model: settings?.model,
      developerInstructions: instructions,
      temperature: 0.3, // 分類なので低温度
      maxOutputTokens: 8000, // 40件×1件あたり最大200トークン程度の余裕を確保
      historyLimit: 1,
      store: false,
      responseFormat: "json",
    },
    [{ role: "user", content: userContent }],
    safetyIdentifier,
    { purpose: "news" }
  );
  if (!result.ok) {
    return {
      ok: false,
      reason: result.error,
      errorCode: result.errorCode,
      classificationFallbackReason: result.errorCode === "invalid_model" ? "invalid_model" : "provider_error",
      usageEvents: result.usageEvents ?? [],
    };
  }
  try {
    const parsed = JSON.parse(result.text);
    const map = new Map();
    for (const c of parsed.items ?? []) {
      // 不正な値は握りつぶさず項目ごとに落とす(部分的に使える結果は使う)
      if (typeof c?.id !== "string") continue;
      map.set(c.id, {
        lane: NEWS_LANES.includes(c.lane) ? c.lane : "general",
        distress: NEWS_DISTRESS.includes(c.distress) ? c.distress : "unrated",
        confidence: NEWS_CONFIDENCE.includes(c.confidence) ? c.confidence : "unrated",
        gentle_summary: typeof c.gentle_summary === "string" ? c.gentle_summary.slice(0, 300) : null,
        ai_comment: typeof c.ai_comment === "string" ? c.ai_comment.slice(0, 200) : null,
        matched_topics: Array.isArray(c.matched_topics) ? c.matched_topics.filter((t) => typeof t === "string") : [],
      });
    }
    return {
      ok: true,
      classifications: map,
      classificationFallbackReason: null,
      usageEvents: result.usageEvents,
    };
  } catch {
    // 応答本文が不正でもAPI料金は発生済みなので、usageだけは呼び出し側へ渡す。
    return {
      ok: false,
      reason: "invalid_json",
      classificationFallbackReason: "invalid_json",
      usageEvents: result.usageEvents,
    };
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

function normalizeSettings(settings) {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
}

function normalizeProviderCreatedAt(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const date = new Date(value * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function invalidModelError(value) {
  const error = new RangeError(`Unknown model: ${String(value)}`);
  error.code = "invalid_model";
  return error;
}

function validateConfiguredModel(settings) {
  const normalized = normalizeSettings(settings);
  if (normalized.model === undefined || normalized.model === null) return null;
  return findModel(normalized.model) ? null : invalidModelError(normalized.model);
}
