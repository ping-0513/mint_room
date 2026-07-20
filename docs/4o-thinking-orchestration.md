# 4o Thinking orchestration — design document

Status: DESIGN ONLY. Nothing in this document is implemented yet unless explicitly cross-referenced to an existing file. Implementation agents: read `docs/agent-handoff.md` first for current repo state, then build from this document in the stages listed at the end.

Model naming note: exact model availability is not guaranteed. This document uses **"primary conversational model"** (a 4o-like fast, warm chat model) and **"background reasoning model"** (a GPT-5.5T-like thinking/planning model). Both must be **configurable placeholders** in `MODELS` in `server/openai.mjs` — never hardcoded IDs deep in request logic. Do not assume undocumented model IDs or provider behavior; verify against current OpenAI docs at implementation time.

---

## 1. Concept

mint room today is a single-model chat app. The goal is a layered assistant:

- The **primary conversational layer** keeps the friendly, fast, emotionally comfortable "4o-like" experience the user loves. It answers directly for most messages.
- A **background reasoning layer** (hidden helper) occasionally analyzes conversation state, improves plans, summarizes long context, and watches for routine opportunities (bedtime, medication, tasks). It never speaks to the user directly — its output is internal app data consumed by the orchestrator and the primary model.
- An **orchestrator** decides per-turn whether the background model is needed at all, keeping latency and cost low.

The result should feel like "4o Thinking": the same gentle voice, but noticeably smarter, more consistent, and quietly attentive to the user's routines — e.g. "it's getting late; do you want to start bedtime mode? 🌙".

This is explicitly **not** a policy-bypass system. Both layers go through the same server-side OpenAI boundary, the same safety settings, and provider-side policy enforcement applies to every call. The background model exists to improve planning, consistency, task decomposition, reminders, and user-fit — nothing else.

## 2. User experience

What the user sees:

- Chat feels exactly like today for ordinary messages: fast, warm, no visible machinery.
- For complex questions, the assistant may show a soft "thinking…" state slightly longer, then give a noticeably better-structured answer. No chain-of-thought is shown.
- Occasionally, a **gentle nudge** appears: an inline assistant message, a small banner, or a bedtime-mode card, with Dismiss / Snooze / Start buttons. Nudges are optional, infrequent, and never scolding.
- Settings gain a "Companion brain" (working name) section: reasoning mode, bedtime, nudge style, privacy toggles. Everything can be turned off.
- If the background model fails, the user notices nothing — the primary model answers as usual. No scary errors unless the user's own action failed.

Tone rules for anything nudge-related: soft, brief, opt-out-first, never guilt-based ("would you like…?" not "you should have…").

## 3. Model roles

### Primary conversational model (4o-like)

- Fast natural chat; handles ordinary conversation directly, without waiting on the background model.
- Warm, familiar, low-friction responses; maintains persona.
- Does not over-explain internal reasoning; never reveals hidden notes verbatim.
- Uses existing settings: developer instructions, persona/style note, temperature, top-p, max output tokens, history strategy (`historyLimit`).
- Configured via `settings.model` (existing).

### Background reasoning model (GPT-5.5T-like)

- Analyzes conversation state; detects timing/routine opportunities; identifies when a reminder/nudge may help.
- Improves task plans, checks for missed context, summarizes long context.
- Produces **structured recommendations** (schema in §"Reasoning output schema") for the orchestrator and primary model.
- Helps produce "Thinking-like" responses for complex questions (two-pass design, §"4o Thinking response design").
- Never speaks directly to the user unless its `user_visible_message` is deliberately promoted through the primary layer or a nudge UI element.
- Configured via a new `settings.reasoningModel` (placeholder id in `MODELS`, flagged e.g. `role: "reasoning"`); typically run with low temperature and structured output.
- **Solo mode:** `reasoningModel` may be set to the same model as the primary (4o-thinking-with-itself). Every orchestrator mode works unchanged; quality is lower than with a dedicated reasoning model but still better than single-pass. See `docs/4o-solo-enhancement.md` for the solo-focused idea list.

