import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  MINTROOM_STORAGE_KEYS,
  applyImportPlan,
  backupFilename,
  checkImportPlanCurrent,
  createBackupDocument,
  finalizeImportPlan,
  inspectBackupDocument,
  inspectBackupText,
  isBackupFileSizeAllowed,
  prepareImport,
  serializeBackupDocument,
} from "./backup.js";
import { appendUsageEvents, createEmptyCostLedger, parseCostLedger } from "./costs.js";

const NOW = Date.parse("2026-07-20T03:00:00.000Z");

class FakeStorage {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries).map(([key, value]) => [String(key), String(value)]));
    this.setCalls = 0;
    this.removeCalls = 0;
    this.getCalls = 0;
    this.failSetCalls = new Set();
    this.failSetKeys = new Set();
    this.failRemoveCalls = new Set();
    this.failGetCalls = new Set();
    this.maxStoredCharacters = Number.POSITIVE_INFINITY;
    this.operations = [];
  }

  get length() {
    return this.map.size;
  }

  key(index) {
    return [...this.map.keys()][index] ?? null;
  }

  getItem(key) {
    this.getCalls += 1;
    if (this.failGetCalls.has(this.getCalls)) throw new Error("read failed");
    return this.map.has(String(key)) ? this.map.get(String(key)) : null;
  }

  setItem(key, value) {
    this.setCalls += 1;
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    this.operations.push({ type: "set", key: normalizedKey });
    const nextSize = [...this.map].reduce((total, [currentKey, currentValue]) =>
      total + (currentKey === normalizedKey ? 0 : currentValue.length), 0) + normalizedValue.length;
    if (this.failSetCalls.has(this.setCalls) || this.failSetKeys.has(normalizedKey) || nextSize > this.maxStoredCharacters) {
      const error = new Error("quota exceeded");
      error.name = "QuotaExceededError";
      throw error;
    }
    this.map.set(normalizedKey, normalizedValue);
  }

  removeItem(key) {
    this.removeCalls += 1;
    this.operations.push({ type: "remove", key: String(key) });
    if (this.failRemoveCalls.has(this.removeCalls)) throw new Error("remove failed");
    this.map.delete(String(key));
  }

  snapshot() {
    return Object.fromEntries([...this.map].sort(([left], [right]) => left.localeCompare(right)));
  }
}

function knownRaw(overrides = {}) {
  return {
    [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({ theme: "dark", model: "gpt-4o-2024-11-20", usdJpyRate: "160" }),
    [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: [{ role: "user", content: "秘密の日本語 🍵", ts: NOW }] }),
    [MINTROOM_STORAGE_KEYS.life]: JSON.stringify({ tasks: [{ text: "牛乳", done: false }], shopping: [], medication: [] }),
    [MINTROOM_STORAGE_KEYS.diary]: JSON.stringify({ entries: { "2026-07-20": { text: "よい日", generatedAt: NOW, mock: false } } }),
    [MINTROOM_STORAGE_KEYS.news]: JSON.stringify({ interests: ["AI"], hiddenIds: [], lastResult: null }),
    [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(createEmptyCostLedger(NOW)),
    ...overrides,
  };
}

function validDocument(overrides = {}, extraEntries = []) {
  const entries = Object.entries(knownRaw(overrides)).map(([key, raw]) => ({ key, present: true, raw }));
  entries.push(...extraEntries);
  entries.sort((left, right) => left.key.localeCompare(right.key));
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date(NOW).toISOString(),
    entries,
  };
}

function inspect(document) {
  return inspectBackupText(serializeBackupDocument(document));
}

function validUsageEvent(eventId = "resp_backup_1") {
  return {
    eventId,
    occurredAt: "2026-07-20T03:00:00.000Z",
    purpose: "chat",
    requestedModel: "gpt-4o-2024-11-20",
    actualModel: "gpt-4o-2024-11-20",
    requestedServiceTier: "default",
    actualServiceTier: "default",
    status: "estimated",
    pricingVersion: "test-pricing-v1",
    ratesNanoUsdPerToken: { input: 2500, cachedInput: 1250, output: 10000 },
    tokens: { input: 100, cachedInput: 10, output: 20, reasoningOutput: 0, total: 120 },
    estimatedUsdNano: "437500",
  };
}

