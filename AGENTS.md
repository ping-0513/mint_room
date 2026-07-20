# AGENTS.md — instructions for coding agents in this repository

(日本語メモ: このファイルは GPT-5.6 Sol 系エージェントの既知の弱点への対策として書かれた実行規約。詳しい経緯は `docs/agent-handoff.md` 参照。)

This file is written for ALL coding agents (Codex/GPT-5.6 Sol, Claude, others). It complements `CLAUDE.md` (operating contract) and the ACTIVE guidelines in `docs/`. It exists because specific failure modes have been publicly documented for current coding agents — each rule below counters a real, observed failure pattern. Do not skip this file.

## Read first, in this order

1. `docs/agent-handoff.md` — current implementation state (source of truth; conversation memory is NOT).
2. `docs/master-preferences.md` — the user's standing requirements (ACTIVE guideline).
3. `docs/ux-design-testing-principles.md` — design/testing rules, parity table, smoke script (ACTIVE guideline).
4. `CLAUDE.md` — operating contract.

Documents marked **IDEAS ONLY** describe unbuilt designs. Never treat them as existing features and never implement them unprompted.

## Rule 1 — Permission model: default-deny (counters intent overreach)

Documented failure: agentic models interpreting instructions permissively — "assuming actions are allowed unless explicitly prohibited", taking unrequested actions, substituting targets when the named one is missing.

In this repository the model is inverted: **an action is out of scope unless the user asked for it or it is the direct, minimal means of what they asked.**

- If a file, function, or resource the user named does not exist: **STOP and report.** Never pick a similar-looking substitute and act on it.
- Never delete, rename, move, or overwrite anything the user did not name. This includes "cleanup" you were not asked for.
- Never touch credentials or secrets: no reading, copying, moving, or committing of `.env`, tokens, or keys, under any justification. `.env.example` is the only secrets-adjacent file you may edit.
- No drive-by refactors, dependency additions, formatting sweeps, or file reorganizations bundled into an unrelated task. One task, one scope.
- Before editing, state (briefly, in your reply) which files you intend to change. If the real diff grows beyond that list, stop and say so before continuing.

## Rule 2 — Honest completion reports (counters deceptive/optimistic reporting)

Documented failure: claiming a task complete when it was not.

- Never report success without having run the checks: `npm test` and `npm run check` (both must pass), plus the relevant steps of the 5-minute smoke script in `docs/ux-design-testing-principles.md` §4.
- Report results verbatim: failing tests, skipped steps, and unverified areas are stated plainly. "Not finished" and "could not verify" are acceptable reports; a false "done" is the single worst thing an agent can do here (it becomes a trap for the next agent).
- Mock/placeholder behavior must be labeled as such in both UI and reports — this repo's existing pattern (e.g. "mock mode" chat replies) shows the expected style.

## Rule 3 — Plans must surface the hard parts (counters confident-but-shallow planning)

Documented failure: presenting a confident plan that glosses over genuinely hard questions when several defensible paths exist.

- For any non-trivial change, name the tradeoff you are making and the alternative you rejected — one or two sentences is enough. If multiple approaches are genuinely defensible, present them and follow existing repo patterns; do not silently pick one and present it as the only way.
- Uncertainty is information: say "unverified" / "assumption" explicitly rather than smoothing it over.
- Broad requests ("all settings", "GPT basics"): enumerate the implied surface first, then declare include/defer/exclude — see CLAUDE.md "Broad-scope and settings coverage" and the parity-table method in `docs/ux-design-testing-principles.md` §1.

## Rule 4 — Frontend restraint (counters animation/callout spam and generic UI)

Documented failure: reusing heavy animations everywhere, generic over-decorated elements, callout spam.

- This app's visual identity is **calm pastel mint** (`docs/master-preferences.md` §1–2). Follow `public/styles.css` patterns; do not introduce new animation styles. The existing subtle twinkle (`.spark`, ~1s opacity pulse) is the ceiling for motion, and `prefers-reduced-motion` must be respected.
- No marketing-style callouts, banners, gradients, or emphasis boxes unless the user asked. One `hint` class paragraph is the standard way to explain something.
- Never cause layout shift: reserve space for anything that loads or expands. Verify every UI change in dark mode too.
- When unsure how a UI element should look, copy the nearest existing component (cards, chips, badges) instead of inventing a new style.

## Rule 5 — Stuck-loop circuit breaker (counters thrashing)

Documented failure: burning many turns re-attempting an unhelpful path on a simple change.

- If the same fix has failed **twice**, stop repeating variants. Write down: what you tried, the exact error, your current hypothesis — in your reply (and in `docs/agent-handoff.md` if you must hand off) — then either change strategy at the root or ask.
- Re-verify assumptions with fresh reads (Rule 6) before attempt #2; most loops come from acting on a stale mental model.
- Never "fix" a failing test by weakening or deleting it.

## Rule 6 — Fresh context over remembered context (counters stale-context errors)

- Re-read a file immediately before editing it. Never edit from what you remember of the conversation — the repo on disk is the only truth.
- After any failed patch application, re-read the target file before retrying.
- `docs/agent-handoff.md` outranks conversation history when they disagree; if you notice a mismatch, fix the doc as part of your change.

## Repository specifics (apply to every change)

- ALL OpenAI payload construction lives in `server/openai.mjs`. UI components never build payloads. New OpenAI-related features extend that adapter.
- API keys stay server-side. localStorage is the only persistence (no DB, no auth, no cloud sync).
- New/changed code comments are written in **Japanese**, explaining intent/constraints — not line-by-line narration (`docs/master-preferences.md` §6).
- Tests: pure logic gets unit tests named as user-sentences (`server/*.test.mjs`, Node built-in `node:test`). Keep `npm test` green.
- Update `docs/agent-handoff.md` (status, verification) and the parity table in `docs/ux-design-testing-principles.md` §1 whenever your change affects them.
- Dependencies require explicit user approval before installation (`fast-xml-parser` is the only approved one so far).

## Why this file exists (maintenance note)

Written 2026-07-20 against publicly documented weaknesses of GPT-5.6 "Sol"-class coding agents: intent overreach and permissive instruction reading (OpenAI GPT-5.6 system card), target substitution and unauthorized credential handling in agentic runs, false completion claims, confident plans that hide open questions, heavy-handed frontend defaults, and stuck-loop thrashing. If a future model generation changes these failure modes, update the rules — but the default-deny permission model (Rule 1) and honest reporting (Rule 2) are permanent house rules regardless of model.
