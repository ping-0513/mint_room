# mint room 🌿✨

A cute, practical, GPT-powered personal assistant web app — a "gentle intelligent room" in sparkling pastel mint.

## Quick start

```bash
cp .env.example .env        # optional: add your OPENAI_API_KEY
export OPENAI_API_KEY=sk-... # or export directly
npm start                    # → http://localhost:3000
```

No dependencies to install. Without an API key the app runs in clearly-labeled **mock mode** so the UI is fully testable.

## What's here

- **Chat** — GPT chat with regenerate, retry, loading states, localStorage history. OpenAI calls go through a server-side boundary (`POST /api/chat`); the key never reaches the browser.
- **Settings** — model, developer instructions, persona, temperature, top-p, max output tokens, reasoning effort (model-gated), response format, safety section, tools placeholders, light/dark/system theme.
- **Life** — tasks, shopping list, medication checklist, sleep schedule (local only).
- **Calendar** — visual month grid with sample events.
- **Images / Search** — honest placeholders; adapter boundary ready.

## Architecture

- `server.mjs` — zero-dependency Node HTTP server (static files + API routes).
- `server/openai.mjs` — the single OpenAI adapter; all request payload construction lives here.
- `public/` — vanilla HTML/CSS/JS frontend, no build step.

See `docs/agent-handoff.md` for full implementation status, the settings→API mapping table, and next steps.
