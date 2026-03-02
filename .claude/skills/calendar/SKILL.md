---
name: calendar
description: 'Manage Google Calendar: create, list, search, update, delete events, check availability, RSVP, and find conflicts. Use this skill whenever the user mentions appointments, meetings, scheduling, calendar events, availability, free/busy times, or anything related to their schedule — even if they don''t say "calendar" explicitly.'
---

# Google Calendar

Manage the user's Google Calendar using the `gog` CLI. The default calendar ID is `primary` and the system timezone is `America/New_York`.

## Help

When the user asks for help with this skill, show them this summary:

```
Calendar Skill — what I can do:

  Schedule       "Add a meeting with Alex on Friday at 2pm"
  List           "What's on my calendar today?" / "Show me next week"
  Search         "Find my dentist appointment"
  Reschedule     "Move the standup to 10am"
  Cancel         "Delete the meeting with Trena"
  Details        "Show me the details for <event>"
  Availability   "Am I free Thursday afternoon?"
  Conflicts      "Do I have any conflicts this week?"
  RSVP           "Accept the team lunch invite"

Tips:
  - Times default to America/New_York
  - You can say dates naturally: "next Tuesday", "March 5th", "tomorrow at 3"
  - Default meeting length is 1 hour unless you say otherwise
  - I'll confirm before deleting or modifying events
```

## How timestamps work

All RFC3339 timestamps must include the timezone offset. Determine the correct offset based on the date of the event:

- **EST (Eastern Standard Time)**: UTC-05:00 — roughly early November through mid-March
- **EDT (Eastern Daylight Time)**: UTC-04:00 — roughly mid-March through early November

DST transitions follow US rules (second Sunday in March, first Sunday in November). When in doubt, check with `date +%z` or use the event date to determine which offset applies.

Example: an event on July 4 at 3pm → `2026-07-04T15:00:00-04:00` (EDT)
Example: an event on January 10 at 9am → `2026-01-10T09:00:00-05:00` (EST)

## Creating events

Use `gog calendar create primary` with these key flags:

| Flag | Purpose |
|------|---------|
| `--summary` | Event title (required) |
| `--from` | Start time in RFC3339 (required) |
| `--to` | End time in RFC3339 (required) |
| `--description` | Event description |
| `--location` | Location |
| `--attendees` | Comma-separated emails |
| `--all-day` | All-day event (use date-only for --from/--to) |
| `--with-meet` | Attach a Google Meet link |
| `--reminder` | e.g. `popup:30m`, `email:1d` (max 5) |
| `--rrule` | Recurrence, e.g. `RRULE:FREQ=WEEKLY;BYDAY=MO` |
| `--visibility` | `default`, `public`, `private`, `confidential` |
| `--transparency` | `busy` (opaque) or `free` (transparent) |
| `--event-color` | Color ID 1-11 |

If the user doesn't specify a duration, default to **1 hour**.

**Example:**
```bash
gog calendar create primary \
  --summary "Lunch with Sarah" \
  --from "2026-03-10T12:00:00-04:00" \
  --to "2026-03-10T13:00:00-04:00" \
  --location "Café Roma"
```

## Listing events

Use `gog calendar events primary` with time filters:

| Flag | Purpose |
|------|---------|
| `--today` | Today's events |
| `--tomorrow` | Tomorrow's events |
| `--week` | This week |
| `--days N` | Next N days |
| `--from` / `--to` | Custom date range (RFC3339, date, or relative like `today`, `tomorrow`, `monday`) |
| `--max N` | Max results (default 10) |
| `--all-pages` | Fetch all pages |
| `--query` | Free text search |
| `--weekday` | Include day-of-week columns |

**Example:**
```bash
gog calendar events primary --today
gog calendar events primary --days 7 --max 25
gog calendar events primary --from monday --to friday
```

## Searching events

Use `gog calendar search "<query>"` to find events by text:

```bash
gog calendar search "dentist" --from today --days 90
```

Supports `--from`, `--to`, `--today`, `--tomorrow`, `--week`, `--days`, `--max`.

## Viewing event details

```bash
gog calendar event primary <eventId>
```

To get an event ID, list or search events first. The ID appears in the output.

## Updating events

Use `gog calendar update primary <eventId>` with any of:

| Flag | Purpose |
|------|---------|
| `--summary` | New title |
| `--from` / `--to` | New start/end times |
| `--description` | New description |
| `--location` | New location |
| `--attendees` | Replace all attendees |
| `--add-attendee` | Add attendees (preserves existing) |
| `--reminder` | New reminders |
| `--event-color` | New color |
| `--visibility` | New visibility |
| `--transparency` | `busy` or `free` |

To update a recurring event, use `--scope` (`single`, `future`, or `all`) with `--original-start` for single/future.

When the user wants to reschedule, first find the event (search or list), then update its `--from` and `--to`.

## Deleting events

```bash
gog calendar delete primary <eventId>
```

Always confirm with the user before deleting. For recurring events, use `--scope` (`single`, `future`, `all`).

## Checking availability

```bash
gog calendar freebusy primary --from "2026-03-10T00:00:00-04:00" --to "2026-03-10T23:59:59-04:00"
```

Use this when the user asks "Am I free on...?" or "When am I available?"

## Finding conflicts

```bash
gog calendar conflicts --today
gog calendar conflicts --week
gog calendar conflicts --days 7
```

## Responding to invitations

```bash
gog calendar respond primary <eventId> --status accepted
gog calendar respond primary <eventId> --status declined --comment "Can't make it, sorry"
```

Status options: `accepted`, `declined`, `tentative`, `needsAction`.

## Interpreting natural language

When the user speaks casually about dates and times, map their language to the right flags:

| User says | Interpretation |
|-----------|---------------|
| "today" | `--today` or `--from today` |
| "tomorrow" | `--tomorrow` |
| "this week" | `--week` |
| "next week" | `--from monday --to` next Friday (calculate dates) |
| "next Tuesday at 2" | Calculate the RFC3339 timestamp for the upcoming Tuesday, 14:00 |
| "in the morning" | 09:00 (ask if unclear) |
| "afternoon" | 13:00-17:00 range |
| "end of day" | 17:00 |
| "all day" | Use `--all-day` with date-only values |

When ambiguous (e.g. "Tuesday" could be this week or next), prefer the upcoming occurrence. If genuinely unclear, ask.

## Workflow guidelines

1. **Creating**: Parse the user's natural language into the right flags and create the event. Report back the summary, date/time, and any other details.
2. **Finding then acting**: When the user wants to update, delete, or RSVP, first search/list to find the event ID, then perform the action. Don't ask the user for event IDs — look them up.
3. **Confirming destructive actions**: Always confirm before deleting events. For updates, confirm if the change seems significant (e.g., changing the date of a meeting with attendees).
4. **Multiple calendars**: Default to `primary`. If the user mentions a specific calendar, use `gog calendar calendars` to list available ones and use the right ID.
