# Tiamat

A Claude Code setup for running an always-on AI assistant with skills, a heartbeat system, and agent orchestration.

This repo is the working configuration for a Claude Code instance that acts as an administrative assistant and coding agent manager. It's shared as an example of what a fully configured Claude Code environment looks like.

## What's here

```
CLAUDE.md              # Agent identity and instructions
SOUL.md                # Persona definition (synced into CLAUDE.md)
HEARTBEAT.md           # Periodic task checklist (reviewed every 30 min)
scripts/
  heartbeat-cron.sh    # Sends /heartbeat to the agent's zmx session
  heartbeat-state.sh   # Hook handler: writes busy/idle state
  sync-soul.sh         # Rebuilds CLAUDE.md from SOUL.md
docs/
  heartbeat-documentation.md   # Architecture notes on heartbeat systems
  soul-documentation.md        # Architecture notes on SOUL.md
.claude/
  skills/              # Claude Code skills (see below)
  output-styles/       # Custom output style
```

## Skills

Skills live in `.claude/skills/` and teach the agent how to use specific tools:

| Skill | What it does |
|-------|-------------|
| **outliner** | Manages a tree-structured scratchpad via the `outliner` CLI |
| **calendar** | Google Calendar management via the `gog` CLI |
| **twitter** | Twitter/X interaction via the `bird` CLI |
| **coding-agent** | Delegates tasks to Codex, Claude Code, Pi, or OpenCode via background PTY processes |
| **heartbeat** | Periodic check-in that reviews HEARTBEAT.md for actionable items |

## Heartbeat system

The heartbeat system gives the agent periodic "turns" to check on tasks, even when the user isn't actively chatting.

**How it works:**

1. Claude Code runs in a persistent [zmx](https://github.com/nicholasgasior/zmx) session
2. A systemd user timer fires every 30 minutes
3. `scripts/heartbeat-cron.sh` runs with 4 preflight gates:
   - Is `HEARTBEAT.md` empty? Skip (saves tokens)
   - Is the agent busy? Skip (avoids interrupting work)
   - Is the zmx session alive? Skip if not
   - Is the user mid-typing? Skip (don't clobber input)
4. If all gates pass, it sends `/heartbeat` to the session
5. The agent reads `HEARTBEAT.md`, acts on anything that needs attention, and replies `HEARTBEAT_OK` if nothing does

### Setting up the hooks

The heartbeat system uses Claude Code hooks to track whether the agent is busy or idle. These go in your **user-level** settings (`~/.claude/settings.json`), not in the project:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/tiamat/scripts/heartbeat-state.sh idle"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/tiamat/scripts/heartbeat-state.sh busy"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "~/tiamat/scripts/heartbeat-state.sh idle"
          }
        ]
      }
    ]
  }
}
```

The script writes `busy <epoch>` or `idle <epoch>` to `logs/heartbeat-state`. The cron script checks this file before sending a heartbeat, so it never interrupts the agent mid-task.

**Note:** The script only writes state when `ZMX_SESSION=tiamat`, so it won't interfere with other Claude Code sessions.

### Setting up the timer

```bash
# Create systemd user timer
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/tiamat-heartbeat.service << 'EOF'
[Unit]
Description=Tiamat heartbeat ping

[Service]
Type=oneshot
ExecStart=%h/tiamat/scripts/heartbeat-cron.sh
EOF

cat > ~/.config/systemd/user/tiamat-heartbeat.timer << 'EOF'
[Unit]
Description=Tiamat heartbeat timer

[Timer]
OnCalendar=*:0/30
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now tiamat-heartbeat.timer
```

## Coding agent MCP server

The coding-agent skill includes an MCP server that spawns and manages background PTY processes. To use it:

1. `cd .claude/skills/coding-agent/server && npm install`
2. Add to your `.mcp.json`:
   ```json
   {
     "mcpServers": {
       "coding-agent": {
         "command": "tsx",
         "args": ["<path-to-repo>/.claude/skills/coding-agent/server/src/index.ts"]
       }
     }
   }
   ```

## License

See [LICENSE](LICENSE).
