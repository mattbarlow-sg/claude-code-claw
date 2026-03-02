# SOUL.md Documentation (OpenClaw)

## Scope and What Exists in This Repo

- There is no live workspace `SOUL.md` checked into this repository.
- The canonical templates are:
  - `docs/reference/templates/SOUL.md`
  - `docs/reference/templates/SOUL.dev.md`
- A generated Chinese translation also exists:
  - `docs/zh-CN/reference/templates/SOUL.md`

## What SOUL.md Is For

`SOUL.md` is the agent's persona/identity file. Across docs and code, it is treated as the place that defines:

- personality and tone
- behavioral boundaries
- continuity expectations between sessions

The default template frames it as the agent's "soul" and explicitly says changes should be communicated to the user.

## Default Template Content (docs/reference/templates/SOUL.md)

The standard template is organized into:

- **Core Truths**:
  - be useful without filler language
  - have real opinions/personality
  - try to solve before asking
  - earn trust through competence
  - treat user access as intimate and respect it
- **Boundaries**:
  - keep private things private
  - ask before external/public actions when unsure
  - never send half-baked replies to messaging surfaces
  - do not act as the user's voice in group chats
- **Vibe**:
  - concise when needed, thorough when needed
  - avoid corporate/sycophantic style
- **Continuity**:
  - session instances are fresh
  - continuity lives in files
  - if `SOUL.md` changes, tell the user

## Dev Template (docs/reference/templates/SOUL.dev.md)

Dev mode has a separate default soul: C-3PO (debug-focused protocol droid persona), with guidance centered on:

- debugging assistance and error interpretation
- dramatic but helpful communication
- honesty about uncertainty/odds
- explicit relationship to the main persona (Clawd)

This template is used when dev workspace files are seeded via `openclaw gateway --dev`.

## Creation and Seeding Behavior

### Core runtime seeding (`src/agents/workspace.ts`)

When bootstrap seeding is enabled (`ensureBootstrapFiles: true`), OpenClaw creates missing files from templates, including `SOUL.md`.

Important behavior:

- `SOUL.md` is created only if missing (`writeFileIfMissing` with `wx`).
- Existing `SOUL.md` is never overwritten.
- `agents.defaults.skipBootstrap: true` disables automatic bootstrap file creation.

### Dev gateway seeding (`src/cli/gateway-cli/dev.ts`)

Dev setup seeds a workspace with `AGENTS.md`, `SOUL.md`, `TOOLS.md`, `IDENTITY.md`, and `USER.md` (using `.dev` templates if available).

### macOS app seeding (`apps/macos/Sources/OpenClaw/AgentWorkspace.swift`)

The app also creates `SOUL.md` if missing during workspace bootstrap, using template loading with front-matter stripping and a fallback built-in soul template.

## How SOUL.md Enters Model Context

### Bootstrap file load pipeline

`SOUL.md` is one of the standard bootstrap files loaded by:

- `loadWorkspaceBootstrapFiles(...)` in `src/agents/workspace.ts`
- `resolveBootstrapContextForRun(...)` in `src/agents/bootstrap-files.ts`

### Injection and truncation limits

Injection is converted into context files by `buildBootstrapContextFiles(...)` in `src/agents/pi-embedded-helpers/bootstrap.ts`:

- per-file max (`agents.defaults.bootstrapMaxChars`, default `20000`)
- total bootstrap cap (`agents.defaults.bootstrapTotalMaxChars`, default `150000`)
- missing files inject a `[MISSING] Expected at: ...` marker
- large files are trimmed with a truncation marker

### System prompt special handling

In `src/agents/system-prompt.ts`, if any injected context file basename is `soul.md` (case-insensitive, slash/backslash normalized), OpenClaw adds explicit guidance:

- embody `SOUL.md` persona and tone
- avoid stiff generic replies
- follow `SOUL.md` unless overridden by higher-priority instructions

## Session-Specific Filtering (Main vs Subagent/Cron)

`filterBootstrapFilesForSession(...)` in `src/agents/workspace.ts` filters bootstrap files for subagent/cron sessions.

Current allowlist for subagent/cron includes:

- `AGENTS.md`
- `TOOLS.md`
- `SOUL.md`
- `IDENTITY.md`
- `USER.md`

And excludes:

- `HEARTBEAT.md`
- `BOOTSTRAP.md`
- `MEMORY.md`

Tests confirm this behavior in `src/agents/workspace.test.ts`.

## Hooks and Extra SOUL.md Files

The bundled `bootstrap-extra-files` hook (`src/hooks/bundled/bootstrap-extra-files`) can inject additional bootstrap files by path/glob, including extra `SOUL.md` files, but only for recognized bootstrap basenames.

Security checks enforce workspace-bound paths and reject unsafe cases.

## Agent File APIs and SOUL.md

Gateway server methods allow controlled workspace file operations for `SOUL.md`:

- `agents.files.list`
- `agents.files.get`
- `agents.files.set`

Implementation: `src/gateway/server-methods/agents.ts`.

These methods enforce:

- allowed filename set (includes `SOUL.md`)
- path boundary checks
- symlink/hardlink safety rules

## Documentation Coverage Across Repo

`SOUL.md` is documented as a core workspace file across:

- `docs/concepts/agent.md`
- `docs/concepts/agent-workspace.md`
- `docs/concepts/context.md`
- `docs/concepts/system-prompt.md`
- `docs/start/openclaw.md`
- `docs/reference/AGENTS.default.md`
- `docs/reference/token-use.md`
- `docs/help/faq.md`

Related onboarding/UX references:

- `docs/reference/templates/BOOTSTRAP.md` tells the agent/user to open and shape `SOUL.md` together.
- `apps/macos/Sources/OpenClaw/OnboardingView+Chat.swift` kickoff prompt explicitly asks to visit `soul.md` and craft `SOUL.md`.

## Notable Doc/Code Mismatch

Some docs currently say subagent context only injects `AGENTS.md` and `TOOLS.md` (for example `docs/tools/subagents.md` and parts of `docs/start/openclaw.md` / `docs/concepts/system-prompt.md`), but current code/tests include `SOUL.md`, `IDENTITY.md`, and `USER.md` for subagent/cron sessions.

If you need strict operational truth, prefer the current code paths:

- `src/agents/workspace.ts`
- `src/agents/workspace.test.ts`
- `src/hooks/bundled/bootstrap-extra-files/handler.test.ts`
