import { test } from "node:test";
import assert from "node:assert/strict";
import { createUsageEvent, MODEL_PRICING, PRICING_VERSION } from "./costs.mjs";

test("キャッシュ済み入力を分けてnano-USD整数で正確に積算する", () => {
  const event = createUsageEvent({
    requestedModel: "gpt-4o-2024-11-20",
    actualModel: "gpt-4o-2024-11-20",
    requestedServiceTier: "default",
    actualServiceTier: "default",
    usage: {
      input_tokens: 1_000,
      input_tokens_details: { cached_tokens: 400 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 50 },
      total_tokens: 1_200,
    },
    purpose: "chat",
    occurredAt: "2026-07-20T01:02:03.000Z",
    eventId: "usage-test-1",
  });

  assert.equal(event.status, "estimated");
  assert.equal(event.estimatedUsdNano, "4000000");
  assert.equal(event.estimatedUsd, 0.004);
  assert.deepEqual(event.tokens, { input: 1_000, cachedInput: 400, output: 200, reasoningOutput: 50, total: 1_200 });
  assert.deepEqual(event.ratesNanoUsdPerToken, { input: 2_500, cachedInput: 1_250, output: 10_000 });
  assert.equal(event.actualServiceTier, "default");
  assert.equal(event.pricingVersion, PRICING_VERSION);
  assert.equal(event.occurredAt, "2026-07-20T01:02:03.000Z");
});

test("reasoning tokensはoutput内数なので二重課金しない", () => {
  const common = {
    requestedModel: "o4-mini",
    usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    eventId: "usage-reasoning",
  };
  const withoutDetails = createUsageEvent(common);
  const withReasoning = createUsageEvent({
    ...common,
    usage: { ...common.usage, output_tokens_details: { reasoning_tokens: 40 } },
  });
  assert.equal(withReasoning.estimatedUsdNano, withoutDetails.estimatedUsdNano);
});

test("usageが無い成功応答を0円と誤表示しない", () => {
  const event = createUsageEvent({ requestedModel: "gpt-4.1-mini", usage: null, eventId: "usage-missing" });
  assert.equal(event.status, "usage_unavailable");
  assert.equal(event.tokens, null);
  assert.equal(event.estimatedUsdNano, null);
  assert.equal(event.estimatedUsd, null);
});

test("未知モデルのusageは既知モデルの料金へフォールバックしない", () => {
  const event = createUsageEvent({
    requestedModel: "future-model",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    eventId: "usage-unknown-model",
  });
  assert.equal(event.status, "pricing_unavailable");
  assert.equal(event.pricingUnavailableReason, "model");
  assert.deepEqual(event.tokens, { input: 10, cachedInput: 0, output: 5, reasoningOutput: 0, total: 15 });
  assert.equal(event.ratesNanoUsdPerToken, null);
  assert.equal(event.estimatedUsdNano, null);
});

test("providerが返した実モデルの料金を使い、可変aliasの旧料金を当てない", () => {
  const event = createUsageEvent({
    requestedModel: "gpt-4.1-mini",
    actualModel: "gpt-4o-2024-11-20",
    requestedServiceTier: "default",
    actualServiceTier: "default",
    usage: { input_tokens: 1_000_000, output_tokens: 0, total_tokens: 1_000_000 },
  });
  assert.equal(event.status, "estimated");
  assert.equal(event.pricedModel, "gpt-4o-2024-11-20");
  assert.equal(event.estimatedUsdNano, "2500000000");
  assert.equal(event.estimatedUsd, 2.5);
});

test("providerの実モデルが料金表に無ければrequested aliasの料金を推測しない", () => {
  const event = createUsageEvent({
    requestedModel: "gpt-4.1-mini",
    actualModel: "gpt-future-snapshot",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  assert.equal(event.status, "pricing_unavailable");
  assert.equal(event.pricingUnavailableReason, "actual_model");
  assert.equal(event.estimatedUsdNano, null);
});

test("default以外の実サービス層へ標準料金を当てはめない", () => {
  const event = createUsageEvent({
    requestedModel: "gpt-4.1-mini",
    requestedServiceTier: "default",
    actualServiceTier: "priority",
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  });
  assert.equal(event.status, "pricing_unavailable");
  assert.equal(event.pricingUnavailableReason, "service_tier");
  assert.equal(event.actualServiceTier, "priority");
  assert.equal(event.ratesNanoUsdPerToken, null);
  assert.equal(event.estimatedUsdNano, null);
});

test("負数・非整数・内訳矛盾のusageは利用不能として扱う", () => {
  const cases = [
    { input_tokens: -1, output_tokens: 1, total_tokens: 0 },
    { input_tokens: 1.5, output_tokens: 1, total_tokens: 2.5 },
    { input_tokens: 2, input_tokens_details: { cached_tokens: 3 }, output_tokens: 1, total_tokens: 3 },
    { input_tokens: 2, output_tokens: 1, output_tokens_details: { reasoning_tokens: 2 }, total_tokens: 3 },
    { input_tokens: 2, output_tokens: 1, total_tokens: 99 },
  ];
  for (const usage of cases) {
    assert.equal(createUsageEvent({ requestedModel: "gpt-4.1-mini", usage }).status, "usage_unavailable");
  }
});

test("料金表は4oの11月版と現在選択可能なモデルを明示する", () => {
  assert.deepEqual(MODEL_PRICING["gpt-4o-2024-11-20"].ratesNanoUsdPerToken, {
    input: 2_500,
    cachedInput: 1_250,
    output: 10_000,
  });
  for (const model of ["gpt-4.1", "gpt-4.1-mini", "gpt-4o-mini", "o4-mini"]) {
    assert.ok(MODEL_PRICING[model]);
  }
  assert.equal(MODEL_PRICING["gpt-4o"], undefined);
});

test("usageイベントへ会話本文を混ぜない", () => {
  const event = createUsageEvent({
    requestedModel: "gpt-4.1-mini",
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  });
  const serialized = JSON.stringify(event);
  for (const key of ["messages", "content", "instructions", "prompt", "output_text"]) {
    assert.ok(!serialized.includes(`\"${key}\"`));
  }
});
