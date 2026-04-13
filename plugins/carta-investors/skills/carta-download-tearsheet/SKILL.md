---
name: carta-download-tearsheet
description: >
  Download tear sheets for your portfolio companies and funds on Carta.
version: 1.2.0
---

<!-- Part of the official Carta AI Agent Plugin -->

# Download Tearsheet

## Overview

Download tear sheets for your portfolio companies and funds on Carta.

The skill presents available templates and portfolio companies interactively, then routes
to the appropriate workflow based on the selection:

- **One portco** → Preview: immediate embedded PDF returned in the MCP response.
- **All portcos across all funds** → Download All: fast path — no fund breakdown needed.
- **Specific portcos (two or more)** → Bulk: builds fund breakdowns, async ZIP archive, polled until complete, download URL provided.

---

# When to Use

- "Generate a tear sheet for [Portco]"
- "Download tear sheet for all portfolio companies"
- "Create a bulk tear sheet package"
- "Preview the tear sheet for [Portco]"
- "Generate tear sheets for all portcos in [Fund]"
- "Download all tear sheets as a ZIP"
- Other trigger phrases: "tear sheet for portco", "tear sheets for all portcos", "preview tear sheet", "generate tear sheet PDF", "create tear sheet", "download tear sheet package", "download all tear sheets".
  
## Prerequisites

- The Carta MCP server must be connected.
- A firm context must be active. If not set, call `list_contexts` then `set_context` with the target `firm_id` before any other call.
- No fund UUID or portco UUID needs to be known in advance — both are resolved interactively via `fa:list:tearsheet_templates` and `fa:list:portfolio_companies`.

## Data Retrieval

| MCP Command | Purpose |
|-------------|---------|
| `fetch("fa:list:tearsheet_templates", {})` | List available PDF templates for the firm |
| `fetch("fa:list:portfolio_companies", {})` | List all portfolio companies with their fund groupings |
| `fetch("fa:get:tearsheet_preview", {...})` | Generate a single-portco PDF synchronously |
| `fetch("fa:mutate:download_all_tearsheets", {...})` | Start an async job for all portcos (fast path) |
| `fetch("fa:mutate:start_tearsheet_download", {...})` | Start an async bulk job for a specific portco subset |
| `fetch("fa:get:tearsheet_download_status", {})` | Poll for async job completion; returns `"pending"` or a download URL |

## Gate 0: Firm Context

Ensure a firm context is active. If this is your first MCP call in the session, or if
subsequent calls fail with a firm/context error:

1. Call `list_contexts` to see which firms are accessible.
2. Call `set_context` with the target `firm_id`.

You do not need to ask the user for a firm UUID — the MCP session tracks the active firm.

---

## Gate 1: Select Template

Call:

```
fetch("fa:list:tearsheet_templates", {})
```

**If the user mentioned a document name** (e.g. "Investment Summary", "Fund Summary",
"Tear Sheet"): match it against the template `name` field (case-insensitive, partial match).

- **Match found:** Confirm with the user:

  > "Found template **'Investment Summary'** — is this the one you want?"

  If yes, store it and continue. If no, show the full table.

- **No match found:** Tell the user, then show the full table:

  > "No template named 'Investment Summary' was found for this firm. Here are the
  > available templates — which one would you like to use?"

**If no document name was mentioned:**

- **One template:** Confirm with user before proceeding.
- **Multiple templates:** Show table, ask user to select by number:

  ```
  | # | id | Name | Orientation | Grain Level | Description |
  |---|----|------|-------------|-------------|-------------|
  | 1 | aaa-... | Q4 2024 Standard | landscape | fund | — |
  | 2 | bbb-... | Annual Summary   | portrait  | company | Annual LP report |
  ```

Store as `TEMPLATE_UUID` (the template `id`) and `TEMPLATE_NAME`.

---

## Gate 2: Select Portfolio Companies

Call:

```
fetch("fa:list:portfolio_companies", {})
```

The command returns an array of portfolio companies. Each item includes `name`,
`entity_link_id`, and `fund_uuid`.

Group them by `fund_uuid` and display a numbered table:

```
## Acme Fund I
| # | Company Name | entity_link_id | fund_uuid |
|---|--------------|----------------|-----------|
| 1 | Portco Alpha | el-uuid-1      | fund-uuid-1 |
| 2 | Portco Beta  | el-uuid-2      | fund-uuid-1 |

## Acme Fund II
| # | Company Name | entity_link_id | fund_uuid |
|---|--------------|----------------|-----------|
| 3 | Portco Gamma | el-uuid-3      | fund-uuid-2 |
```

Ask the user to choose:

1. **All portcos across all funds**
2. **All portcos in a specific fund**
3. **Specific companies** — by row number or entity_link_id

---

## Gate 3: Route

After the user selects portcos:

