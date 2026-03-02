# Heartbeat Feature Architecture (OpenClaw)

## Scope
This document describes the **agent heartbeat** feature (periodic agent turns), not the separate web transport heartbeat monitor (`web.heartbeatSeconds`).

## High-level architecture

### 1. Scheduling and wake orchestration
- The gateway starts a heartbeat runner at startup (`src/gateway/server.impl.ts:641-647`).
- The runner computes per-agent schedules from config and arms a timer (`src/infra/heartbeat-runner.ts:996-1038`, `1040-1085`).
- When due, it does not run inline from the timer callback; it queues a wake via `requestHeartbeatNow({ reason: "interval" })` (`src/infra/heartbeat-runner.ts:1033-1036`).
- Wake requests are coalesced, prioritized, retried on busy-main-lane, and deduplicated by target (agent/session) in `src/infra/heartbeat-wake.ts:27-184`.

### 2. Trigger sources
Heartbeats can be triggered by:
- Interval timer (`reason: "interval"`) from the runner timer.
- Cron wake/system-event path (`wake` RPC -> cron service -> heartbeat wake/run) (`src/gateway/server-methods/cron.ts:24-43`, `src/cron/service/timer.ts:627-700`).
- Async exec completion events (`src/agents/bash-tools.exec-runtime.ts:219-242`, `258-268`).
- Manual `wake` requests (for example CLI `system event --mode now`) (`src/gateway/server-methods/cron.ts:24-43`).

### 3. Agent selection and config resolution
- Heartbeats run for either:
  - Only agents with explicit `agents.list[].heartbeat` blocks, or
  - The default agent when no explicit heartbeat agents exist (`src/infra/heartbeat-runner.ts:116-209`).
- Per-agent heartbeat config is defaults merged with agent override (`src/infra/heartbeat-runner.ts:133-146`).
- Interval parsing uses duration parsing; non-positive/invalid disables (`src/infra/heartbeat-runner.ts:211-238`).

### 4. Preflight gates before a run
`runHeartbeatOnce()` enforces gates in this order (`src/infra/heartbeat-runner.ts:591-637`):
- Global enabled toggle (`setHeartbeatsEnabled`).
- Agent-level heartbeat enabled.
- Valid positive interval.
- Active-hours window (`src/infra/heartbeat-active-hours.ts:70-99`).
- Main lane not busy (`requests-in-flight`).
- `HEARTBEAT.md` effectively empty skip (except wake/cron/exec and tagged cron reasons) (`src/infra/heartbeat-runner.ts:497-555`).

### 5. Session and routing context
- Session resolution supports main/global, explicit configured session, and forced session key; it prevents cross-agent session misuse (`src/infra/heartbeat-runner.ts:253-333`).
- Delivery target resolution supports `target: none|last|<channel>`, optional `to`, optional `accountId`, and `directPolicy` DM blocking (`src/infra/outbound/targets.ts:239-369`, `471-483`).
- Per-channel/per-account heartbeat visibility controls whether OKs/alerts are shown and whether indicator events are emitted (`src/infra/heartbeat-visibility.ts:22-73`).

### 6. Prompt construction for heartbeat runs
- Base heartbeat prompt normally comes from heartbeat config/defaults.
- If queued system events indicate exec completion or cron reminders, the runner swaps in dedicated event prompts (`src/infra/heartbeat-runner.ts:563-589`, `src/infra/heartbeat-events-filter.ts:6-53`).
- The prompt body is wrapped with current-time context and sent as the message body to `getReplyFromConfig()` with `isHeartbeat: true` (`src/infra/heartbeat-runner.ts:671-750`).

### 7. Agent execution path and heartbeat mode
- `getReplyFromConfig(..., { isHeartbeat: true, ... })` enables heartbeat-specific behavior including optional heartbeat model override (`src/auto-reply/reply/get-reply.ts:84-100`).
- If a session already has an active run, heartbeat followups are dropped instead of queued (`src/auto-reply/reply/queue-policy.ts:11-16`, `src/auto-reply/reply/agent-runner.ts:239-249`).
- Typing indicators are suppressed for heartbeat runs (`src/auto-reply/reply/typing-policy.ts:20-33`, `src/auto-reply/reply/typing-mode.ts:25-33`).

### 8. Response normalization and ACK semantics
- `HEARTBEAT_OK` token handling lives in `stripHeartbeatToken()` with edge-only stripping and optional short-padding tolerance (`src/auto-reply/heartbeat.ts:110-171`).
- For heartbeat runs, if response is empty/ACK-only, outbound alert delivery is skipped; optional OK message may still be sent based on visibility (`src/infra/heartbeat-runner.ts:756-814`).
- `ackMaxChars` default is 300 in code (`src/auto-reply/heartbeat.ts:9`, `src/infra/heartbeat-runner.ts:244-250`).
- Exec-completion reasons intentionally bypass ACK skip so exec results are not discarded (`src/infra/heartbeat-runner.ts:782-793`).

