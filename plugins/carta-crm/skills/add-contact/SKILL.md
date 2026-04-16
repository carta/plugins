---
name: add-contact
description: >
  Creates one or more contact records in the Carta CRM via the public API.
  Use this skill when the user says things like "add a contact", "create a contact
  record", "add contact to CRM", "save a contact", "upload contact to Carta CRM",
  or "/add-contact". Collects contact information conversationally, then POSTs to the
  Carta CRM API. listId is optional — contacts are saved to the platform's all-contacts
  list if no list is specified.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Help the user create one or more contact records in the Carta CRM by calling
`POST /v1/contacts`. Only `name` is required — collect that and any other details
the user has already provided, then make the API call immediately. Do not block on
optional fields like `listId`.

## Step 1 — Check credentials

```bash
echo "API_KEY=${LISTALPHA_API_KEY:+set}"
```

If `LISTALPHA_API_KEY` is missing, tell the user:
> "You need to set the `LISTALPHA_API_KEY` environment variable to your Carta CRM API key before using this skill. You can add it in Claude's environment settings."

## Step 2 — Collect contact information

Only `name` is required. Extract everything the user has already provided in their
message without re-asking. If `name` is missing, ask for it once.

Fields you can collect:
- **name** (required) — full name (e.g., "Jane Smith"), or derived from `firstName` + `lastName`
- **firstName**, **lastName**, **middleName** (optional)
- **listId** (optional) — if provided, adds the contact to that list; otherwise the contact lands in the platform's all-contacts view
- **emailDetail** (optional) — primary email address (plain string, e.g. `"jane@example.com"`)
- **emailDetailSecond**, **emailDetailThird**, **emailDetailFourth** (optional) — additional email addresses
- **phone** (optional) — primary phone number (use `businessPhone`, `thirdPhone`, `fourthPhone` for additional numbers)
- **title** (optional) — job title
- **company** (optional) — employer name
- **linkedIn** (optional) — LinkedIn profile URL
- **tags** (optional) — array of string tags
- **notes** (optional) — free-text notes

Never ask for `listId` unless the user brings it up. The contact will be saved
and accessible in Carta CRM regardless.

## Step 3 — Create the contact via API

Build the request body with only the fields the user provided:
```json
{
  "name": "<contact name>",
  "<field_key>": "<value>"
}
```

Include `listId` only if the user specified one. All fields are spread at the
top level of the body (not nested).

```bash
curl -s -o /tmp/la_contact_response.json -w "%{http_code}" \
  -X POST "https://api.listalpha.com/v1/contacts" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

Read the response:
```bash
cat /tmp/la_contact_response.json
```

## Step 4 — Report result

On success (HTTP 200), respond with:
> "Contact **{name}** saved successfully (ID: `{id}`)."

If a `listId` was provided, add:
> "Added to list `{listId}`."

On error, show the status code and error message, and suggest fixes:
- **401** — API key is invalid or missing
- **400** — Check that `name` is provided and all field keys are valid
- **404** — The specified `listId` does not exist
- **500** — Server error; try again or contact support

## Adding multiple contacts

If the user wants to add multiple contacts, repeat Steps 2–4 for each one, then
summarize:
> "Created N contacts: [list of names with IDs]"

## Reference

See `references/api-reference.md` for endpoint details and field schema.