- **Exactly one portco selected** → proceed to [Preview Flow](#preview-flow-single-portco).
- **All portcos across all funds selected** → proceed to [Download All Flow](#download-all-flow-all-portcos).
- **Two or more specific portcos selected** → build `FUND_BREAKDOWNS` and proceed to [Bulk Flow](#bulk-flow-multiple-portcos).

---

## Preview Flow (single portco)

Store the selected portco's `fund_uuid` and `entity_link_id`.

Tell the user: "Generating tearsheet — this may take up to 2 minutes..."

Call:

```
fetch("fa:get:tearsheet_preview", {
  "template_uuid": "<TEMPLATE_UUID>",
  "fund_uuid": "<FUND_UUID>",
  "entity_link_id": "<ENTITY_LINK_ID>"
})
```

The command returns the PDF as an embedded resource in the MCP response.

Report to the user:

```
Your tear sheet is ready!

The PDF has been returned as an embedded resource in this response.
Save it from your interface or ask me to retry if nothing appeared.

Template: <TEMPLATE_NAME>
Company:  <PORTCO_NAME>
```

**On failure:** Surface the full error. Common causes:
- **Firm context not set:** Call `list_contexts` and `set_context` first.
- **422:** Template may not be compatible with this portco. Try a different template.
- **401/403:** Session may have expired. Re-connect the Carta MCP server.
- **Timeout:** Server may be busy. Try again.

Never retry automatically.

---

## Download All Flow (all portcos)

Present a confirmation summary before starting — **never proceed without explicit user approval**:

```
Ready to generate tearsheets for all portfolio companies:

  Template:  <TEMPLATE_NAME> (<TEMPLATE_UUID>)
  Scope:     All portcos across all funds

Proceed? (yes/no)
```

Start the bulk job using the download-all command:

```
fetch("fa:mutate:download_all_tearsheets", {
  "template_uuid": "<TEMPLATE_UUID>"
})
```

Tell the user the job has started and polling will begin.

**Poll for completion** — call `fetch("fa:get:tearsheet_download_status", {})` every 30 seconds, up to
10 attempts (5 minutes total):

- Response is `"pending"` → print progress ("Still processing... (attempt N/10)") and wait.
- Response contains a URL → job complete. Capture as `DOWNLOAD_URL`.
- Response is an error message → surface it and stop.

**On timeout (10 attempts exhausted):** Tell the user the job may still be running and
they can check manually by asking: "Check tearsheet download status".

**On success:** Present the download link:
- DO NOT try to download the artifact directly. ALWAYS present the download link.

```
Your tear sheets are ready!

[Download Your Tear Sheets](<DOWNLOAD_URL>)

> Note: this link is temporary and will expire — download it soon.
```

---

## Bulk Flow (multiple portcos)

Build `FUND_BREAKDOWNS` — group entity_link_ids by fund_uuid:

```json
[
  {"fund_uuid": "fund-uuid-1", "entity_link_ids": ["el-uuid-1", "el-uuid-2"]},
  {"fund_uuid": "fund-uuid-2", "entity_link_ids": ["el-uuid-3"]}
]
```

Present a confirmation summary before starting — **never proceed without explicit user approval**:

```
Ready to generate bulk tearsheets:

  Template:  Q4 2024 Standard (aaa-...)
  Portcos:   3 companies across 2 funds

    Acme Fund I
      - Portco Alpha
      - Portco Beta
    Acme Fund II
      - Portco Gamma

Proceed? (yes/no)
```

Start the bulk job:

```
fetch("fa:mutate:start_tearsheet_download", {
  "template_uuid": "<TEMPLATE_UUID>",
  "fund_breakdowns": <FUND_BREAKDOWNS>
})
```

Tell the user the job has started and polling will begin.

**Poll for completion** — call `fetch("fa:get:tearsheet_download_status", {})` every 15 seconds, up to
20 attempts (5 minutes total):

- Response is `"pending"` → print progress ("Still processing... (attempt N/20)") and wait.
- Response contains a URL → job complete. Capture as `DOWNLOAD_URL`.
- Response is an error message → surface it and stop.

**On timeout (20 attempts exhausted):** Tell the user the job may still be running and
they can check manually by asking: "Check tearsheet download status".

**On success:** Present the download link:
- DO NOT try to download the artifact directly. ALWAYS present the download link.

```
Your tear sheets are ready!

[Download Your Tear Sheets](<DOWNLOAD_URL>)

> Note: this link is temporary and will expire — download it soon.
```

---

## Error Handling

- **Firm context error:** Call `list_contexts` and `set_context` to re-establish context.
- **No templates returned:** The firm may not have tearsheet templates configured. Check
  the Carta app or contact support.
- **No portcos returned:** The firm may not have portfolio companies. Verify the correct
  firm context is active.
- **Bulk job failure:** Template or portco selection may be invalid. Retry with different
  selections.
- Never retry automatically — surface the full error and let the user decide.
