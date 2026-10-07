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
> Edits go through the Carta UI via the deep link at the end. The
> `mutate:cap_table` command exists but its schema is not yet
> documented — promote to read+write in a future revision when the
> schema is published.

> **c-corp only — scenario-bound, not source-of-truth.** A `CORPORATION`
> valuation candidate stores its own copy of the cap table. If the user
> changed the cap table in Carta after this candidate was created, that
> stored copy may be stale. To compare against the live cap table, point
> them at the deep link.
>
> **This caveat does not apply to the LLC path.** An LLC valuation
> stores no cap-table snapshot, so there is nothing that can go stale —
> the LLC read is always live. Never tell the user an LLC cap table
> "isn't scenario-bound yet", and never imply it becomes scenario-bound
> once a valuation exists. It does not.

## UX Rules

When presenting 5 or fewer choices, always ask inline as plain text with
numbered options (no `AskUserQuestion` — see the main skill's UX Rules).

## User-Facing Output Rules

Do not surface raw command names, API field names, HTTP status codes, or
numeric project/candidate IDs in chat. Speak in business terms ("share
class", "outstanding shares", "ownership %"). The rendered cap table
itself is the artifact and may include numeric values, share-class names,
and stakeholder names — that's expected output.

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
projects does not block this flow and is not an error — it just means
the holding has no valuation yet.

**Ignore the gateway's empty-response warning here.** A zero-project
`list:projects` comes back with a generic MCP warning along the lines of
*"EMPTY RESPONSE … Any values you derive from this gap are BEST EFFORT —
flag this clearly to the user."* That warning is emitted for every empty
response and is **wrong for this flow** — on the LLC path the cap table
does not come from `list:projects` at all, so nothing downstream is
"best effort" and no data is missing. Do **not** surface it, do not
caveat the cap table as incomplete or provisional, and do not treat it
as a reason to ask for a valuation project. The LLC read that follows is
complete and authoritative on its own.

### `CORPORATION` also needs (candidate-scoped)

- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- `targetId` and `valuation_id` — for the deep link.
- The company name and the candidate's valuation date — for the header.

If any of these are missing, ask the user to pick a valuation row from
the orchestrator's drill-down list first.

### `LLC_ISSUER` also needs (issuer-scoped)

Nothing beyond what the underlying command itself takes:

- `issuerId` — the LLC issuer id. This is `target.id` when a project
  exists and the dashboard's `llcIssuerId` when one doesn't; they are
  the same value.
- The company name — for the header.
- `asOfDate` is **optional** — omit it for the latest cap table.

**A valuation project is not a prerequisite on the LLC path.** Do not
gate the LLC read on a candidate, and do not ask the user to pick a
valuation row before rendering an LLC cap table. The issuer id alone is
sufficient, and an LLC holding with no valuation at all is a normal,
fully supported case — not a degraded one.

---

## Step 0: Branch by target type

Cap tables are fetched with a different command depending on the
holding's `target.kind` (from context — see Prerequisites):

- **`CORPORATION`** (c-corp) → continue with **Steps 1–4** below
  (candidate-scoped `cap_table_summary` / `cap_table`).
- **`LLC_ISSUER`** (next-gen LLC) → skip Steps 1–4 and follow the
  **LLC path** section instead (issuer-scoped `llc_cap_table_summary`).
  Take this path whether or not the holding has a valuation project —
  the LLC read never depends on one.
- **`LLC_ENTITY`** → you should never get here: the orchestrator stops
  this deprecated target kind upstream, at SKILL.md Step 2.5a, with its
  own message. If you somehow arrive with one anyway, fetch **nothing**
  and hand back to that gate rather than inventing a second wording for
  the same condition.

---

## Step 1: Fetch the per-class summary (c-corp)

Call:

```json
call_tool({
  "name": "portfolio_valuations__get__cap_table_summary",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

This returns aggregated totals per share class. **Do this silently** —
do not narrate the call.

If this call returns empty (no share classes), the candidate's cap table
hasn't been populated yet. Surface a plain-language fallback:

> "I don't see any cap table data on the **{candidate name}** scenario
> for **{company name}**. Open this valuation in Carta to populate it:
> {DEEP_LINK}"

Then return to the orchestrator's routing.

If the call fails (non-empty error), retry once. If it fails again,
surface a plain-language fallback (no status code):

> "Couldn't load the cap table right now. Try again in a moment, or
> {DEEP_LINK}."

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
> 2. **Edit in Carta** — render the deep link and point out that cap
>    table edits happen in the UI for now.
> 3. **Looks good — what's next?** — return to the orchestrator's
>    Step 6 routing. In a walk-through after a fresh create, the next
>    unfinished item on the End Goal checklist (likely
>    financials-review) is offered. In lateral-entry mode, just stop
>    and let the user drive.

Wait for the reply, then route accordingly. If only the share-class
summary is shown and the user picks "Looks good," do not push them
toward the holder detail.

## Step 4: Per-holder detail (only if requested)

Call:

```json
call_tool({
  "name": "portfolio_valuations__get__cap_table",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>
  }
})
```

This returns the full cap table including individual holders and their
share counts. **Do this silently.**

Render as a markdown table with these columns:

| Stakeholder | Share Class | Shares | Ownership % |
|---|---|---|---|
| {holder name} | {class name} | {N} | {x.xx%} |

If there are more than 20 rows, render the top 20 by share count
(descending), then add a one-line note:

> Showing top 20 of {total} holders. {DEEP_LINK}

After the table, offer:

> "Anything else with the cap table?"
> 1. **Edit in Carta** — render the deep link.
> 2. **Move on** — return to the orchestrator.

## LLC path (`LLC_ISSUER`)

Reached from Step 0 when `target.kind == "LLC_ISSUER"`. Next-gen LLCs
have no corp cap table — the c-corp commands above return an error for
them. Fetch the issuer-scoped LLC summary instead.

**This is a live read of the issuer, not a valuation artifact.** It is
not scoped to a candidate, it does not require one, and it returns the
same data whether the holding has zero valuations or ten. Everything in
this section holds in all of those cases.

### LLC Step 1: Fetch the LLC cap table summary

Call (silently — do not narrate). The minimal call is just the issuer:

```json
call_tool({
  "name": "portfolio_valuations__get__llc_cap_table_summary",
  "arguments": {
    "issuerId": <issuerId>
  }
})
```

- `issuerId` — the LLC issuer id (`target.id` from `list:projects`, or
  the dashboard's `llcIssuerId`; same value). This is the **only**
  required argument.
- `asOfDate` — **optional**, and omitted by default:
  - **No valuation project, or the user simply asked for "the cap
    table"** → omit it. The server returns the latest cap table. This is
    the common case.
  - **Working inside a valuation candidate** → pass that candidate's
    valuation date, so the view lines up with the valuation in progress.
  - **The user asked for a historical view** ("cap table as of
    2024-12-31") → pass their date.

  When passed, it must be a **full ISO-8601 timestamp**
  (`YYYY-MM-DDT00:00:00Z`), never a bare `YYYY-MM-DD`.

  Passing `asOfDate` does **not** make the result scenario-bound — it is
  still a live read, just filtered to a date.

Empty response (no interest types) → the LLC's cap table hasn't been
populated in Carta. Surface a plain-language fallback and return to the
orchestrator's routing:

> "I don't see any cap table data for **{company name}**. Open it in
> Carta to populate it: {DEEP_LINK}"

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

Do **not** describe an LLC cap table as a "snapshot" of a valuation, and
do not add a note explaining that it "isn't scenario-bound yet" — that
framing is c-corp-only and is wrong here (see the callout at the top of
this file). If the holding has no valuation project, that is worth one
plain sentence only if it is relevant to what the user asked next — it
is not a caveat on the cap table itself.

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
> 3. **Edit in Carta** — render the deep link; LLC cap-table edits happen
>    in the UI.
> 4. **Looks good — what's next?** — return to the orchestrator's routing.

### LLC Step 4: Holder list (only if requested)

The summary already carries `holders[]` — no second call. Render:

| Holder | Group | Outstanding | Fully Diluted |
|---|---|---|---|
| {holderName} | {holderGroup} | {N} | {N} |

If there are more than 20 rows, render the top 20 by outstanding
(descending), then: `Showing top 20 of {total} holders. {DEEP_LINK}`.

## Edit fallback

If at any point the user asks to edit the cap table ("change the share
count", "add a new class", "fix the ownership %"), do not attempt the
edit. Surface a plain-language redirect:

> "Cap table edits aren't supported here yet — make changes in Carta
> and the next time we run this skill, the updates will show. {DEEP_LINK}"

## Deep link

See [`references/deep-link.md`](../deep-link.md) for URL construction.
Use **Pattern B** with `{tab}` = `cap-table`. Required context:
`ownerId`, `targetId`, `valuation_id`. Render per deep-link.md Step 5 (a markdown link).
For `LLC_ISSUER` targets, `targetId` is the LLC issuer id, and Pattern B
has its own LLC template — deep-link.md branches on the target kind, so
take the URL from there rather than adapting the c-corp one.

**When the holding has no valuation project** — routine on the LLC path
— neither Pattern B (needs `valuation_id`) nor Pattern A (needs
`project_id`) can be constructed. Follow deep-link.md's **When a pattern
can't be built** section: it lands the user on the firm's portfolio page.
Say plainly that a direct cap-table link isn't available because the
holding has no valuation yet.

## Goal-checklist contribution

**On the c-corp path only**, cap-table-review contributes to **End Goal
item 1: Cap table data is present**. The contribution is automatic and
API-derived — once
`call_tool({"name": "portfolio_valuations__get__cap_table_summary", "arguments": {...}})`
returns a non-empty response, item 1 is satisfied. The user does not need
to confirm. If it returns empty, item 1 stays unsatisfied and the
orchestrator's walk-through keeps surfacing this step until the cap table
is populated in Carta.

**On the LLC path, item 1 does not apply — this flow contributes nothing
to it.** The LLC cap table is live issuer data, not part of any
candidate, so its contents are never a candidate-completeness criterion:
do not mark item 1 satisfied, and do not mark it missing either (see
SKILL.md item 1, where the LLC branch is N/A).

What a successful LLC read *does* prove is **access** — and that matters,
because a Niagara allocation reads the same cap table through the same
llc-core grant. So if the cap table rendered here, allocation is not
going to be blocked on access. That is a useful side effect to remember,
**not** a reason to call this flow as a preflight:
`references/dive-in/allocation.md` runs its own eligibility check
(Gate 0, via `get:configuration`), which reports both a missing
waterfall model and a cap-table access problem before prompting the
user for anything. Leave the check to it. If this read comes back
permission-denied, say so plainly and note that allocation can't run
until access is granted (see SKILL.md item 5).

If the user wants to run that allocation, route them to
`references/dive-in/allocation.md` — it resolves the available
methodologies from the valuation's own configuration and walks the user
through whichever one they pick.
