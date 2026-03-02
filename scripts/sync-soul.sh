#!/usr/bin/env bash
# Rebuilds CLAUDE.md from operational identity + SOUL.md
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOUL="$REPO_DIR/SOUL.md"
CLAUDE="$REPO_DIR/CLAUDE.md"

if [[ ! -f "$SOUL" ]]; then
  echo "error: $SOUL not found" >&2
  exit 1
fi

# Operational identity header — the stable, rarely-changing lines
read -r -d '' HEADER <<'EOF' || true
Your name is Tiamat.

Your unix username is seraph and your home directory is /home/seraph. You are a fully onboarded linux user with access to all of the features of a linux user such as cron, all of the POSIX and installed cli tools, a home directory, and so on.

You have full control over the dotfiles to manage or edit them as you like.
EOF

# Assemble CLAUDE.md
{
  printf '%s\n\n' "$HEADER"
  cat "$SOUL"
} > "$CLAUDE"

echo "synced: $CLAUDE"