## 4. Conversation architecture

### Orchestrator

A small server-side module — proposed file: `server/orchestrator.mjs` — sitting between `POST /api/chat` and `server/openai.mjs`. It never constructs OpenAI payloads itself; it composes calls to adapter functions (`buildResponsesPayload`, a future `buildReasoningPayload`) and merges results.

Modes (the orchestrator picks one per turn):

| Mode | Flow | When |
|---|---|---|
| `fast_chat` | primary model only | default; trivial/short/emotional messages |
| `assisted_chat` | primary model + most recent cached background reasoning note injected as guidance | a fresh-enough reasoning note exists; no new reasoning call |
| `thinking_response` | background reasoning first → structured note → primary model answers with the note as guidance | complexity triggers or user request ("think carefully") |
| `routine_watch` | background check for sleep/routine/todo nudges; no chat reply needed | periodic client tick or piggybacked on a normal turn |
| `regenerate_review` | background model diagnoses why the previous answer failed → primary model regenerates with the diagnosis as guidance | user hits Regenerate after a bad answer (optionally: only on 2nd+ regenerate) |

Trigger heuristics (cheap, local, no model call needed to decide):

- Call reasoning only when: message length or history size crosses a threshold; message contains planning/technical/caution-topic markers; user explicitly asks for careful thinking; regenerate was pressed; or a routine tick is due.
- Never call reasoning for: greetings, short replies, emotional check-ins, UI actions. A per-session budget (e.g. max N reasoning calls/hour, configurable) caps cost.
- `routine_watch` runs at most every X minutes (default 15–30) and can often be answered **without any model call** from local state alone (see §5) — the reasoning model is only consulted when tone-sensitivity matters.

Guidance injection rule: reasoning output enters the primary call as part of server-composed `instructions` (clearly delimited, e.g. "Internal planning note — do not quote or mention: …"), never as a fake user/assistant turn. This keeps chat history clean and regenerate semantics intact.

## 5. Sleep/routine nudge architecture

### State needed

| State | Source | Lives where (MVP) |
|---|---|---|
| Preferred bedtime | explicit user setting | localStorage (`mintroom.settings.v1`) |
| Wake-up target | explicit user setting (already exists as `life.wakeTime`) | localStorage (`mintroom.life.v1`) |
| Current local time + timezone | client clock; timezone setting optional override | computed client-side, sent with orchestrator requests |
| Last sleep-nudge time | app-managed | localStorage (new `mintroom.routine.v1`) |
| Dismissed nudges + snooze-until times | app-managed | `mintroom.routine.v1` |
| Current conversation tone (busy / distressed / playful / working / casual) | inferred from chat (reasoning model or cheap heuristics); default "unknown" | in-memory + optionally `mintroom.routine.v1` |
| Medication checklist status | existing Life tab | `mintroom.life.v1` |
| Task list due times | Life tab (needs a due-time field added later) | `mintroom.life.v1` |

**MVP: localStorage only. No database.** The client sends a compact routine-state snapshot to the server per orchestrated turn; the server holds nothing between requests.

Inferred from chat (best-effort, never blocking): conversation tone, "user seems to be working/urgent", "user mentioned being tired". Explicitly configured (never inferred): bedtime, wake-up target, medication times, nudge enablement, cooldowns. Inference tunes *timing and tone* of nudges; it never creates new nudge categories by itself.

### Anti-nagging rules

- Hard cooldown per nudge type (default 60–120 min, configurable). A dismissed nudge never repeats within its cooldown.
- Snooze sets an explicit `snoozeUntil`; respected absolutely.
- Max nudges per evening (default 2 across all types).
- Tone gate: if tone is `distressed` or `working/urgent`, suppress all non-critical nudges unless the user enabled "interrupt me anyway".
- Nudges are suggestions with buttons, never auto-actions, never modal, never repeated in consecutive turns.

### Nudge UI representations

