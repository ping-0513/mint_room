// mint roomの端末内データをraw文字列のまま保全し、安全に復元する純ロジック。

import {
  COST_LEDGER_KEY,
  createEmptyCostLedger,
  isValidDateKey,
  parseCostLedger,
  parseFxRateToMicros,
} from "./costs.js";

export const BACKUP_FORMAT = "mint-room-backup";
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_BYTES = 32 * 1024 * 1024;
export const MAX_BACKUP_ENTRIES = 5000;
export const MINTROOM_STORAGE_PREFIX = "mintroom.";

export const MINTROOM_STORAGE_KEYS = Object.freeze({
  settings: "mintroom.settings.v1",
  chat: "mintroom.chat.v1",
  life: "mintroom.life.v1",
  diary: "mintroom.diary.v1",
  news: "mintroom.news.v1",
  costs: COST_LEDGER_KEY,
});

const KNOWN_KEYS = Object.freeze(Object.values(MINTROOM_STORAGE_KEYS));
const KNOWN_KEY_SET = new Set(KNOWN_KEYS);
const MAX_KEY_LENGTH = 200;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_LIST_ITEMS = 5000;
const MAX_CHAT_MESSAGES = 10_000;
const MAX_NEWS_ITEMS = 2000;

const LABELS = Object.freeze({
  [MINTROOM_STORAGE_KEYS.settings]: "設定",
  [MINTROOM_STORAGE_KEYS.chat]: "会話",
  [MINTROOM_STORAGE_KEYS.life]: "Life",
  [MINTROOM_STORAGE_KEYS.diary]: "日記",
  [MINTROOM_STORAGE_KEYS.news]: "ニュース",
  [MINTROOM_STORAGE_KEYS.costs]: "利用料金",
});

export function isBackupFileSizeAllowed(size, maxBytes = MAX_BACKUP_BYTES) {
  return Number.isSafeInteger(size) && size >= 0 && size <= maxBytes;
}

export function createBackupDocument(storage, now = Date.now()) {
  const exportedAt = toIso(now);
  const current = readMintRoomStorage(storage);
  const entries = [];

  for (const key of KNOWN_KEYS) {
    if (current.has(key)) entries.push({ key, present: true, raw: current.get(key) });
    else entries.push({ key, present: false });
  }
  for (const [key, raw] of current) {
    if (!KNOWN_KEY_SET.has(key)) entries.push({ key, present: true, raw });
  }
  entries.sort((left, right) => left.key.localeCompare(right.key));
  return { format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, exportedAt, entries };
}

