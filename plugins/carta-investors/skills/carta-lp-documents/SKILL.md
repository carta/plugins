---
name: carta-lp-documents
description: >-
  Find the user's own LP documents — K-1s, capital call and distribution notices, financial statements, PCAPs, subscription agreements, side letters. LP only; not for a GP or fund manager pulling the documents their fund sent its LPs.
version: 1.0.0
model: inherit
allowed-tools:
  # The only source for a connector's name
  - list_connectors
  # The connector check's observed call.
  - mcp__carta__welcome
  - mcp__claude_ai_Carta__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork / public)
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__read_tool
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  # Cowork
  - Artifact
  # Local execution — the find locates the render script on remote plugin mounts
  - Bash(pwd)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-documents/scripts/render_artifact.py" *)
  - Read
  - Write
  # Zip download (desktop / CLI only)
  - Bash(unzip -l *)
  # Interaction
  - AskUserQuestion
trigger-phrases:
  - "get my lp docs tutorial"
  - "show me the get my lp docs tutorial"
  - "how do I find my documents"
  - "walk me through get my lp docs"
  - "getting started with get my lp docs"
  - "documents tutorial"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.89.0</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# Get My LP Docs

---

## ROUTING: Check for Tutorial Intent

If the user's message matches ANY of these patterns, **skip the main skill and run the Tutorial (see Section below)**:
- "get my lp docs tutorial"
- "show me the get my lp docs tutorial"
- "how do I find my documents"
- "walk me through get my lp docs"
- "getting started with get my lp docs"
- "documents tutorial"

If tutorial intent detected → jump to **## Tutorial** section below.