1. **Inline assistant message** — soft one-liner in chat flow (default for sleep).
2. **Small banner** — dismissible strip above the input (for medication/task while user is mid-conversation).
3. **Bedtime mode card** — a cute card with moon/mint styling: "Start bedtime mode 🌙", shows wake-up target, optional "dim theme" action.
4. Every representation has **Dismiss / Snooze / Start (or Done)** buttons. Dismiss records cooldown; Snooze records `snoozeUntil`; Start flips the relevant mode/checklist.

### Example nudge policies (ship as data, not scattered code)

- Bedtime within 30 min **and** tone is casual → gentle inline suggestion of bedtime mode.
- Past bedtime **and** no sleep nudge dismissed within cooldown → one soft reminder, then silence for the night.
- Tone is working/urgent → no interruptions unless "nudge even when busy" is on.
- Medication unchecked near its configured time → medication **card** (checklist framing), never a scolding message.
- Any dismissal → that nudge type is silent for its cooldown period.
- No nudges at all between wake-up target and configurable "quiet morning" end, unless medication-related.

## 6. Data/state needed (summary)

- New localStorage key `mintroom.routine.v1`: `{ bedtime, quietHours, lastNudge: {type: timestamp}, dismissed: {type: timestamp}, snoozeUntil: {type: timestamp}, nudgesTonight: number, lastTone: string }`.
- New settings fields (see §7) in `mintroom.settings.v1`.
- Cached reasoning artifacts (context summary, last reasoning note + timestamp) in-memory per tab, optionally `mintroom.reasoning-cache.v1` with a short TTL. Cached summaries are what make `assisted_chat` free.
- No server-side state beyond the existing per-instance anonymous `safety_identifier`.

## 7. Settings needed

Extend the existing Settings tab (groups in parentheses; existing settings stay as-is):

| Setting | Group | Notes |
|---|---|---|
| Primary model | Model (exists as `model`) | unchanged |
| Background reasoning model | Model | placeholder list entry; "not configured" state supported |
| Reasoning mode | Model | `off` / `auto` (default) / `always_complex` / `manual_only` |
| Reasoning effort (where supported) | Model (exists) | applies to reasoning model when its capability flag allows |
| Bedtime nudge enabled | Routine (new group) | default on once bedtime is set, else off |
| Bedtime | Routine | time input |
| Wake-up target | Routine | reuse `life.wakeTime` |
| Nudge style | Routine | `soft` (default) / `direct` / `minimal` |
| Nudge cooldown | Routine | minutes; default 90 |
| Medication reminder enabled | Routine | default off until user opts in |
| Task reminder enabled | Routine | default off |
| Local timezone | Routine (advanced) | default: browser timezone |
| Privacy mode | Safety | when on: no chat content to background model; nudges use local state only |
| Send conversation to background model | Safety | explicit toggle, on by default only when reasoning mode ≠ off; help text states clearly that chat content is sent to a second model call |
| Save summaries locally | Safety | default on; off = summaries stay in-memory only |
| Developer instructions / persona / temperature / top-p / max tokens / safety & moderation mode | existing | unchanged; both layers respect them |

No login, no database, no cloud sync in MVP. All new settings persist in localStorage like existing ones.

## 8. API boundaries

Keep the existing architecture contract (see `docs/agent-handoff.md`):

