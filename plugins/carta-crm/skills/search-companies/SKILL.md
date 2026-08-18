---
name: search-companies
description: >
  Searches for and retrieves company records from the Carta CRM.
  Use this skill when the user says things like "find a company", "search companies",
  "look up a company", "show me company details for [name]", "full details on [name]", "tell me about [name]", "get company by ID",
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
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

## Overview

Look up companies in the Carta CRM. A request about **one named company** renders that
company's card; a request for a **set** renders a table. Route on that distinction first —
it decides every call below.

## Step 1 — Determine intent: one company, or a set?

- **Detail** — the user named one company and wants the record: "full details on Preqin",
  "tell me about Acme", "more on Stripe", "who is Preqin". → Step 2.
- **List** — the user wants a set, or filtered or plural results: "companies I'm tracking",
  "companies in fintech", "what companies do we have". → Step 3.
- **By domain** — the user gave a website domain (e.g. "stripe.com") → Step 2, skipping the
  resolve; `fetch_company_by_domain` already identifies one record.

A named single company is a **detail** request even when the user says "search" or "find".
If it's genuinely unclear, treat it as a list and ask what they want to narrow to.

## Step 2 — Detail: resolve the name, then render the card

**Resolve through `crm_call_tool`, never `crm_view_tool`.** This step is for you, not the
user: a view call collapses every array in the response to a count, so the rows — and the
`id` you need — never reach you, and the user gets a list they did not ask for.

```
crm_call_tool({
  "name": "crm:search_companies",
  "arguments": { query: "<company name>", limit: 10 }
})
```

Then branch on how many candidates came back:

- **Exactly one match** → render its card and stop:
  ```
  crm_view_tool({ "name": "crm:fetch_company_by_id", "arguments": { id: "<id>" } })
  ```
- **Several matches** → do NOT guess. Render the candidates as a view and ask which one:
  ```
  crm_view_tool({
    "name": "crm:search_companies",
    "arguments": { query: "<company name>", limit: 10 }
  })
  ```
  Then ask: "Several companies match — which one did you mean?" When they pick, call
  `fetch_company_by_id` for it. Opening the top hit unasked shows the wrong record with
  full confidence.
- **No match** → say so; do not render an empty view.

**By domain**, there is nothing to resolve — one call, one card:
```
crm_view_tool({ "name": "crm:fetch_company_by_domain", "arguments": { domain: "<domain>" } })
```

Render at most one card per request. If the user named several companies, ask which to open
rather than stacking views.

## Step 3 — List: search and render the table

When the user's filters map to specific fields, discover the valid `field_id`s first. This
is a schema lookup, so it goes through `crm_call_tool`:

```
crm_call_tool({ "name": "crm:get_company_fields", "arguments": {} })
```

Map the user's intent to the most specific matching fields and pass them as `filters`
(`{ field_id, operator, value }`). Fall back to the free-text `query` only when no field
matches. Never guess a `field_id` — they vary per organisation.

```
crm_view_tool({
  "name": "crm:search_companies",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate.

### If the view is unavailable

CRM views are enabled per organisation, and single-record views behind a second flag on
top of that. So any `crm_view_tool` call above may answer with:

> CRM tool 'search_companies' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 4. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

A detail request whose card has no view still resolves the same way: keep the
`crm_call_tool` resolve from Step 2 and present the chosen record as text.

## Step 4 — Present results

**When a card rendered**, the user sees the whole record. Do not restate its fields.
Answer what they asked, or acknowledge in one line.

**When a table rendered**, the user already sees every row. Do NOT re-list, re-format, or
summarise them as text — that duplicates the table. Answer the question they actually
asked, or acknowledge in one line (e.g. "Found 14 companies — the ID is in the first
column, for `/update-company`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary and show the ID prominently — the user will need it to run `/update-company`.

If no companies are found:
> "No companies found matching your search. Try a different name, keyword, or domain."