export function serializeBackupDocument(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function backupFilename(now = Date.now(), prefix = "mint-room-backup") {
  const date = toDate(now);
  const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `${prefix}-${localDate}.json`;
}

export function inspectBackupText(text, { maxBytes = MAX_BACKUP_BYTES } = {}) {
  if (typeof text !== "string") return fail("バックアップファイルを文字データとして読み取れませんでした。");
  const normalizedText = text.replace(/^\uFEFF/, "");
  if (!normalizedText.trim()) return fail("バックアップファイルが空です。");
  if (new TextEncoder().encode(normalizedText).byteLength > maxBytes) {
    return fail(`バックアップファイルが大きすぎます（上限${formatBytes(maxBytes)}）。`);
  }

  let value;
  try {
    value = JSON.parse(normalizedText);
  } catch {
    return fail("JSONを読み取れませんでした。壊れたファイルや別形式のファイルは復元できません。");
  }
  return inspectBackupDocument(value);
}

export function inspectBackupDocument(value) {
  if (!isPlainObject(value) || value.format !== BACKUP_FORMAT || value.formatVersion !== BACKUP_FORMAT_VERSION) {
    return fail("mint room形式のバックアップではありません。形式バージョン1のファイルを選んでください。");
  }
  if (normalizeIso(value.exportedAt) !== value.exportedAt) {
    return fail("バックアップ日時を確認できませんでした。");
  }
  if (!Array.isArray(value.entries) || value.entries.length > MAX_BACKUP_ENTRIES) {
    return fail(`保存項目の形式を読み取れません（上限${MAX_BACKUP_ENTRIES}件）。`);
  }

  const seen = new Set();
  const normalizedEntries = [];
  const previewItems = [];
  const invalidCategories = [];
  let otherCount = 0;
  let costRecovery = null;

  for (const candidate of value.entries) {
    const normalized = normalizeBackupEntry(candidate);
    if (!normalized.ok) return normalized;
    const entry = normalized.entry;
    if (seen.has(entry.key)) return fail(`同じ保存項目「${entry.key}」が重複しています。`);
    seen.add(entry.key);
    normalizedEntries.push(entry);

    if (!KNOWN_KEY_SET.has(entry.key)) {
      otherCount += 1;
      continue;
    }
    if (!entry.present) {
      previewItems.push({ key: entry.key, label: LABELS[entry.key], detail: "データなし" });
      continue;
    }

    if (entry.key === MINTROOM_STORAGE_KEYS.costs) {
      const parsed = parseCostLedger(entry.raw);
      if (parsed.ok) {
        previewItems.push({ key: entry.key, label: LABELS[entry.key], detail: `${parsed.ledger.events.length}回分` });
      } else {
        costRecovery = recoverCostLedgerRaw(entry.raw, value.exportedAt);
        const detail = costRecovery.status === "recoverable"
          ? `${costRecovery.recoveredCount}回分を救出可能・${costRecovery.rejectedCount}件を除外`
          : "履歴内容を解析できないため0件から再開";
        previewItems.push({ key: entry.key, label: LABELS[entry.key], detail });
      }
      continue;
    }

    const validated = validateKnownRaw(entry.key, entry.raw);
    if (!validated.ok) {
      invalidCategories.push({ key: entry.key, label: LABELS[entry.key], error: validated.error });
      previewItems.push({ key: entry.key, label: LABELS[entry.key], detail: "破損（Import対象外）" });
      continue;
    }
    previewItems.push({ key: entry.key, label: LABELS[entry.key], detail: validated.detail });
  }

  for (const key of KNOWN_KEYS) {
    if (!seen.has(key)) return fail(`${LABELS[key]}の有無が記録されていないため、完全なバックアップとして復元できません。`);
  }

  normalizedEntries.sort((left, right) => left.key.localeCompare(right.key));
  previewItems.sort((left, right) => KNOWN_KEYS.indexOf(left.key) - KNOWN_KEYS.indexOf(right.key));
  return {
    ok: true,
    inspection: {
      exportedAt: value.exportedAt,
      entries: normalizedEntries,
      previewItems,
      otherCount,
      costRecovery,
      invalidCategories,
    },
  };
}

export function prepareImport(storage, inspection, now = Date.now()) {
  if (!inspection || !Array.isArray(inspection.entries)) return fail("復元内容を準備できませんでした。");
  try {
    const beforeBackup = createBackupDocument(storage, now);
    const beforeInspection = inspectBackupText(serializeBackupDocument(beforeBackup));
    if (!beforeInspection.ok) {
      return fail(`復元前バックアップを作れないため、Importを開始しません。${beforeInspection.error}`);
    }
    const before = new Map(beforeBackup.entries.filter((entry) => entry.present).map((entry) => [entry.key, entry.raw]));
    const invalidKeys = new Set((inspection.invalidCategories ?? []).map((item) => item.key));
    const importEntries = [];
    let newCount = 0;
    let overwriteCount = 0;
    let removeCount = 0;
    let unchangedCount = 0;
    let protectedUnknownCount = 0;
    let skippedInvalidCount = 0;
    for (const entry of inspection.entries) {
      if (invalidKeys.has(entry.key)) {
        skippedInvalidCount += 1;
        continue;
      }
      const exists = before.has(entry.key);
      if (!KNOWN_KEY_SET.has(entry.key) && exists && before.get(entry.key) !== entry.raw) {
        // 現在のアプリが解釈できない将来データは、古いbackupで黙って上書きしない。
        protectedUnknownCount += 1;
        continue;
      }
      importEntries.push(entry);
      if (!entry.present) {
        if (exists) removeCount += 1;
        else unchangedCount += 1;
      } else if (!exists) newCount += 1;
      else if (before.get(entry.key) === entry.raw && entry.key !== MINTROOM_STORAGE_KEYS.costs) unchangedCount += 1;
      else overwriteCount += 1;
    }
    return {
      ok: true,
      prepared: {
        inspection,
        importEntries,
        beforeBackup,
        counts: { newCount, overwriteCount, removeCount, unchangedCount, protectedUnknownCount, skippedInvalidCount },
      },
    };
  } catch (error) {
    return fail(storageError("現在の保存データをバックアップできないため、Importを開始しません。", error));
  }
}

export function finalizeImportPlan(prepared, {
  costRecoveryChoice = null,
  invalidCategoryChoice = null,
  resetAt = Date.now(),
} = {}) {
  if (!prepared?.inspection || !prepared?.beforeBackup) return fail("復元計画を作成できませんでした。");
  const recovery = prepared.inspection.costRecovery;
  const invalidCategories = prepared.inspection.invalidCategories ?? [];
  if (invalidCategories.length > 0 && invalidCategoryChoice !== "skip") {
    return fail("破損したカテゴリをImport対象外にし、現在のデータを保持することに同意してください。");
  }
  if (recovery?.status === "recoverable" && costRecoveryChoice !== "repair") {
    return fail("利用料金履歴の修復内容を確認し、同意してください。");
  }
  if (recovery?.status === "unrecoverable" && costRecoveryChoice !== "reset") {
    return fail("読み取れない利用料金履歴を0件から再開することに同意してください。");
  }

  let resetRaw = null;
  if (recovery?.status === "unrecoverable") {
    try {
      resetRaw = JSON.stringify(createEmptyCostLedger(resetAt));
    } catch {
      return fail("利用料金履歴の再開日時を作成できませんでした。");
    }
  }
  const sourceEntries = Array.isArray(prepared.importEntries) ? prepared.importEntries : prepared.inspection.entries;
  const entries = sourceEntries.map((entry) => {
    if (entry.key !== MINTROOM_STORAGE_KEYS.costs || !recovery) return { ...entry };
    return { key: entry.key, present: true, raw: recovery.status === "recoverable" ? recovery.recoveredRaw : resetRaw };
  });
  const beforeMap = new Map(prepared.beforeBackup.entries.map((entry) => [entry.key, entry]));
  const beforeTargets = entries.map((entry) => {
    const previous = beforeMap.get(entry.key);
    return previous ? { ...previous } : { key: entry.key, present: false };
  });
  return {
    ok: true,
    plan: { entries, beforeTargets, beforeBackup: prepared.beforeBackup },
  };
}

export function checkImportPlanCurrent(storage, plan) {
  if (!plan || !Array.isArray(plan.entries) || !Array.isArray(plan.beforeTargets) || !plan.beforeBackup) {
    return { ok: false, error: "復元計画が不正です。", changedSincePreview: false };
  }
  let currentBackup;
  try {
    currentBackup = createBackupDocument(storage, plan.beforeBackup.exportedAt);
  } catch (error) {
    return {
      ok: false,
      error: storageError("現在の保存データを再確認できないため、Importを開始しません。", error),
      changedSincePreview: false,
    };
  }
  if (!sameEntries(currentBackup.entries, plan.beforeBackup.entries)) {
    return {
      ok: false,
      changedSincePreview: true,
      error: "確認画面を開いた後に別のタブまたは操作でデータが変わりました。もう一度ファイルを選び直してください。",
    };
  }
  return { ok: true, currentBackup };
}

export function applyImportPlan(storage, plan) {
  const current = checkImportPlanCurrent(storage, plan);
  if (!current.ok) {
    return {
      ok: false,
      changedSincePreview: current.changedSincePreview,
      error: current.error,
      rollbackAttempted: false,
      rollbackOk: null,
    };
  }

  try {
    const removals = plan.entries.filter((entry) => !entry.present);
    const writes = plan.entries.filter((entry) => entry.present);
    for (const entry of [...removals, ...writes]) writeEntry(storage, entry);
    for (const entry of plan.entries) verifyEntry(storage, entry);
    return { ok: true, rollbackAttempted: false, rollbackOk: null };
  } catch (error) {
    const rollbackOk = rollbackTargets(storage, plan.beforeTargets);
    return {
      ok: false,
      error: rollbackOk
        ? storageError("Importに失敗したため、変更前のデータへ戻しました。", error)
        : storageError("Importに失敗し、一部のデータを元へ戻せませんでした。先に保存された緊急バックアップを保管し、このタブを閉じないでください。", error),
      rollbackAttempted: true,
      rollbackOk,
    };
  }
}

function readMintRoomStorage(storage) {
  const values = new Map();
  try {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (typeof key !== "string" || !key.startsWith(MINTROOM_STORAGE_PREFIX)) continue;
      const raw = storage.getItem(key);
      if (raw !== null) values.set(key, String(raw));
    }
    // Storage実装や同時変更に左右されず、既知キーだけは必ず直接確認する。
    for (const key of KNOWN_KEYS) {
      const raw = storage.getItem(key);
      if (raw === null) values.delete(key);
      else values.set(key, String(raw));
    }
  } catch (error) {
    throw new Error(storageError("端末内データを読み取れませんでした。", error));
  }
  return new Map([...values].sort(([left], [right]) => left.localeCompare(right)));
}