function validCostEvent(eventId = "resp_backup_1") {
  const usage = validUsageEvent(eventId);
  return appendUsageEvents(createEmptyCostLedger(NOW), [usage], { usdJpyRate: "160", recordedAt: NOW }).ledger.events[0];
}

function preparedPlan(storage, document, options = {}) {
  const inspection = inspect(document);
  assert.equal(inspection.ok, true);
  const prepared = prepareImport(storage, inspection.inspection, NOW);
  assert.equal(prepared.ok, true);
  return finalizeImportPlan(prepared.prepared, options);
}

test("exportはmintroom名前空間だけをraw文字列のまま保存する", () => {
  const raw = knownRaw();
  const storage = new FakeStorage({
    ...raw,
    "mintroom.future.v9": "日本語を変えない\n{not-json}",
    "other.apiKey": "sk-must-not-export",
  });
  const document = createBackupDocument(storage, NOW);
  const byKey = new Map(document.entries.map((entry) => [entry.key, entry]));

  assert.equal(byKey.get(MINTROOM_STORAGE_KEYS.chat).raw, raw[MINTROOM_STORAGE_KEYS.chat]);
  assert.equal(byKey.get("mintroom.future.v9").raw, "日本語を変えない\n{not-json}");
  assert.equal(byKey.has("other.apiKey"), false);
  assert.deepEqual(document.entries.map((entry) => entry.key), [...document.entries.map((entry) => entry.key)].sort());
});

test("存在しない既知キーは削除マーカーとしてexportする", () => {
  const document = createBackupDocument(new FakeStorage(), NOW);
  assert.equal(document.entries.length, Object.keys(MINTROOM_STORAGE_KEYS).length);
  assert.ok(document.entries.every((entry) => entry.present === false && !("raw" in entry)));
});

test("ファイル名はUTCではなく端末のローカル日付を使う", () => {
  const local = new Date(2026, 0, 2, 0, 30);
  assert.equal(backupFilename(local), "mint-room-backup-2026-01-02.json");
});

test("空・壊れたJSON・別形式・旧版をimport対象にしない", () => {
  assert.equal(inspectBackupText("").ok, false);
  assert.equal(inspectBackupText("{broken").ok, false);
  assert.equal(inspectBackupDocument({ format: "another-app", formatVersion: 1 }).ok, false);
  assert.equal(inspectBackupDocument({ ...validDocument(), formatVersion: 0 }).ok, false);
});

test("サイズ上限を境界値どおりに判定する", () => {
  assert.equal(isBackupFileSizeAllowed(MAX_BACKUP_BYTES), true);
  assert.equal(isBackupFileSizeAllowed(MAX_BACKUP_BYTES + 1), false);
  assert.equal(inspectBackupText("x".repeat(101), { maxBytes: 100 }).ok, false);
});

test("欠落・重複・名前空間外・不正な削除マーカーを拒否する", () => {
  const missing = validDocument();
  missing.entries.pop();
  assert.equal(inspect(missing).ok, false);

  const duplicate = validDocument();
  duplicate.entries.push({ ...duplicate.entries[0] });
  assert.equal(inspect(duplicate).ok, false);

  assert.equal(inspect(validDocument({}, [{ key: "foreign.key", present: true, raw: "x" }])).ok, false);
  assert.equal(inspect(validDocument({}, [{ key: "mintroom.future.v1", present: false }])).ok, false);
});

test("既知データのschemaを検証し、未知のmintroomキーはrawのまま許可する", () => {
  const invalidChat = inspect(validDocument({ [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: "not-an-array" }) }));
  assert.equal(invalidChat.ok, true);
  assert.deepEqual(invalidChat.inspection.invalidCategories.map((item) => item.key), [MINTROOM_STORAGE_KEYS.chat]);

  const futureRaw = '{"__proto__":{"polluted":true},"自由":"値"}';
  const future = inspect(validDocument({}, [{ key: "mintroom.future.v1", present: true, raw: futureRaw }]));
  assert.equal(future.ok, true);
  assert.equal(future.inspection.entries.find((entry) => entry.key === "mintroom.future.v1").raw, futureRaw);
  assert.equal({}.polluted, undefined);
});

test("previewは件数だけを返し、会話本文を複製しない", () => {
  const result = inspect(validDocument());
  assert.equal(result.ok, true);
  assert.match(result.inspection.previewItems.find((item) => item.key === MINTROOM_STORAGE_KEYS.chat).detail, /^1/);
  assert.doesNotMatch(JSON.stringify(result.inspection.previewItems), /秘密の日本語/);
});

