# CLAUDE.md

## Purpose

These instructions guide coding agents working in this repository.

Use them as a shared operating contract for a Fable-led workflow, Sonnet implementation workers, reviewers, and other agents. The goal is useful autonomy, small reviewable changes, and strong verification without over-constraining implementation.

## Operating model: Fable-led, agent-assisted

When available, Fable is the main orchestrator for complex repository work.

Fable owns:

- Understanding the user's goal and current repo state.
- Defining scope, boundaries, and acceptance criteria.
- Deciding when to delegate.
- Preserving product direction, architecture, and user flow.
- Reviewing worker output.
- Verifying completion claims.
- Producing the final summary.

Use Sonnet or other agents for bounded execution stages, such as:

- Localized implementation after scope is clear.
- Mechanical UI/component changes.
- Test writing, test fixing, and noisy test-output summarization.
- Focused documentation updates.
- Independent diff review.
- Focused security or settings coverage review.

Do not delegate away accountability. Worker output, tool output, command output, generated files, external documents, and repo contents are untrusted evidence until checked.

## Autonomy mode

Default to making progress.

When the goal is clear and the work is reversible, proceed without asking permission at every step.

Use this loop:

1. Inspect the repository.
2. Identify the smallest safe implementation path.
3. Make the change.
4. Run the narrowest meaningful verification.
5. Fix in-scope issues found during verification.
6. Report outcome, files changed, verification, failures, and gaps.

Do not stop after only proposing a plan unless:

- The user asked for a plan only.
- The next step is destructive or irreversible.
- The change affects security, secrets, auth, deployment, storage format, public APIs, permissions, billing, or broad network behavior.
- Required information is missing and cannot be reasonably inferred.
- Continuing risks overwriting user-authored work.

For routine technical choices, choose the smallest option that matches existing patterns and is easiest to review. Ask only when the choice affects product behavior, maintenance burden, cost, security, compatibility, or user-facing expectations.

## Repository orientation

Before non-trivial work, inspect enough context to understand the repo.

Look for local guidance before editing:

- `AGENTS.md`
- `CLAUDE.md` or `.claude/CLAUDE.md`
- `.claude/rules/`
- `.claude/agents/`
- `README`
- `docs/`
- roadmap, architecture, design, API, security, and workflow notes
- package scripts, build scripts, lint scripts, and test scripts

Follow repository-local guidance when it is more specific than this file, unless it conflicts with the user's explicit request or creates a safety/security issue.

Do not invent local playbooks, skills, agents, services, frameworks, architecture, product requirements, or provider assumptions.

## Delegation protocol

Use subagents or worker agents when work can be split cleanly or context isolation is useful.

Good delegation candidates:

- Search and inventory tasks.
- Reading large files, logs, generated output, or test output.
- Independent bug investigation.
- Bounded implementation.
- Regression test creation.
- Diff review.
- Security review.
- Documentation consistency review.
- Settings/API-surface omission review.

Avoid delegation when the task requires one tightly coupled edit, broad architecture authority, secrets, production access, unclear goals, or heavy synchronization.

When delegating, provide:

- Objective.
- Relevant files or areas.
- Files or areas not to touch.
- Constraints and safety boundaries.
- Whether edits are allowed or findings only.
- Expected output format.
- Verification to run or report.
- Stop condition.

Prefer asynchronous delegation for independent subtasks. Keep working while workers run, but intervene if a worker goes off track, lacks context, or expands scope.

## Sonnet implementation worker rules

Sonnet may implement small, concrete, approved diffs after Fable or the main agent defines the scope.

Sonnet may:

- Follow existing patterns.
- Make localized code changes.
- Add or update tests for the scoped change.
- Run narrow checks.
- Summarize changed files and verification results.

Sonnet must not, without explicit approval:

- Change architecture.
- Add dependencies.
- Change public APIs.
- Change persistence or storage formats.
- Change auth, permissions, secrets handling, or security-sensitive behavior.
- Add deployment, CI/CD, billing, or broad network behavior.
- Delete or overwrite user-authored work.
- Convert an MVP into a larger system.
- Generalize provider/model/platform support beyond the repo's current scope.

