import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendUsageEvents,
  createEmptyCostLedger,
  filterCostEvents,
  FIXED_GPT4O_MODEL,
  formatEventCost,
  formatJpyMicros,
  formatStoredLocalTimestamp,
  formatUsdNano,
  isValidDateKey,
  localDateKey,
  migrateStableModelSettings,
  mergeCostLedgers,
  parseCostLedger,
  parseFxRateToMicros,
  summarizeCostEvents,
  validateDateRange,
} from "./costs.js";

function usageEvent(overrides = {}) {
  return {
    eventId: "resp_cost_1",
    occurredAt: "2026-07-20T03:00:00.000Z",
    purpose: "chat",
    requestedModel: FIXED_GPT4O_MODEL,
    actualModel: FIXED_GPT4O_MODEL,
    requestedServiceTier: "default",
    actualServiceTier: "default",
    status: "estimated",
    pricingVersion: "openai-model-pages-2026-07-20",
    ratesNanoUsdPerToken: { input: 2500, cachedInput: 1250, output: 10000 },
    tokens: { input: 1000, cachedInput: 400, output: 100, reasoningOutput: 0, total: 1100 },
    estimatedUsdNano: "3000000",
    ...overrides,
  };
}

test("既知usageを正確なUSDと呼出時点の円へ固定する", () => {
  const result = appendUsageEvents(createEmptyCostLedger(), [usageEvent()], { usdJpyRate: "160" });
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].usdNano, "3000000");
  assert.equal(result.added[0].fxMicros, "160000000");
  assert.equal(result.added[0].jpyMicros, "480000");
  assert.equal(formatEventCost(result.added[0]), "今回 約¥0.48 ($0.003)");
});

test("同じResponse IDは二重計上しない", () => {
  const first = appendUsageEvents(createEmptyCostLedger(), [usageEvent()], { usdJpyRate: "160" });
  const second = appendUsageEvents(first.ledger, [usageEvent()], { usdJpyRate: "170" });
  assert.equal(second.added.length, 0);
  assert.equal(second.ledger.events.length, 1);
  assert.equal(second.ledger.events[0].fxMicros, "160000000");
});

test("複数タブの新しい記録をResponse IDで結合し、全期間から消さない", () => {
  const tabA = appendUsageEvents(createEmptyCostLedger(1000), [usageEvent({ eventId: "tab-a" })], { usdJpyRate: "160" }).ledger;
  const tabB = appendUsageEvents(createEmptyCostLedger(2000), [usageEvent({ eventId: "tab-b" })], { usdJpyRate: "160" }).ledger;
  const merged = mergeCostLedgers(tabA, tabB);
  assert.deepEqual(new Set(merged.events.map((event) => event.eventId)), new Set(["tab-a", "tab-b"]));
  assert.equal(merged.recordingStartedAt, new Date(1000).toISOString());
});

test("為替変更は新しい呼び出しだけに適用し、過去額を変えない", () => {
  const first = appendUsageEvents(createEmptyCostLedger(), [usageEvent()], { usdJpyRate: "150" });
  const secondEvent = usageEvent({ eventId: "resp_cost_2", occurredAt: "2026-07-21T03:00:00.000Z" });
  const second = appendUsageEvents(first.ledger, [secondEvent], { usdJpyRate: "160" });
  assert.equal(second.ledger.events[0].jpyMicros, "450000");
  assert.equal(second.ledger.events[1].jpyMicros, "480000");
});

test("為替未設定はUSDを保存し、0円とは表示しない", () => {
  const result = appendUsageEvents(createEmptyCostLedger(), [usageEvent()], { usdJpyRate: "" });
  assert.equal(result.added[0].jpyMicros, null);
  assert.match(formatEventCost(result.added[0]), /円換算レート未設定/);
  assert.doesNotMatch(formatEventCost(result.added[0]), /¥0/);
});

test("usageまたは料金がないイベントは算出不可のまま記録する", () => {
  const unavailable = usageEvent({
    eventId: "resp_unavailable",
    status: "usage_unavailable",
    tokens: null,
    ratesNanoUsdPerToken: null,
    estimatedUsdNano: null,
  });
  const result = appendUsageEvents(createEmptyCostLedger(), [unavailable], { usdJpyRate: "160" });
  assert.equal(result.added[0].usdNano, null);
  assert.equal(result.added[0].jpyMicros, null);
  assert.match(formatEventCost(result.added[0]), /算出不可/);
});