test("正常な利用額台帳は修復確認なしで復元できる", () => {
  const ledger = createEmptyCostLedger(NOW);
  ledger.events.push(validCostEvent());
  const document = validDocument({ [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(ledger) });
  const result = inspect(document);
  assert.equal(result.ok, true);
  assert.equal(result.inspection.costRecovery, null);
});

test("一部だけ壊れた利用額台帳は有効な一意イベントだけを救出する", () => {
  const event = validCostEvent();
  const broken = {
    schemaVersion: 1,
    recordingStartedAt: new Date(NOW).toISOString(),
    events: [event, { eventId: "broken", recordedAt: "not-a-date" }],
  };
  const result = inspect(validDocument({ [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(broken) }));
  assert.equal(result.ok, true);
  assert.equal(result.inspection.costRecovery.status, "recoverable");
  assert.equal(result.inspection.costRecovery.recoveredCount, 1);
  assert.equal(result.inspection.costRecovery.rejectedCount, 1);
  assert.equal(parseCostLedger(result.inspection.costRecovery.recoveredRaw).ledger.events[0].eventId, event.eventId);
});

test("重複IDはどちらかを推測採用せず両方を除外する", () => {
  const event = validCostEvent("duplicate");
  const broken = {
    schemaVersion: 1,
    recordingStartedAt: new Date(NOW).toISOString(),
    events: [event, { ...event }],
  };
  const result = inspect(validDocument({ [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(broken) }));
  assert.equal(result.inspection.costRecovery.recoveredCount, 0);
  assert.equal(result.inspection.costRecovery.rejectedCount, 2);
});

test("解析不能な利用額台帳は明示同意がある場合だけ0件から再開する", () => {
  const document = validDocument({ [MINTROOM_STORAGE_KEYS.costs]: "{broken" });
  const storage = new FakeStorage(knownRaw());
  const inspection = inspect(document);
  assert.equal(inspection.inspection.costRecovery.status, "unrecoverable");
  const prepared = prepareImport(storage, inspection.inspection, NOW);
  assert.equal(finalizeImportPlan(prepared.prepared).ok, false);
  const resetAt = NOW + 123_456;
  const finalized = finalizeImportPlan(prepared.prepared, { costRecoveryChoice: "reset", resetAt });
  assert.equal(finalized.ok, true);
  const importedCost = finalized.plan.entries.find((entry) => entry.key === MINTROOM_STORAGE_KEYS.costs);
  const parsed = parseCostLedger(importedCost.raw);
  assert.equal(parsed.ledger.events.length, 0);
  assert.equal(parsed.ledger.recordingStartedAt, new Date(resetAt).toISOString());
});

test("壊れた既知カテゴリは明示同意でスキップし、正常カテゴリの復元を塞がない", () => {
  const currentChat = JSON.stringify({ messages: [{ role: "user", content: "現在を守る" }] });
  const storage = new FakeStorage(knownRaw({ [MINTROOM_STORAGE_KEYS.chat]: currentChat }));
  const document = validDocument({ [MINTROOM_STORAGE_KEYS.chat]: "{broken" });
  const inspected = inspect(document);
  const prepared = prepareImport(storage, inspected.inspection, NOW);
  assert.equal(prepared.prepared.counts.skippedInvalidCount, 1);
  assert.equal(finalizeImportPlan(prepared.prepared).ok, false);
  const finalized = finalizeImportPlan(prepared.prepared, { invalidCategoryChoice: "skip" });
  assert.equal(finalized.ok, true);
  assert.equal(applyImportPlan(storage, finalized.plan).ok, true);
  assert.equal(storage.getItem(MINTROOM_STORAGE_KEYS.chat), currentChat);
  assert.equal(storage.getItem(MINTROOM_STORAGE_KEYS.settings), knownRaw()[MINTROOM_STORAGE_KEYS.settings]);
});

test("previewと計画作成はlocalStorageを変更しない", () => {
  const storage = new FakeStorage(knownRaw({ [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({ theme: "light" }) }));
  const before = storage.snapshot();
  const inspected = inspect(validDocument());
  const prepared = prepareImport(storage, inspected.inspection, NOW);
  const finalized = finalizeImportPlan(prepared.prepared);
  assert.equal(finalized.ok, true);
  assert.deepEqual(storage.snapshot(), before);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.removeCalls, 0);
});

test("確定時は既知キーを正確に復元し、backupにない既存の未知キーを残す", () => {
  const before = knownRaw({ [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: [] }) });
  delete before[MINTROOM_STORAGE_KEYS.diary];
  const storage = new FakeStorage({ ...before, "mintroom.local-only.v1": "keep-me" });
  const document = validDocument({}, [{ key: "mintroom.from-backup.v1", present: true, raw: "raw-future" }]);
  document.entries = document.entries.map((entry) => entry.key === MINTROOM_STORAGE_KEYS.news ? { key: entry.key, present: false } : entry);
  const finalized = preparedPlan(storage, document);
  assert.equal(finalized.ok, true);
  assert.equal(applyImportPlan(storage, finalized.plan).ok, true);
  assert.equal(storage.getItem(MINTROOM_STORAGE_KEYS.chat), knownRaw()[MINTROOM_STORAGE_KEYS.chat]);
  assert.equal(storage.getItem(MINTROOM_STORAGE_KEYS.news), null);
  assert.equal(storage.getItem("mintroom.from-backup.v1"), "raw-future");
  assert.equal(storage.getItem("mintroom.local-only.v1"), "keep-me");
});

test("現在と衝突する未知の将来キーは古いbackupで上書きしない", () => {
  const storage = new FakeStorage({ ...knownRaw(), "mintroom.future.v3": "current-new-format" });
  const document = validDocument({}, [{ key: "mintroom.future.v3", present: true, raw: "backup-old-format" }]);
  const inspection = inspect(document);
  const prepared = prepareImport(storage, inspection.inspection, NOW);
  assert.equal(prepared.prepared.counts.protectedUnknownCount, 1);
  const finalized = finalizeImportPlan(prepared.prepared);
  assert.equal(applyImportPlan(storage, finalized.plan).ok, true);
  assert.equal(storage.getItem("mintroom.future.v3"), "current-new-format");
});

test("export後に保存領域が空になっても全データをbyte単位で往復できる", () => {
  const sourceRaw = { ...knownRaw(), "mintroom.future.v2": "将来データ\n🍵" };
  const exported = createBackupDocument(new FakeStorage(sourceRaw), NOW);
  const inspection = inspect(exported);
  assert.equal(inspection.ok, true);
  const emptyTarget = new FakeStorage();
  const prepared = prepareImport(emptyTarget, inspection.inspection, NOW);
  const finalized = finalizeImportPlan(prepared.prepared);
  assert.equal(finalized.ok, true);
  assert.equal(applyImportPlan(emptyTarget, finalized.plan).ok, true);
  assert.deepEqual(emptyTarget.snapshot(), new FakeStorage(sourceRaw).snapshot());
});

test("実際の全6スキーマを満たす非空データもrawのまま一括往復できる", () => {
  const costEvent = validCostEvent("rich-roundtrip");
  const richRaw = {
    [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({
      theme: "dark", model: "gpt-4o-2024-11-20", reasoningEffort: "medium",
      responseFormat: "text", temperature: 0.7, topP: 1, maxOutputTokens: 16384,
      historyLimit: 80, developerInstructions: "短くやさしく", persona: "mint",
      moderationPrecheck: false, store: false, skillPacksEnabled: true,
      safetyMode: "balanced", moderationBehavior: "warn", promptCacheKey: "room",
      usdJpyRate: "160.25",
    }),
    [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: [
      { role: "user", content: "卵料理を教えて", ts: NOW - 1000 },
      {
        role: "assistant", content: "オムレツにしよう", ts: NOW,
        activeSkills: [{ id: "cooking", label: "料理" }],
        costEventIds: [costEvent.eventId],
      },
    ] }),
    [MINTROOM_STORAGE_KEYS.life]: JSON.stringify({
      wakeTime: "07:30", sleepTime: "23:45",
      tasks: [{ text: "散歩", done: true }],
      shopping: [{ text: "卵", done: false }],
      medication: [{ text: "ビタミン", done: true }],
    }),
    [MINTROOM_STORAGE_KEYS.diary]: JSON.stringify({ entries: {
      "2026-07-20": { text: "料理を楽しんだ日", generatedAt: NOW, mock: false, costEventIds: [costEvent.eventId] },
    } }),
    [MINTROOM_STORAGE_KEYS.news]: JSON.stringify({
      interests: ["AI", "料理"], hiddenIds: ["hidden-1"],
      lastResult: {
        items: [{
          id: "news-1", lane: "interest", confidence: "公式", distress: "low",
          source: "Mint News", title: "やさしい更新", link: "https://example.com/news-1",
          summary: "概要", gentle_summary: "やさしい概要", ai_comment: "あとで読めます。",
        }],
        feedErrors: ["one feed unavailable"], costEventIds: [costEvent.eventId],
      },
    }),
    [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify({ ...createEmptyCostLedger(NOW), events: [costEvent] }),
    "mintroom.future.rich": "未知データ\n🍵",
  };
  const exported = createBackupDocument(new FakeStorage(richRaw), NOW);
  const inspection = inspect(exported);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.inspection.costRecovery, null);
  assert.deepEqual(inspection.inspection.invalidCategories, []);

  const emptyTarget = new FakeStorage();
  const prepared = prepareImport(emptyTarget, inspection.inspection, NOW);
  const finalized = finalizeImportPlan(prepared.prepared);
  assert.equal(finalized.ok, true);
  assert.equal(applyImportPlan(emptyTarget, finalized.plan).ok, true);
  assert.deepEqual(emptyTarget.snapshot(), new FakeStorage(richRaw).snapshot());
});

test("破損台帳を含むexportから有効イベントを救出して記録可能な台帳へ戻す", () => {
  const event = validCostEvent("recover-roundtrip");
  const corruptCost = JSON.stringify({
    schemaVersion: 1,
    recordingStartedAt: new Date(NOW).toISOString(),
    events: [event, { eventId: "invalid-roundtrip", occurredAt: false }],
  });
  const source = new FakeStorage(knownRaw({ [MINTROOM_STORAGE_KEYS.costs]: corruptCost }));
  const exported = createBackupDocument(source, NOW);
  assert.equal(exported.entries.find((entry) => entry.key === MINTROOM_STORAGE_KEYS.costs).raw, corruptCost);
  const inspection = inspect(exported);
  const emptyTarget = new FakeStorage();
  const prepared = prepareImport(emptyTarget, inspection.inspection, NOW);
  const finalized = finalizeImportPlan(prepared.prepared, { costRecoveryChoice: "repair" });
  assert.equal(applyImportPlan(emptyTarget, finalized.plan).ok, true);
  const restored = parseCostLedger(emptyTarget.getItem(MINTROOM_STORAGE_KEYS.costs));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.ledger.events.map((item) => item.eventId), [event.eventId]);
  const appended = appendUsageEvents(restored.ledger, [validUsageEvent("after-repair")], { usdJpyRate: "160", recordedAt: NOW + 1 });
  assert.equal(appended.added.length, 1);
  assert.deepEqual(appended.ledger.events.map((item) => item.eventId), [event.eventId, "after-repair"]);
});

test("preview後に別タブが変更した場合は1件も書き込まない", () => {
  const storage = new FakeStorage(knownRaw());
  const finalized = preparedPlan(storage, validDocument({ [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({ theme: "light" }) }));
  storage.map.set(MINTROOM_STORAGE_KEYS.chat, JSON.stringify({ messages: [{ role: "user", content: "別タブ" }] }));
  const beforeApply = storage.snapshot();
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.changedSincePreview, true);
  assert.deepEqual(storage.snapshot(), beforeApply);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.removeCalls, 0);
});

