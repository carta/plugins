# Portfolio Valuation — Cap Table Review

Show the user the cap table behind a portfolio holding so they can
confirm it reflects what they expect before continuing.

**The two target kinds read from fundamentally different sources.** This
is the most important distinction in this file — most of the branching
below follows from it:

| `target.kind` | What you render | Scope |
|---|---|---|
| `CORPORATION` | the candidate's **stored snapshot** of the company's cap table, captured when the candidate was created | candidate-scoped |
| `LLC_ISSUER` | the LLC's **live** cap table, read straight from the issuer | issuer-scoped — no candidate involved |

> **Read-only for MVP.** This reference only renders the cap table.
> Edits happen on the valuation's page in Carta's valuations dashboard. The
> `mutate:cap_table` command exists but its schema is not yet
> documented — promote to read+write in a future revision when the
> schema is published.

> **c-corp only — scenario-bound, not source-of-truth.** A `CORPORATION`
> valuation candidate stores its own copy of the cap table. If the user
> changed the cap table in Carta after this candidate was created, that
> stored copy may be stale. To compare against the live cap table, point
> them at the valuation's page in Carta's valuations dashboard.
>
> **This caveat does not apply to the LLC path.** An LLC valuation
> stores no cap-table snapshot, so there is nothing that can go stale —
> the LLC read is always live. Never tell the user an LLC cap table
> "isn't scenario-bound yet", and never imply it becomes scenario-bound
> once a valuation exists. It does not.

The rendered cap table may show share counts, share-class names and
stakeholder names — that's expected output.

## Prerequisites

**Resolve the branch first, then check only that branch's inputs.** The
two paths have different requirements, and the LLC path needs far less.
Do not apply the c-corp requirements to an LLC target.

### Both paths need: the branch signal

`target.kind` — one of `CORPORATION`, `LLC_ISSUER`, `LLC_ENTITY`.
Resolve it from whichever source is available:

1. the `target` object on the resolved project from `list:projects`
   (available when the orchestrator's Step 2.5a found a project); or
2. the matched company's `isLlc` / `llcIssuerId` from
   `list:portfolio_dashboard` — `isLlc: true` means `LLC_ISSUER`.

**Source 2 is authoritative on its own.** `list:projects` returning zero
projects does not block this flow and is not an error — ignore the
gateway's empty-response warning (SKILL.md Step 2.5a).

### `CORPORATION` also needs (candidate-scoped)

- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- `targetId` and `valuation_id` — for opening its page in the dashboard MCP
  App.
- The company name and the candidate's valuation date — for the header.

If any of these are missing, ask the user to pick a valuation row from
the orchestrator's drill-down list first.

### `LLC_ISSUER` also needs (issuer-scoped)

- `issuerId` — the LLC issuer id. This is `target.id` when a project
  exists and the dashboard's `llcIssuerId` when one doesn't; they are
  the same value.
- The company name — for the header.

Do not ask the user to pick a valuation row first — an LLC holding with
no valuation is a normal, fully supported case.

---

## Step 0: Branch by target type

Cap tables are fetched with a different command depending on the
holding's `target.kind` (from context — see Prerequisites):

- **`CORPORATION`** (c-corp) → continue with **Steps 1–4** below
  (candidate-scoped `cap_table_summary` / `cap_table`).
- **`LLC_ISSUER`** (next-gen LLC) → skip Steps 1–4 and follow the
  **LLC path** section instead (issuer-scoped `llc_cap_table_summary`),
  whether or not the holding has a valuation project.
- **`LLC_ENTITY`** → you should never get here: the orchestrator stops
  this deprecated target kind upstream, at SKILL.md Step 2.5a, with its
  own message. If you somehow arrive with one anyway, fetch **nothing**
  and hand back to that gate rather than inventing a second wording for
  the same condition.

---

## Step 1: Fetch the per-class summary (c-corp)

Silently call `get:cap_table_summary`. It returns aggregated totals per
share class.

If this call returns empty (no share classes), the candidate's cap table
hasn't been populated yet. Surface a plain-language fallback:

> "I don't see any cap table data on the **{candidate name}** scenario
> for **{company name}**. You can populate it on the valuation's page in
> Carta's valuations dashboard."

Then return to the orchestrator's routing.

If the call fails (non-empty error), retry once. If it fails again,
surface a plain-language fallback (no status code):

> "Couldn't load the cap table right now. Try again in a moment, or
> check it on the valuation's page in Carta's valuations dashboard."

## Step 2: Render the per-class summary

Render the per-class summary as a markdown table with these columns:

| Share Class | Authorized | Outstanding | Fully Diluted | Ownership % |
|---|---|---|---|---|
| {class name} | {N} | {N} | {N} | {x.xx%} |

**Column logic** (mapped from the API response):
- **Share Class**: the class name.
- **Authorized**: total shares authorized for this class.
- **Outstanding**: total shares outstanding.
- **Fully Diluted**: outstanding plus convertibles, options, warrants
  treated as if exercised.
- **Ownership %**: fully-diluted percentage of the total cap table.

Format share counts with thousands separators (e.g. 1,234,567). Format
percentages to two decimals.

Below the table, render a one-line total:

> Total fully diluted shares: **{N}**

## Step 3: Offer follow-up actions

Ask inline as plain text:

> **What would you like to do next with the cap table?**
> 1. **Show me the holders** — proceed to Step 4 (per-holder detail).
> 2. **Edit in Carta** — say that cap table edits happen on the valuation's
>    page in Carta's valuations dashboard, and open it (SKILL.md **Page
>    navigation → Which page to open**).
> 3. **Looks good** — confirm what was reviewed and return control.

