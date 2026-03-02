#!/usr/bin/env bash
# heartbeat-state.sh — Hook handler for busy/idle agent state
# Called by Claude Code hooks (SessionStart, UserPromptSubmit, Stop)
# Only writes state when running inside the tiamat zmx session.

set -euo pipefail

STATE="${1:-}"
STATE_FILE="$HOME/tiamat/logs/heartbeat-state"

if [[ -z "$STATE" ]] || [[ "$STATE" != "busy" && "$STATE" != "idle" ]]; then
    exit 0
fi

# Only write state for the tiamat session
if [[ "${ZMX_SESSION:-}" != "tiamat" ]]; then
    exit 0
fi

mkdir -p "$(dirname "$STATE_FILE")"
echo "$STATE $(date +%s)" > "$STATE_FILE"
