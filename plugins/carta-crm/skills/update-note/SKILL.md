---
name: update-note
description: >
  Updates an existing note record in the Carta CRM.
  Use this skill when the user says things like "update a note", "edit note",
  "update note content", "change note title", "update note text",
  "move note to folder", or "/update-note".
  Accepts a note ID or title keyword (will search if no ID provided).
  Only the fields explicitly provided are changed — all other fields are left untouched.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Partially update an existing note using `PATCH /v1/notes/{id}`.
Only fields provided in the request body are modified — this is a partial update,
not a replacement. First resolve the note ID, then collect what to change,
then make the API call.

## Step 1 — Resolve the note ID

If the user provided a note ID directly, use it and skip to Step 3.

If only a title or keyword was given, search for the note first:

```bash
curl -s "https://api.listalpha.com/v1/notes?search=<title>&limit=10" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

If multiple notes match, present the list to the user and ask them to confirm which one to update (show title, owner, and ID for each).

## Step 2 — Collect what to update

Ask the user what they want to change. Any combination of the following fields can be updated:

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Display name of the note |
| `text` | string | Note body content |
| `folderId` | string | ID of the parent folder |
| `owner` | string | Email of the note owner |

If the user has already specified what to change in their message, extract it directly without re-asking.

**Important:** Only include fields that are explicitly being changed. Omit everything else.

## Step 3 — Update the note via API

Build the request body with only the fields being changed:

```json
{
  "title": "<updated title>",
  "text": "<updated body>",
  "folderId": "<folder id>",
  "owner": "<owner email>"
}
```

Make the API call:

```bash
curl -s -X PATCH "https://api.listalpha.com/v1/notes/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 4 — Report result

On success (HTTP 200), respond with a summary of what changed:
> "Note **{title}** updated (ID: `{id}`). {Changed: text updated, moved to folder, etc.}"

On error:
- **401** — API key is invalid or missing
- **400** — Check that `title` is non-empty if provided, and `folderId` is valid
- **404** — No note found with that ID — suggest running `/search-notes` first
- **500** — Server error; try again or contact support

## Updating multiple notes

If the user wants to apply the same change to multiple notes, repeat Steps 1 and 3–4 for each. Summarize at the end:
> "Updated N notes: [list of titles]"

## Reference

See `references/api-reference.md` for full endpoint details.
