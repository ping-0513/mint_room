// API利用額の端末内台帳。会話本文は保存せず、サーバーが返したusageイベントだけを扱う。

export const COST_LEDGER_SCHEMA_VERSION = 1;
export const COST_LEDGER_KEY = "mintroom.costs.v1";
export const FIXED_GPT4O_MODEL = "gpt-4o-2024-11-20";

const VALID_PURPOSES = new Set(["chat", "diary", "news"]);
const VALID_STATUSES = new Set(["estimated", "usage_unavailable", "pricing_unavailable"]);
const DECIMAL_INTEGER = /^\d+$/;
const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function createEmptyCostLedger(now = Date.now()) {
  return {
    schemaVersion: COST_LEDGER_SCHEMA_VERSION,
    recordingStartedAt: new Date(now).toISOString(),
    events: [],
  };
}

// 壊れた台帳を無言で初期化して上書きしないよう、失敗理由を呼び出し側へ返す。
export function parseCostLedger(raw, now = Date.now()) {
  if (raw === null || raw === undefined || raw === "") {
    return { ok: true, ledger: createEmptyCostLedger(now), isNew: true };
  }
  let value;
  try {
    value = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { ok: false, ledger: createEmptyCostLedger(now), error: "利用額の保存データが壊れています。元データを保護するため、新しい記録は保存しません。" };
  }
  if (!isPlainObject(value) || value.schemaVersion !== COST_LEDGER_SCHEMA_VERSION || !Array.isArray(value.events)) {
    return { ok: false, ledger: createEmptyCostLedger(now), error: "利用額の保存形式を読み取れません。元データを保護するため、新しい記録は保存しません。" };
  }
  const started = normalizeIso(value.recordingStartedAt);
  if (!started) {
    return { ok: false, ledger: createEmptyCostLedger(now), error: "利用額の記録開始日時を読み取れません。元データを保護しています。" };
  }
  const events = [];
  const seen = new Set();
  for (const candidate of value.events) {
    const event = normalizeStoredEvent(candidate);
    if (!event || seen.has(event.eventId)) {
      return { ok: false, ledger: createEmptyCostLedger(now), error: "利用額の履歴に不正または重複した項目があります。元データを保護しています。" };
    }
    seen.add(event.eventId);
    events.push(event);
  }
  return {
    ok: true,
    ledger: { schemaVersion: COST_LEDGER_SCHEMA_VERSION, recordingStartedAt: started, events },
    isNew: false,
  };
}

// 可変aliasを選んでいた既存利用者だけを、明示された固定snapshotへ1回移行する。
export function migrateStableModelSettings(value) {
  const source = isPlainObject(value) ? value : {};
  if (source.model !== "gpt-4o") return { settings: { ...source }, changed: false };
  return { settings: { ...source, model: FIXED_GPT4O_MODEL }, changed: true };
}

// 複数タブがそれぞれ持つ台帳をResponse IDで結合し、片方の新規記録を消さない。
export function mergeCostLedgers(...ledgers) {
  const validLedgers = ledgers.filter((ledger) => isPlainObject(ledger) && Array.isArray(ledger.events));
  if (validLedgers.length === 0) return createEmptyCostLedger();
  const started = validLedgers
    .map((ledger) => normalizeIso(ledger.recordingStartedAt))
    .filter(Boolean)
    .sort()[0] ?? new Date().toISOString();
  const byId = new Map();
  for (const ledger of validLedgers) {
    for (const event of ledger.events) {
      if (typeof event?.eventId === "string" && event.eventId) byId.set(event.eventId, event);
    }
  }
  return cloneLedger({ schemaVersion: COST_LEDGER_SCHEMA_VERSION, recordingStartedAt: started, events: [...byId.values()] });
}

/**
 * サーバーusageを端末用イベントへ変換して追加する。
 * 為替は追加時点で固定し、設定変更後も過去イベントを再計算しない。
 */
export function appendUsageEvents(ledger, incoming, { usdJpyRate = "", recordedAt = Date.now() } = {}) {
  const current = cloneLedger(ledger);
  const existingIds = new Set(current.events.map((event) => event.eventId));
  const fxMicros = parseFxRateToMicros(usdJpyRate);
  const added = [];
  let rejectedCount = 0;

  for (const candidate of Array.isArray(incoming) ? incoming : []) {
    const event = normalizeIncomingEvent(candidate, { fxMicros, recordedAt });
    if (!event) {
      rejectedCount += 1;
      continue;
    }
    if (existingIds.has(event.eventId)) continue;
    existingIds.add(event.eventId);
    current.events.push(event);
    added.push(event);
  }
  return { ledger: current, added, rejectedCount };
}

export function parseFxRateToMicros(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{1,4})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(6, "0"));
  const micros = whole * 1_000_000n + fraction;
  // 現実的な手動入力だけを許可し、0や桁間違いを課金履歴へ固定しない。
  return micros >= 1_000_000n && micros <= 1_000_000_000n ? micros.toString() : null;
}