Wait for the reply, then route accordingly. If only the share-class
summary is shown and the user picks "Looks good," do not push them
toward the holder detail.

## Step 4: Per-holder detail (only if requested)

Silently call `get:cap_table`. It returns the full cap table including
individual holders and their share counts.

Render as a markdown table with these columns:

| Stakeholder | Share Class | Shares | Ownership % |
|---|---|---|---|
| {holder name} | {class name} | {N} | {x.xx%} |

If there are more than 20 rows, render the top 20 by share count
(descending), then add a one-line note:

> Showing top 20 of {total} holders.

After the table, offer:

> "Anything else with the cap table?"
> 1. **Edit in Carta** — say that cap table edits happen on the valuation's
>    page in Carta's valuations dashboard, and open it (SKILL.md **Page
>    navigation → Which page to open**).
> 2. **Move on** — return to the orchestrator.

## LLC path (`LLC_ISSUER`)

Reached from Step 0 when `target.kind == "LLC_ISSUER"`. Next-gen LLCs
have no corp cap table — the c-corp commands above return an error for
them. Fetch the issuer-scoped LLC summary instead; it returns the same
data whether the holding has zero valuations or ten.

### LLC Step 1: Fetch the LLC cap table summary

Call (silently — do not narrate). The minimal call is just the issuer:

```json
read_tool({
  "name": "portfolio_valuations__get__llc_cap_table_summary",
  "arguments": {
    "issuerId": <issuerId>
  }
})
```

