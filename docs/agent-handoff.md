# Agent handoff — mint room

Status: FIRST FOUNDATION PASS COMPLETE AND VERIFIED (2026-07-20). This file is the source of truth for the next agent.

## Current repo state

- Stack: plain Node.js (>=18, tested on v22) HTTP server + static vanilla HTML/CSS/JS frontend. **Zero npm dependencies** — nothing to install, nothing to break.
  - Rationale: repo was empty, session time was constrained. Migrating to Next.js/React/TS later is fine; the adapter and settings schema port as-is.
- Branch: `claude/assistant-app-foundation-jvhrba` (pushed).

## Files

- `server.mjs` — HTTP server: serves `public/`, `POST /api/chat` (server-side OpenAI boundary), `GET /api/status` (key-configured flag + model list; never exposes the key). Generates a per-instance anonymous `safety_identifier` (UUID-based, no PII).
- `server/openai.mjs` — **the single OpenAI adapter.** All payload construction is in `buildResponsesPayload()`. Model list + capability flags in `MODELS`. Mock mode when `OPENAI_API_KEY` is unset (clearly labeled in replies).
- `public/index.html` — tab shell (Chat / Life / Calendar / Images / Search / Settings), settings markup.
- `public/styles.css` — pastel mint theme; light/dark via CSS variables + `[data-theme="dark"]`; system preference respected.
- `public/app.js` — chat state machine, settings binding + localStorage, life lists, calendar grid, tabs.
- `.env.example`, `.gitignore`, `package.json` (scripts only), `README.md`.

## How to run

```
export OPENAI_API_KEY=sk-...   # optional; omit for clearly-labeled mock mode
npm start                       # = node server.mjs → http://localhost:3000
npm run check                   # node --check on all JS entry points
```

No test framework exists yet.

## What works now (verified)

- Server boots; `GET /` serves the app; `GET /api/status` and `POST /api/chat` verified via curl (mock mode).
- Chat: input clears on send, double-send guarded (`sending` flag + disabled buttons), loading indicator, error banner with Retry/Dismiss, failed sends roll back and restore the input text.
- **Regenerate** re-requests a reply for the same last user turn: it splices off the trailing assistant reply, never re-appends the user message, and restores the old reply if the retry fails.
- Chat history persists in localStorage (`mintroom.chat.v1`); only the last `historyLimit` turns are sent to the API.
- Settings persist in localStorage (`mintroom.settings.v1`), grouped: General/Appearance, Model, Behavior, Safety, Tools.
- Model-dependent gating: reasoning-effort select and temperature/top-p disable per model capability flags served by `/api/status`.
- Life tab: tasks / shopping / medication checklists + wake/sleep times, localStorage-persisted (`mintroom.life.v1`).
- Calendar: month grid, prev/next, today highlight, **sample events only** (labeled in UI).
- Theme: light/dark/system, mint identity kept in dark mode.

## Mock/placeholder inventory (all labeled in the UI — nothing fakes results)

- Chat replies when no API key is set (labeled "mock mode" in reply text and header status).
- Moderation precheck toggle — does nothing yet (labeled "placeholder").
- Web search / image input / image generation / streaming toggles — disabled with "coming soon"/"next step" badges.
- Prompt cache key field — stored locally, not sent.
- Calendar events — sample data, view-only.
- Real OpenAI call path (`createChatResponse`) is implemented but NOT yet exercised against the live API from this environment (no key available). The payload shape was verified by direct invocation of `buildResponsesPayload`.

## OpenAI API mapping (all in `server/openai.mjs`)

| UI setting | API parameter | Status |
|---|---|---|
| Model | `model` | mapped |
| Developer instructions + persona | `instructions` (persona appended as labeled style note) | mapped |
| Chat history (trimmed by historyLimit) | `input` | mapped |
| Temperature | `temperature` | mapped; omitted for models with `supportsTemperature: false` |
| Top-p | `top_p` | mapped; same gating |
| Max output tokens | `max_output_tokens` | mapped (clamped 16–32768) |
| Reasoning effort | `reasoning.effort` | mapped only when model `supportsReasoningEffort` and value ≠ default |
| Response format JSON | `text.format = {type:"json_object"}` | mapped (advanced) |
| Store responses | `store` (default **false** for privacy) | mapped |
| (server-generated) | `safety_identifier` | mapped; anonymous UUID, no PII |
| Safety mode, moderation behavior, history limit, theme, tools toggles | — | intentionally app-only, not sent |
| Moderation precheck, prompt cache key, streaming | — | placeholders, not sent |

Not mapped yet (deliberately): `tools`, `stream`, `prompt_cache_key`, moderation endpoint, image content parts, structured-output JSON schema.

## Verification run

- `npm run check` → pass (node --check on server.mjs, server/openai.mjs, public/app.js).
- Server smoke test via curl: `/api/status` 200 with model list; `/api/chat` 200 mock reply; invalid JSON → 400; `/`, `/app.js`, `/styles.css` → 200 with correct content types.
- `buildResponsesPayload` invoked directly: verified o4-mini omits temperature/top_p, includes `reasoning.effort`, history trimming, instructions merging, `store:false`, `safety_identifier`.
- Not verified: real OpenAI API call (no key in this environment), in-browser interaction (no browser run performed; logic is simple vanilla JS).

## Design docs

- `docs/feature-ideas.md` (2026-07-20, Japanese): ideas-only backlog of latent user needs (markdown rendering, backup/export, PWA notifications, tool use for Life data, accessibility, etc.) with a suggested effort/impact order. Not commitments.
- `docs/4o-thinking-orchestration.md` (2026-07-20): design-only spec for a future layered assistant — primary conversational model + background reasoning model, orchestrator modes, sleep/routine nudges, reasoning output schema, and a 7-stage implementation plan. Nothing from it is implemented yet; its Stage 1–3 tasks are good Sonnet-sized units.

## Remaining tasks / safe next steps (Sonnet-suitable, in priority order)

1. **Browser smoke test** — load the app, click through tabs, send a mock chat, toggle theme. Fix any DOM typos found.
2. **Streaming** — `stream: true` in the adapter + SSE (or chunked fetch) endpoint variant + incremental render in `sendMessage()`/`regenerate()`. Enable the existing streaming toggle.
3. **Moderation precheck** — server-side call to the OpenAI moderation endpoint in `server/openai.mjs`, honoring `moderationBehavior` (block/warn/log). Wire the existing toggle.
4. **Image input** — file input in Chat/Images → base64 `input_image` content part in the adapter. Keep payload construction in the adapter.
5. **Web search + image generation** — Responses API `tools` wiring behind the disabled toggles.
6. **Calendar events** — add/edit/delete events with localStorage, category markers (health/errand/fun/task already styled).
7. Optional later: migrate to Next.js/React/TypeScript; the adapter, settings schema, and localStorage keys should carry over.

Constraints for the next agent: keep ALL OpenAI payload construction in `server/openai.mjs`; no DB/auth/deployment/accounts; settings stay in localStorage; never expose the API key client-side; keep placeholders honestly labeled; preserve the mint light/dark theme identity.