test("事前再確認は現在値の緊急backupを返し、writeしない", () => {
  const storage = new FakeStorage(knownRaw());
  const finalized = preparedPlan(storage, validDocument({ [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({ theme: "light" }) }));
  const beforeOperations = storage.operations.length;
  const checked = checkImportPlanCurrent(storage, finalized.plan);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.currentBackup.entries, finalized.plan.beforeBackup.entries);
  assert.equal(storage.operations.length, beforeOperations);
});

test("利用額は明示削除してから復元し、別タブへ置換意図を順番に通知する", () => {
  const storage = new FakeStorage(knownRaw());
  const finalized = preparedPlan(storage, validDocument());
  assert.equal(applyImportPlan(storage, finalized.plan).ok, true);
  const costOperations = storage.operations.filter((item) => item.key === MINTROOM_STORAGE_KEYS.costs);
  assert.deepEqual(costOperations.slice(0, 2).map((item) => item.type), ["remove", "set"]);
});

test("途中の容量エラーでは変更前rawへbyte単位でrollbackする", () => {
  const original = knownRaw({ [MINTROOM_STORAGE_KEYS.chat]: '{"messages":[]}\n' });
  const storage = new FakeStorage(original);
  const before = storage.snapshot();
  const finalized = preparedPlan(storage, validDocument());
  storage.failSetCalls.add(2);
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackOk, true);
  assert.deepEqual(storage.snapshot(), before);
});

