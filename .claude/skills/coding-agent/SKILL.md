---
name: coding-agent
description: 'Delegate coding tasks to Codex, Claude Code, Pi, or OpenCode agents via background PTY processes. Use when: (1) building/creating new features or apps, (2) reviewing PRs, (3) refactoring large codebases, (4) iterative coding that needs file exploration, (5) running multiple coding agents in parallel. NOT for: simple one-liner fixes (just edit the file), reading code (use read tools). Requires the coding-agent MCP server to be running.'
---

# Coding Agent

Spawn and manage coding agents (Codex, Claude Code, Pi, OpenCode) as background PTY processes via the `exec` and `process` MCP tools.

## Setup

The MCP server must be configured in `.mcp.json` in the project root (or `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "coding-agent": {
      "command": "tsx",
      "args": ["<path-to-tiamat>/.claude/skills/coding-agent/server/src/index.ts"]
    }
  }
}
```

## Tools

### exec

Spawn a command with optional PTY and background mode.

| Parameter    | Type    | Description                                                        |
| ------------ | ------- | ------------------------------------------------------------------ |
| `command`    | string  | The shell command to run                                           |
| `pty`        | boolean | Allocate a pseudo-terminal — **required for coding agents**        |
| `workdir`    | string  | Working directory (agent sees only this folder's context)          |
| `background` | boolean | Run in background, returns sessionId for monitoring                |
| `timeout`    | number  | Timeout in seconds (kills process on expiry)                       |
| `env`        | object  | Environment variables to set                                       |

### process

Manage running/finished sessions.

| Action      | Description                                          |
| ----------- | ---------------------------------------------------- |
| `list`      | List all running/recent sessions                     |
| `poll`      | Check if session is still running, get new output    |
| `log`       | Get full session output (with optional offset/limit) |
| `write`     | Send raw data to stdin                               |
| `submit`    | Send carriage return (like pressing Enter)            |
| `send-keys` | Send key tokens or hex bytes                         |
| `paste`     | Paste text (with optional bracketed mode)            |
| `kill`      | Terminate the session                                |
| `clear`     | Clear a finished session from history                |
| `remove`    | Remove a session (running or finished)               |

---

## PTY Mode is Required

Coding agents are interactive terminal applications that need a pseudo-terminal to work correctly. Without PTY, output breaks or the agent may hang.

**Always set `pty: true`** when running coding agents.

---

## Quick Start: One-Shot Tasks

For quick prompts, run in foreground (no background):

```
exec({ command: "codex exec 'Add error handling'", pty: true, workdir: "~/project" })
```

Codex requires a git repo. For scratch work:
```
exec({ command: "cd $(mktemp -d) && git init && codex exec 'Your prompt'", pty: true })
```

---

## The Pattern: workdir + background + pty

For longer tasks, use background mode:

```
# Start agent in target directory
exec({ command: "codex exec --full-auto 'Build a snake game'", pty: true, workdir: "~/project", background: true })
# Returns sessionId for tracking

# Monitor progress
process({ action: "log", sessionId: "XXX" })

# Check if done / get new output
process({ action: "poll", sessionId: "XXX" })

# Send input (if agent asks a question)
process({ action: "write", sessionId: "XXX", data: "y" })

# Submit with Enter
process({ action: "submit", sessionId: "XXX" })

# Kill if needed
process({ action: "kill", sessionId: "XXX" })
```

**Why workdir matters:** The agent wakes up in a focused directory and doesn't wander off reading unrelated files.

---

## Codex CLI

**Model:** `gpt-5.2-codex` (default, set in ~/.codex/config.toml)

### Flags

| Flag            | Effect                                             |
| --------------- | -------------------------------------------------- |
| `exec "prompt"` | One-shot execution, exits when done                |
| `--full-auto`   | Sandboxed but auto-approves in workspace           |
| `--yolo`        | NO sandbox, NO approvals (fastest, most dangerous) |

### Building/Creating

```
# Quick one-shot (auto-approves)
exec({ command: "codex exec --full-auto 'Build a dark mode toggle'", pty: true, workdir: "~/project" })

# Background for longer work
exec({ command: "codex --yolo 'Refactor the auth module'", pty: true, workdir: "~/project", background: true })
```

### Reviewing PRs

Clone to temp for safe review:

```
# Clone and review
exec({ command: "REVIEW_DIR=$(mktemp -d) && git clone https://github.com/user/repo.git $REVIEW_DIR && cd $REVIEW_DIR && gh pr checkout 130 && codex review --base origin/main", pty: true })
```

---

## Claude Code

```
# Foreground
exec({ command: "claude 'Your task'", pty: true, workdir: "~/project" })

# Background
exec({ command: "claude 'Your task'", pty: true, workdir: "~/project", background: true })
```

---

## OpenCode

```
exec({ command: "opencode run 'Your task'", pty: true, workdir: "~/project" })
```

---

## Pi Coding Agent

```
exec({ command: "pi 'Your task'", pty: true, workdir: "~/project" })

# Non-interactive mode
exec({ command: "pi -p 'Summarize src/'", pty: true })

# Different provider/model
exec({ command: "pi --provider openai --model gpt-4o-mini -p 'Your task'", pty: true })
```

---

## Parallel Issue Fixing with git worktrees

Fix multiple issues in parallel:

```
# 1. Create worktrees
exec({ command: "git worktree add -b fix/issue-78 /tmp/issue-78 main", workdir: "~/project" })
exec({ command: "git worktree add -b fix/issue-99 /tmp/issue-99 main", workdir: "~/project" })

# 2. Launch agents in each
exec({ command: "pnpm install && codex --yolo 'Fix issue #78'", pty: true, workdir: "/tmp/issue-78", background: true })
exec({ command: "pnpm install && codex --yolo 'Fix issue #99'", pty: true, workdir: "/tmp/issue-99", background: true })

# 3. Monitor progress
process({ action: "list" })
process({ action: "log", sessionId: "XXX" })

# 4. Create PRs after fixes
exec({ command: "git push -u origin fix/issue-78", workdir: "/tmp/issue-78" })
exec({ command: "gh pr create --title 'fix: ...' --body '...'", workdir: "/tmp/issue-78" })

# 5. Cleanup
exec({ command: "git worktree remove /tmp/issue-78", workdir: "~/project" })
```

---

## Batch PR Reviews

```
# Fetch all PR refs
exec({ command: "git fetch origin '+refs/pull/*/head:refs/remotes/origin/pr/*'", workdir: "~/project" })

# Deploy one agent per PR
exec({ command: "codex exec 'Review PR #86. git diff origin/main...origin/pr/86'", pty: true, workdir: "~/project", background: true })
exec({ command: "codex exec 'Review PR #87. git diff origin/main...origin/pr/87'", pty: true, workdir: "~/project", background: true })

# Monitor all
process({ action: "list" })
```

---

## Rules

1. **Always use pty: true** — coding agents need a terminal
2. **Respect tool choice** — if user asks for Codex, use Codex; don't hand-code patches yourself
3. **Be patient** — don't kill sessions because they're "slow"
4. **Monitor with process poll/log** — check progress without interfering
5. **--full-auto for building** — auto-approves changes
6. **Parallel is OK** — run many agents at once for batch work

---

## Progress Updates

When spawning coding agents in the background, keep the user informed:

- Send 1 short message when starting (what's running + where)
- Update when something changes:
  - a milestone completes (build finished, tests passed)
  - the agent asks a question / needs input
  - you hit an error or need user action
  - the agent finishes (include what changed + where)
- If you kill a session, immediately say why

---

## Process Tool: send-keys Reference

The `send-keys` action encodes keyboard sequences. Use it for special keys, modifiers, and control sequences.

### Key tokens

Named keys: `enter`, `tab`, `escape`, `space`, `backspace`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`, `delete`, `f1`-`f12`

### Modifiers

Prefix with `C-` (ctrl), `M-` (alt), `S-` (shift): `C-c` sends Ctrl+C, `M-x` sends Alt+x, `C-S-left` sends Ctrl+Shift+Left.

### Hex bytes

Pass raw hex bytes: `hex: ["1b", "5b", "41"]` sends ESC [ A (up arrow).

### Examples

```
# Send Ctrl+C to interrupt
process({ action: "send-keys", sessionId: "XXX", keys: ["C-c"] })

# Send Enter
process({ action: "send-keys", sessionId: "XXX", keys: ["enter"] })

# Send escape
process({ action: "send-keys", sessionId: "XXX", keys: ["escape"] })

# Type text and submit
process({ action: "write", sessionId: "XXX", data: "yes" })
process({ action: "submit", sessionId: "XXX" })
```