Otherwise → proceed with main skill (see **## Main Skill** section).

---

## Main Skill

Help an LP find and retrieve their own fund documents. Before fetching, ask the minimum questions needed to get to the right document. Never ask all questions at once.

This skill is for limited partners looking at **their own** documents. A GP or fund manager asking for documents their fund sent to its LPs is not served here — reach out to your Carta account manager or contact Carta Support.

## When to Use

- "Get me my K-1"
- "Show me my documents"
- "I need the capital call notice from [fund]"
- "Where is my Q3 financial statement?"
- "Did I get any distribution notices recently?"
- "Show me everything from [fund]"
- "What documents do I have?"
- "Get my PCAPs" / "capital account statements"
- "Show me my subscription agreement"
- "Do I have a side letter?"

---

## Step 0 — Connect to Carta

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — it sits in the **plugin's** `references/` directory, not this skill's. Read it by that exact path; don't search for it. Follow it to resolve the connector name with `list_connectors`; its confirmation call is `welcome`, which also verifies the Carta session is active. Stay quiet about the check when it passes.

Store the resolved name as `<CARTA_MCP_SERVER>` — the artifact in Step 4 needs it. Below, `mcp__<SERVER>__read_tool` and `mcp__<SERVER>__call_tool` mean your own prefixed `read_tool` and `call_tool` for that connector.

**If no Carta connector answers:** tell the user Carta is not connected and stop.

**Identity is automatic.** The LP is identified by their authenticated Carta session — never ask for, collect, or pass a user ID. Every document call below returns *this* LP's own documents.

---

## Step 0.5 — Confirm this is an investor's login

This skill is for limited partners (LPs). Before any document call, ask Carta who the user is — **once per request, never retried**:

```
mcp__<SERVER>__read_tool({"name": "lp__get__persona", "arguments": {}})
```

It returns `{"persona": …, "lp_portfolio_ids": [...]}`. Act on `persona`:

| `persona` | Do |
|---|---|
| `LP` | Continue to Step 1. Say nothing about the check. |
| `HYBRID` | Continue to Step 1. Say once that you're showing the documents they hold as an investor. |
| `GP` | Stop. Tell them this finds an investor's own documents, and their login belongs to a fund manager — for documents their fund sent to its LPs, reach out to your Carta account manager or contact Carta Support. Return the `NEEDS_HUMAN` lines below. |
| `NONE` | Stop. Tell them: "No LP portfolios found on this account." If they expected some, they can check the Carta LP portal or ask their fund manager. Return the `NEEDS_HUMAN` lines below. |

```
NEEDS_HUMAN: this Carta login is not an LP
needs_human: true
```

If the call fails, apply "Stop and retry rules" below — every failure here is terminal. A plain-text reply saying the command is not enabled means LP tools aren't turned on for this login yet: say exactly that.

Never look for the user's documents another way after a `GP` or `NONE` answer — not with a list command, a search, or another skill.

---

## Stop and retry rules — read before any call

These apply to every Carta call in this skill.

**Read the error's `code`.** A failed Carta call returns a JSON error — `{"code": …, "message": …, "fix": …, "details": …}`. Decide on `code` alone; never match on the wording of `message`.

**Terminal — stop at once, never retry:**

| `code` | Tell the LP |
|---|---|
| `unauthenticated` | Their Carta session has ended: reconnect Carta, then ask again. |
| `scope_required` | This connection isn't allowed to do that. For a zip, send them to the Carta LP portal (Step 5.1, web path). Do **not** call `request_permissions`. |
| `role_required`, `out_of_scope` | This Carta login can't open these LP documents. |
| `invalid_argument` with `field: "user_id"` | This Carta login can't open LP documents on its own. Don't suggest reconnecting. |

An error that isn't JSON is terminal the same way when it reads `401`, `403`, "forbidden", "not authenticated" or "not enabled".

Tell the LP in plain words — no status codes, error codes, tool names or raw error text — and return:

```
NEEDS_HUMAN: <one line, e.g. "this Carta login cannot open LP documents">
needs_human: true
```

The zip in Step 5.4 handles its own refusals (`delivery_terms_not_accepted`, `not_found`, `invalid_argument` with `details.ids`).

**Document-type budget — at most 3 attempts per request.** The primary query plus at most **2 fallbacks** from the Synonym Map. After the third attempt returns nothing, stop and return `NEEDS_HUMAN: no <type> documents found` with `needs_human: true`, and ask the LP to confirm the fund, the document type, or the period.

These all count as attempts and never reset the budget:
- OR-ing several terms into one `search` value;
- switching to another list command to look for the same thing;
- re-running a query with only `page_size`, `ordering` or the date range changed;
- an unfiltered "fetch everything and scan it" sweep.

Following `next_cursor` or the next `page` of a query that **succeeded** is not a new attempt.

---

## Document Endpoints

LP documents are served by **four separate MCP commands** — there is no single `lp:list:documents` command. You don't pass a `user_id` — the connected Carta session identifies the LP, and each command returns **their own** documents.

| Command | What it returns | `document_type` in response | Pagination | Has `document_type` filter? |
|---|---|---|---|---|
| `lp:list:flpd_documents` | K-1s, capital calls, distributions, financials, legal docs, tax docs | 17 distinct values (see enum below) | cursor-based | Yes |
| `lp:list:closing_documents` | Subscription agreements, side letters, W-8/W-9, KYC, PPMs (from closings) | Always `"Closing Document"` | offset-based | No |
| `lp:list:other_documents` | Miscellaneous portfolio documents | Always `"Other Document"` | offset-based | No |
| `lp:list:source_file_documents` | RFI uploads, shared financials | Always `"Source File"` | offset-based | No |

The non-FLPD endpoints flatten their documents to a single generic type. Use the `search` param or inspect `document_name` to find specific closing document types (subscription agreement, side letter, W-9, …).

**Common optional params** (all 4 endpoints): `portfolio_ids`, `investment_name`, `firm_name`, `date_from`, `date_to`, `search`

**Additional params** for `lp:list:flpd_documents` only: `document_type`, `tax_year`, `ordering` (default `-document_date`), `page_size` (1-500, default 100), `cursor`

**Response fields to honour:**
- `warnings` — when non-empty (for example a source timed out), tell the LP the results may be partial.
- `delivery_terms_accepted` — `false` means the LP has not accepted electronic delivery for that fund. The document is **locked**: show it, never link it, and leave it out of zips. `accept_url`, when present, is where they accept. A document without the field is not locked.
- `source: "source_file"` — `download_url` opens a Carta page, not a file. Label it "View in Carta" and never put it in a zip.

---

## FLPD Document Type Enum

The `document_type` parameter on `lp:list:flpd_documents` accepts these exact string values:

```
"Annual and quarterly report"
"Annual meeting"
"Capital account statements"
"Capital calls"
"Carried interest statement"
"Consolidated capital account statements"
"Distributions"
"Financial Package"
"General"
"Legal"
"Legal - Commitment change"
"Legal - Side letter"
"Legal - Subscription agreement"
"QSBS statement"
"Tax"
"Tax - Estimate"
"Tax - Schedule K-1"
```

The MCP also accepts these **friendly aliases** (resolved server-side):
- `k1` → `"Tax - Schedule K-1"`
- `capital_call_notice` → `"Capital calls"`
- `distribution_notice` → `"Distributions"`
- `financial_statement` → `"Annual and quarterly report"`, `"Consolidated capital account statements"`, `"Financial Package"`, `"Capital account statements"`, `"Carried interest statement"`

Any value not in the alias map is passed through as-is, so raw enum strings always work.

**K-1 detection nuance:** some K-1s are stored with `document_type: "Tax"` but have "K-1" in their `document_name`. Query `"Tax - Schedule K-1"` first. If that is empty, the one fallback is `document_type: "Tax"`, filtered client-side to names containing "K-1" (case-insensitive).

---

## Document Type Synonym Map

Resolve user terms to the correct endpoint + `document_type` value **before fetching**. The Fallbacks column is ordered; take at most two of them (see the budget above).

| User says | Endpoint | `document_type` value | Fallbacks |
|---|---|---|---|
| K-1, Schedule K-1 | `flpd_documents` | `Tax - Schedule K-1` | `Tax` filtered to names containing "K-1" |
| tax doc, tax return, tax document, taxes | `flpd_documents` | `Tax` | `Tax - Schedule K-1`, `Tax - Estimate` |
| tax estimate, estimated taxes | `flpd_documents` | `Tax - Estimate` | search `"tax estimate"` |
| capital call, drawdown, capital contribution | `flpd_documents` | `Capital calls` | search `"capital call"` |
| distribution, dist notice, proceeds | `flpd_documents` | `Distributions` | search `"distribution"` |
| PCAP, capital account statement, partner statement | `flpd_documents` | `Capital account statements` | search `"capital account"` |
| financial statement, financials, quarterly report, Q1-Q4 report | `flpd_documents` | `Financial Package` | `Annual and quarterly report`, search `"financial"` |
| annual meeting, annual meeting notice | `flpd_documents` | `Annual meeting` | search `"annual meeting"` |
| legal document, LPA, partnership agreement | `flpd_documents` | `Legal` | search `"partnership agreement"` |
| subscription agreement, sub docs | `flpd_documents` | `Legal - Subscription agreement` | `closing_documents` with search `"subscription"` |
| side letter | `flpd_documents` | `Legal - Side letter` | `closing_documents` with search `"side letter"` |
| commitment change | `flpd_documents` | `Legal - Commitment change` | search `"commitment"` |
| carried interest, carry statement | `flpd_documents` | `Carried interest statement` | search `"carried interest"` |
| consolidated PCAP, consolidated capital account | `flpd_documents` | `Consolidated capital account statements` | search `"consolidated"` |
| W-8, W-9, W8, W9, withholding form | `closing_documents` | (no filter — search `"W-9"` or `"W-8"`) | `flpd_documents` with the same search |
| PPM, private placement memo, offering memo | `closing_documents` | (no filter — search `"PPM"`) | `flpd_documents` with `document_type: "Legal"` |
| KYC, know your customer, investor questionnaire | `closing_documents` | (no filter — search `"KYC"`) | search `"questionnaire"` |
| QSBS, qualified small business stock | `flpd_documents` | `QSBS statement` | search `"QSBS"` |
| all documents, everything, show me all | all 4 endpoints | (no filter) | — |

---

## Step 1 — Resolve Document Type

1. Read the user's message.
2. Look up their term in the **Document Type Synonym Map** above.
3. If matched → use the canonical `document_type` and endpoint. Do not ask for clarification.
4. If **not matched** → run one free-text search (this is attempt 1 of 3): `mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"search": "<user_term>"}})`. If it is empty, tell the user: "I didn't find any documents labeled '[term]'. Here are the document types you have on file: [types from any results you already hold]. Did you mean one of these?"
5. Extract other context if stated: fund name, year, "all funds", date range.

If the user has provided enough to fetch — go fetch. Do not ask questions they already answered.

---

## Step 2 — Ask the Missing Question(s)

Ask **one question at a time**, in this order:

### Question A: Document Type (ask first if unknown and cannot be inferred)

> "What type of document are you looking for?"
> - **K-1** (annual tax document)
> - **Capital call notice** (contribution request from a GP)
> - **Distribution notice** (payment coming from a fund)
> - **Capital account statement** (also called a PCAP)
> - **Financial statement** (quarterly or annual fund financials)
> - **Legal document** (LPA, subscription agreement, side letter)
> - **All documents** (show everything)

### Question B: Which Investment (ask if fund/company is still unknown)

> "For all your investments, or a specific one?"

If the user says a specific fund, pass `investment_name` as a filter param.

### Question C: Time Period (ask only for K-1 or financial statements)

For **K-1**: ask the tax year if not already stated, then pass it as `tax_year`.
> "Which tax year? (e.g. 2024, 2023)"

For **financial statements**: ask the period if not already stated.
> "Which period? For example: Q3 2024, or annual 2023."

**Do not ask for a time period for capital call notices, distribution notices, or legal documents** — default to surfacing the most recent results.

---

## Step 3 — Fetch

Call `mcp__<SERVER>__read_tool` with the command name (colons become double underscores) and arguments. Never pass a `user_id`.

### Examples by type

```
-- K-1s for a tax year
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Tax - Schedule K-1", "tax_year": 2024}})

-- All tax documents (K-1s + estimates + other tax)
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Tax"}})

-- Capital calls
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Capital calls"}})

-- Distributions
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Distributions"}})

-- Capital account statements (PCAPs)
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Capital account statements"}})

-- Financial statements
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Financial Package"}})

-- Subscription agreements
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Legal - Subscription agreement"}})

-- By type + investment
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"document_type": "Tax", "investment_name": "Harborview Growth Fund II"}})

-- By date range
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"date_from": "2024-01-01", "date_to": "2024-12-31"}})

-- Free-text search
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents", "arguments": {"search": "capital account"}})
```

### "All documents" query

When the user wants everything, call all 4 endpoints once each and merge the `results` arrays — this is one attempt, not four:

```
mcp__<SERVER>__read_tool({"name": "lp__list__flpd_documents",          "arguments": {}})
mcp__<SERVER>__read_tool({"name": "lp__list__closing_documents",       "arguments": {}})
mcp__<SERVER>__read_tool({"name": "lp__list__other_documents",         "arguments": {}})
mcp__<SERVER>__read_tool({"name": "lp__list__source_file_documents",   "arguments": {}})
```

All 4 endpoints return the same document shape:
```json
{
  "id": "flpd:4534",
  "document_name": "Schedule K-1",
  "document_type": "Tax - Schedule K-1",
  "source": "fund_lp_document",
  "investment_name": "Harborview Growth Fund II, L.P.",
  "investment_type": "fund",
  "firm_name": "Harborview Partners",
  "portfolio_name": "Personal",
  "document_date": "03/31/2025",
  "download_url": "https://…"
}
```

### Pagination

For `flpd_documents` (cursor-based): if `next_cursor` is present, fetch the next page with `{"cursor": "<next_cursor>"}`. For the other 3 endpoints (offset-based): use `page` and `page_size`.

Stop after **50 pages** per endpoint, or as soon as a cursor repeats, and tell the LP the list may be incomplete. When there are that many documents, the artifact (Step 4) pages through them itself — you don't need every page in context.

---

## Step 4 — Present Results

**One rule decides the format: fewer than 5 documents → inline table; 5 or more → artifact.**

### No documents found

Only after the budget in "Stop and retry rules" is spent: "No [type] documents found for [investment/fund name]. You may want to contact [firm name] directly." Then the `NEEDS_HUMAN` line from that section.

### Fewer than 5 documents — inline table

Columns: **Type**, **Fund**, **Document**, **Firm**, **Date**. Add a **Portfolio** column only when `portfolio_name` differs between rows. Write dates in the LP's own date style (for example "31 Mar 2025" or "Mar 31, 2025"), never a bare `MM/DD/YYYY`.

- **Document** is the document name linked to its `download_url`, which opens it in Carta.
- A **locked** row (`delivery_terms_accepted: false`) shows `🔒 Locked — <name>` with **no link**.
- A `source_file` row is linked as "<name> (View in Carta)".

Example:

| Type | Fund | Document | Firm | Date |
|---|---|---|---|---|
| K-1 (Tax Year 2024) | Harborview Growth Fund II | [2024 K-1 Schedule](https://…) | Harborview Partners | Mar 20, 2025 |
| K-1 (Tax Year 2024) | Pinecrest Growth Fund I | 🔒 Locked — Tax Form K-1 | Pinecrest Capital | Mar 18, 2025 |

Below the table, one line per fund with locked rows:

> **Pinecrest Growth Fund I** — Accept electronic delivery to view these documents: [Accept in Carta](<accept_url>)

When `accept_url` is missing or is not an `https://` URL, write instead: "…to view these documents — accept the terms in the Carta LP portal." with no link.

If any response carried `warnings`, add one line saying the results may be partial.

Then offer the zip (Step 5).

### 5 or more documents — artifact

**4a. Checks.** Read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` (the plugin's `references/`, not this skill's; don't search for it) and follow it.

**4b. Render.** `<CWD>` is the output of `pwd`. Run this on one line, with the script path exactly as written: `allowed-tools` pre-approves that exact command, so a shell variable or a `cd` in front of it makes the user approve it by hand.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-documents/scripts/render_artifact.py" --mcp-server "<CARTA_MCP_SERVER>" --out "<CWD>/lp-documents.html"
```

It prints `{"out": "<path>", "title": "LP Documents"}`. The title is always `LP Documents`; the page names the portfolio, or counts them, from the documents it loads. It exits non-zero on an unusable connector name or an output path outside the working directory — surface the error and stop; do not edit the HTML by hand.

**4c. Fallback — one attempt, only when `uv` is missing or the script file does not exist** (never after a validation error):
1. `Read` the template at `${CLAUDE_PLUGIN_ROOT}/skills/carta-lp-documents/references/lp-docs-artifact-template.html` — this skill's own `references/`. Read it by that exact path; don't search for it.
2. Check `<CARTA_MCP_SERVER>` holds no quote, angle bracket, backslash or newline. If it does, stop.
3. Replace `__LP_DOCS_CONFIG__` with `{"server": "<CARTA_MCP_SERVER>", "title": "LP Documents", "generated": "<today, YYYY-MM-DD>"}` and `__LP_DOCS_TITLE__` with `LP Documents`.
4. `Write` the result to `<CWD>/lp-documents.html`, and tell the user the fallback ran so the mount path gets fixed.

**4d. Publish.** Look for an existing **LP Documents** page with `Artifact({action: "list", scope: "mine"})`; if one with the same title is published, keep its `url`. Then — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<out from 4b, or the fallback file>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "LP Documents",
  description: "LP document browser — filters, sorts, and opens fund documents from Carta.",
  icon: "list",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome"] }] }
  }
})
```

The title is fixed so a returning LP always finds and updates the same page, whatever their portfolios — and it must match the page's own `<title>`, which always wins in the gallery. Both tools must be in the grant, or every fetch rejects with `not_in_manifest`. Restate the whole `capabilities` object every time: a non-empty object replaces the stored grant.

The page loads fresh documents from Carta every time it is opened, shows locked funds with their "Accept electronic delivery" prompt under every filter, and reports partial loads in a banner. Give the user its URL, then offer the zip (Step 5).

---

## Step 5 — Zip Download

### 5.1 Where you are running decides the path

Run `pwd`. **Desktop / CLI** means you have Bash and the working directory is not under `/sessions`. Anything else — the web app (no Bash), or a Cowork sandbox (`/sessions/…`) — is **web**.

**Web:** do not start a zip. Send the LP to the Carta LP portal, which bulk-downloads documents itself. Build the link per portfolio as `<origin>/investors/individual/<portfolio_id>/portfolio/get_received_documents/`, where:
- `<portfolio_id>` is each id in `lp_portfolio_ids` from Step 0.5;
- `<origin>` is the scheme and host of any `download_url` you fetched, **only if** it is `https://` and the host is exactly `carta.com` or ends in `.carta.com`.

