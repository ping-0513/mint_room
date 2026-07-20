import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResponsesPayload,
  buildDiaryPrompt,
  classifyNews,
  createChatResponse,
  createDiaryEntry,
  findModel,
  resolveActiveSkills,
  MODELS,
  DEFAULT_MODEL,
} from "./openai.mjs";

const msgs = (n) =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

test("default model is in MODELS", () => {
  assert.ok(findModel(DEFAULT_MODEL));
  assert.ok(findModel("gpt-4o-2024-11-20"));
  assert.equal(findModel("gpt-4o"), null);
});

test("unknown model is rejected instead of falling back to default", () => {
  assert.throws(
    () => buildResponsesPayload({ model: "nope" }, msgs(1)),
    (error) => error.code === "invalid_model" && /Unknown model: nope/.test(error.message)
  );
});

test("temperature/top_p sent only for models that support them", () => {
  const chatty = buildResponsesPayload({ model: "gpt-4.1-mini", temperature: 0.5, topP: 0.9 }, msgs(1));
  assert.equal(chatty.temperature, 0.5);
  assert.equal(chatty.top_p, 0.9);
  const reasoning = buildResponsesPayload({ model: "o4-mini", temperature: 0.5, topP: 0.9 }, msgs(1));
  assert.ok(!("temperature" in reasoning));
  assert.ok(!("top_p" in reasoning));
});

test("temperature is clamped to [0,2]", () => {
  const p = buildResponsesPayload({ model: "gpt-4.1-mini", temperature: 99 }, msgs(1));
  assert.equal(p.temperature, 2);
});

test("reasoning effort only for supporting models and non-default values", () => {
  const on = buildResponsesPayload({ model: "o4-mini", reasoningEffort: "high" }, msgs(1));
  assert.deepEqual(on.reasoning, { effort: "high" });
  const def = buildResponsesPayload({ model: "o4-mini", reasoningEffort: "default" }, msgs(1));
  assert.ok(!("reasoning" in def));
  const unsupported = buildResponsesPayload({ model: "gpt-4.1-mini", reasoningEffort: "high" }, msgs(1));
  assert.ok(!("reasoning" in unsupported));
});

test("history is trimmed to historyLimit messages", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL, historyLimit: 3 }, msgs(10));
  assert.equal(p.input.length, 3);
  assert.equal(p.input.at(-1).content, "m9");
});

test("instructions merge developer + persona; both optional", () => {
  const both = buildResponsesPayload(
    { model: DEFAULT_MODEL, developerInstructions: "Be brief.", persona: "gentle" }, msgs(1));
  assert.match(both.instructions, /^Be brief\./);
  assert.match(both.instructions, /persona note.*gentle/);
  const none = buildResponsesPayload({ model: DEFAULT_MODEL }, msgs(1));
  assert.ok(!("instructions" in none));
});

test("server-selected Skill Pack is inserted between developer instructions and persona", () => {
  const prompt = "鶏肉のレシピを教えて";
  const payload = buildResponsesPayload(
    { model: DEFAULT_MODEL, developerInstructions: "Be brief.", persona: "gentle" },
    [{ role: "user", content: prompt }],
    undefined,
    ["cooking"]
  );
  assert.ok(payload.instructions.indexOf("Be brief.") < payload.instructions.indexOf("Built-in Skill Pack: 料理"));
  assert.ok(payload.instructions.indexOf("Built-in Skill Pack: 料理") < payload.instructions.indexOf("persona note"));
  assert.doesNotMatch(payload.instructions, new RegExp(prompt));
});

test("unknown or client-forged Skill IDs cannot force instruction injection", () => {
  const payload = buildResponsesPayload({ model: DEFAULT_MODEL }, msgs(1), undefined, ["made-up"]);
  assert.ok(!("instructions" in payload));
  const forged = resolveActiveSkills(
    { skillPacksEnabled: true, skillIds: ["cooking"] },
    [{ role: "user", content: "こんにちは" }],
    { autoSkills: true }
  );
  assert.deepEqual(forged, []);
});

test("auto Skill Packs require the chat-only option and respect the off switch", () => {
  const messages = [{ role: "user", content: "夕飯のレシピを考えて" }];
  assert.deepEqual(resolveActiveSkills({}, messages), []);
  const active = resolveActiveSkills({}, messages, { autoSkills: true });
  assert.deepEqual(active, [{ id: "cooking", label: "料理" }]);
  assert.ok(!("description" in active[0]));
  assert.deepEqual(resolveActiveSkills({ skillPacksEnabled: false }, messages, { autoSkills: true }), []);
});

