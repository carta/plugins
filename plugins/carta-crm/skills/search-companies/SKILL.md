---
name: search-companies
description: >
  Searches for and retrieves company records from the Carta CRM.
  Use this skill when the user says things like "find a company", "search companies",
  "look up a company", "show me company details for [name]", "get company by ID",
  "get company by domain", "list companies", "what companies do we have", or "/search-companies".
  Returns company details including ID, name, and custom fields.
  The company ID returned can be used with the update-company skill.
allowed-tools:
  - mcp__carta__crm_view_tool
  - mcp__carta__crm_call_tool
version: 1.0.0
model: haiku
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

## Overview

Search for companies in the Carta CRM. Choose the right tool based on what the user
provided. Always surface the company ID so the user can reference it for updates.

## Step 1 — Determine search mode

- **By domain** — user provided a website domain (e.g. "stripe.com") → use `fetch_company_by_domain`
- **By name / keyword** — user provided a company name or keyword → use `search_companies`

If it's unclear, default to search by name and ask for a search term.

## Step 2 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

**By name / keyword:**
```
crm_view_tool({
  "name": "crm:search_companies",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

**By domain:**
```
crm_view_tool({ "name": "crm:fetch_company_by_domain", "arguments": { domain: "<domain>" } })
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate.

### If the view is unavailable

CRM views are enabled per organisation, and single-record views behind a second flag on
top of that. So **either** call above may answer with:

> CRM tool 'search_companies' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 3. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

## Step 3 — Present results

**When the view rendered**, the user already sees every record on screen. Do NOT
re-list, re-format, or summarise the rows as text — that duplicates the table.
Answer the question they actually asked, or acknowledge in one line
(e.g. "Found 14 companies — the ID is in the first column, for `/update-company`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary and show the ID prominently — the user will need it to run `/update-company`.

If no companies are found:
> "No companies found matching your search. Try a different name, keyword, or domain."