- **UI components never construct OpenAI payloads.** All payload construction stays in `server/openai.mjs` (add `buildReasoningPayload(settings, snapshot)` beside `buildResponsesPayload`).
- **API keys stay server-side.** Background reasoning uses a server route — proposed `POST /api/orchestrate` (or an extended `/api/chat` accepting `{ mode }`), same key handling as today.
- The orchestrator (`server/orchestrator.mjs`) is pure decision + composition logic: **testable without live API calls** by injecting fake adapter functions.
- **Mock reasoning output is supported for development**: when `OPENAI_API_KEY` is unset, the reasoning path returns a labeled mock note (same pattern as today's mock chat), so the whole nudge/thinking flow is demo-able offline.
- localStorage holds user settings and local schedules for MVP; the client sends only the compact routine snapshot + trimmed history the server needs per call.

## 9. Safety/privacy boundaries

- This system does **not** and cannot bypass OpenAI or provider policy; no "disable policy" controls will ever be added. Both model calls go through the same moderated, policy-enforced API.
- No sensitive data in any database in MVP (there is no database).
- No full-conversation logging by default; server logs stay at request-outcome level.
- **Transparency:** settings copy states plainly when conversation content is sent to the background model; privacy mode and "reasoning off" fully disable it.
- Users can independently turn off background reasoning and all nudges.
- Local-only state first; any future sync is Stage 7 and requires explicit user approval.
- `safety_identifier` remains the anonymous server-generated UUID — never email, name, or other raw personal identifiers.
- Medication features are **checklist/nudge features only** — reminders about the user's own configured list. The assistant must not present dosage advice or medical guidance; caution topics route to `thinking_response` with the existing safety settings applied.
- Reasoning output is internal app data. It is never displayed as chain-of-thought; only `user_visible_message` may ever surface, and only through the nudge UI or primary model.

## 10. "4o Thinking" response design

Two-pass response:

1. **Pass 1 (hidden):** background reasoning model receives trimmed history + routine snapshot + the user's message, returns the structured note below (compact JSON, low token budget).
2. **Pass 2 (visible):** primary model receives the normal payload plus `primary_model_guidance` (and `do_not_say`) folded into server-composed instructions, and answers in its own warm voice.

Use it for: complex planning, technical explanations, medical/legal/financial caution topics, long-context summarization, explicit "think carefully" requests, regenerate-after-bad-answer.
Skip it for: lightweight chat, emotional reassurance, quick UI actions, very short answers.

Latency strategy — pick per mode: `thinking_response` blocks (show the soft "thinking…" state; acceptable because the user asked a hard question); `assisted_chat` and `routine_watch` never block (fast answer first; refinement lands as cached guidance for the *next* turn). Optional later: fast-answer-then-refine in one turn (needs streaming; see handoff next-steps).

Cost strategy: reasoning called only on triggers; summaries cached with TTL and reused; compact structured outputs (`max_output_tokens` small, e.g. 300–800); per-session call budget.

Failure strategy: any reasoning failure (timeout, API error, malformed JSON) → log at debug level, fall back to `fast_chat` silently. The user sees a normal answer, never an error, unless the primary call itself failed (existing error banner + retry covers that).

### Reasoning output schema (internal app data — never user-visible chain-of-thought)

```jsonc
{
  "should_nudge": false,                 // boolean
  "nudge_type": "none",                  // sleep | medication | task | shopping | calendar | none
  "urgency": "low",                      // low | medium | high
  "user_visible_message": null,          // string | null — the ONLY field that may ever be shown, via nudge UI or primary model
  "primary_model_guidance": "",          // instructions folded into the primary call
  "context_summary": "",                 // cached; powers assisted_chat cheaply
  "risks_or_cautions": [],               // string[] — e.g. "medical topic: keep general, suggest professional"
  "suggested_actions": [],               // [{ "type": "start_bedtime_mode" | "open_tab" | "add_task" | ..., "label": "..." }]
  "should_use_thinking_response": false, // recommend deeper handling next turn
  "reasoning_mode": "fast",              // fast | assisted | deep — what the reasoner believes this turn needed
  "do_not_say": [],                      // string[] — phrasing for the primary model to avoid (e.g. scolding about bedtime)
  "state_updates": {}                    // e.g. { "lastTone": "working" } — merged into mintroom.routine.v1 by the client
}
```

Validation rule: the server validates this shape and drops/repairs malformed fields; a malformed note is treated as a reasoning failure (silent fallback), never surfaced.

## 11. MVP implementation stages

| Stage | Scope | Files likely changed | Testable | Do NOT implement yet |
|---|---|---|---|---|
| **1. Docs + settings placeholders** | This document; add disabled/labeled Settings controls (reasoning model "not configured", routine group with placeholders) | `docs/*`, `public/index.html`, `public/app.js` | settings persist + render; `npm run check` | any model calls, nudge logic |
| **2. Local routine state + bedtime nudge UI** | `mintroom.routine.v1`; pure client-side time-based bedtime nudge (no model); inline message + card + dismiss/snooze/cooldown | `public/app.js`, `public/index.html`, `public/styles.css` | manipulate clock/bedtime, verify policies & cooldowns in browser | tone inference, reasoning calls |
| **3. Mock orchestrator** | `server/orchestrator.mjs` with mode selection + mock reasoning notes (schema above); wire `/api/chat` through it | `server/orchestrator.mjs`, `server.mjs`, `docs/agent-handoff.md` | unit-test mode selection with fake adapters; curl with mock notes | live reasoning calls |
| **4. Server-side background reasoning call** | `buildReasoningPayload` in `server/openai.mjs`; real call behind `reasoningMode`; JSON validation + silent fallback | `server/openai.mjs`, `server/orchestrator.mjs` | with API key: assisted_chat + routine_watch end-to-end; without: mock path unchanged | thinking two-pass UX |
| **5. Thinking response mode** | blocking two-pass flow; "thinking…" UI state; regenerate_review | `server/orchestrator.mjs`, `public/app.js` | complex prompt → guided answer; regenerate diagnosis path | auto fast-then-refine streaming refinement |
| **6. Richer integrations** | task due times, medication timing cards, calendar-aware nudges, tone inference | Life/Calendar code + orchestrator | nudge policies against Life data | external calendar sync |
| **7. Optional DB/cloud sync** | only after explicit user approval; not designed here | — | — | everything until approved |

Each stage keeps the existing contract: payloads only in `server/openai.mjs`, keys server-side, honest labeling of mocks, no DB/auth.

## 12. Later implementation tasks for Sonnet or another agent

Bounded, delegable units (each small enough for one reviewed diff):

1. Stage 1 settings placeholders (pure UI + localStorage, follow existing `SETTING_FIELDS` pattern in `public/app.js`).
2. Stage 2 routine state module + bedtime nudge policies as a small pure function (`shouldNudge(state, now, settings)`) — highly unit-testable; add the first test harness here.
3. Stage 3 orchestrator skeleton with injected adapters + mock notes.
4. Stage 4 `buildReasoningPayload` + schema validation (verify current OpenAI structured-output options at implementation time; do not trust this doc's memory of the API).
5. Nudge UI components (banner, bedtime card) matching the mint theme, light + dark.
6. Update `docs/agent-handoff.md` after each stage (implemented / placeholder / verified).

Constraints carried over: no new dependencies without approval; smallest coherent diffs; never expose keys; never present reasoning output as chain-of-thought; keep the 4o-like voice — the helper makes the assistant smarter, not colder.

## 13. Open questions

1. Exact model IDs for both roles — resolve against OpenAI's live model list at implementation time; keep as `MODELS` entries with role flags.
2. Should `routine_watch` run on a client timer when the tab is idle, or only piggyback on user turns? (Timer = timelier nudges; piggyback = zero idle cost. Suggest: piggyback first, optional timer later.)
3. Tone inference source: cheap client heuristics vs. reasoning model field vs. both — start with `state_updates.lastTone` from the reasoning model only.
4. Does bedtime mode change the theme (auto-dim), or just the conversation framing? (User's eye sensitivity suggests auto-dim is welcome — confirm.)
5. One endpoint (`/api/chat` with `mode`) vs. separate `/api/orchestrate` — decide at Stage 3 based on how much the request shapes diverge.
6. Whether `regenerate_review` should trigger on first regenerate or only repeated ones (cost vs. helpfulness).
7. How aggressively to summarize long histories client-side vs. letting the reasoning model do it server-side (token cost trade-off).
