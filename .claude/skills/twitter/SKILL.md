---
name: twitter
description: 'Interact with Twitter/X using the bird CLI: read bookmarks, check mentions, browse home timeline, read threads, post tweets, and manage bookmarks. Use this skill whenever the user mentions tweets, bookmarks, mentions, their Twitter/X feed, timeline, or wants to read, post, reply, search, or manage anything on Twitter/X — even if they don''t say "Twitter" explicitly. Also use when the user references a tweet URL (x.com or twitter.com links).'
---

# Twitter / X

Interact with Twitter/X using the `bird` CLI tool. Auth is pre-configured — just run commands directly.

## Core Commands

### Bookmarks

The primary workflow is: **list bookmarks → process each one → unbookmark when done.**

```bash
# List recent bookmarks (default 20)
bird bookmarks --plain

# List more
bird bookmarks --plain -n 50

# All bookmarks (paginated)
bird bookmarks --plain --all

# With thread context for bookmarked tweets
bird bookmarks --plain --author-chain --include-parent
```

When the user asks to "check bookmarks" or "process bookmarks", follow this pattern:

1. Fetch bookmarks with `bird bookmarks --plain --author-chain --include-parent`
2. Summarize each bookmark concisely — who posted it, what it's about, and any thread context
3. For each bookmark, ask the user what action to take (or present them all as a batch for triage)
4. After the user has processed a bookmark, unbookmark it:
   ```bash
   bird unbookmark <tweet-url-or-id>
   ```
   Multiple IDs can be passed at once: `bird unbookmark <url1> <url2> <url3>`

### Mentions

```bash
# Recent mentions (default 10)
bird mentions --plain

# More mentions
bird mentions --plain -n 30
```

When showing mentions, summarize who mentioned the user and what they said. If a mention is part of a thread, fetch the thread for context before summarizing.

### Home Timeline

```bash
# "For You" feed (default 20)
bird home --plain

# Chronological "Following" feed
bird home --plain --following

# More tweets
bird home --plain -n 40
```

### Reading a Tweet or Thread

When the user shares a tweet URL or asks about a specific tweet, read it and expand the thread:

```bash
# Read a single tweet
bird read <tweet-url-or-id> --plain

# Read the full conversation thread
bird thread <tweet-url-or-id> --plain
```

Default to fetching the thread rather than just the single tweet — the context is almost always useful.

### Posting and Replying

```bash
# Post a tweet
bird tweet "Your text here"

# Reply to a tweet
bird reply <tweet-url-or-id> "Your reply text"

# Attach media
bird tweet "Check this out" --media /path/to/image.png --alt "Description of image"
```

### Searching

```bash
bird search "query" --plain -n 20
```

## Output Handling

Always use `--plain` when fetching tweets so the output is stable and parseable (no emoji, no ANSI colors). This gives you clean text to summarize.

When you need structured data for processing (e.g., extracting tweet IDs from bookmarks to unbookmark them), use `--json` instead:

```bash
bird bookmarks --json -n 20
```

The JSON output includes tweet IDs, URLs, author info, timestamps, and full text — everything needed for programmatic processing.

## Summarization

When fetching tweets (bookmarks, mentions, timeline), don't dump raw output to the user. Summarize:

- **Who** posted it (handle + display name)
- **What** it says (1-2 sentence summary, preserve key links/references)
- **Thread context** if it's part of a conversation
- **Media** — note if there are images/videos but don't reproduce thumbnail URLs
- **Engagement signals** only if relevant (e.g., "this blew up" or noting it's a QT)

For bookmarks specifically, number each one so the user can refer to them by number when deciding what to do with them.

## The Bookmark Processing Workflow

This is the most common workflow. When the user says things like "process my bookmarks", "check bookmarks", "go through my bookmarks":

1. Fetch bookmarks with thread context
2. Present a numbered summary of each
3. For each bookmark (or in batch), help the user decide:
   - **Save/archive** — note it somewhere, create a task, add to a list
   - **Act on it** — reply, share, research the topic further
   - **Dismiss** — just unbookmark it
4. Execute the chosen actions
5. Unbookmark processed items

The user may want to process them one at a time or triage the whole batch. Follow their lead.

## Tips

- Tweet IDs and full URLs (e.g., `https://x.com/user/status/123456`) are interchangeable in all commands
- `bird whoami` shows the currently authenticated account
- If a command fails with auth errors, ask the user to check their browser cookies / bird config
- Rate limits exist — if you hit them, wait a moment and retry