### 9. Transcript/session hygiene and dedupe
- Before heartbeat run, transcript file size is captured; ACK-only/duplicate turns are pruned by truncating back to pre-run size (`src/infra/heartbeat-runner.ts:376-425`, `737-767`, `801-841`).
- `updatedAt` can be restored for non-informational heartbeat turns so idle-expiry behavior is not artificially extended (`src/infra/heartbeat-runner.ts:345-374`, `760-764`, `796-800`).
- Duplicate heartbeat payloads within 24h are suppressed via `SessionEntry.lastHeartbeatText` + `lastHeartbeatSentAt` (`src/infra/heartbeat-runner.ts:819-851`, `src/config/sessions/types.ts:68-75`).

### 10. Outbound delivery and channel readiness
- Delivery is skipped when target is `none`, unresolved, DM-blocked, alerts-disabled, unknown account, or channel checkReady fails (`src/infra/heartbeat-runner.ts:861-915`).
- Channel plugins can gate heartbeat sends via `heartbeat.checkReady()` adapter (`src/channels/plugins/types.adapters.ts:237-247`, `src/infra/heartbeat-runner.ts:712-721`, `893-915`).
- Successful sends go through shared outbound delivery pipeline (`src/infra/heartbeat-runner.ts:918-937`).

### 11. Observability and control plane
- Every run emits heartbeat events with status/reason/preview/indicator fields (`src/infra/heartbeat-events.ts:3-58`, `src/infra/heartbeat-runner.ts:631-975`).
- Gateway broadcasts heartbeat events to clients (`src/gateway/server.impl.ts:635-639`).
- `last-heartbeat` returns the last event; `set-heartbeats` toggles global enabled state (`src/gateway/server-methods/system.ts:10-29`).
- Hot config reload updates heartbeat runner config in-place (`src/gateway/server-reload-handlers.ts:64-67`).

## Actual agent instructions (verbatim strings)

### A) Default heartbeat poll message (user message body)
Source: `src/auto-reply/heartbeat.ts:6-7`

```text
Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.
```

### B) Heartbeat contract injected into system prompt
Source: `src/agents/system-prompt.ts:648-653`

```text
## Heartbeats
Heartbeat prompt: <resolved heartbeat prompt>
If you receive a heartbeat poll (a user message matching the heartbeat prompt above), and there is nothing that needs attention, reply exactly:
HEARTBEAT_OK
OpenClaw treats a leading/trailing "HEARTBEAT_OK" as a heartbeat ack (and may discard it).
If something needs attention, do NOT include "HEARTBEAT_OK"; reply with the alert text instead.
```

### C) Cron-triggered heartbeat prompt variants
Source: `src/infra/heartbeat-events-filter.ts:6-38`

```text
A scheduled reminder has been triggered. The reminder content is:

<event text>

Please relay this reminder to the user in a helpful and friendly way.
```

Internal-only variant when user relay is disabled:

```text
A scheduled reminder has been triggered. The reminder content is:

<event text>

Handle this reminder internally. Do not relay it to the user unless explicitly requested.
```

### D) Exec-completion-triggered heartbeat prompt variants
Source: `src/infra/heartbeat-events-filter.ts:40-52`

```text
An async command you ran earlier has completed. The result is shown in the system messages above. Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. If it failed, explain what went wrong.
```

Internal-only variant when user relay is disabled:

```text
An async command you ran earlier has completed. The result is shown in the system messages above. Handle the result internally. Do not relay it to the user unless explicitly requested.
```

### E) Seeded workspace HEARTBEAT.md template guidance
Source: `docs/reference/templates/HEARTBEAT.md:8-12` (loaded via workspace template system)

```text
# HEARTBEAT.md
# Keep this file empty (or with only comments) to skip heartbeat API calls.
# Add tasks below when you want the agent to check something periodically.
```

### F) Seeded AGENTS heartbeat guidance template
Source: `docs/reference/templates/AGENTS.md:135-142`

```text
When you receive a heartbeat poll (message matches the configured heartbeat prompt), don't just reply HEARTBEAT_OK every time. Use heartbeats productively!
Default heartbeat prompt:
Read HEARTBEAT.md if it exists (workspace context). Follow it strictly. Do not infer or repeat old tasks from prior chats. If nothing needs attention, reply HEARTBEAT_OK.
You are free to edit HEARTBEAT.md with a short checklist or reminders. Keep it small to limit token burn.
```

## Practical flow summary
1. Timer/wake request enters `heartbeat-wake` queue.
2. Runner selects eligible agent(s), checks gates, resolves session/target.
3. Runner builds prompt (default heartbeat or cron/exec variant) and calls reply engine with `isHeartbeat`.
4. Response is normalized for `HEARTBEAT_OK` contract.
5. ACK-only/empty/duplicate runs are suppressed and transcript/session metadata is cleaned up.
6. Alert content (and optional reasoning payload) is delivered if routing/visibility/readiness allow.
7. Heartbeat event telemetry is emitted and broadcast.
