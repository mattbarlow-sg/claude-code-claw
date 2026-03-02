---
name: heartbeat
description: Periodic check-in that reviews HEARTBEAT.md for items needing attention
disable-model-invocation: true
user-invocable: true
---

# Heartbeat Check

You are running a periodic heartbeat. Review the file `~/tiamat/HEARTBEAT.md` and evaluate every item.

## Rules

1. **Read** `~/tiamat/HEARTBEAT.md` in full.
2. **Evaluate** each item against today's date (!`date +%Y-%m-%d`) and current time (!`date +%H:%M`).
3. **Check** for:
   - Tasks past their due date or due today
   - Reminders whose trigger time has arrived
   - Monitoring items that need a status check (run any listed check commands)
   - Any item explicitly marked `urgent` or `priority: high`
4. **If nothing needs attention**: respond with exactly `HEARTBEAT_OK` and nothing else.
5. **If items need attention**: summarize what's urgent concisely, tag each with its section and line from HEARTBEAT.md, and suggest next actions.
6. **Be proactive**: don't just report — if there's something useful you can do (check on a running process, clean up a completed task, tidy stale items), do it.

## Editing HEARTBEAT.md

You may edit HEARTBEAT.md to mark completed tasks, remove stale items, or add brief notes. Keep it small to limit token burn.

## Important

- Be brief. This runs every 30 minutes — don't be verbose.
- Do not infer or repeat old tasks from prior conversation context. Only act on what's in HEARTBEAT.md right now.
- If HEARTBEAT.md doesn't exist or is empty, respond with `HEARTBEAT_OK`.
