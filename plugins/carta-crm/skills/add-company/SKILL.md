---
name: add-company
description: >
  Creates one or more company records in the Carta CRM via the public API.
  Use this skill when the user says things like "add a company", "create a company
  record", "add company to CRM", "upload company to Carta CRM", or "/add-company".
  Collects company information conversationally, then POSTs it to the Carta CRM API.
allowed-tools:
  - Bash
---

## Overview

Help the user create one or more company records in the Carta CRM by calling
`POST /v1/companies`. Collect the company details conversationally, validate the
required fields, then make the API call using curl.

## Step 1 — Check credentials

Check that the required environment variables are set:

```bash
echo "API_KEY=${LISTALPHA_API_KEY:+set}"
```

If `LISTALPHA_API_KEY` is missing, tell the user:
> "You need to set the `LISTALPHA_API_KEY` environment variable to your Carta CRM API key before using this skill. You can add it in Claude's environment settings."

## Step 2 — Discover available custom fields (optional but recommended)

Call the custom fields endpoint to see what fields the tenant has configured for companies:

```bash
curl -s -X GET "https://api.listalpha.com/v1/companies/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use the returned field names as hints when collecting company data. If the call
fails, proceed without it — custom fields are optional.

## Step 3 — Collect company information

Ask the user for:
- **Name** (required) — the company name (e.g., "Stripe", "Acme Corp")
- **Additional fields** (optional) — any of: `website`, `location`, `industry`,
  `about`, `tags`, or any custom fields returned in Step 2

If the user has already provided details in their message, extract them directly
without re-asking.

## Step 4 — Create the company via API

Build the request body:
```json
{
  "name": "<company name>",
  "fields": {
    "<field_key>": "<value>"
  }
}
```

Omit `fields` entirely if no field data was provided.

Make the API call:
```bash
curl -s -X POST "https://api.listalpha.com/v1/companies" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 5 — Report result

On success (HTTP 200), respond with:
> "Company **{name}** created successfully (ID: `{id}`)."

On error, show the status code and error message from the response, and suggest
fixes:
- **401** — API key is invalid or missing
- **400** — Check that `name` is provided and `fields` contains valid keys
- **500** — Server error; try again or contact support

## Adding multiple companies

If the user wants to add multiple companies at once, repeat Steps 3–5 for each
one. After all are done, summarize:
> "Created N companies: [list of names with IDs]"

## Reference

See `references/api-reference.md` for endpoint details and field schema.