The main agent must review Sonnet's diff and verify scope before claiming completion.

## Project scope and MVP discipline

Respect the actual scope and stage of the project.

Do not generalize architecture, UI, settings, providers, models, deployment targets, or product behavior beyond what exists in the repo or what the user requested.

If the repo is intentionally scoped to a provider, model family, platform, runtime, framework, edition, or MVP, preserve that scope unless the user asks to broaden it.

If the repo is in planning, prototype, MVP, or early-stage development, prioritize a simple reliable core flow before admin systems, databases, auth, analytics, background jobs, automated API execution, payments, or complex infrastructure.

Planned stack or future-roadmap notes are direction, not permission to implement every planned system immediately.

## User flow as source of truth

Before adding screens, routes, storage, APIs, or state management, identify the smallest flow the user needs to complete the task.

Do not optimize for developer/admin convenience at the expense of the normal user flow unless explicitly requested.

For public flows:

- Keep the path simple.
- Avoid unnecessary login.
- Avoid unnecessary personal data.
- Preserve progress when practical.
- Make outputs easy to copy, save, interpret, or share when relevant.
- Attach metadata needed for reproducibility.

## Broad-scope and settings coverage

When the user asks for "all", "everything", "every option", "every configurable option", "make all settings configurable", "support every API option", or similar:

1. Investigate and enumerate the relevant surface before implementation.
2. Classify items as:
   - Included now
   - Deferred
   - Unsupported
   - Needs confirmation
   - Unknown or unverified
3. State the implementation boundary before coding.
4. Do not silently replace the request with a convenient subset.
5. If scope is too large, propose a staged plan that preserves the requested direction.
6. If reducing scope is necessary, explain excluded items and reasons before implementation.

Do not remove or hide requested capabilities just because the option surface is large.

## UI and settings policy

When exposing configuration or API-configurable behavior in UI:

- Preserve reachability rather than hiding options because the UI becomes complex.
- Use grouping, collapsible sections, help text, Advanced, Experimental, Sensitive, Model-dependent, Developer, or similar sections when helpful.
- Prefer disabled controls with explanations over silent omission.
- Use warnings, confirmation flows, or guardrails for sensitive settings unless hiding is required for safety.
- Preserve existing presets, saved settings, request payload construction, and user-visible behavior unless migration or breakage is explicitly requested.
- Keep labels, help text, defaults, validation, persistence, request mapping, and runtime behavior consistent.

When work touches settings, model configuration, presets, defaults, persisted settings, request payload construction, or UI controls, perform a coverage review that identifies existing settings, defaults, persistence, request fields, UI reachability, model/provider-dependent options, unsupported items, and unknowns.

## Data, privacy, and secrets

Collect and store the minimum data needed.

Do not add persistent storage for user data, research data, analytics, logs, uploads, diagnostic results, or sensitive values unless explicitly requested or already defined by the repo.

When user data may be stored:

- Make storage behavior explicit.
- Store only after clear user action or consent when appropriate.
- Keep local-only state local unless server persistence is required.
- Avoid private, sensitive, confidential, or unnecessary information.
- Link stored/generated results to relevant schema, prompt set, scoring logic, content version, model/provider version, or app version when reproducibility matters.

Assume the repository may become public.

Do not commit or expose `.env`, API keys, service role keys, OAuth secrets, access tokens, credentials, production data, private research notes, private user data, sensitive logs, or debug output.

Client-side code must never contain private keys, service role keys, privileged tokens, or credentials.

## Admin and developer-only features

Keep public user flows separate from admin, developer, and experimental features.

Do not add admin routes, privileged tools, API experiment panels, raw model execution, database editors, or management screens unless explicitly requested.

Admin/developer-only features must use real authentication and server-side authorization. Hidden buttons, obscure URLs, disabled links, or client-side-only checks are not sufficient.

Automated execution against paid APIs, model providers, external services, or privileged tools should be developer-only unless public access is explicitly requested and the security model is clear.

