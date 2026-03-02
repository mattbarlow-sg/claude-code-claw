---
name: outliner
description: >
  Manage the user's outliner — a tree-structured scratchpad for tracking what they're
  working on. Use this skill whenever the user mentions their outline, tasks, projects
  list, what they're working on, adding/removing/reorganizing items, setting priorities,
  sleeping items, or wants to see what's on their plate. Also use it when the user says
  things like "add X to my list", "what's on my radar", "mark that done", "I'm done with X",
  "put that on the back burner", "what should I focus on", or anything involving managing
  their work items — even if they don't say "outliner" explicitly.
---

# Outliner Skill

The outliner is the user's scratchpad — a tree of items representing what they're working on,
thinking about, or want to remember. It lives behind a local API and is controlled via the
`outliner` CLI at `/usr/local/bin/outliner`.

## Reading the outline

Always start by reading the current state so you know what's there:

```bash
outliner --json outline get
```

The response contains:
- `itemsById` — a flat map of all items keyed by UUID
- `childrenByParent` — ordered child lists keyed by parent ID (`"root"` for top-level items)

Each item has:
- `id` — UUID
- `parentId` — parent UUID, or `null` for root items
- `text` — the item title
- `note` — optional longer description
- `collapsed` — whether children are hidden in the UI
- `attentionState` — one of `default`, `attention`, `subdued`
- `sleepUntil` — ISO timestamp if the item is sleeping, otherwise `null`
- `sleepCount` — how many times the item has been slept (affects spaced repetition)

For a quick count without the full tree: `outliner outline get --summary`

## Adding items

**New root items** (quick capture, inbox-style):
```bash
outliner --json ingest "Item text here"
```
Multiple at once: `outliner --json ingest "First" "Second" "Third"`

Ingest prepends at root — new items appear at the top.

**Child of an existing item:**
```bash
outliner --json item add-child --id <parent-id> --text "Child text"
```
Children are prepended in the parent's child list.

**Sibling below an existing item:**
```bash
outliner --json item insert-below --id <anchor-id> --text "New sibling"
```

## Updating items

```bash
outliner --json item update --id <id> --text "New title"
outliner --json item update --id <id> --note "Detailed notes here"
outliner --json item update --id <id> --clear-note
outliner --json item update --id <id> --collapsed true
```

For long notes, write to a temp file first:
```bash
outliner --json item update --id <id> --note-file /tmp/note.md
```

## Attention states

Items cycle through: `default` → `attention` → `subdued` → `default`

```bash
outliner --json item cycle-attention --id <id>
```

- **attention** — highlighted, actively being worked on or important
- **subdued** — dimmed, on the back burner but not deleted
- **default** — normal visibility

To get an item to a specific state, cycle it the right number of times. The server
enforces a guardrail: if a parent is subdued, children inherit that visually.

## Sleeping items

Sleep pushes an item off-screen for a period. The server applies spaced repetition —
repeated sleeps on the same item increase the duration.

```bash
outliner --json item sleep --id <id> --days 2
```

Days must be 1-4. Use sleep for items the user doesn't need to think about right now
but shouldn't forget.

## Reordering

```bash
outliner --json item move-up --id <id>
outliner --json item move-down --id <id>
outliner --json item move --id <id> --target-id <sibling-id> --position before
outliner --json item indent --id <id>    # makes item a child of the sibling above it
outliner --json item dedent --id <id>    # moves item up one nesting level
```

Items being moved and their targets must share the same parent.

## Deleting items

```bash
outliner --json item delete --id <id> --yes
```

This deletes the item and all its descendants. Always pass `--yes` to skip the
confirmation prompt.

## Conventions

- Always use `--json` for parsing reliability.
- Every mutation returns the full updated outline — use it to confirm the change and
  get fresh IDs if needed.
- When the user says "add X", ingest at root unless context makes it clear the item
  belongs under a specific parent.
- When the user says they finished something, delete the item (or subdued it if they
  might revisit).
- Present the outline to the user as a readable tree, not raw JSON. Indent children,
  show attention states with markers like `[!]` for attention and `[~]` for subdued.
- Keep interactions snappy — read once, batch mutations, don't re-read between every
  small change unless you need fresh state.
