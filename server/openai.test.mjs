import { test } from "node:test";
import assert from "node:assert/strict";
import { buildResponsesPayload, findModel, MODELS, DEFAULT_MODEL } from "./openai.mjs";

const msgs = (n) =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));

test("default model is in MODELS", () => {
  assert.ok(findModel(DEFAULT_MODEL));
});

test("unknown model falls back to default", () => {
  const p = buildResponsesPayload({ model: "nope" }, msgs(1));
  assert.equal(p.model, DEFAULT_MODEL);
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

test("json response format maps to text.format", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL, responseFormat: "json" }, msgs(1));
  assert.deepEqual(p.text, { format: { type: "json_object" } });
  const t = buildResponsesPayload({ model: DEFAULT_MODEL, responseFormat: "text" }, msgs(1));
  assert.ok(!("text" in t));
});

test("store defaults to false and safety identifier is forwarded", () => {
  const p = buildResponsesPayload({ model: DEFAULT_MODEL }, msgs(1), "mint-room-x");
  assert.equal(p.store, false);
  assert.equal(p.safety_identifier, "mint-room-x");
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