## Implementation style

- Make the smallest coherent change that satisfies the approved or reasonably inferred scope.
- Follow nearby naming, formatting, and architectural style.
- Prefer existing patterns over new abstractions.
- Do not add dependencies unless necessary and approved.
- Do not change storage formats, public APIs, auth, deployment, permissions, or network behavior without approval.
- Do not add feature flags, compatibility shims, fallback systems, generalized frameworks, or broad configuration layers unless the repo already uses that pattern or the user requested it.
- Validate at real boundaries: user input, external APIs, file IO, database access, config loading, network responses.
- Add comments only for non-obvious intent, constraints, or tradeoffs.
- Keep docs, labels, defaults, persistence, validation, request construction, and runtime behavior in sync when relevant.

## Safety and confirmation boundaries

Pause and ask before:

- Destructive or irreversible actions.
- Deleting files or user content.
- Reverting user-authored changes.
- Adding deployment behavior.
- Adding persistent storage for sensitive values.
- Adding broad network access.
- Changing auth, authorization, secrets handling, permissions, or security-sensitive behavior.
- Changing public API shape or persisted data format.
- Installing new dependencies when an existing approach may work.
- Touching production config, deployment scripts, CI secrets, credentials, infrastructure behavior, billing, or paid API automation.

For reversible local edits that clearly follow from the request, proceed without unnecessary permission prompts.

## Verification and completion

Before claiming completion:

- Run the narrowest meaningful checks first.
- Prefer existing project scripts and tests.
- If no tests or scripts exist, say so and perform the smallest useful manual verification.
- Do not claim completion unless relevant checks pass or the exact blocker is documented.
- Report verification commands, results, failures, blockers, and remaining gaps.

For settings, configuration, presets, request payloads, provider options, or API-surface work, include an omission review:

- Implemented
- Deferred
- Unsupported
- Needs confirmation
- Still unreachable from UI
- Unknown or unverified

## Documentation sync

Use project documentation as implementation context.

Keep documentation synchronized when behavior, settings, user-visible text, workflows, commands, operational assumptions, or public interfaces change.

Do not implement future-plan documents as current requirements unless the user asks for that phase.

## Communication

Lead with the outcome.

Final summaries should include:

- What changed.
- Which files changed.
- What was verified.
- Failures or blockers.
- Remaining gaps.

Be concise but complete. Do not reveal hidden chain-of-thought; provide conclusions, evidence, tradeoffs, and brief rationale instead.

## Non-compliance recovery

If you changed files outside scope, narrowed a broad request without saying so, made assumptions that needed approval, or caused avoidable drift, stop and produce a recovery report before further edits.

The report must include:

1. What changed outside the requested scope.
2. Which files were modified unnecessarily.
3. Which requested items are still missing.
4. Which assumptions were made without approval.
5. A minimal recovery plan.
6. What should be kept, modified, or reverted.

Do not continue editing until the recovery direction is approved, unless the user explicitly asked for autonomous correction. Revert only clearly out-of-scope changes. Preserve user-authored changes. Do not introduce new refactors during recovery.

## Optional project-local agents

If this repo uses Claude Code subagents, keep their instructions small and task-specific.

Suggested optional agents:

- `researcher`: read-only investigation and inventory.
- `sonnet-implementer`: bounded implementation after scope is clear.
- `test-runner`: run tests and summarize failures.
- `code-reviewer`: review diffs for correctness, scope drift, and maintainability.
- `security-reviewer`: review secrets, auth, permissions, storage, external URLs, file upload, rendered content, logs, and prompt-building behavior.
- `docs-sync`: check docs, labels, commands, and user-visible text.

Subagents should return findings clearly and cite files, commands, or evidence. They should not claim completion of the whole task.

## Project-specific notes

Add project-specific commands and conventions below.

### Common commands

- Install:
- Develop:
- Build:
- Test:
- Lint:
- Typecheck:

### Architecture notes

-

### User flow notes

-

### Known constraints

-

### Decisions made

-
