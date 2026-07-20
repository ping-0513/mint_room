# Agent handoff — Mint Room

## Current repo state (as of this pass)

The repo was empty except `CLAUDE.md` before this pass. This pass scaffolds a
Next.js 14 (App Router) + TypeScript + Tailwind CSS app from scratch — the
"mint room" personal assistant foundation described in the task brief.

Stack: Next.js 14.2.5, React 18, TypeScript (strict), Tailwind CSS. No
database, no auth, no deployment config. Settings and chat history persist
to `localStorage` only.

## What was implemented

- **Tab shell** (`app/page.tsx`, `components/TabNav.tsx`): Chat, Life,
  Calendar, Images, Search, Settings. Mint/aqua pastel theme with full dark
  mode (`tailwind.config.ts`, `app/globals.css`), sparkle accent, soft
  rounded surfaces, no harsh contrast.
- **Chat tab** (`components/ChatTab.tsx`) — the most fully built piece:
  - Input clears immediately on successful send.
  - Send button + Enter key both guarded by an `isSending` flag to prevent
    double-send.
  - Regenerate finds the last **user** message, drops any assistant
    message(s) after it, and re-requests a fresh assistant reply for that
    same user turn — it does not resend/duplicate the user message.
  - Loading state ("thinking…"/streaming ellipsis), disabled Send/Regenerate
    while sending.
  - Per-message error state with an inline **Retry** button (re-runs the
    request using the history up to that point; does not duplicate turns).
  - Chat history persisted to `localStorage` (`mintroom.chat.history`).
- **Server-side OpenAI boundary**:
  - `lib/openai.ts` — the single function (`buildOpenAIRequest`) that maps
    `AppSettings` + message history to an OpenAI **Responses API**
    (`/v1/responses`) payload. Never imported from client components; reads
    `process.env.OPENAI_API_KEY` only server-side.
  - `app/api/chat/route.ts` — POST route. If `OPENAI_API_KEY` is unset, it
    returns a clearly-labeled mock reply (streamed word-by-word if streaming
    is on) so the UI is fully testable without a key. If the key is set, it
    calls OpenAI's Responses API and, when streaming is requested, converts
    OpenAI's SSE (`response.output_text.delta` events) into a plain text
    delta stream so the client never has to parse SSE itself.
  - `.env.example` documents `OPENAI_API_KEY`. No secrets committed.
- **Settings tab** (`components/SettingsTab.tsx`) with collapsible sections:
  Model, Behavior, Safety, Tools & capabilities (collapsed by default), and
  Appearance. Backed by `lib/settings-context.tsx` (React context +
  `localStorage`, key `mintroom.settings`) and `lib/types.ts` (all setting
  types + defaults + validation ranges in one place).
- **Life tab** (`components/LifeTab.tsx`): wake/sleep time pickers, and
  three add/check/remove checklists (tasks, shopping list, medication),
  each persisted to its own `localStorage` key. Fully usable, not just a
  visual mock.
- **Calendar tab** (`components/CalendarTab.tsx`): a real month grid (current
  month, computed from `Date`), today highlighted, category-colored event
  chips (task/appointment/med/personal) with icon + label, legend at top.
  Events are local mock data (`MOCK_EVENTS` array) — no external calendar
  sync.
- **Images tab / Search tab**: clearly labeled placeholder entry points
  (disabled buttons, explanatory text). No fake functionality.
- **Theme**: light/dark/system, applied via a pre-hydration inline script in
  `app/layout.tsx` (avoids flash) plus a `SettingsProvider` effect that
  reacts to OS theme changes when "system" is selected.

## Files changed

All new files (repo was empty):

```
CLAUDE.md                        (pre-existing, unchanged)
.env.example
.gitignore
next.config.js
package.json
postcss.config.js
tailwind.config.ts
tsconfig.json
app/layout.tsx
app/page.tsx
app/globals.css
app/api/chat/route.ts
components/TabNav.tsx
components/ChatTab.tsx
components/SettingsTab.tsx
components/LifeTab.tsx
components/CalendarTab.tsx
components/ImagesTab.tsx
components/SearchTab.tsx
lib/types.ts
lib/openai.ts
lib/settings-context.tsx
lib/use-local-storage.ts
lib/chat-client.ts
docs/agent-handoff.md            (this file)
```

## How to run

```bash
npm install
cp .env.example .env.local   # optionally add OPENAI_API_KEY
npm run dev                  # http://localhost:3000
```

Without `OPENAI_API_KEY`, chat works end-to-end against a mock reply. With a
key set, it calls the real OpenAI Responses API.

Build/typecheck:

```bash
npm run typecheck   # tsc --noEmit
npm run build        # next build
```

## Verification results (this pass)

- `npx tsc --noEmit` — passes, no errors.
- `npm run build` — succeeds (`next build`, includes its own type/lint pass
  during the build). Routes: `/` (static), `/api/chat` (dynamic).
- Manual smoke test: started `next dev`, `curl`'d `/` (200 OK) and POSTed to
  `/api/chat` with a sample settings payload and no `OPENAI_API_KEY` set —
  received a correctly streamed mock reply, no server errors in the dev log.