test("期間指定はローカル日付の開始日と終了日を両方含む", () => {
  const base = createEmptyCostLedger();
  const events = [
    usageEvent({ eventId: "a", occurredAt: new Date(2026, 6, 19, 12).toISOString() }),
    usageEvent({ eventId: "b", occurredAt: new Date(2026, 6, 20, 12).toISOString() }),
    usageEvent({ eventId: "c", occurredAt: new Date(2026, 6, 21, 12).toISOString() }),
  ];
  const result = appendUsageEvents(base, events, { usdJpyRate: "160" });
  assert.deepEqual(filterCostEvents(result.ledger.events, "2026-07-19", "2026-07-20").map((event) => event.eventId), ["a", "b"]);
});

test("集計はUSDを全件、円は換算済みだけ加算し不足件数も示す", () => {
  const first = appendUsageEvents(createEmptyCostLedger(), [usageEvent()], { usdJpyRate: "160" });
  const second = appendUsageEvents(first.ledger, [usageEvent({ eventId: "b" })], { usdJpyRate: "" });
  const unavailable = appendUsageEvents(second.ledger, [usageEvent({
    eventId: "c", status: "pricing_unavailable", estimatedUsdNano: null,
  })], { usdJpyRate: "160" });
  const summary = summarizeCostEvents(unavailable.ledger.events);
  assert.equal(summary.callCount, 3);
  assert.equal(summary.usdNano, "6000000");
  assert.equal(summary.jpyMicros, "480000");
  assert.equal(summary.unconvertedCount, 1);
  assert.equal(summary.unavailableCount, 1);
});

test("壊れた台帳を無言で正常扱いせず、既存rawを上書きしない判断材料を返す", () => {
  assert.equal(parseCostLedger("{broken").ok, false);
  assert.equal(parseCostLedger(JSON.stringify({ schemaVersion: 99, events: [] })).ok, false);
  const malformedEvent = createEmptyCostLedger(0);
  malformedEvent.events.push({ ...usageEvent(), recordedAt: "not-a-date", localDate: "2026-07-20" });
  assert.equal(parseCostLedger(JSON.stringify(malformedEvent)).ok, false);
  const valid = parseCostLedger(JSON.stringify(createEmptyCostLedger(0)));
  assert.equal(valid.ok, true);
});

test("台帳イベントに会話本文や回答を複製しない", () => {
  const provider = usageEvent({ prompt: "secret", text: "answer", messages: ["private"] });
  const { added } = appendUsageEvents(createEmptyCostLedger(), [provider], { usdJpyRate: "160" });
  assert.ok(!("prompt" in added[0]));
  assert.ok(!("text" in added[0]));
  assert.ok(!("messages" in added[0]));
});

test("gpt-4o aliasだけを11月固定版へ明示移行する", () => {
  const migrated = migrateStableModelSettings({ model: "gpt-4o", theme: "dark" });
  assert.equal(migrated.changed, true);
  assert.equal(migrated.settings.model, "gpt-4o-2024-11-20");
  assert.equal(migrated.settings.theme, "dark");
  assert.equal(migrateStableModelSettings({ model: "gpt-4.1-mini" }).changed, false);
});

test("為替・日付の入力を厳密に検証する", () => {
  assert.equal(parseFxRateToMicros("157.25"), "157250000");
  assert.equal(parseFxRateToMicros("0"), null);
  assert.equal(parseFxRateToMicros("not-a-rate"), null);
  assert.equal(isValidDateKey("2026-02-29"), false);
  assert.equal(isValidDateKey("2026-07-20"), true);
  assert.equal(validateDateRange("2026-07-21", "2026-07-20").ok, false);
  assert.equal(localDateKey(new Date(2026, 6, 20, 12)), "2026-07-20");
});

test("1円未満を0円へ丸めずに表示する", () => {
  assert.equal(formatJpyMicros("114695"), "¥0.1147");
  assert.equal(formatUsdNano("725000"), "$0.000725");
});

test("移動後も履歴日時を記録時のローカル日付とUTC offsetで表示する", () => {
  assert.equal(formatStoredLocalTimestamp({
    occurredAt: "2026-07-20T03:00:00.000Z",
    localDate: "2026-07-20",
    timezoneOffsetMinutes: -540,
  }), "2026-07-20 12:00:00 (UTC+09:00)");
});