If no such origin exists, say "open your documents in the Carta LP portal" with no link.

**Desktop / CLI:** continue below.

### 5.2 Offer and naming

> "Would you like to download these as a zip? I can organize them any way you prefer, or use a sensible default."

The zip includes every document from the result, not just one page of the artifact. If yes, ask once:
> "Any preference for naming or organization? For example: 'folders by fund', 'all in one folder', or 'use the default'."

Default format — **flat, no folder**: `{quarter} {year} {fund_name} {doc_name_or_type}.pdf`, e.g. `Q1 2025 Harborview Growth Fund II Capital Call Notice.pdf`.

`{fund_name}` = `investment_name`; `{year}` = the year of `document_date`; `{quarter}` from its month (Jan–Mar = Q1, …); `{tax_year}` for K-1s from `document_name` or `document_date` year − 1.

| Document type | Filename |
|---|---|
| Capital call notice | `{quarter} {year} {fund_name} Capital Call Notice.pdf` |
| Distribution notice | `{quarter} {year} {fund_name} Distribution Notice.pdf` |
| Financial statement | `{quarter} {year} {fund_name} Financial Statement.pdf` |
| K-1 (annual, no quarter) | `{tax_year} {fund_name} K-1.pdf` |
| Other | `{quarter} {year} {fund_name} {document_name}.pdf` |