- **Not verified**: real OpenAI API calls (no API key available in this
  environment), browser UI interaction (no visual/browser check was done in
  this pass — only HTTP-level smoke testing). The Chat/Settings/Life/
  Calendar UI has not been visually confirmed in a real browser.
- `npm run lint` was not run explicitly this pass (build includes Next's
  lint/type step and passed).

## Response behavior settings implemented

All settings live in `lib/types.ts` (`AppSettings`) and are editable in
`components/SettingsTab.tsx`:

- Model (dropdown, list defined in `AVAILABLE_MODELS`, easy to edit)
- Developer instructions (textarea)
- Assistant style / persona note (textarea, tracked separately from dev
  instructions in state, merged at request-build time)
- Temperature (slider, 0–2 step 0.1)
- Top-p (slider, 0–1 step 0.05)
- Max output tokens (number input, 16–8192)
- Reasoning effort (default/low/medium/high; disabled with an explanatory
  label when the selected model doesn't declare `supportsReasoningEffort`)
- Response format (text / JSON, JSON option labeled advanced)
- Streaming toggle
- Safety mode (standard/stricter/development) — app-level only, does not
  claim to bypass provider policy
- Moderation precheck — **placeholder only**, control shown disabled with
  "coming soon" label (see below)
- Moderation behavior (warn/block/debug log) — state exists, not yet wired
  to an actual moderation call
- Safety identifier — auto-generated random UUID (`mr_<uuid>`) stored in
  `localStorage`, shown read-only in Settings, never derived from name/email
- Store responses toggle (defaults **off**, privacy-preserving)
- Prompt cache key — advanced/developer text field, optional
- Tools & capabilities (web search, image input, image generation, tool
  use) — all shown as disabled placeholders with explanations
- Context/history length strategy (last 10 / last 20 / full) — actually
  wired up: `ChatTab` trims history sent to `/api/chat` accordingly
- Theme (light/dark/system)

## OpenAI API mapping implemented or stubbed

Mapped (see `lib/openai.ts` doc comment for the authoritative list):

- `model`, `input` (message history), `temperature`, `top_p`,
  `max_output_tokens`, `stream`, `store`, `safety_identifier`
- `instructions` ← developer instructions + persona note, merged
- `reasoning.effort` ← reasoning effort, only sent for models flagged
  `supportsReasoningEffort` and when not "default"
- `text.format = { type: "json_object" }` ← response format "json" (best
  effort — **verify against current Responses API docs**, this was written
  from general knowledge, not a live docs check, since this environment has
  no OpenAI API access to verify against)
- `prompt_cache_key` ← only when non-empty

Intentionally **not** mapped yet (placeholders):

- Web/search tool, image input, image generation, function/tool calling —
  no `tools` array is constructed at all yet.
- Moderation precheck — no call to the moderation endpoint exists yet.
  Placeholder documented here per the task instructions.

## Known model-dependent behavior

- Reasoning effort is only exposed/sent for models with
  `supportsReasoningEffort: true` in `lib/types.ts` (currently just
  `o4-mini` in the seed list). Extend that list as needed — it's the single
  place model capabilities are declared.
- The exact set of valid `reasoning.effort` values and whether
  `response_format`/`text.format` shape is current should be re-verified
  against live OpenAI docs before this is used against a real account —
  this was implemented from general model knowledge without live doc access.

## Remaining gaps / not implemented

- No real OpenAI call has been tested (no key in this environment).
- No moderation precheck call.
- No web search, image input, image generation, or tool/function calling —
  UI placeholders only.
- No visual/browser QA — only HTTP-level smoke tests were run.
- No automated tests (unit or e2e) exist yet.
- Life tab has no reminders/notifications, just checklists + times.
- Calendar has no add/edit UI yet — mock events only.
- `npm run lint` (ESLint) was not run standalone this pass.

## Safe next implementation steps for another agent (incl. Sonnet)

1. Add a real API key locally and manually verify the OpenAI Responses API
   call path (non-streaming and streaming) works end-to-end; adjust
   `lib/openai.ts` field names/shapes against current docs if they've
   drifted (especially `text.format` and `reasoning.effort` value set).
2. Add a moderation precheck: a small server route
   (`app/api/moderate/route.ts`) calling OpenAI's moderation endpoint,
   called from `ChatTab` before `sendChat` when
   `settings.safety.moderationPrecheckEnabled` is true; respect
   `moderationBehavior` (warn/block/debug_log). Flip the Settings toggle
   from disabled to enabled once wired.
3. Wire `contextStrategy` more richly if needed (e.g. token-based trimming
   instead of message-count).
4. Add image input: enable the Images tab upload control, pass image data
   through a new/extended `/api/chat` (or a dedicated route) using the
   Responses API's multi-modal `input` content parts.
5. Add a Calendar "add event" flow backed by `localStorage`, replacing
   `MOCK_EVENTS`.
6. Run `npm run lint` and fix anything flagged; consider adding a minimal
   test setup (none exists yet) if the project grows.
7. Do a real browser pass (start `npm run dev`, click through all six tabs,
   light and dark mode, mobile-width layout) — this pass only verified via
   `curl` and `tsc`/`next build`, not a rendered browser.
