---
name: search-deals
description: >
  Searches for and retrieves deal records from the Carta CRM.
  Use this skill when the user says things like "find a deal", "search deals",
  "look up a deal", "show me deals for [company]", "get deal by ID", "find deal in [pipeline/stage]",
  "list deals", "what deals do we have for [company]", or "/search-deals".
  Returns deal details including ID, company, stage, pipeline, tags, and custom fields.
  The deal ID returned can be used with the update-deal skill.
allowed-tools:
  - Bash(curl *)
  - AskUserQuestion
---

## Overview

Search for deals in the Carta CRM using `GET /v1/deals` (filtered list) or
`GET /v1/deals/{id}` (single deal by ID). Return results in a readable summary
and always include the deal ID so the user can reference it for updates.

## Step 1 — Determine search mode

Based on the user's request, choose one of two modes:

- **By ID** — user provided a deal ID (a hex string like `64f1a2b3c4d5e6f7a8b9c0d1`) → use `GET /v1/deals/{id}`
- **By search / filter** — user provided a company name, keyword, stage, or pipeline → use `GET /v1/deals` with query params

If it's unclear, default to **By search / filter** and ask the user for a search term.

## Step 2 — Fetch pipeline context (for filter mode)

If the user mentioned a pipeline or stage by name, fetch pipelines first to resolve names to IDs:

```bash
curl -s "https://api.listalpha.com/v1/deals/pipelines" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Match the user's pipeline/stage name to the corresponding `id`. Skip this step if the user didn't specify a pipeline or stage, or if they provided IDs directly.

## Step 3 — Execute the search

**By ID:**
```bash
curl -s "https://api.listalpha.com/v1/deals/<id>" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

**By search / filter:**

Build a query string from the available parameters and call:

```bash
curl -s "https://api.listalpha.com/v1/deals?search=<term>&limit=20" \
  -H "Authorization: ${LISTALPHA_API_KEY}"
```

Available query parameters:

| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Company name or keyword |
| `pipelines` | array | Filter by pipeline ID(s) — repeat param for multiple: `?pipelines=id1&pipelines=id2` |
| `stages` | array | Filter by stage ID(s) — repeat param for multiple |
| `limit` | integer | Max results (default to 20 unless user specifies) |
| `offset` | integer | Skip N results for pagination |

Omit any params the user did not specify.

## Step 4 — Present results

For each deal returned, display:

```
Deal: <company name> (ID: `<id>`)
  Pipeline: <pipelineId> | Stage: <stageId>
  Tags: <tags>
  Comment: <comment>
  Added: <addedAt>
  Custom fields: <fields>
```

If no deals are found:
> "No deals found matching your search. Try a different company name or check the pipeline filter."

If multiple results are returned, list them all and note the total count.

Always surface the deal ID prominently — the user will need it to run `/update-deal`.

## Error handling

- **401** — API key is invalid or missing
- **404** — No deal found with that ID
- **400 / 500** — Show the error message from the response

## Reference

See `references/api-reference.md` for full endpoint details.
