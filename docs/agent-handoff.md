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
- Chat history persists in localStorage (`mintroom.chat.v1`); only the last `historyLimit` messages (not turn pairs) are sent to the API — UI label says "messages".
- Settings persist in localStorage (`mintroom.settings.v1`), grouped: General/Appearance, Model, Behavior, Safety, Tools.
- Model-dependent gating: reasoning-effort select and temperature/top-p disable per model capability flags served by `/api/status`.
- Life tab: tasks / shopping / medication checklists + wake/sleep times, localStorage-persisted (`mintroom.life.v1`).
- Calendar: month grid, prev/next, today highlight, **sample events only** (labeled in UI).
- Theme: light/dark/system, mint identity kept in dark mode.
- **Gentle news (added 2026-07-20, stages N1–N3 of `docs/gentle-news-design.md`):** News tab with interest-topic chips (local, `mintroom.news.v1`), lanes (interest / rumor / essential / general), confidence badges (公式/報道/噂/推測) + AI comment, hide-per-item, heavy items marked ⚠️ with softened summaries. Server: `server/news.mjs` (RSS2.0+Atom parse via new dependency `fast-xml-parser` — approved by user; per-feed failure tolerance; 30-min cache; keyword fallback filter) + `classifyNews` batch LLM classification in `server/openai.mjs` (JSON output, per-item validation, classification cache) + `POST /api/news`. Without an API key runs in labeled "simple keyword mode". **IMPORTANT: default feed URLs in `DEFAULT_FEEDS` could NOT be verified from this sandbox (all outbound network blocked — Node fetch, curl, and WebFetch all fail); they are well-known patterns but must be verified on the user's machine via `feedErrors` in the response/status line.** X (Twitter) integration deliberately NOT implemented (paid API; see design doc — adapter boundary documented).
- **AI diary (added 2026-07-20):** Diary tab where the assistant writes its own gentle entry about the master's day (design intent: a kind outside observer counters self-critical journaling). `POST /api/diary` + `buildDiaryPrompt`/`createDiaryEntry` in `server/openai.mjs` (prompt is a tested pure function; forbids guilt-tripping and invented events; absent days get a kind "didn't visit" entry). Snapshot = today's chat messages (chat messages now carry `ts` timestamps; pre-feature messages lack `ts` and are treated as not-today) + Life stats. Entries in localStorage `mintroom.diary.v1`, one per date, replaced only on successful regeneration; delete with confirm. Mock mode returns labeled mock entries.

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

- `npm test` → 24/24 pass (payload mapping, diary prompt, news: RSS/Atom fixture parsing, broken-XML tolerance, stable IDs, keyword block/interest lanes, classification prompt content, block-list overreach guard). News endpoint smoke-tested: graceful degradation with all feeds failing (ok:true + feedErrors), bad body → 400. Real RSS fetch and real LLM classification NOT verifiable from this sandbox (no outbound network, no API key).
- (superseded) `npm test` → 16/16 pass (`server/openai.test.mjs`, Node built-in `node:test`, zero dependencies: 11 payload-mapping tests — capability gating, clamping, history trim — plus 5 diary-prompt tests). Diary endpoint smoke-tested via curl: visited/absent mock entries, missing snapshot → 400.
- Brushup 2026-07-20 also fixed: Windows path handling (`fileURLToPath` instead of `URL.pathname`), percent-encoded static paths + hardened traversal guard (verified with curl `--path-as-is`, returns 403), 413 delivered for oversized bodies (was: connection killed before response), theme-toggle dead line, failed-send no longer clobbers newly typed input, model-fallback now persisted, "turns"→"messages" label honesty.
- `npm run check` → pass (node --check on server.mjs, server/openai.mjs, public/app.js).
- Server smoke test via curl: `/api/status` 200 with model list; `/api/chat` 200 mock reply; invalid JSON → 400; `/`, `/app.js`, `/styles.css` → 200 with correct content types.
- `buildResponsesPayload` invoked directly: verified o4-mini omits temperature/top_p, includes `reasoning.effort`, history trimming, instructions merging, `store:false`, `safety_identifier`.
- Not verified: real OpenAI API call (no key in this environment), in-browser interaction (no browser run performed; logic is simple vanilla JS).

## Design docs

