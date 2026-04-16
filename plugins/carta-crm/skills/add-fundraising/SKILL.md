---
name: add-fundraising
description: >
  Creates one or more fundraising records in the Carta CRM via the public API.
  Use this skill when the user says things like "add a fundraising", "create a fundraising",
  "log a fundraising round", "add fundraising to CRM", "create fundraising record",
  or "/add-fundraising". Collects fundraising information conversationally, then POSTs
  it to the Carta CRM API.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Help the user create one or more fundraising records in the Carta CRM by calling
`POST /v1/fundraisings`. Collect the fundraising details conversationally, validate the
required fields, then make the API call using curl.

## Step 1 — Check credentials

Check that the required environment variables are set:

```bash
echo "API_KEY=${LISTALPHA_API_KEY:+set}"
```

If `LISTALPHA_API_KEY` is missing, tell the user:
> "You need to set the `LISTALPHA_API_KEY` environment variable to your Carta CRM API key before using this skill. You can add it in Claude's environment settings."

## Step 2 — Discover available custom fields (optional but recommended)

Call the custom fields endpoint to see what fields the tenant has configured for fundraisings:

```bash
curl -s -X GET "https://api.listalpha.com/v1/fundraisings/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use the returned field names as hints when collecting fundraising data. If the call
fails, proceed without it — custom fields are optional.

## Step 3 — Collect fundraising information

Ask the user for:
- **Name** (required) — the fundraising round name (e.g., "Acme Corp Series B", "Project Atlas Seed Round")
- **Additional fields** (optional) — any custom fields returned in Step 2

If the user has already provided details in their message, extract them directly
without re-asking.

## Step 4 — Create the fundraising via API

Build the request body:
```json
{
  "name": "<fundraising name>",
  "fields": {
    "<field_key>": "<value>"
  }
}
```

Omit `fields` entirely if no field data was provided.

Make the API call:
```bash
curl -s -X POST "https://api.listalpha.com/v1/fundraisings" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 5 — Report result

On success (HTTP 200), respond with:
> "Fundraising **{name}** created successfully (ID: `{id}`)."

On error, show the status code and error message from the response, and suggest fixes:
- **401** — API key is invalid or missing
- **400** — Check that `name` is provided and `fields` contains valid keys
- **500** — Server error; try again or contact support

## Adding multiple fundraisings

If the user wants to add multiple fundraisings at once, repeat Steps 3–5 for each
one. After all are done, summarize:
> "Created N fundraisings: [list of names with IDs]"

## Reference

See `references/api-reference.md` for endpoint details and field schema.
