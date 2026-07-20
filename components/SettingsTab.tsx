"use client";

import { useState, type ReactNode } from "react";
import { useSettings } from "@/lib/settings-context";
import {
  AVAILABLE_MODELS,
  MAX_OUTPUT_TOKENS_RANGE,
  TEMPERATURE_RANGE,
  TOP_P_RANGE,
  type ReasoningEffort,
} from "@/lib/types";

function Section({ title, subtitle, children, defaultOpen = true }: { title: string; subtitle?: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-xl2 border border-mint-100 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/60">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div>
          <h2 className="text-sm font-semibold text-mint-800 dark:text-mint-100">{title}</h2>
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
        </div>
        <span className="text-slate-400">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="space-y-4 border-t border-mint-100 px-4 py-4 dark:border-slate-800">{children}</div>}
    </section>
  );
}

function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      {children}
      {help && <span className="block text-xs text-slate-500 dark:text-slate-400">{help}</span>}
    </label>
  );
}

function inputCls() {
  return "w-full rounded-lg border border-mint-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-mint-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100";
}

export default function SettingsTab() {
  const { settings, setSettings, resetSettings } = useSettings();
  const { response, safety, tools, appearance } = settings;
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === response.model);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto px-4 py-4">
      <div className="mx-auto max-w-2xl space-y-4 pb-10">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-mint-800 dark:text-mint-100">Settings</h1>
          <button
            onClick={resetSettings}
            className="text-xs font-medium text-slate-500 underline hover:text-mint-600 dark:text-slate-400"
          >
            Reset to defaults
          </button>
        </div>

        <Section title="Model" subtitle="Which OpenAI model answers your messages">
          <Field label="Model">
            <select
              className={inputCls()}
              value={response.model}
              onChange={(e) => setSettings((s) => ({ ...s, response: { ...s.response, model: e.target.value } }))}
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-slate-400">
            OpenAI API key: {" "}
            <span className="font-medium">
              status is checked server-side — see the note at the bottom of this page.
            </span>
          </p>
        </Section>

        <Section title="Behavior" subtitle="Instructions, persona, and sampling controls">
          <Field label="Developer instructions" help="Sent to the model as app-level instructions, kept separate from your chat messages.">
            <textarea
              className={inputCls()}
              rows={3}
              value={response.developerInstructions}
              onChange={(e) =>
                setSettings((s) => ({ ...s, response: { ...s.response, developerInstructions: e.target.value } }))
              }
              placeholder="e.g. Always answer in short bullet points."
            />
          </Field>
          <Field label="Assistant style / persona note" help="Optional tone/persona guidance, merged into instructions but tracked separately.">
            <textarea
              className={inputCls()}
              rows={2}
              value={response.personaNote}
              onChange={(e) => setSettings((s) => ({ ...s, response: { ...s.response, personaNote: e.target.value } }))}
              placeholder="e.g. Warm, encouraging, a little playful."
            />
          </Field>
          <Field label={`Temperature: ${response.temperature.toFixed(1)}`} help="Lower is more stable/focused. Higher is more varied/creative.">
            <input
              type="range"
              min={TEMPERATURE_RANGE.min}
              max={TEMPERATURE_RANGE.max}
              step={TEMPERATURE_RANGE.step}
              value={response.temperature}
              onChange={(e) =>
                setSettings((s) => ({ ...s, response: { ...s.response, temperature: Number(e.target.value) } }))
              }
              className="w-full accent-mint-500"
            />
          </Field>
          <Field label={`Top-p: ${response.topP.toFixed(2)}`} help="Alternative sampling control. Usually leave this at 1 unless you know why you're changing both.">
            <input
              type="range"
              min={TOP_P_RANGE.min}
              max={TOP_P_RANGE.max}
              step={TOP_P_RANGE.step}
              value={response.topP}
              onChange={(e) => setSettings((s) => ({ ...s, response: { ...s.response, topP: Number(e.target.value) } }))}
              className="w-full accent-mint-500"
            />
          </Field>
          <Field label="Max output tokens" help="Upper limit on response length.">
            <input
              type="number"
              className={inputCls()}
              min={MAX_OUTPUT_TOKENS_RANGE.min}
              max={MAX_OUTPUT_TOKENS_RANGE.max}
              step={MAX_OUTPUT_TOKENS_RANGE.step}
              value={response.maxOutputTokens}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  response: { ...s.response, maxOutputTokens: Number(e.target.value) },
                }))
              }
            />
          </Field>
          <Field
            label="Reasoning effort"
            help={
              selectedModel?.supportsReasoningEffort
                ? "How much the model 'thinks' before answering."
                : `${selectedModel?.label ?? "This model"} does not support reasoning effort — control disabled.`
            }
          >
            <select
              className={inputCls()}
              value={response.reasoningEffort}
              disabled={!selectedModel?.supportsReasoningEffort}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  response: { ...s.response, reasoningEffort: e.target.value as ReasoningEffort },
                }))
              }
            >
              <option value="default">Default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Response format">
            <select
              className={inputCls()}
              value={response.responseFormat}
              onChange={(e) =>
                setSettings((s) => ({ ...s, response: { ...s.response, responseFormat: e.target.value as "text" | "json" } }))
              }
            >
              <option value="text">Plain text</option>
              <option value="json">JSON (advanced — make sure your prompt asks for JSON too)</option>
            </select>
          </Field>
          <Field label="Streaming">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={response.streamingEnabled}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, response: { ...s.response, streamingEnabled: e.target.checked } }))
                }
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">Stream responses as they're generated</span>
            </div>
          </Field>
        </Section>

        <Section title="Safety" subtitle="App-level privacy and moderation controls (not a way to bypass OpenAI policy)">
          <Field label="Safety mode" help="Standard is recommended. This does not disable provider-side policy enforcement.">
            <select
              className={inputCls()}
              value={safety.safetyMode}
              onChange={(e) => setSettings((s) => ({ ...s, safety: { ...s.safety, safetyMode: e.target.value as typeof safety.safetyMode } }))}
            >
              <option value="standard">Standard</option>
              <option value="stricter">Stricter</option>
              <option value="development">Development / debug</option>
            </select>
          </Field>
          <Field label="Moderation precheck" help="Placeholder — not implemented yet. Would check input via OpenAI's moderation endpoint before sending.">
            <div className="flex items-center gap-2 opacity-60">
              <input type="checkbox" checked={false} disabled />
              <span className="text-sm text-slate-600 dark:text-slate-300">Enable moderation precheck (coming soon)</span>
            </div>
          </Field>
          <Field label="Moderation behavior" help="How the app should react if moderation flags something (once implemented).">
            <select
              className={inputCls()}
              value={safety.moderationBehavior}
              onChange={(e) =>
                setSettings((s) => ({ ...s, safety: { ...s.safety, moderationBehavior: e.target.value as typeof safety.moderationBehavior } }))
              }
            >
              <option value="warn">Warn only</option>
              <option value="block">Block and show message</option>
              <option value="debug_log">Developer/debug logging</option>
            </select>
          </Field>
          <Field label="Safety identifier" help="A random, locally-generated ID sent with requests. Not your name or email.">
            <input className={inputCls()} value={safety.safetyIdentifier} readOnly />
          </Field>
          <Field label="Store responses" help="Whether OpenAI is allowed to store this response server-side. Defaults off for privacy.">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={safety.storeResponses}
                onChange={(e) => setSettings((s) => ({ ...s, safety: { ...s.safety, storeResponses: e.target.checked } }))}
              />
              <span className="text-sm text-slate-600 dark:text-slate-300">Allow OpenAI to store responses</span>
            </div>
          </Field>
          <Field label="Prompt cache key (advanced)" help="Developer-only. Leave blank unless you know what this does.">
            <input
              className={inputCls()}
              value={safety.promptCacheKey}
              onChange={(e) => setSettings((s) => ({ ...s, safety: { ...s.safety, promptCacheKey: e.target.value } }))}
              placeholder="optional"
            />
          </Field>
        </Section>

        <Section title="Tools & capabilities" subtitle="Most of these are placeholders for now" defaultOpen={false}>
          {[
            { key: "webSearchEnabled", label: "Web/search tool" },
            { key: "imageInputEnabled", label: "Image input" },
            { key: "imageGenerationEnabled", label: "Image generation" },
            { key: "toolUseEnabled", label: "Tool use (function calling)" },
          ].map((t) => (
            <Field key={t.key} label={t.label} help="Placeholder — not wired up to the API yet.">
              <div className="flex items-center gap-2 opacity-60">
                <input type="checkbox" checked={false} disabled />
                <span className="text-sm text-slate-600 dark:text-slate-300">Enable (coming soon)</span>
              </div>
            </Field>
          ))}
          <Field label="Context/history length strategy" help="How much prior chat history is sent with each request.">
            <select
              className={inputCls()}
              value={tools.contextStrategy}
              onChange={(e) => setSettings((s) => ({ ...s, tools: { ...s.tools, contextStrategy: e.target.value as typeof tools.contextStrategy } }))}
            >
              <option value="recent-10">Last 10 messages</option>
              <option value="recent-20">Last 20 messages</option>
              <option value="full">Full history</option>
            </select>
          </Field>
        </Section>

        <Section title="Appearance">
          <Field label="Theme">
            <select
              className={inputCls()}
              value={appearance.theme}
              onChange={(e) => setSettings((s) => ({ ...s, appearance: { ...s.appearance, theme: e.target.value as typeof appearance.theme } }))}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </Field>
        </Section>

        <p className="px-1 text-xs text-slate-400">
          OpenAI API key is read from the server-side <code>OPENAI_API_KEY</code> environment variable — it is
          never exposed to the browser. Without it, chat falls back to a mock response so the UI stays usable.
        </p>
      </div>
    </div>
  );
}