- `AGENTS.md` (repo root, 2026-07-20, **ACTIVE GUIDELINE**): execution rules for all coding agents, written as countermeasures to publicly documented GPT-5.6 Sol failure modes (intent overreach / permissive instruction reading per OpenAI's system card, target substitution, credential mishandling, false completion claims, shallow confident planning, frontend animation/callout spam, stuck loops, stale context). Key inversions: default-deny permission model, honest-report obligation, 2-failure circuit breaker, re-read-before-edit.

- `docs/master-preferences.md` (2026-07-20, Japanese, **ACTIVE GUIDELINE**): the master's standing requirements for any app — visual clarity with reachable settings, zero layout jank / no silent dead buttons, maintainability, waiting-state UX (cute "thinking" indicators), AI-handoff resilience, **Japanese comments for new/changed code (convention starts 2026-07-20)**, security. Portable to other repos. Includes a pre-release mini checklist.
- `docs/ux-design-testing-principles.md` (2026-07-20, Japanese, **ACTIVE GUIDELINE — not an ideas memo**): user-perspective design/testing rules born from real failures (regenerate implemented as duplicate send, missing copy button, missing regenerate despite "GPT basics" request). Contains the GPT-parity table with honest current status, the 5-state rule for every button, a 5-minute manual smoke script, and the vague-instruction protocol. Read before implementing or reviewing any UI change; keep its parity table updated.
- `docs/gentle-news-design.md` (2026-07-20, Japanese): design for the gentle news feature — **stages N1–N3 IMPLEMENTED same day** (user approved the external RSS fetch boundary and the `fast-xml-parser` dependency). Remaining: N4 (morning-card digest, 👍👎 weight learning) and the X/Twitter paid-API adapter (documented, deliberately not implemented). Classification cache is keyed by article-id × interests-hash so changing interests triggers reclassification.
- `docs/weight-and-private-metrics.md` (2026-07-20, Japanese): ideas-only design for weight tracking where the AI only ever sees derived values (% change from diet start, trend, goal progress — quantized, 7-day averaged) and never raw kg; raw values stay client-side and are never put in any request payload. Generalizes into a reusable "PrivateMetric" privacy-transform layer. Includes safety rules (never praise too-fast loss, no shame on regain).
- `docs/external-integrations-and-habit-design.md` (2026-07-20, Japanese): ideas-only memo on (1) externalizing memory/records/schedule to Obsidian (local Markdown vault via the local Node server) and Google Calendar (ICS read + template-URL write before any OAuth) so the LLM references facts instead of storing them, and (2) reward/retention design — micro-rewards, soft streaks, two-choice nudges, if-then pre-commitments, shame-free meal logging. New safety boundary flagged: local file access must be path-restricted, append-only, approval-gated.
- `docs/4o-solo-enhancement.md` (2026-07-20, Japanese): ideas-only memo for making the primary 4o-like model smarter WITHOUT a second stronger model — context injection (time, life data, memory), default instruction templates, parameter presets, and same-model two-pass (reasoningModel = primary). Complements the orchestration doc.
- `docs/feature-ideas.md` (2026-07-20, Japanese): ideas-only backlog of latent user needs (markdown rendering, backup/export, PWA notifications, tool use for Life data, accessibility, etc.) with a suggested effort/impact order. Not commitments.
- `docs/4o-thinking-orchestration.md` (2026-07-20): design-only spec for a future layered assistant — primary conversational model + background reasoning model, orchestrator modes, sleep/routine nudges, reasoning output schema, and a 7-stage implementation plan. Nothing from it is implemented yet; its Stage 1–3 tasks are good Sonnet-sized units.

## Remaining tasks / safe next steps (Sonnet-suitable, in priority order)

1. **Browser smoke test** — load the app, click through tabs, send a mock chat, toggle theme. Fix any DOM typos found.
2. **Streaming** — `stream: true` in the adapter + SSE (or chunked fetch) endpoint variant + incremental render in `sendMessage()`/`regenerate()`. Enable the existing streaming toggle.
3. **Moderation precheck** — server-side call to the OpenAI moderation endpoint in `server/openai.mjs`, honoring `moderationBehavior` (block/warn/log). Wire the existing toggle.
4. **Image input** — file input in Chat/Images → base64 `input_image` content part in the adapter. Keep payload construction in the adapter.
5. **Web search + image generation** — Responses API `tools` wiring behind the disabled toggles.
6. **Calendar events** — add/edit/delete events with localStorage, category markers (health/errand/fun/task already styled).
6b. **Diary follow-ups** — configurable address term (マスター is currently the default in the server-side diary instructions); auto-suggest writing yesterday's entry on first visit of a new day (no background scheduler exists — the app must be open); optional Obsidian export of entries (see external-integrations memo).
7. Optional later: migrate to Next.js/React/TypeScript; the adapter, settings schema, and localStorage keys should carry over.

Constraints for the next agent: keep ALL OpenAI payload construction in `server/openai.mjs`; no DB/auth/deployment/accounts; settings stay in localStorage; never expose the API key client-side; keep placeholders honestly labeled; preserve the mint light/dark theme identity.
