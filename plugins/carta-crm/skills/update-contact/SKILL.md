---
name: update-contact
description: >
  Updates an existing contact (person) record in the Carta CRM.
  Use this skill when the user says things like "update a contact", "edit contact",
  "update contact details", "change contact email", "update person's title",
  "update contact company", "add a tag to contact", or "/update-contact".
  Accepts a contact ID or name (will search if no ID provided).
  Only the fields explicitly provided are changed — all other fields are left untouched.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Partially update an existing contact using `PATCH /v1/contacts/{id}`.
Only fields provided in the request body are modified — this is a partial update,
not a replacement. First resolve the contact ID, then collect what to change,
then make the API call.

## Step 1 — Resolve the contact ID

If the user provided a contact ID directly, use it and skip to Step 3.

If only a name or description was given, search for the contact first:

```bash
curl -s "https://api.listalpha.com/v1/contacts?search=<name>&limit=10" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

If multiple contacts match, present the list to the user and ask them to confirm which one to update (show name, title, company, and ID for each).

## Step 2 — Collect what to update

Ask the user what they want to change. Any combination of the following fields can be updated:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Contact's full name |
| `firstName` | string | First name |
| `middleName` | string | Middle name |
| `lastName` | string | Last name |
| `emailDetail` | string | Primary email address |
| `emailDetailSecond` | string | Second email address |
| `emailDetailThird` | string | Third email address |
| `emailDetailFourth` | string | Fourth email address |
| `phone` | string | Primary phone number |
| `businessPhone` | string | Business phone number |
| `title` | string | Job title |
| `company` | string | Employer/company name |
| `linkedIn` | string | LinkedIn profile URL |
| `tags` | array | Replace the full tags array |
| `notes` | string | Free-text notes |

If the user has already specified what to change in their message, extract it directly without re-asking.

**Important:** Only include fields that are explicitly being changed. Omit everything else.

## Step 3 — Update the contact via API

Build the request body with only the fields being changed:

```json
{
  "name": "<full name>",
  "title": "<job title>",
  "company": "<employer>",
  "emailDetail": "<email>",
  "phone": "<phone>",
  "tags": ["<tag1>", "<tag2>"],
  "notes": "<notes>"
}
```

Make the API call:

```bash
curl -s -X PATCH "https://api.listalpha.com/v1/contacts/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 4 — Report result

On success (HTTP 200), respond with a summary of what changed:
> "Contact **{name}** updated (ID: `{id}`). {Changed: title updated, email added, etc.}"

On error:
- **401** — API key is invalid or missing
- **400** — Check that field keys are valid
- **404** — No contact found with that ID — suggest running `/search-contacts` first
- **500** — Server error; try again or contact support

## Updating multiple contacts

If the user wants to apply the same change to multiple contacts, repeat Steps 1 and 3–4 for each. Summarize at the end:
> "Updated N contacts: [list of names]"

## Reference

See `references/api-reference.md` for full endpoint details.
