---
name: add-deal
description: >
  Creates one or more deal records in the Carta CRM via the public API.
  Use this skill when the user says things like "add a deal", "create a deal",
  "log a deal", "add deal to CRM", "add deal to Carta CRM", or "/add-deal".
  Collects deal information conversationally, then POSTs it to the Carta CRM API.
allowed-tools:
  - Bash
---

## Overview

Help the user create one or more deal records in the Carta CRM by calling
`POST /v1/deals`. First fetch available pipelines and custom fields, then collect
deal details conversationally, and make the API call using curl.

## Step 1 — Check credentials

```bash
echo "API_KEY=${LISTALPHA_API_KEY:+set}"
```

If `LISTALPHA_API_KEY` is missing, tell the user:
> "You need to set the `LISTALPHA_API_KEY` environment variable to your Carta CRM API key before using this skill. You can add it in Claude's environment settings."

## Step 2 — Fetch available pipelines and stages

Call the pipelines endpoint so the user can pick a pipeline and stage by name:

```bash
curl -s -X GET "https://api.listalpha.com/v1/deals/pipelines" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

The response shape is:
```json
{
  "pipelines": [
    { "id": "...", "name": "...", "stages": [{ "id": "...", "name": "..." }] }
  ]
}
```

Present the pipeline and stage names to the user. If the call fails, proceed without it.

## Step 3 — Discover available custom fields (optional but recommended)

```bash
curl -s -X GET "https://api.listalpha.com/v1/deals/custom-fields" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Use returned field names as hints when collecting deal data. If the call fails, proceed without it.

## Step 4 — Collect deal information

Ask the user for:
- **Pipeline** (optional) — which pipeline this deal belongs to (from Step 1)
- **Stage** (optional) — which stage within the pipeline (from Step 1)
- **Company name** (optional) — the company associated with the deal
- **Company URL** (optional) — company website (used for auto-enrichment)
- **Comment** (optional) — notes or comments about the deal
- **Tags** (optional) — array of tag strings
- **Deal lead** (optional) — user ID to assign as deal lead
- **Added at** (optional) — date the deal was added (ISO 8601)
- **Custom fields** (optional) — any fields returned in Step 2

If the user has already provided details in their message, extract them directly
without re-asking.

## Step 5 — Create the deal via API

Build the request body, omitting any fields the user did not provide:
```json
{
  "pipelineId": "<pipeline id>",
  "stageId": "<stage id>",
  "company": {
    "name": "<company name>",
    "url": "<company url>"
  },
  "comment": "<comment>",
  "tags": ["<tag1>", "<tag2>"],
  "dealLead": "<user id>",
  "addedAt": "<ISO 8601 date>",
  "fields": {
    "<field_key>": "<value>"
  }
}
```

Omit `company` if neither name nor URL was provided. Omit `fields` if no custom
field data was provided.

Make the API call:
```bash
curl -s -X POST "https://api.listalpha.com/v1/deals" \
  -H "Authorization: ${LISTALPHA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '<json_body>'
```

## Step 6 — Report result

On success (HTTP 200), respond with:
> "Deal created successfully (ID: `{id}`)."

If a company name is available, include it:
> "Deal for **{company name}** created successfully (ID: `{id}`)."

On error, show the status code and error message from the response, and suggest fixes:
- **401** — API key is invalid or missing
- **400** — Check that pipeline/stage IDs are valid and fields contain valid keys
- **500** — Server error; try again or contact support

## Adding multiple deals

If the user wants to add multiple deals at once, repeat Steps 4–6 for each one.
After all are done, summarize:
> "Created N deals: [list of company names with IDs]"

## Reference

See `references/api-reference.md` for endpoint details and field schema.
