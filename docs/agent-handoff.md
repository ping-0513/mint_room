# Agent handoff — mint room

Status: IN PROGRESS (first foundation pass under time pressure). This file is the source of truth for the next agent.

## Current repo state

- Nearly-empty repo turned into a zero-dependency web app foundation.
- Stack chosen: plain Node.js (>=18, tested on 22) HTTP server + static vanilla HTML/CSS/JS frontend.
  - Rationale: no npm install step, nothing to break if the session is interrupted, easy for any later agent (including Sonnet) to continue or to migrate to Next.js/React later if desired.
- Branch: `claude/assistant-app-foundation-jvhrba`.

## Files

- `server.mjs` — HTTP server: serves `public/`, exposes `POST /api/chat` (server-side OpenAI boundary), `GET /api/status` (reports whether an API key is configured; never exposes the key).
- `server/openai.mjs` — the single OpenAI adapter. All request payload construction lives here (`buildResponsesPayload`), plus the model capability list (`MODELS`) and mock-mode reply when no `OPENAI_API_KEY` is set.
- `public/index.html` — tab shell (Chat / Life / Calendar / Images / Search / Settings) + settings panel markup.
- `public/styles.css` — sparkling pastel mint theme, light/dark/system via CSS variables.
- `public/app.js` — chat state machine, settings state + localStorage persistence, tab logic, life-management lists, calendar grid, placeholder tabs.
- `.env.example`, `.gitignore`, `package.json` (scripts only, no dependencies).

## How to run

```
export OPENAI_API_KEY=sk-...   # optional; without it the app runs in clearly-labeled mock mode
npm start                       # = node server.mjs, serves http://localhost:3000
```

Syntax check: `npm run check` (node --check on the JS entry points). There is no test framework yet.

## What was implemented (see sections below for detail)

(Updated at end of pass — if this section looks incomplete, the pass was interrupted; trust the file list and git log.)

## Remaining tasks / safe next steps for the next agent (Sonnet-suitable)

1. Streaming: add SSE streaming to `POST /api/chat` (Responses API `stream: true`) and incremental rendering in `public/app.js` (`sendChat()`). Non-streaming works today; this is the top UX improvement.
2. Moderation precheck: implement server-side call to OpenAI moderation endpoint in `server/openai.mjs` behind the existing `moderationPrecheck` setting (currently a labeled placeholder toggle).
3. Image input: wire a file input in the Images/Chat tab to Responses API `input_image` content parts (adapter already keeps message-content shape extensible).
4. Web search + image generation: real tool wiring (Responses API `tools`) behind the existing disabled toggles.
5. Calendar: event creation UI (currently mock events, view-only grid).
6. Optional migration to Next.js/React/TypeScript if the project grows — the adapter (`server/openai.mjs`) and settings schema should port as-is.

Constraints for the next agent: keep all OpenAI payload construction in `server/openai.mjs`; do not add DB/auth/deployment; keep settings persistence in localStorage; never expose the API key to the client.