function normalizeBackupEntry(value) {
  if (!isPlainObject(value) || typeof value.key !== "string" || typeof value.present !== "boolean") {
    return fail("保存項目のkey/present形式が不正です。");
  }
  if (!value.key.startsWith(MINTROOM_STORAGE_PREFIX) || value.key.length > MAX_KEY_LENGTH) {
    return fail("mintroom.以外の保存項目、または長すぎるkeyを含むファイルは復元できません。");
  }
  if (value.present) {
    if (typeof value.raw !== "string") return fail(`保存項目「${value.key}」のraw値が不正です。`);
    return { ok: true, entry: { key: value.key, present: true, raw: value.raw } };
  }
  if (Object.hasOwn(value, "raw")) return fail(`未保存項目「${value.key}」に不要なraw値があります。`);
  if (!KNOWN_KEY_SET.has(value.key)) return fail("未知の保存項目を削除する指示は安全のため受け付けません。");
  return { ok: true, entry: { key: value.key, present: false } };
}

function validateKnownRaw(key, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return fail("JSONが壊れています。");
  }
  if (key === MINTROOM_STORAGE_KEYS.settings) return validateSettings(value);
  if (key === MINTROOM_STORAGE_KEYS.chat) return validateChat(value);
  if (key === MINTROOM_STORAGE_KEYS.life) return validateLife(value);
  if (key === MINTROOM_STORAGE_KEYS.diary) return validateDiary(value);
  if (key === MINTROOM_STORAGE_KEYS.news) return validateNews(value);
  return fail("対応していない保存項目です。");
}