test("rollbackの一時失敗は容量解放後に再試行して全項目を復元する", () => {
  const original = knownRaw();
  const storage = new FakeStorage(original);
  const finalized = preparedPlan(storage, validDocument({ [MINTROOM_STORAGE_KEYS.settings]: JSON.stringify({ theme: "light" }) }));
  storage.failSetCalls.add(2);
  storage.failSetCalls.add(3);
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackOk, true);
  assert.deepEqual(storage.snapshot(), new FakeStorage(original).snapshot());
});

test("rollbackの永続失敗でも失敗したkey以外の元データを削除しない", () => {
  const original = knownRaw();
  const storage = new FakeStorage(original);
  const finalized = preparedPlan(storage, validDocument());
  storage.failSetKeys.add(MINTROOM_STORAGE_KEYS.costs);
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackOk, false);
  const snapshot = storage.snapshot();
  assert.equal(snapshot[MINTROOM_STORAGE_KEYS.costs], undefined);
  for (const [key, raw] of Object.entries(original).filter(([key]) => key !== MINTROOM_STORAGE_KEYS.costs)) {
    assert.equal(snapshot[key], raw);
  }
  assert.equal(Object.keys(snapshot).length, Object.keys(original).length - 1);
});

test("容量不足rollbackは先に大きい現在値を縮めて削除済みcostを復元する", () => {
  const original = knownRaw({
    [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(200) }] }),
    [MINTROOM_STORAGE_KEYS.news]: JSON.stringify({ interests: [], hiddenIds: [], lastResult: null }),
    [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(createEmptyCostLedger(NOW)),
  });
  const ledger = appendUsageEvents(createEmptyCostLedger(NOW), [{
    eventId: "quota-rollback",
    occurredAt: new Date(NOW).toISOString(),
    purpose: "chat",
    requestedModel: "gpt-4o-2024-11-20",
    actualModel: "gpt-4o-2024-11-20",
    requestedServiceTier: "default",
    actualServiceTier: "default",
    status: "estimated",
    pricingVersion: "test-pricing-v1",
    ratesNanoUsdPerToken: { input: 2500, cachedInput: 1250, output: 10000 },
    tokens: { input: 1, cachedInput: 0, output: 1, reasoningOutput: 0, total: 2 },
    estimatedUsdNano: "12500",
  }], { recordedAt: NOW }).ledger;
  const document = validDocument({
    [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages: [{ role: "user", content: "x".repeat(230) }] }),
    [MINTROOM_STORAGE_KEYS.costs]: JSON.stringify(ledger),
  });
  document.entries = document.entries.map((entry) => entry.key === MINTROOM_STORAGE_KEYS.news
    ? { key: entry.key, present: false }
    : entry);

  const storage = new FakeStorage(original);
  storage.maxStoredCharacters = Object.values(original).reduce((total, raw) => total + raw.length, 0);
  const finalized = preparedPlan(storage, document);
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackAttempted, true);
  assert.equal(result.rollbackOk, true);
  assert.deepEqual(storage.snapshot(), new FakeStorage(original).snapshot());
});

test("極端に多い描画項目はカテゴリ単位でスキップ対象にする", () => {
  const messages = Array.from({ length: 10_001 }, () => ({ role: "user", content: "x" }));
  const inspected = inspect(validDocument({ [MINTROOM_STORAGE_KEYS.chat]: JSON.stringify({ messages }) }));
  assert.equal(inspected.ok, true);
  assert.deepEqual(inspected.inspection.invalidCategories.map((item) => item.key), [MINTROOM_STORAGE_KEYS.chat]);
});

test("現在値の事前読取りに失敗した場合はrollbackせず停止する", () => {
  const storage = new FakeStorage(knownRaw());
  const finalized = preparedPlan(storage, validDocument());
  storage.failGetCalls.add(storage.getCalls + 1);
  const result = applyImportPlan(storage, finalized.plan);
  assert.equal(result.ok, false);
  assert.equal(result.rollbackAttempted, false);
  assert.equal(storage.setCalls, 0);
  assert.equal(storage.removeCalls, 0);
});
