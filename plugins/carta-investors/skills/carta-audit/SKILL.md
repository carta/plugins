---
name: carta-audit
version: 0.1.0
description: >-
  Open an audit engagement on a Carta fund: pick the fund and audit year once, see how many
  documents sit in each audit area (General, Cash, Investments, Partners' Equity, Income & Expenses,
  Financial Packages, Supplemental), and choose what to do next. Use when someone starts working an
  audit rather than naming a specific task — "start my audit", "I'm auditing this fund", "what can I
  do for this audit", "help me with this audit", "which funds can I audit", "set up my audit
  engagement" — or when they ask for audit documents without saying which fund or year. Establishes
  the fund and year the other audit skills reuse, so the caller is not asked twice. NOT FOR:
  downloading audit documents for a known fund and year (carta-investors:carta-audit-download),
  checking whether they are complete (carta-investors:carta-audit-readiness), or what changed since
  the last check (carta-investors:carta-audit-whats-new).
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - AskUserQuestion
  - Read
  - Write(/${CLAUDE_PLUGIN_DATA}/manifests/**)
  - Write(~/.claude/plugins/data/carta-investors-*/manifests/**)
  - Bash(mkdir -p *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py *)
  - mcp__visualize__read_me
  - mcp__visualize__show_widget
model: inherit
trigger-phrases:
  - "start my audit"
  - "I'm auditing this fund"
  - "help me with this audit"
  - "which funds can I audit"
  - "set up my audit engagement"
  - "what can I do for this audit"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.62.4</carta-plugin>

# Start an audit

Open an engagement on a fund: establish which fund and which year, show what's
available across the seven audit areas, and hand off to the right next step.

This skill reads Carta only — it lists documents, it never exports or downloads them.
The one thing it writes is the local check record, so the next visit can say what's
new.

## Voice

Write for an external auditor, not a Carta employee. They know audit vocabulary and
the Audit Documents page; they don't know Carta's internals.

Never show the caller a fund UUID, a task id, an `fa__*` command name, the words
"MCP" or "audit_area", or a raw `lifecycle_status` value. Refer to funds by name and
to areas by their labels.

## Impersonation

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/impersonation.md` (the plugin's own
`references/`, not this skill's) and follow it. Do not search for the file — read it
at that path.

---

## Step 0 — Connect

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/mcp-setup.md` (the plugin's own `references/`,
not this skill's) and follow it to identify the Carta MCP server and attach
`_instrumentation_v2` to every call. Do not search for the file — read it at that
path.

---

## Step 1 — Resolve the engagement

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md` and follow it to
establish the firm, fund and audit year. When the caller audits more than one fund
("all my funds", or several named), its "Several funds at once" section picks them
all, across firms, in one step.

Two things to hold onto, because the rest of the session depends on them: the caller
answers these questions **once**, and when the caller doesn't give an audit year it
defaults per that reference's Step 3. In a funds picker the year is a dropdown,
pre-selected per "Years with documents" in that reference.

---

## Step 2 — Count what's in each area

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md` for the seven areas and the
readiness translation table.

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/check-record.md` and follow its "Reading it"
section for the whole fund (`all`), so Step 3 can say what's new since the last check.

List each area, all seven calls together rather than one at a time:

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__audit-documents",
  "arguments": {"fund_uuid": "<fund_uuid>", "audit_year": <audit_year>, "audit_area": "<audit_area>"},
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit"]}
})
```

Rows are under `results`; a zero-row match is an envelope with `count: 0`. Take each
area's document count from `count`, not by counting rows yourself. If `has_next` is
true, re-run with `after` set to `next` — every page, since the record needs every row.

**If the very first call fails because the fund itself isn't reachable** — "No Fund
matches the given query", a 404, or a fund-wide permission denial — stop the whole
loop there. Every remaining area will fail identically, so trying the other six only
burns calls for no new information. Report it per the access guidance in
`resolve-engagement.md` and stop.

Once the fund is confirmed reachable, an error on one area is that area's problem
only — note it and carry on with the rest.

Oversize responses come back as a stub rather than a row list; `mcp-setup.md` covers
how to fetch the real payload.

---

## Step 3 — Present the engagement

Lead with the fund and year in one line, then the seven areas as a table. Counts,
plain-English readiness, nothing else:

| Audit area | Documents | New since last check | Status | Last updated in Carta |
|---|---|---|---|---|
| General | 312 | 3 | All ready | 3 Oct 2026 |
| Cash | 0 | — | Nothing filed | — |
| Investments | 140 | 0 | 138 ready, 2 still processing | 14 Oct 2026 |
| Partners' Equity | 1,090 | 12 | All ready | 9 Oct 2026 |
| Income & Expenses | 87 | 1 | 85 ready, 1 needs attention, 1 draft | 15 Oct 2026 |
| Financial Packages | 0 | — | Not published yet | — |
| Supplemental | 4 | 0 | All ready | 21 Sep 2026 |

Rules for that Status column:

- Translate `lifecycle_status` using the table in `audit-areas.md`. Never print the
  raw value.
- An empty area reads "Nothing filed" — except Financial Packages, which reads "Not
  published yet", because that's what empty actually means there.
- Don't pad a clean area. "All ready" beats a four-way breakdown where three
  categories are zero.

**New since last check** counts the area's new documents against the record from
Step 2, per "What counts as new" in `check-record.md`. An empty area shows "—". On a
first check, show "—" in every row and put that section's first-check line under the
table. Changed or removed documents belong to the detailed what's-new check, not this
table.

The last column is the most recent `updated_at` among the area's documents, shown per
the "Last updated in Carta" rules in `audit-areas.md`. It tells the auditor where the
fund has been filing lately.

Then save the whole-fund record per "Writing it" in `check-record.md`, with every
document listed across the seven areas. Skip it if Step 2 stopped because the fund
wasn't reachable; that section's all-areas rule covers an area that failed to list.

Then ask what's next per the "Next-step question" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/next-step.md` (the plugin's own `references/`, not
this skill's; do not search for it), with these choices:

- **Download documents** — "The whole fund, or just the areas you pick"
- **Check readiness in detail** — "Which specific documents aren't ready yet"
- **See what changed in detail** — "New, changed and removed documents since your
  last check". On a first check, the description is "Nothing to compare yet — this
  is useful on your next check".

Route a "download" answer to `carta-investors:carta-audit-download`, a "readiness"
answer to `carta-investors:carta-audit-readiness`, and a "what's new" answer to
`carta-investors:carta-audit-whats-new` — passing the fund and year through so none of them
re-asks. For the what's-new check and for a download, also pass the record as Step 2
read it, before this skill saved over it, and pass the download Step 2's listing:
compare against that record, or nothing would show as new.

---

## Multiple funds or years

If the caller is auditing more than one fund, or more than one year, resolve each up
front and run Step 2 for every combination firm by firm, as the "Several funds at
once" section says. Within a firm, run all its funds together. Don't try to total document counts across funds.

Present one board instead of a summary per fund: a heading per firm, then one row per
fund (and per year, when there are several). Show each area's document count and mark
an area that isn't fully ready with a short note:

**Acme Capital**

| Fund | General | Cash | Investments | Partners' Equity | Income & Expenses | Financial Packages | Supplemental | New since last check | Last updated in Carta |
|---|---|---|---|---|---|---|---|---|---|
| Growth Fund II | 312 | — | 140 (2 processing) | 1,090 | 87 (1 needs attention) | Not published | 4 | 16 | 15 Oct 2026 |

Each fund (and year) keeps its own record: read and save it per fund as Steps 2 and 3
say, and show that fund's new-document total across all areas in its row.

A row per fund keeps the board readable at twenty funds, where a full table per fund
would not be. Follow it with the same next-step question, asked once, its choices
covering every fund on the board.