function validateSettings(value) {
  if (!isPlainObject(value)) return fail("設定全体がobjectではありません。");
  const enums = {
    theme: new Set(["system", "light", "dark"]),
    reasoningEffort: new Set(["default", "low", "medium", "high"]),
    responseFormat: new Set(["text", "json"]),
  };
  for (const [key, allowed] of Object.entries(enums)) {
    if (Object.hasOwn(value, key) && !allowed.has(value[key])) return fail(`${key}の値が不正です。`);
  }
  const strings = ["model", "developerInstructions", "persona", "safetyMode", "moderationBehavior", "promptCacheKey", "usdJpyRate"];
  for (const key of strings) {
    if (Object.hasOwn(value, key) && (!isBoundedString(value[key]) || value[key].length > MAX_TEXT_LENGTH)) return fail(`${key}の型または長さが不正です。`);
  }
  if (Object.hasOwn(value, "model") && !value.model.trim()) return fail("modelが空です。");
  const booleans = ["moderationPrecheck", "store", "skillPacksEnabled"];
  for (const key of booleans) {
    if (Object.hasOwn(value, key) && typeof value[key] !== "boolean") return fail(`${key}の型が不正です。`);
  }
  const ranges = { temperature: [0, 2], topP: [0, 1], maxOutputTokens: [16, 32768], historyLimit: [1, 100] };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (Object.hasOwn(value, key) && (!Number.isFinite(value[key]) || value[key] < minimum || value[key] > maximum)) {
      return fail(`${key}が範囲外です。`);
    }
  }
  if (typeof value.usdJpyRate === "string" && value.usdJpyRate !== "" && parseFxRateToMicros(value.usdJpyRate) === null) {
    return fail("usdJpyRateが範囲外です。");
  }
  return { ok: true, detail: "設定1組" };
}

