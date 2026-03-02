#!/usr/bin/env bash
# heartbeat-cron.sh — Send /heartbeat to the tiamat zmx session
# Intended to be run by a systemd timer every 30 minutes during active hours.

set -euo pipefail

SESSION="tiamat"
LOG_DIR="$HOME/tiamat/logs"
LOG_FILE="$LOG_DIR/heartbeat.log"
HEARTBEAT_FILE="$HOME/tiamat/HEARTBEAT.md"
STATE_FILE="$LOG_DIR/heartbeat-state"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Gate 1: Check if HEARTBEAT.md has any non-comment, non-whitespace content
# Strip HTML comments, blank lines, and whitespace-only lines
if ! grep -vE '^\s*$|^\s*<!--.*-->\s*$|^\s*#' "$HEARTBEAT_FILE" 2>/dev/null | grep -qvE '^\s*$'; then
    log "SKIP HEARTBEAT.md empty"
    exit 0
fi

# Gate 2: Check if agent is busy (written by heartbeat-state.sh hook)
if [[ -f "$STATE_FILE" ]]; then
    STATE=$(awk '{print $1}' "$STATE_FILE")
    if [[ "$STATE" == "busy" ]]; then
        log "SKIP agent is busy"
        exit 0
    fi
else
    log "SKIP state file missing (no active session)"
    exit 0
fi

# Gate 3: Check if the zmx session exists (--short gives one name per line)
if ! zmx list --short 2>/dev/null | grep -qx "$SESSION"; then
    log "SKIP session '$SESSION' not found"
    exit 0
fi

# Gate 4: Check if the user is mid-typing in the prompt.
# Use --vt to preserve ANSI escapes: hint/placeholder text is dim (\e[2m),
# while real user input has no such escape after the prompt character.
NBSP=$'\xc2\xa0'
PROMPT_LINE=$(zmx history "$SESSION" --vt 2>/dev/null | grep '❯' | tail -1)
# Strip the dim placeholder text (ESC[2m...ESC[0m) so only real input remains
ESC=$'\x1b'
AFTER_PROMPT=$(echo "$PROMPT_LINE" | sed "s/.*❯${NBSP}//" | sed "s/${ESC}\[2m[^${ESC}]*${ESC}\[0m//g" | sed "s/${ESC}\[[0-9;]*m//g" | tr -d '[:space:]')
if [[ -n "$AFTER_PROMPT" ]]; then
    log "SKIP user is typing in prompt"
    exit 0
fi

# Send /heartbeat via send-keys (text first, then Enter after brief delay)
if zmx send-keys "$SESSION" '/heartbeat' 2>/dev/null && sleep 0.1 && zmx send-keys "$SESSION" $'\r' 2>/dev/null; then
    log "OK sent /heartbeat to session '$SESSION'"
else
    log "FAIL could not send /heartbeat to session '$SESSION'"
    exit 1
fi