**When names repeat.** One quarter can hold several documents of the same type, and a zip keeps only one file per name. After naming every document, find the names that appear more than once and add the document's date before `.pdf`, as `YYYY-MM-DD`: `Q4 2024 Harborview Growth Fund II Capital Call Notice 2024-11-15.pdf`. If documents still share a name because the dates are equal too, add ` (2)`, ` (3)` … after the date, in the order the documents were listed: `… 2024-11-15 (2).pdf`. A name that was unique to begin with stays as it is. Apply the same rule to a naming scheme the LP asked for, within each folder.

### 5.3 Build `items`

For each document: `{"id": "<id>", "path": "<filename>"}`. Sanitize each path segment: strip `/ \ : * ? " < > |`, collapse whitespace, trim; no leading `/`, no `..`, no empty segments.

**Leave out:**
- `source_file` documents — they are Carta pages, not files;
- **locked** documents (`delivery_terms_accepted: false`). Name their funds to the LP: "Left out N documents from <funds> — accept electronic delivery for those funds first."

If more than 500 items remain, split into labeled parts ("Part 1 of 2").

### 5.4 Start and poll

```
mcp__<SERVER>__call_tool({"name": "lp__mutate__start_document_download", "arguments": {"items": [...]}})
```

If it fails, act on the error's `code`:

| `code` | Do |
|---|---|
| `scope_required`, or any terminal code from "Stop and retry rules" | Send the LP to the portal (5.1, web path) and stop. Never call `request_permissions`. |
| `delivery_terms_not_accepted` | For each fund in `details.funds`, tell the LP to accept electronic delivery — link its `accept_url` only when it is `https://`. Drop the ids in `details.ids` from `items` and start again. |
| `not_found`, or `invalid_argument` with `details.ids` | Those documents can't go in a zip. Drop the ids in `details.ids`, tell the LP how many were left out, and start again. |

**At most one restart per package.** A second refusal of any kind sends the LP to the portal and stops. Trimming `items` again, splitting the package into parts, or starting a fresh package for the same documents are not ways around this cap — never try them.

Otherwise it returns a `workflow_id`. Poll every ~10 seconds, **at most 18 polls** (3 minutes):

```
mcp__<SERVER>__read_tool({"name": "lp__get__document_download_status", "arguments": {"workflow_id": "<workflow_id>"}})
```

- `"pending"` → wait ~10s and poll again.
- A ready message with a URL → 5.5.
- A `not_found` or `internal_error` code → the package is finished and failed. Tell the LP it could not be built and point them to the portal. Never poll again.

Still pending after 18 polls: tell the LP it is still being prepared and give them the `workflow_id` to check later.