function validateChat(value) {
  if (!isPlainObject(value) || !Array.isArray(value.messages)) return fail("messages配列がありません。");
  if (value.messages.length > MAX_CHAT_MESSAGES) return fail(`messagesが多すぎます（上限${MAX_CHAT_MESSAGES}件）。`);
  for (const message of value.messages) {
    if (!isPlainObject(message) || !["user", "assistant"].includes(message.role) || !isBoundedString(message.content)) {
      return fail("会話メッセージの形式が不正です。");
    }
    if (Object.hasOwn(message, "ts") && (!Number.isFinite(message.ts) || message.ts < 0)) return fail("会話日時が不正です。");
    if (Object.hasOwn(message, "costEventIds") && !isStringArray(message.costEventIds, MAX_LIST_ITEMS, 200)) return fail("利用額参照が不正です。");
    if (Object.hasOwn(message, "activeSkills")) {
      if (!Array.isArray(message.activeSkills) || message.activeSkills.length > 10 || !message.activeSkills.every((skill) =>
        isPlainObject(skill) && isBoundedString(skill.id, 200) && isBoundedString(skill.label, 500))) {
        return fail("Skill Pack参照が不正です。");
      }
    }
  }
  return { ok: true, detail: `${value.messages.length}メッセージ` };
}

function validateLife(value) {
  if (!isPlainObject(value)) return fail("Life全体がobjectではありません。");
  for (const key of ["tasks", "shopping", "medication"]) {
    if (!Array.isArray(value[key]) || value[key].length > MAX_LIST_ITEMS || !value[key].every((item) =>
      isPlainObject(item) && isBoundedString(item.text) && typeof item.done === "boolean")) {
      return fail(`${key}リストの形式が不正です。`);
    }
  }
  for (const key of ["wakeTime", "sleepTime"]) {
    if (Object.hasOwn(value, key) && !isBoundedString(value[key], 100)) return fail(`${key}の型が不正です。`);
  }
  return { ok: true, detail: `タスク${value.tasks.length}・買い物${value.shopping.length}・服薬${value.medication.length}` };
}

function validateDiary(value) {
  if (!isPlainObject(value) || !isPlainObject(value.entries)) return fail("日記entriesがobjectではありません。");
  const entries = Object.entries(value.entries);
  if (entries.length > MAX_LIST_ITEMS) return fail(`日記が多すぎます（上限${MAX_LIST_ITEMS}日分）。`);
  for (const [date, entry] of entries) {
    if (!isValidDateKey(date) || !isPlainObject(entry) || !isBoundedString(entry.text)) return fail("日記項目の形式が不正です。");
    if (Object.hasOwn(entry, "generatedAt") && (!Number.isFinite(entry.generatedAt) || entry.generatedAt < 0)) return fail("日記日時が不正です。");
    if (Object.hasOwn(entry, "mock") && typeof entry.mock !== "boolean") return fail("日記mock値が不正です。");
    if (Object.hasOwn(entry, "costEventIds") && !isStringArray(entry.costEventIds, MAX_LIST_ITEMS, 200)) return fail("日記の利用額参照が不正です。");
  }
  return { ok: true, detail: `${Object.keys(value.entries).length}日分` };
}

