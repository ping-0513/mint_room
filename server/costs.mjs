import { randomUUID } from "node:crypto";

// 料金は各モデルの公式ページを2026-07-20に確認した版で固定する。
// 1トークンあたりのnano-USD整数にしておくことで、浮動小数点の丸めを避けて積算できる。
export const PRICING_VERSION = "openai-model-pages-2026-07-20";

export const MODEL_PRICING = Object.freeze({
  "gpt-4.1": pricing(2_000, 500, 8_000, "https://developers.openai.com/api/docs/models/gpt-4.1"),
  "gpt-4.1-2025-04-14": pricing(2_000, 500, 8_000, "https://developers.openai.com/api/docs/models/gpt-4.1"),
  "gpt-4.1-mini": pricing(400, 100, 1_600, "https://developers.openai.com/api/docs/models/gpt-4.1-mini"),
  "gpt-4.1-mini-2025-04-14": pricing(400, 100, 1_600, "https://developers.openai.com/api/docs/models/gpt-4.1-mini"),
  "gpt-4o-2024-11-20": pricing(2_500, 1_250, 10_000, "https://developers.openai.com/api/docs/models/gpt-4o"),
  "gpt-4o-mini": pricing(150, 75, 600, "https://developers.openai.com/api/docs/models/gpt-4o-mini"),
  "gpt-4o-mini-2024-07-18": pricing(150, 75, 600, "https://developers.openai.com/api/docs/models/gpt-4o-mini"),
  "o4-mini": pricing(1_100, 275, 4_400, "https://developers.openai.com/api/docs/models/o4-mini"),
  "o4-mini-2025-04-16": pricing(1_100, 275, 4_400, "https://developers.openai.com/api/docs/models/o4-mini"),
});

/**
 * Responses APIのusageだけから、会話内容を含まない保存用イベントを作る。
 * usageや料金が分からない場合も0円とは扱わず、理由をstatusに残す。
 */
export function createUsageEvent({
  requestedModel,
  actualModel,
  requestedServiceTier = "default",
  actualServiceTier,
  usage,
  purpose = "chat",
  occurredAt,
  eventId,
} = {}) {
  const modelId = typeof requestedModel === "string" && requestedModel ? requestedModel : "unknown";
  const actualModelWasProvided = typeof actualModel === "string" && actualModel.length > 0;
  const normalizedActualModel = actualModelWasProvided ? actualModel : modelId;
  // providerが実際に返したモデルを料金の正本にし、将来aliasの解決先が変わっても旧料金を当てない。
  const pricedModel = normalizedActualModel;
  const rate = MODEL_PRICING[pricedModel] ?? null;
  const tokens = normalizeUsage(usage);
  const normalizedRequestedTier = typeof requestedServiceTier === "string" && requestedServiceTier
    ? requestedServiceTier
    : "default";
  const normalizedActualTier = typeof actualServiceTier === "string" && actualServiceTier ? actualServiceTier : null;
  const standardTier =
    normalizedRequestedTier === "default" &&
    (normalizedActualTier === null || normalizedActualTier === "default");
  const base = {
    eventId: typeof eventId === "string" && eventId ? eventId : randomUUID(),
    occurredAt: normalizeOccurredAt(occurredAt),
    purpose: normalizePurpose(purpose),
    requestedModel: modelId,
    actualModel: normalizedActualModel,
    pricedModel,
    requestedServiceTier: normalizedRequestedTier,
    actualServiceTier: normalizedActualTier,
    pricingVersion: PRICING_VERSION,
    currency: "USD",
    isEstimate: true,
    tokens,
    ratesNanoUsdPerToken: rate && standardTier ? rate.ratesNanoUsdPerToken : null,
    pricingUnavailableReason: null,
    estimatedUsdNano: null,
    estimatedUsd: null,
  };

  if (!tokens) return { ...base, status: "usage_unavailable" };
  if (!rate) {
    return {
      ...base,
      status: "pricing_unavailable",
      pricingUnavailableReason: actualModelWasProvided ? "actual_model" : "model",
    };
  }
  if (!standardTier) {
    return { ...base, status: "pricing_unavailable", pricingUnavailableReason: "service_tier" };
  }

  const uncachedInput = BigInt(tokens.input - tokens.cachedInput);
  const cachedInput = BigInt(tokens.cachedInput);
  const output = BigInt(tokens.output);
  const rates = rate.ratesNanoUsdPerToken;
  const nanoUsd =
    uncachedInput * BigInt(rates.input) +
    cachedInput * BigInt(rates.cachedInput) +
    output * BigInt(rates.output);

  return {
    ...base,
    status: "estimated",
    estimatedUsdNano: nanoUsd.toString(),
    // 表示互換用の近似値。正確な集計にはestimatedUsdNanoを使う。
    estimatedUsd: Number(nanoUsd) / 1_000_000_000,
  };
}

function pricing(input, cachedInput, output, sourceUrl) {
  return Object.freeze({
    ratesNanoUsdPerToken: Object.freeze({ input, cachedInput, output }),
    sourceUrl,
  });
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const input = safeTokenCount(usage.input_tokens);
  const output = safeTokenCount(usage.output_tokens);
  const cachedInput = safeTokenCount(usage.input_tokens_details?.cached_tokens ?? 0);
  const reasoningOutput = safeTokenCount(usage.output_tokens_details?.reasoning_tokens ?? 0);
  const suppliedTotal = usage.total_tokens === undefined ? input + output : safeTokenCount(usage.total_tokens);
  if (
    input === null ||
    output === null ||
    cachedInput === null ||
    reasoningOutput === null ||
    suppliedTotal === null ||
    cachedInput > input ||
    reasoningOutput > output ||
    suppliedTotal !== input + output
  ) {
    return null;
  }
  return { input, cachedInput, output, reasoningOutput, total: suppliedTotal };
}

function safeTokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeOccurredAt(value) {
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

function normalizePurpose(value) {
  return ["chat", "diary", "news"].includes(value) ? value : "chat";
}
