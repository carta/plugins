---
name: search-notes
description: >
  Searches for and retrieves note records from the Carta CRM.
  Use this skill when the user says things like "find a note", "search notes",
  "look up a note", "show me notes about [topic]", "get note by ID",
  "list notes", "find notes in [folder]", or "/search-notes".
  Returns note details including ID, title, text, folder, and owner.
  The note ID returned can be used with the update-note skill.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Search for notes in the Carta CRM using `GET /v1/notes` (filtered list) or
`GET /v1/notes/{id}` (single note by ID). Return results in a readable summary
and always include the note ID so the user can reference it for updates.

## Step 1 — Determine search mode

Based on the user's request, choose one of two modes:

- **By ID** — user provided a note ID (a hex string like `64f1a2b3c4d5e6f7a8b9c0d1`) → use `GET /v1/notes/{id}`
- **By search / filter** — user provided a title, keyword, or folder → use `GET /v1/notes` with query params

If it's unclear, default to **By search / filter** and ask the user for a search term.

## Step 2 — Execute the search

**By ID:**
```bash
curl -s "https://api.listalpha.com/v1/notes/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

**By search / filter:**

```bash
curl -s "https://api.listalpha.com/v1/notes?search=<term>&limit=20" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Available query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Note title or keyword |
| `folderId` | string | Filter by folder ID |
| `limit` | integer | Max results (default to 20 unless user specifies) |
| `offset` | integer | Skip N results for pagination |

Omit any params the user did not specify.

## Step 3 — Present results

For each note returned, display:

```
Note: <title> (ID: `<id>`)
  Owner: <owner>
  Folder: <folderId>
  Created: <creationDate>
  Text: <text (truncated to ~200 chars if long)>
```

Omit any fields that are blank or not present.

If no notes are found:
> "No notes found matching your search. Try a different title or keyword."

If multiple results are returned, list them all and note the total count.

Always surface the note ID prominently — the user will need it to run `/update-note`.

## Error handling

- **401** — API key is invalid or missing
- **404** — No note found with that ID
- **400 / 500** — Show the error message from the response

## Reference

See `references/api-reference.md` for full endpoint details.