function validateNews(value) {
  if (!isPlainObject(value) || !isStringArray(value.interests, MAX_LIST_ITEMS) || !isStringArray(value.hiddenIds, MAX_LIST_ITEMS)) {
    return fail("ニュース設定の配列が不正です。");
  }
  const lastResult = value.lastResult ?? null;
  if (lastResult !== null) {
    if (!isPlainObject(lastResult) || !Array.isArray(lastResult.items)) return fail("ニュースキャッシュの形式が不正です。");
    if (lastResult.items.length > MAX_NEWS_ITEMS) return fail(`ニュース記事が多すぎます（上限${MAX_NEWS_ITEMS}件）。`);
    for (const item of lastResult.items) {
      if (!isPlainObject(item) || !["id", "lane", "confidence", "distress", "source", "title"].every((key) => isBoundedString(item[key]))) {
        return fail("ニュース項目の形式が不正です。");
      }
      for (const key of ["link", "summary", "gentle_summary", "ai_comment"]) {
        if (Object.hasOwn(item, key) && item[key] !== null && !isBoundedString(item[key])) return fail(`ニュースの${key}が不正です。`);
      }
    }
    if (Object.hasOwn(lastResult, "feedErrors") && (!Array.isArray(lastResult.feedErrors) || lastResult.feedErrors.length > MAX_LIST_ITEMS)) return fail("feedErrorsが不正です。");
    if (Object.hasOwn(lastResult, "costEventIds") && !isStringArray(lastResult.costEventIds, MAX_LIST_ITEMS, 200)) return fail("ニュースの利用額参照が不正です。");
  }
  const cachedCount = lastResult?.items?.length ?? 0;
  return { ok: true, detail: `興味${value.interests.length}・非表示${value.hiddenIds.length}・記事${cachedCount}` };
}

function recoverCostLedgerRaw(raw, exportedAt) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return unrecoverableCost(exportedAt, "JSON自体を解析できません。");
  }
  if (!isPlainObject(value) || value.schemaVersion !== 1 || !Array.isArray(value.events)) {
    return unrecoverableCost(exportedAt, "台帳のrootまたはschemaVersionを確認できません。");
  }

  const canonicalStartedAt = normalizeIso(value.recordingStartedAt);
  const validationStartedAt = canonicalStartedAt ?? exportedAt;
  const counts = new Map();
  for (const event of value.events) {
    const id = typeof event?.eventId === "string" && event.eventId ? event.eventId : null;
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const recovered = [];
  let rejectedCount = 0;
  for (const event of value.events) {
    const id = typeof event?.eventId === "string" && event.eventId ? event.eventId : null;
    if (!id || counts.get(id) !== 1) {
      rejectedCount += 1;
      continue;
    }
    const single = parseCostLedger(JSON.stringify({ schemaVersion: 1, recordingStartedAt: validationStartedAt, events: [event] }));
    if (!single.ok) {
      rejectedCount += 1;
      continue;
    }
    recovered.push(single.ledger.events[0]);
  }

  const repairedStartedAt = canonicalStartedAt ?? recovered.map((event) => normalizeIso(event.recordedAt)).filter(Boolean).sort()[0] ?? exportedAt;
  const repaired = { schemaVersion: 1, recordingStartedAt: repairedStartedAt, events: recovered };
  const finalCheck = parseCostLedger(JSON.stringify(repaired));
  if (!finalCheck.ok) return unrecoverableCost(exportedAt, "救出後の台帳を安全に検証できませんでした。");
  return {
    status: "recoverable",
    recoveredRaw: JSON.stringify(finalCheck.ledger),
    recoveredCount: recovered.length,
    rejectedCount,
    repairedRecordingStartedAt: canonicalStartedAt === null,
  };
}

