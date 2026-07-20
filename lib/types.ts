// Shared types for chat state and response-behavior settings.
// This is the single source of truth for what the UI can configure
// and what the server-side OpenAI adapter (lib/openai.ts) understands.

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Set while an assistant message is still streaming in. */
  pending?: boolean;
  /** Set if this assistant message failed to generate. */
  error?: string;
}

export type ReasoningEffort = "default" | "low" | "medium" | "high";
export type ResponseFormat = "text" | "json";
export type SafetyMode = "standard" | "stricter" | "development";
export type ModerationBehavior = "warn" | "block" | "debug_log";
export type ContextStrategy = "full" | "recent-20" | "recent-10";
export type ThemeSetting = "light" | "dark" | "system";

export interface ModelOption {
  id: string;
  label: string;
  /** Whether this model accepts a reasoning effort parameter. */
  supportsReasoningEffort: boolean;
}

// Keep this list small and easy to edit — it is the one place model
// availability is declared, so the request adapter never hardcodes a model.
export const AVAILABLE_MODELS: ModelOption[] = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini (default, fast)", supportsReasoningEffort: false },
  { id: "gpt-4.1", label: "GPT-4.1", supportsReasoningEffort: false },
  { id: "gpt-4o-mini", label: "GPT-4o mini", supportsReasoningEffort: false },
  { id: "o4-mini", label: "o4-mini (reasoning)", supportsReasoningEffort: true },
];

export const DEFAULT_MODEL_ID = AVAILABLE_MODELS[0].id;

export interface ResponseSettings {
  model: string;
  developerInstructions: string;
  personaNote: string;
  temperature: number;
  topP: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  responseFormat: ResponseFormat;
  streamingEnabled: boolean;
}

export interface SafetySettings {
  safetyMode: SafetyMode;
  /** App-side moderation precheck before sending to generation. Placeholder — not wired up yet. */
  moderationPrecheckEnabled: boolean;
  moderationBehavior: ModerationBehavior;
  /** Generated locally (random UUID), never derived from name/email/PII. */
  safetyIdentifier: string;
  /** Maps to OpenAI's `store` param. Defaults to false for privacy. */
  storeResponses: boolean;
  /** Advanced/developer-only. Empty string means "not set". */
  promptCacheKey: string;
}

export interface ToolSettings {
  /** Placeholder — no web/search tool wired up yet. */
  webSearchEnabled: boolean;
  /** Placeholder — image input UI exists, but not sent to the model yet. */
  imageInputEnabled: boolean;
  /** Placeholder — no image generation call wired up yet. */
  imageGenerationEnabled: boolean;
  /** Placeholder — no function/tool calling wired up yet. */
  toolUseEnabled: boolean;
  contextStrategy: ContextStrategy;
}

export interface AppearanceSettings {
  theme: ThemeSetting;
}

export interface AppSettings {
  response: ResponseSettings;
  safety: SafetySettings;
  tools: ToolSettings;
  appearance: AppearanceSettings;
}

export const DEFAULT_SETTINGS: Omit<AppSettings, "safety"> & {
  safety: Omit<SafetySettings, "safetyIdentifier">;
} = {
  response: {
    model: DEFAULT_MODEL_ID,
    developerInstructions: "",
    personaNote: "",
    temperature: 1,
    topP: 1,
    maxOutputTokens: 1024,
    reasoningEffort: "default",
    responseFormat: "text",
    streamingEnabled: true,
  },
  safety: {
    safetyMode: "standard",
    moderationPrecheckEnabled: false,
    moderationBehavior: "warn",
    storeResponses: false,
    promptCacheKey: "",
  },
  tools: {
    webSearchEnabled: false,
    imageInputEnabled: false,
    imageGenerationEnabled: false,
    toolUseEnabled: false,
    contextStrategy: "recent-20",
  },
  appearance: {
    theme: "system",
  },
};

// Validation ranges, kept next to the settings they validate.
export const TEMPERATURE_RANGE = { min: 0, max: 2, step: 0.1 };
export const TOP_P_RANGE = { min: 0, max: 1, step: 0.05 };
export const MAX_OUTPUT_TOKENS_RANGE = { min: 16, max: 8192, step: 16 };
