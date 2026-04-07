---
name: add-note
description: >
  Creates one or more note records in the Carta CRM via the public API.
  Use this skill when the user says things like "add a note", "create a note",
  "log a note", "add note to CRM", "add note to Carta CRM", or "/add-note".
  Collects note information conversationally, then POSTs it to the Carta CRM API.
tools:
  - Bash
---

## Overview

Help the user create one or more note records in the Carta CRM by calling
`POST /v1/notes`. Collect the note details conversationally, validate the required
fields, then make the API call using curl.

## Step 1 — Collect note information

Ask the user for:
- **Title** (required) — the display name shown in the UI (must be non-empty)
- **Text** (optional) — the note body content
- **Folder ID** (optional) — ID of the parent folder to organize the note
- **Owner** (optional) — email of the note owner (defaults to API key owner if omitted)
- **Creation date** (optional) — ISO 8601 timestamp to preserve a historical creation date
- **External ID / UID** (optional) — unique identifier from an external system

If the user has already provided details in their message, extract them directly
without re-asking.

## Step 2 — Create the note via API

Build the request body, omitting any fields the user did not provide:
```json
{
  "title": "<note title>",
  "text": "<note body>",
  "folderId": "<folder id>",
  "owner": "<owner email>",
  "creationDate": "<ISO 8601 date>",
  "uid": "<external id>"
}
```

Make the API call:
```bash
curl -s -X POST "https://api.listalpha.com/v1/notes" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 3 — Report result

On success (HTTP 200), respond with:
> "Note **{title}** created successfully (ID: `{id}`)."

On error, show the status code and error message from the response, and suggest fixes:
- **401** — API key is invalid or missing
- **400** — Check that `title` is provided and non-empty
- **404** — Folder not found — `folderId` does not exist
- **500** — Server error; try again or contact support

## Adding multiple notes

If the user wants to add multiple notes at once, repeat Steps 2–3 for each one.
After all are done, summarize:
> "Created N notes: [list of titles with IDs]"

## Reference

See `references/api-reference.md` for endpoint details and field schema.
