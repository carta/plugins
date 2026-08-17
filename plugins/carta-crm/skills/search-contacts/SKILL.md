---
name: search-contacts
description: >
  Searches for and retrieves contact (people) records from the Carta CRM.
  Use this skill when the user says things like "find a contact", "search contacts",
  "look up a person", "show me contact details for [name]", "get contact by ID",
  "list contacts", "find people at [company]", "search people", or "/search-contacts".
  Returns contact details including ID, name, email, title, company, and tags.
  The contact ID returned can be used with the update-contact skill.
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

Search for contacts in the Carta CRM. If the user provided an ID, fetch the single
record directly. Otherwise search by name/keyword and return results in a readable
summary. Always surface the contact ID so the user can reference it for updates.

## Step 1 — Determine search mode

- **By ID** — user provided a contact ID → call `fetch_contact_by_id`
- **By name / keyword** — user provided a name, email, or keyword → call `search_contacts`

If it's unclear, default to search and ask the user for a search term.

## Step 2 — Execute the search

Use `crm_view_tool` so the result renders as an interactive table the user can sort and
click through. It takes exactly the same `name` and `arguments` as `crm_call_tool`.

**By name / keyword:**
```
crm_view_tool({
  "name": "crm:search_contacts",
  "arguments": {
    query: "<search term>",
    limit: 20
  }
})
```

**By ID:**
```
crm_view_tool({ "name": "crm:fetch_contact_by_id", "arguments": { id: "<contact id>" } })
```

If the user mentions a specific list or folder by name, resolve the name to a list ID
first, then pass `list_id` to narrow the search. This lookup has no view of its own, so
it goes through `crm_call_tool`:

```
crm_call_tool({ "name": "crm:get_contact_lists", "arguments": {} })
```

Increase `limit` if the user asks to see more results. Use `offset` to paginate.

### If the view is unavailable

CRM views are enabled per organisation, and single-record views behind a second flag on
top of that. So **either** call above may answer with:

> CRM tool 'search_contacts' has no view — call it with crm_call_tool instead.

That is a normal response, not a failure — this organisation does not have that view
enabled. Retry that one call verbatim through `crm_call_tool` and present the result as
text per Step 3. Do **not** retry `crm_view_tool`, and do not report the message to the
user.

## Step 3 — Present results

**When the view rendered**, the user already sees every record on screen. Do NOT
re-list, re-format, or summarise the rows as text — that duplicates the table.
Answer the question they actually asked, or acknowledge in one line
(e.g. "Found 23 contacts — the ID is in the first column, for `/update-contact`.").

**When you fell back to `crm_call_tool`**, display all non-empty fields in a readable
summary — name, title, company, email, phone, and tags — and show the ID prominently,
since the user needs it to run `/update-contact`.

`fetch_contact_by_id` also returns related deals and notes. The view renders those, but
call them out in text if the user is asking for context on a specific person.

If no contacts are found:
> "No contacts found matching your search. Try a different name, email, or keyword."