### 5.5 Save it

The ready URL is a short-lived signed link. **Never show it as a clickable link or paste it for the LP to open** — download it for them. Claude Code asks the LP to approve the download; that prompt is expected:

```bash
curl --proto '=https' --tlsv1.2 -sSL "<signed_url>" -o ~/Downloads/"<FILENAME>.zip" -w "%{http_code}"
```

- `200` → check it with `unzip -l ~/Downloads/"<FILENAME>.zip"` and tell the LP: "Your zip is saved to **`~/Downloads/<FILENAME>.zip`** — N files."
- `401` or `403` → terminal: return `NEEDS_HUMAN: the download link was refused` with `needs_human: true` and point the LP to the portal. Do not run curl again.
- Any other failure → point the LP to the portal. One curl attempt per package.

### 5.6 Examples

**Default naming**
> User: "Zip them up"
> → build items with `{quarter} {year} {fund_name} {doc_name_or_type}.pdf`, locked and source-file documents left out → start, poll, save.

**Custom naming**
> User: "Organize by year, name them like '2024-Q1-capital-call.pdf'"
> → items = [{"id":"…", "path":"2024/2024-Q1-capital-call.pdf"}, …] → start, poll, save.

---

## Important Notes

- Always show investment name and date alongside every document.
- K-1s are annual. If the LP asks for "my K-1" without a year, surface the most recent one.
- **Always use the Synonym Map** before fetching — never pass user terms directly as `document_type`. "PCAP" → `Capital account statements`, "K-1" → `Tax - Schedule K-1`.
- Capital call and distribution notices can be time-sensitive. Note the date prominently.
- Never guess at a document's content.