export function localDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isValidDateKey(value) {
  if (typeof value !== "string") return false;
  const match = DATE_KEY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function validateDateRange(from, to) {
  if (!isValidDateKey(from) || !isValidDateKey(to)) return { ok: false, error: "開始日と終了日を指定してください。" };
  if (from > to) return { ok: false, error: "開始日は終了日以前にしてください。" };
  return { ok: true };
}

export function filterCostEvents(events, from, to) {
  if (!validateDateRange(from, to).ok) return [];
  return (Array.isArray(events) ? events : []).filter((event) => event.localDate >= from && event.localDate <= to);
}

export function summarizeCostEvents(events) {
  let usdNano = 0n;
  let jpyMicros = 0n;
  let estimatedCount = 0;
  let jpyConvertedCount = 0;
  let unavailableCount = 0;
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;

  for (const event of Array.isArray(events) ? events : []) {
    if (event?.status === "estimated" && isDecimalInteger(event.usdNano)) {
      estimatedCount += 1;
      usdNano += BigInt(event.usdNano);
      if (isDecimalInteger(event.jpyMicros)) {
        jpyConvertedCount += 1;
        jpyMicros += BigInt(event.jpyMicros);
      }
    } else {
      unavailableCount += 1;
    }
    if (event?.tokens) {
      inputTokens += event.tokens.input;
      cachedInputTokens += event.tokens.cachedInput;
      outputTokens += event.tokens.output;
    }
  }

  return {
    callCount: Array.isArray(events) ? events.length : 0,
    estimatedCount,
    unavailableCount,
    jpyConvertedCount,
    unconvertedCount: estimatedCount - jpyConvertedCount,
    usdNano: usdNano.toString(),
    jpyMicros: jpyMicros.toString(),
    tokens: { input: inputTokens, cachedInput: cachedInputTokens, output: outputTokens },
  };
}

export function formatUsdNano(value) {
  if (!isDecimalInteger(value)) return "算出不可";
  return `$${formatScaled(value, 9, 6, 0.000001)}`;
}

export function formatJpyMicros(value) {
  if (!isDecimalInteger(value)) return "円換算なし";
  return `¥${formatScaled(value, 6, 4, 0.0001)}`;
}

export function formatEventCost(event, prefix = "今回") {
  if (!event) return `${prefix}の利用額は記録されていません`;
  if (event.status !== "estimated") {
    return event.status === "pricing_unavailable"
      ? `${prefix}の利用額は料金未登録のため算出不可`
      : `${prefix}の利用額はusage未取得のため算出不可`;
  }
  const usd = formatUsdNano(event.usdNano);
  return isDecimalInteger(event.jpyMicros)
    ? `${prefix} 約${formatJpyMicros(event.jpyMicros)} (${usd})`
    : `${prefix} 約${usd}（円換算レート未設定）`;
}

export function formatStoredLocalTimestamp(event) {
  const timestamp = Date.parse(event?.occurredAt);
  const offset = event?.timezoneOffsetMinutes;
  if (!isValidDateKey(event?.localDate) || !Number.isInteger(offset) || !Number.isFinite(timestamp)) return "日時不明";
  const localClock = new Date(timestamp - offset * 60_000);
  const clock = [localClock.getUTCHours(), localClock.getUTCMinutes(), localClock.getUTCSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  const utcOffsetMinutes = -offset;
  const sign = utcOffsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(utcOffsetMinutes);
  const zone = `${sign}${String(Math.floor(absoluteOffset / 60)).padStart(2, "0")}:${String(absoluteOffset % 60).padStart(2, "0")}`;
  return `${event.localDate} ${clock} (UTC${zone})`;
}

function normalizeIncomingEvent(value, { fxMicros, recordedAt }) {
  if (!isPlainObject(value)) return null;
  const eventId = cleanString(value.eventId, 200);
  const occurredAt = normalizeIso(value.occurredAt);
  const status = VALID_STATUSES.has(value.status) ? value.status : null;
  const purpose = VALID_PURPOSES.has(value.purpose) ? value.purpose : null;
  if (!eventId || !occurredAt || !status || !purpose) return null;

  const tokens = normalizeTokens(value.tokens);
  if (status === "estimated" && !tokens) return null;
  const usdNano = status === "estimated" && isDecimalInteger(value.estimatedUsdNano)
    ? String(value.estimatedUsdNano)
    : null;
  if (status === "estimated" && usdNano === null) return null;

  const recordedDate = new Date(recordedAt);
  if (!Number.isFinite(recordedDate.getTime())) return null;

  let jpyMicros = null;
  if (usdNano !== null && fxMicros !== null) {
    jpyMicros = divideRounded(BigInt(usdNano) * BigInt(fxMicros), 1_000_000_000n).toString();
  }
  const occurredMs = Date.parse(occurredAt);
  return {
    eventId,
    occurredAt,
    recordedAt: recordedDate.toISOString(),
    localDate: localDateKey(occurredMs),
    timezoneOffsetMinutes: new Date(occurredMs).getTimezoneOffset(),
    purpose,
    requestedModel: cleanString(value.requestedModel, 120) ?? "unknown",
    actualModel: cleanString(value.actualModel, 120) ?? "unknown",
    pricedModel: cleanString(value.pricedModel, 120) ?? cleanString(value.actualModel, 120) ?? "unknown",
    requestedServiceTier: cleanString(value.requestedServiceTier, 40),
    actualServiceTier: cleanString(value.actualServiceTier, 40),
    status,
    pricingVersion: cleanString(value.pricingVersion, 120),
    pricingUnavailableReason: cleanString(value.pricingUnavailableReason, 40),
    ratesNanoUsdPerToken: normalizeRates(value.ratesNanoUsdPerToken),
    tokens,
    usdNano,
    fxMicros,
    jpyMicros,
  };
}

function normalizeStoredEvent(value) {
  if (!isPlainObject(value)) return null;
  const normalized = normalizeIncomingEvent({
    eventId: value.eventId,
    occurredAt: value.occurredAt,
    purpose: value.purpose,
    requestedModel: value.requestedModel,
    actualModel: value.actualModel,
    pricedModel: value.pricedModel,
    requestedServiceTier: value.requestedServiceTier,
    actualServiceTier: value.actualServiceTier,
    status: value.status,
    pricingVersion: value.pricingVersion,
    pricingUnavailableReason: value.pricingUnavailableReason,
    ratesNanoUsdPerToken: value.ratesNanoUsdPerToken,
    tokens: value.tokens,
    estimatedUsdNano: value.usdNano,
  }, { fxMicros: null, recordedAt: Date.parse(value.recordedAt) });
  if (!normalized || !normalizeIso(value.recordedAt) || !isValidDateKey(value.localDate)) return null;
  if (value.fxMicros !== null && value.fxMicros !== undefined && !isDecimalInteger(value.fxMicros)) return null;
  if (value.jpyMicros !== null && value.jpyMicros !== undefined && !isDecimalInteger(value.jpyMicros)) return null;
  return {
    ...normalized,
    recordedAt: normalizeIso(value.recordedAt),
    localDate: value.localDate,
    timezoneOffsetMinutes: Number.isInteger(value.timezoneOffsetMinutes) ? value.timezoneOffsetMinutes : 0,
    fxMicros: value.fxMicros === null || value.fxMicros === undefined ? null : String(value.fxMicros),
    jpyMicros: value.jpyMicros === null || value.jpyMicros === undefined ? null : String(value.jpyMicros),
  };
}

function cloneLedger(value) {
  return {
    schemaVersion: COST_LEDGER_SCHEMA_VERSION,
    recordingStartedAt: normalizeIso(value?.recordingStartedAt) ?? new Date().toISOString(),
    events: Array.isArray(value?.events) ? value.events.map((event) => ({ ...event, tokens: event.tokens ? { ...event.tokens } : null })) : [],
  };
}

function normalizeTokens(value) {
  if (!isPlainObject(value)) return null;
  const fields = ["input", "cachedInput", "output", "reasoningOutput", "total"];
  if (!fields.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0)) return null;
  if (value.cachedInput > value.input || value.reasoningOutput > value.output || value.total !== value.input + value.output) return null;
  return Object.fromEntries(fields.map((key) => [key, value[key]]));
}

function normalizeRates(value) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return null;
  const input = value.input;
  const cachedInput = value.cachedInput;
  const output = value.output;
  return [input, cachedInput, output].every((part) => Number.isSafeInteger(part) && part >= 0)
    ? { input, cachedInput, output }
    : null;
}

function formatScaled(value, scaleDigits, maxFractionDigits, lessThanThreshold) {
  const integer = BigInt(value);
  if (integer === 0n) return "0";
  const scale = 10n ** BigInt(scaleDigits);
  const thresholdScaled = BigInt(Math.round(lessThanThreshold * Number(scale)));
  if (integer < thresholdScaled) return `<${lessThanThreshold.toFixed(maxFractionDigits)}`;
  const displayScale = 10n ** BigInt(maxFractionDigits);
  const rounded = divideRounded(integer * displayScale, scale);
  const whole = rounded / displayScale;
  const fraction = String(rounded % displayScale).padStart(maxFractionDigits, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function divideRounded(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

function normalizeIso(value) {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isDecimalInteger(value) {
  return (typeof value === "string" || typeof value === "number") && DECIMAL_INTEGER.test(String(value));
}

function cleanString(value, maxLength) {
  return typeof value === "string" && value.length > 0 ? value.slice(0, maxLength) : null;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