function unrecoverableCost(_exportedAt, reason) {
  return {
    status: "unrecoverable",
    recoveredCount: 0,
    rejectedCount: null,
    reason,
  };
}

function writeEntry(storage, entry) {
  if (entry.present) {
    // 別タブの利用額mergeへ「意図的な置換」を先に知らせ、古い履歴の復活を防ぐ。
    if (entry.key === MINTROOM_STORAGE_KEYS.costs) storage.removeItem(entry.key);
    storage.setItem(entry.key, entry.raw);
  }
  else storage.removeItem(entry.key);
  verifyEntry(storage, entry);
}

function verifyEntry(storage, entry) {
  const actual = storage.getItem(entry.key);
  if (entry.present ? actual !== entry.raw : actual !== null) throw new Error(`保存項目「${entry.key}」の書込み確認に失敗しました。`);
}

function rollbackTargets(storage, beforeTargets) {
  const failedRemovals = [];
  const failedWrites = [];

  // 元々なかった新規keyだけを先に除き、元データを空にしてから戻す事故を避ける。
  for (const entry of beforeTargets.filter((item) => !item.present)) {
    try { storage.removeItem(entry.key); } catch { failedRemovals.push(entry); }
  }

  // 現在値より小さい元rawを先に戻して容量を解放し、削除済みkeyの復元余地を作る。
  const present = sortByRollbackGrowth(storage, beforeTargets.filter((item) => item.present));
  for (const entry of present) {
    try { storage.setItem(entry.key, entry.raw); } catch { failedWrites.push(entry); }
  }

  // 一時的な容量不足やStorage失敗は、ほかの復元で空きができた後に1回だけ再試行する。
  for (const entry of failedRemovals) {
    try { storage.removeItem(entry.key); } catch { /* 最後の全件verifyで失敗を確定する。 */ }
  }
  for (const entry of sortByRollbackGrowth(storage, failedWrites)) {
    try { storage.setItem(entry.key, entry.raw); } catch { /* 最後の全件verifyで失敗を確定する。 */ }
  }

  let ok = true;
  for (const entry of beforeTargets) {
    try { verifyEntry(storage, entry); } catch { ok = false; }
  }
  return ok;
}

function sortByRollbackGrowth(storage, entries) {
  return entries
    .map((entry, index) => ({ entry, index, growth: rollbackGrowth(storage, entry) }))
    .sort((left, right) => (left.growth - right.growth) || (left.index - right.index))
    .map(({ entry }) => entry);
}

function rollbackGrowth(storage, entry) {
  try {
    const current = storage.getItem(entry.key);
    // keyが消えている場合はkey自体の保存量も増えるため、後段の復元へ回す。
    return entry.raw.length - (current?.length ?? -entry.key.length);
  } catch {
    // 読取り不能でもsetは試すが、容量を解放する項目の後へ回す。
    return Number.POSITIVE_INFINITY;
  }
}

function sameEntries(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return left.every((entry, index) => {
    const other = right[index];
    return entry.key === other.key && entry.present === other.present && (!entry.present || entry.raw === other.raw);
  });
}

function toIso(value) {
  const date = toDate(value);
  return date.toISOString();
}

function toDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError("有効な日時が必要です。");
  return date;
}

function normalizeIso(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value, maxItems = MAX_LIST_ITEMS, maxLength = MAX_TEXT_LENGTH) {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedString(item, maxLength));
}

function isBoundedString(value, maxLength = MAX_TEXT_LENGTH) {
  return typeof value === "string" && value.length <= maxLength;
}

function formatBytes(bytes) {
  return `${Math.ceil(bytes / (1024 * 1024))}MB`;
}

function storageError(prefix, error) {
  return error?.name === "QuotaExceededError" ? `${prefix} 保存容量が不足しています。` : prefix;
}

function fail(error) {
  return { ok: false, error };
}