## Best Effort

- **Authoritative:** document list, dates, names, and download links come directly from Carta.
- **Computed:** period matching (e.g. inferring "last year" = 2024) is derived by Claude — confirm with the LP if ambiguous.

---

## Tutorial

You are leading a quick ~2-minute tutorial for an LP using the document-retrieval skill.

**Interaction rules — follow these throughout:**

- Present each section, then **pause and wait for user input before advancing**. Never auto-advance.
- All demo data is fictional. No real API calls run during scenarios.
- Tone: warm and simple — like a concierge walking a client through a new feature.
- No technical jargon. Never mention curl, signed URLs, auth, pagination, or API internals.
- Keep it moving. Linear flow: intro → scenario 1 → scenario 2 → wrap-up.

---

### Section 0 — Welcome + What It Does

Present this to the user:

---

**Document Retrieval** — quick intro.

This skill finds your fund documents — K-1s, capital call notices, distribution notices, and financial statements — just by asking for them in plain language.

One of the most useful things: it searches **across all your portfolios and fund commitments at once**, so you don't have to look fund by fund.

Two quick demos and you're done. Type **ready** to start.

---

Wait for the user to confirm before continuing.

---

### Section 1 — Demo: Finding K-1s

Present:

---

**Demo 1 of 2 — K-1 Search**

It's tax season. Jordan Rivera's CPA needs K-1s for 2023. Jordan types:

> **"Get my K-1s for 2023"**

Here's what comes back:

> **Found 3 K-1s for tax year 2023:**
>
> | # | Investment | Firm | Tax Year | Date | Download |
> |---|---|---|---|---|---|
> | 1 | Pinecrest Growth Fund II | Pinecrest Capital | 2023 | Mar 15, 2024 | [Download](#) |
> | 2 | Pinecrest Growth Fund I | Pinecrest Capital | 2023 | Mar 12, 2024 | [Download](#) |
> | 3 | Oakwood Ventures Fund III | Oakwood Capital | 2023 | Apr 2, 2024 | [Download](#) |
>
> K-1s on file for: **2019, 2020, 2021, 2022, 2023**
>
> Would you like to download these as a zip?

All three funds — **one search, one result**. No need to log into each fund portal separately.

Type **next** for the zip demo.

---

Wait for the user before continuing.

---

### Section 2 — Demo: Zip Download

Present:

---

**Demo 2 of 2 — Downloading Your Documents**

Jordan wants all 3 K-1s in one file to send to their CPA.

> **"Zip them up"**

The skill asks one quick question:

> Any preference for how they're named? Or just use the default?

Jordan says "use the default." A few seconds later:

> **Your documents are ready.**
>
> Saved to your Downloads folder — 3 files, 312 KB
>
> Files inside:
> ```
> 2023 Pinecrest Growth Fund II K-1.pdf
> 2023 Pinecrest Growth Fund I K-1.pdf
> 2023 Oakwood Ventures Fund III K-1.pdf
> ```

That's it. One zip, ready to forward. (In the web app, the skill sends you to the Carta LP portal to download instead.)

Type **done** to finish.

---

Wait for the user before continuing.

---

### Section 3 — Wrap-Up

Present:

---

**You're ready. Quick reference:**

| What you want | What to say |
|---|---|
| K-1 for a specific year | "Get my K-1s for 2023" |
| All K-1s on file | "Show me all my K-1s" |
| Capital call notices | "Show my capital call notices" |
| Notices from a specific fund | "Capital calls from [fund name]" |
| Distribution notices | "Show my distribution notices" |
| Quarterly financials | "Q3 2024 financial statements" |
| Everything across all your funds | "Show me all my documents" |
| Download as zip | After results appear: "zip them up" |

Everything searches across all your portfolios and fund commitments automatically — you never have to specify which fund unless you want to narrow it down.

To re-run this tutorial: say **"get my lp docs tutorial"**

---