- `issuerId` — the **only** required argument (see Prerequisites).
- `asOfDate` — **optional**, and omitted by default:
  - **No valuation project, or the user simply asked for "the cap
    table"** → omit it. The server returns the latest cap table. This is
    the common case.
  - **Working inside a valuation candidate** → pass that candidate's
    valuation date, so the view lines up with the valuation in progress.
  - **The user asked for a historical view** ("cap table as of
    2024-12-31") → pass their date.

  When passed, it must be a **full ISO-8601 timestamp**
  (`YYYY-MM-DDT00:00:00Z`), never a bare `YYYY-MM-DD`. It filters the
  live read to a date; it does not make the result scenario-bound.

Empty response (no interest types) → the LLC's cap table hasn't been
populated in Carta. Surface a plain-language fallback and return to the
orchestrator's routing:

> "I don't see any cap table data for **{company name}**. You can
> populate it in Carta."

**Permission denied → do not retry.** A 403 / access error is not
transient; retrying just fails again. Say plainly that access is missing,
and name the downstream consequence so the user knows why it matters:

> "You don't have access to **{company name}**'s cap table, so I can't
> show it — and an allocation for this holding won't run until that
> access is granted. Contact the company to grant access."

Any other error → retry once, then fall back to the same plain-language
wording as the c-corp path. Never surface a status code.

### LLC Step 2: Render the interest-type summary

Head the table with the company name and the firm, then state the
as-of basis in the words matching what you actually sent:

| What you sent | Header line |
|---|---|
| no `asOfDate` | `{company} — current cap table` |
| the candidate's valuation date | `{company} — cap table as of {date}` |
| a user-supplied historical date | `{company} — cap table as of {date}` |

Do **not** describe an LLC cap table as a "snapshot" of a valuation (see
the callout at the top of this file). If the holding has no valuation
project, that is worth one plain sentence only if it is relevant to what
the user asked next — it is not a caveat on the cap table itself.

The response is a per-interest-type rollup (not per-share-class). Render
`interestTypes[]` as a markdown table:

| Interest Type | Outstanding | Fully Diluted | Ownership % |
|---|---|---|---|
| {typeName} | {N} | {N} | {x.xx%} |

Column mapping (per `interestTypes[]` entry): **Interest Type** =
`typeName`; **Outstanding** = `outstandingQuantity`; **Fully Diluted** =
`fullyDiluted`; **Ownership %** = `fullyDilutedOwnershipPercentage`.

Below the type rows, add two more rows:
- **Equity plan pool** — from `equityPlanPool` (`fullyDiluted`,
  `fullyDilutedOwnershipPercentage`); leave Outstanding blank (`—`).
- **Grand total** (bold) — from `grandTotal` (same cell fields).

Format share counts with thousands separators; percentages to two
decimals. (If `view == "OVERVIEW_GROUPS"`, still render the
`interestTypes[]` rollup — groups are collapsed to the type rollup for
this view.)

### LLC Step 3: Offer follow-up actions

Ask inline as plain text:

> **What would you like to do next with the cap table?**
> 1. **Show me the holders** — proceed to LLC Step 4 (holder list).
> 2. **As of a different date** — enter a date for a historical snapshot
>    (re-runs LLC Step 1 with that `asOfDate`).
> 3. **Edit in Carta** — say that LLC cap-table edits happen on the
>    valuation's page in Carta's valuations dashboard (the company's page
>    when the holding has no valuation project), and open it (SKILL.md
>    **Page navigation → Which page to open**), with the ids from **Edit
>    fallback**.
> 4. **Looks good** — confirm what was reviewed and return control.

### LLC Step 4: Holder list (only if requested)

The summary already carries `holders[]` — no second call. Render:

| Holder | Group | Outstanding | Fully Diluted |
|---|---|---|---|
| {holderName} | {holderGroup} | {N} | {N} |

If there are more than 20 rows, render the top 20 by outstanding
(descending), then: `Showing top 20 of {total} holders.`

## Edit fallback

If at any point the user asks to edit the cap table ("change the share
count", "add a new class", "fix the ownership %"), do not attempt the
edit. Surface a plain-language redirect:

> "Cap table edits aren't supported here yet — make changes on the
> valuation's page in Carta's valuations dashboard and the next time we run
> this skill, the updates will show."

Offer to take them there, and open it only on a yes (SKILL.md **Page navigation → After an action, offer instead of moving**). For `LLC_ISSUER` targets, `companyId` is the LLC issuer id —
take it per `references/deep-link.md` **The ids the MCP App takes**. **When
the holding has no valuation project** — routine on the LLC path — there is
no `valuation_id`, so offer the **company** page instead.

## Goal-checklist contribution

**c-corp:** a non-empty `get:cap_table_summary` satisfies End Goal item 1
automatically; an empty one leaves it unsatisfied until the cap table is
populated in Carta.

**LLC:** item 1 is N/A (SKILL.md End Goal item 1). A successful read here
shows the user has cap-table access, which allocation also needs (item 5)
— but don't run this flow as an access preflight; `allocation.md` Gate 0
checks it.
