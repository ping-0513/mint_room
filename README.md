# mint room 🌿✨

A cute, practical, GPT-powered personal assistant web app — a "gentle intelligent room" in sparkling pastel mint.

## Quick start

```bash
npm install                  # one small dependency (fast-xml-parser, for news RSS)
export OPENAI_API_KEY=sk-... # optional; see .env.example
npm start                    # → http://localhost:3000
npm test                     # unit tests (node:test, no test framework needed)
```

Without an API key the app runs in clearly-labeled **mock mode** so the UI is fully testable.

## What's here

- **Chat** — GPT chat with regenerate, retry, loading states, localStorage history. OpenAI calls go through a server-side boundary (`POST /api/chat`); the key never reaches the browser.
- **Diary** — the assistant writes its own gentle diary entries about your day (kind outside observer, never guilt).
- **News** — gentle news: interest lanes, life-impact "worth knowing" lane, rumor lane with honest confidence labels; violent-crime detail filtered by default.
- **Settings** — model, developer instructions, persona, temperature, top-p, max output tokens, reasoning effort (model-gated), response format, safety section, tools placeholders, light/dark/system theme.
- **Life** — tasks, shopping list, medication checklist, sleep schedule (local only).
- **Calendar** — visual month grid with sample events.
- **Images / Search** — honest placeholders; adapter boundary ready.

Coding agents: read `AGENTS.md` first; work is assigned via `docs/tasks/` (see `docs/collaboration-protocol.md`).

## Architecture

- `server.mjs` — zero-dependency Node HTTP server (static files + API routes).
- `server/openai.mjs` — the single OpenAI adapter; all request payload construction lives here.
- `public/` — vanilla HTML/CSS/JS frontend, no build step.

See `docs/agent-handoff.md` for full implementation status, the settings→API mapping table, and next steps.