test("null settings cannot crash routing or payload construction", () => {
  assert.equal(resolveActiveSkills(null, [{ role: "user", content: "レシピを教えて" }], { autoSkills: true })[0]?.id, "cooking");
  assert.equal(buildResponsesPayload(null, msgs(1)).model, DEFAULT_MODEL);
});

test("json response format maps to text.format", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL, responseFormat: "json" }, msgs(1));
  assert.deepEqual(p.text, { format: { type: "json_object" } });
  const t = buildResponsesPayload({ model: DEFAULT_MODEL, responseFormat: "text" }, msgs(1));
  assert.ok(!("text" in t));
});

test("store defaults to false and safety identifier is forwarded", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL }, msgs(1), "mint-room-x");
  assert.equal(p.store, false);
  assert.equal(p.service_tier, "default");
  assert.equal(p.safety_identifier, "mint-room-x");
});

test("mock and rejected model responses never invent usage events", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const mock = await createChatResponse({}, msgs(1), "mint-room-test", { purpose: "chat" });
    const invalid = await createChatResponse({ model: "gpt-4o" }, msgs(1), "mint-room-test", { purpose: "chat" });
    assert.equal(mock.ok, true);
    assert.deepEqual(mock.usageEvents, []);
    assert.equal(invalid.ok, false);
    assert.equal(invalid.errorCode, "invalid_model");
    assert.deepEqual(invalid.usageEvents, []);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("successful Responses usage becomes a content-free cost event", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "sk-test-never-sent";
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(init.body);
      assert.equal(payload.model, "gpt-4o-2024-11-20");
      assert.equal(payload.service_tier, "default");
      return new Response(JSON.stringify({
        id: "resp_usage_test",
        created_at: 1_784_516_400,
        model: "gpt-4o-2024-11-20",
        service_tier: "default",
        output_text: "hello",
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 20 },
          output_tokens: 10,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 110,
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await createChatResponse(
      { model: "gpt-4o-2024-11-20" },
      msgs(1),
      "mint-room-test",
      { purpose: "chat" }
    );
    assert.equal(result.ok, true);
    assert.equal(result.text, "hello");
    assert.equal(result.usageEvents.length, 1);
    assert.equal(result.usageEvents[0].eventId, "resp_usage_test");
    assert.equal(result.usageEvents[0].occurredAt, "2026-07-20T03:00:00.000Z");
    assert.equal(result.usageEvents[0].purpose, "chat");
    assert.equal(result.usageEvents[0].requestedServiceTier, "default");
    assert.equal(result.usageEvents[0].actualServiceTier, "default");
    assert.equal(result.usageEvents[0].estimatedUsdNano, "325000");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("non-user/assistant roles are coerced to user, content stringified", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL }, [{ role: "system", content: 42 }]);
  assert.deepEqual(p.input, [{ role: "user", content: "42" }]);
});

test("every model in MODELS has required capability flags", () => {
  for (const m of MODELS) {
    assert.equal(typeof m.id, "string");
    assert.equal(typeof m.supportsTemperature, "boolean");
    assert.equal(typeof m.supportsReasoningEffort, "boolean");
  }
});

// ---------- AI diary ----------

const lifeStub = { tasksDone: 1, tasksTotal: 3, medsDone: 2, medsTotal: 2, shoppingCount: 4, wakeTime: "07:30", sleepTime: "23:00" };

test("diary for a day the master visited includes the conversation and life data", () => {
  const { instructions, userContent } = buildDiaryPrompt({
    date: "2026-07-20",
    visitedToday: true,
    conversation: [{ role: "user", content: "スクワットした!" }, { role: "assistant", content: "えらい!姿勢に気をつけてね" }],
    life: lifeStub,
  });
  assert.match(userContent, /master: スクワットした!/);
  assert.match(userContent, /me: えらい!/);
  assert.match(userContent, /tasks done 1\/3/);
  assert.match(userContent, /wake-up target 07:30/);
  assert.match(instructions, /diary/i);
});

test("diary for an absent day says the master did not visit, without conversation lines", () => {
  const { userContent } = buildDiaryPrompt({ date: "2026-07-20", visitedToday: false, conversation: [], life: lifeStub });
  assert.match(userContent, /did not visit/);
  assert.ok(!userContent.includes("master:"));
});

test("diary instructions forbid guilt-tripping and inventing events", () => {
  const { instructions } = buildDiaryPrompt({ date: "2026-07-20", visitedToday: false, life: {} });
  assert.match(instructions, /never guilt-tripping/i);
  assert.match(instructions, /Do not invent/i);
  assert.match(instructions, /Absence is never framed as a failure/i);
});

test("diary conversation excerpt is capped at 30 messages and 500 chars each", () => {
  const conversation = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: "x".repeat(1000) + i }));
  const { userContent } = buildDiaryPrompt({ date: "2026-07-20", visitedToday: true, conversation, life: {} });
  const lines = userContent.split("\n").filter((l) => l.startsWith("master: "));
  assert.equal(lines.length, 30);
  assert.ok(lines[0].length <= 500 + "master: ".length);
});

