---
name: carta-audit-readiness
version: 0.1.0
description: >-
  Check whether a fund's audit documents are complete and ready to work, area by area
  — how many documents are ready, which are still processing, which need attention,
  and which areas have nothing filed. Use when someone asks "is this fund ready for
  audit", "what's missing for the audit", "do I have everything for the Partners'
  Equity audit", "which audit documents are still processing", "are the investment
  audit documents complete", or otherwise asks about the state of audit documents rather than asking to download them. Lists only — it never
  exports or downloads files; use carta-investors:carta-audit-download for that.
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
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py *)
  - mcp__visualize__read_me
  - mcp__visualize__show_widget
model: inherit
trigger-phrases:
  - "is this fund ready for audit"
  - "what audit documents are missing"
  - "do I have everything for the partners equity audit"
  - "what audit documents are still processing"
  - "are the investment audit documents complete"
  - "check audit readiness"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.56.22</carta-plugin>

# Audit readiness

Answer the question an auditor actually asks before they start a section: *do I have
everything, and if not, what's holding it up?*

This skill lists only. It never exports, downloads, or produces a zip — that's
`carta-investors:carta-audit-download`. Because it has no side effect, it's safe to
re-run as often as the caller likes.

## Voice

Write for an external auditor. Never show them a fund UUID, a task id, an `fa__*`
command name, the words "MCP" or "audit_area", or a raw `lifecycle_status` value.
Funds go by name, areas by their labels.

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
firm, fund and audit year. If an earlier audit skill (starting the audit, or a download) already
established them in this conversation, reuse them and don't re-ask. For more than one fund, use its
"Several funds at once" section.

**Scope.** If the caller named one area ("do I have everything for Partners' Equity"),
check that area only. If they asked about the fund generally, check all seven.

---

## Step 2 — List

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md` for the area table and the
readiness translation.

For each area in scope, all calls together rather than serially:

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__audit-documents",
  "arguments": {"fund_uuid": "<fund_uuid>", "audit_year": <audit_year>, "audit_area": "<audit_area>"},
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-readiness"]}
})
```

Rows are under `results`; a zero-row match is an envelope with `count: 0`. Take each
area's document count from `count`, not by counting rows yourself. If `has_next` is
true, re-run with `after` set to `next`.

Pass the area — the backend filters server-side, so a single-area question costs a
single-area call.

**If the fund itself isn't reachable** on the first call — "No Fund matches the given
query", a 404, or a fund-wide permission denial — stop the whole loop. Every other
area fails identically. Report it per the access guidance in `resolve-engagement.md`.

Once the fund is confirmed reachable, a failure on one area is that area's problem
only — note it and continue.

Oversize responses come back as a stub; `mcp-setup.md` covers fetching the real
payload.

---

## Step 3 — Answer

### Whole-fund scope

One row per area, then the bottom line:

| Audit area | Documents | Ready | Not yet ready |
|---|---|---|---|
| General | 312 | 312 | — |
| Cash | 0 | — | Nothing filed |
| Investments | 140 | 138 | 2 still processing |
| Partners' Equity | 1,090 | 1,090 | — |
| Income & Expenses | 87 | 85 | 1 needs attention, 1 draft |
| Financial Packages | 0 | — | Not published yet |
| Supplemental | 4 | 4 | — |

Follow it with a plain verdict — what's actually blocking, not a restatement of the
table:

> **4 of 7 areas are complete.** Three documents aren't ready: two in Investments are
> still processing and should clear on their own; one in Income & Expenses needs
> attention — Carta couldn't process it, so the fund may need to re-upload it. The
> fund hasn't published a financial package for 2025 yet.

If everything is ready, say so in one line and stop. Don't pad it.

### Single-area scope

Skip the table. Give the count, the verdict, and — when something isn't ready — name
the specific documents by their `name` field, since at this scope the caller can act
on individual files:

> **Partners' Equity — 1,090 documents, all ready.**

> **Income & Expenses — 87 documents, 85 ready.**
> - *Q3 management fee invoice.pdf* — needs attention, Carta couldn't process it · last updated in Carta 14 Oct 2026
> - *2025 admin expense summary.xlsx* — draft, not yet final · last updated in Carta 2 Oct 2026

Show each named document's last-updated date per the "Last updated in Carta" rules in
`audit-areas.md`.

Cap that list at 20 documents; past that, show the first 20 and say how many more
share each status.

---

## Step 4 — Offer the next step

Ask what's next per the "Next-step question" section of
`${CLAUDE_PLUGIN_ROOT}/references/audit/next-step.md` (the plugin's own `references/`, not
this skill's; do not search for it), with these choices:

- **Download these documents** — "The documents in this check"; route to `carta-investors:carta-audit-download`
- **Check what's new** — "Documents added or changed since your last check"; route to
  `carta-investors:carta-audit-whats-new`

Pass the fund and year through so neither re-asks.

---

## Multiple funds or years

Run Steps 2–3 once per fund and per year, reporting each separately under a heading
per firm, with each fund named as the "Naming funds when there are several" rules in
`resolve-engagement.md` say. Readiness is a per-period judgement — don't merge counts
across funds or years.
