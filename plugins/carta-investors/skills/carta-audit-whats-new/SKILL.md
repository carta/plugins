---
name: carta-audit-whats-new
version: 0.1.0
description: >-
  Report which of a fund's audit documents are new, changed, or no longer there since
  the last time this skill checked that same fund, year and audit area — instead of
  re-listing everything. Use when someone re-checks a fund they've already pulled
  once: "anything new in the audit documents since last time", "what's been added to
  the audit documents since I last checked", "have any audit documents changed",
  "what changed on the audit portal", "check for new audit documents". Keeps a small local record between runs; it never exports or
  downloads files.
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
  - "anything new in the audit documents since last time"
  - "what's been added to the audit documents since I last checked"
  - "have any audit documents changed"
  - "what changed on the audit portal"
  - "check for new audit documents"
  - "what's new on this fund's audit documents"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.68.0</carta-plugin>

# What's new since last check

Compare a fund's current audit documents against the last time this skill looked at
the same fund, year and area, and report what's **new**, **changed**, or **no longer
there** — rather than re-listing everything.

Read-only: it calls the same list command `carta-investors:carta-audit-download` uses,
but never exports a zip. When the caller wants the files themselves, that's the skill
to use.

## Voice

Write for an external auditor. Never show them a fund UUID, an `fa__*` command name,
the words "MCP" or "audit_area", or a raw `lifecycle_status` value.

## Where the record lives

The comparison record is a small file **on this machine**, kept across plugin updates.
If the caller is on a surface with no shell — a web or Slack session — tell them this
check isn't available there and offer `carta-investors:carta-audit-download` instead.

## Impersonation

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/impersonation.md` (the plugin's own
`references/`, not this skill's) and follow it. Do not search for the file — read it
at that path.

---

## Step 0 — Connect

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/mcp-setup.md` (the plugin's own `references/`,
not this skill's) and follow it. Do not search for the file — read it at that path.

---

## Step 1 — Resolve the engagement

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md` and follow it for the
firm, fund and audit year. If an earlier audit skill already established them in
this conversation, reuse them.

**The audit year must be settled explicitly here** — don't let it ride on a default
the caller never saw. The record is filed by year, so a silently wrong year compares
this check against a different year's history next time. If the caller hasn't given
one and nothing earlier in the conversation established one, ask.

**Audit area is optional.** If the caller named one, use it; otherwise check the whole
fund. If it's genuinely ambiguous which they meant, ask rather than guessing —
"whole fund" and "one area" keep separate records and aren't interchangeable.

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md` for the area labels and the
readiness translation.

---

## Step 2 — Find this combination's record

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/check-record.md` (the plugin's own
`references/`, not this skill's) and follow its "Reading it" section for this fund,
year and area, using `all` when no area was named. Do not search for the file — read
it at that path.

If `carta-investors:carta-audit` handed over the record it read earlier in this conversation,
compare against that one instead: carta-audit has already saved today's list over the
file.

---

## Step 3 — List what's there now

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__audit-documents",
  "arguments": {"fund_uuid": "<fund_uuid>", "audit_year": <audit_year>, "audit_area": "<audit_area or omit for the whole fund>"},
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-whats-new"]}
})
```

Rows are under `results`; a zero-row match is an envelope with `count: 0`. If
`has_next` is true, re-run with `after` set to `next` and keep
collecting rows before Step 4 — a partial fetch will misreport later-page documents
as "no longer there".

Each row in `results` carries `id`, `name`, `audit_area`, `document_type`, `year`,
`month`, `state`.

Oversize responses come back as a stub; `mcp-setup.md` covers fetching the real
payload.

**Zero documents or a permission error is terminal** — report it per the access
guidance in `resolve-engagement.md` and stop. **Do not write the record**: an access
failure isn't a real state worth saving as a baseline for future comparisons.

---

## Step 4 — Compare

Build an `id → state` lookup (plus `name`, for reporting) from Step 3 and compare it
against the saved `documents` map from Step 2:

- **New** — `id` present now, absent from the record.
- **Changed** — `id` in both, but `state` differs.
- **No longer there** — `id` in the record, absent now. It may have been recategorised
  into a different area, or removed. Don't guess which; just say it no longer appears
  here.

**No prior record** — nothing to compare. Tell the caller this is the first check for
this fund, year and area, that you've saved today's list as the starting point, and
skip to Step 5.

---

## Step 5 — Report, then save

Lead with the fund, year and area in one line, then:

- **First check:** "First check for this fund and year — I've noted the 312 documents
  that are there today. Ask again later and I'll tell you what's changed."
- **Nothing changed:** say exactly that, in one line. Don't pad it with a document
  dump.
- **Something changed:** counts first, then the detail —

> **3 new, 1 changed, 0 removed** since your last check.
>
> **New**
> - *Q4 capital call notice.pdf* — Partners' Equity
> - *2025 audit confirmation.pdf* — General
> - *Series C purchase agreement.pdf* — Investments
>
> **Changed**
> - *Q3 management fee invoice.pdf* — now ready (was still processing)

Describe state changes in the auditor-facing language from `audit-areas.md` — "now
ready", "now needs attention" — never as a raw enum transition.

Then **always** save the record per "Writing it" in `check-record.md`, whether or not
anything changed. Don't write it if Step 3 was terminal.

Ask what's next per the "Next-step question" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/next-step.md` (the plugin's own `references/`, not
this skill's; do not search for it), with these choices:

- **Download the new documents** — "The new and changed documents listed above".
  When nothing is new or changed, use **Download documents** — "The whole fund, or
  just the areas you pick" instead.
- **Done for now** — "I'll compare against today's check next time"

Route a download answer to `carta-investors:carta-audit-download`, passing the fund and
year through.

---

## Multiple funds, years, or areas

If the caller names more than one, resolve the funds with the "Several funds at once"
section of `resolve-engagement.md`, apply Step 1's year and area rules once for the
batch, then run Steps 2–5 once per combination, up to Step 5's question — each
keeps its own record and gets its own comparison. Report one summary per combination,
never a merged one, grouped under a heading per firm. Ask Step 5's question once, at
the end, after every combination is reported and its record saved; its download
choice covers every combination with new or changed documents.