test("diary prompt survives a missing life object", () => {
  const { userContent } = buildDiaryPrompt({ date: "2026-07-20", visitedToday: false });
  assert.match(userContent, /tasks done 0\/0/);
});

test("日記とニュース分類は会話用Skill Packを実送信payloadへ混ぜない", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  const payloads = [];
  try {
    process.env.OPENAI_API_KEY = "sk-test-never-sent";
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(init.body);
      payloads.push(payload);
      const outputText = payload.text?.format?.type === "json_object" ? '{"items":[]}' : "diary entry";
      return new Response(JSON.stringify({
        model: payload.model,
        service_tier: "default",
        output_text: outputText,
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const diaryResult = await createDiaryEntry(
      {},
      {
        date: "2026-07-20",
        visitedToday: true,
        conversation: [{ role: "user", content: "夕飯のレシピを考えて" }],
        life: {},
      },
      "mint-room-test"
    );
    const newsResult = await classifyNews(
      {},
      [{ id: "recipe-news", source: "fixture", title: "人気レシピ", summary: "料理の作り方" }],
      { interests: ["料理"] },
      "mint-room-test"
    );

    assert.equal(diaryResult.ok, true);
    assert.equal(newsResult.ok, true);
    assert.equal(payloads.length, 2);
    assert.equal(diaryResult.usageEvents[0].purpose, "diary");
    assert.equal(newsResult.usageEvents[0].purpose, "news");
    for (const payload of payloads) {
      assert.doesNotMatch(payload.instructions, /Built-in Skill Pack:/);
      assert.equal(payload.service_tier, "default");
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("newsのJSONが壊れていても発生済みusageを返す", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "sk-test-never-sent";
    globalThis.fetch = async (_url, init) => {
      const payload = JSON.parse(init.body);
      return new Response(JSON.stringify({
        model: payload.model,
        service_tier: "default",
        output_text: "not-json",
        usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await classifyNews(
      {},
      [{ id: "broken", source: "fixture", title: "title", summary: "summary" }],
      {},
      "mint-room-test"
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_json");
    assert.equal(result.classificationFallbackReason, "invalid_json");
    assert.equal(result.usageEvents.length, 1);
    assert.equal(result.usageEvents[0].purpose, "news");
    assert.equal(result.usageEvents[0].status, "estimated");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("newsの上流エラーをno_keyと区別し、失敗時usageを作らない", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  const previousFetch = globalThis.fetch;
  try {
    process.env.OPENAI_API_KEY = "sk-test-never-sent";
    globalThis.fetch = async () => new Response(
      JSON.stringify({ error: { message: "provider unavailable" } }),
      { status: 503, headers: { "content-type": "application/json" } }
    );
    const result = await classifyNews(
      {},
      [{ id: "provider-error", source: "fixture", title: "title", summary: "summary" }],
      {},
      "mint-room-test"
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider unavailable");
    assert.equal(result.classificationFallbackReason, "provider_error");
    assert.deepEqual(result.usageEvents, []);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});

test("diary and news reject the removed gpt-4o alias even in mock mode", async () => {
  const previousKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const diary = await createDiaryEntry(
      { model: "gpt-4o" },
      { date: "2026-07-20", visitedToday: false, life: {} },
      "mint-room-test"
    );
    const news = await classifyNews({ model: "gpt-4o" }, [], {}, "mint-room-test");
    assert.equal(diary.errorCode, "invalid_model");
    assert.deepEqual(diary.usageEvents, []);
    assert.equal(news.errorCode, "invalid_model");
    assert.equal(news.classificationFallbackReason, "invalid_model");
    assert.deepEqual(news.usageEvents, []);
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  }
});
