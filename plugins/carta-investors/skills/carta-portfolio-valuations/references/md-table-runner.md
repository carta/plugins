# Portfolio Valuations — Markdown Table Runner

Interactive text-based alternative to the runner widget. Reached when the
user chooses "Markdown table" for the runner in `artifact` or `preview-server` mode, or any time
`mcp__visualize__show_widget` is unavailable. Produces a numbered draft run
plan, collects overrides in prose, confirms before touching the API, creates
valuations in **Draft** status only (no finalize step).

---

## Step 1: Fetch and normalise data

If `read_tool({"name": "portfolio_valuations__list__portfolio_dashboard", "arguments": {"organizationId": "<org_pk>", "page_size": 100, "raw": false}})` data is already in context from the current
session, re-use it — do not re-fetch.

Otherwise call `read_tool({"name": "portfolio_valuations__list__portfolio_dashboard", "arguments": {"organizationId": "<org_pk>", "page_size": 100, "raw": false}})` (all
pages, always `page_size: 100`) and merge the `companies` arrays.

## Step 2: Classify into buckets

Assign each company to the **first** matching bucket (priority order):

| Bucket | Condition |
|---|---|
| `newRound` | `hasCorpCapTable && latestValuation != null && newFinancingRound != null` |
| `draft` | `hasCorpCapTable && hasCorpCapTableAccess && latestValuation.status == "DRAFT"` |
| `final` | `hasCorpCapTable && hasCorpCapTableAccess && latestValuation.status == "FINAL"` |
| `noValuation` | `(hasCorpCapTable && hasCorpCapTableAccess && latestValuation == null) \|\| (isLlc == true && latestValuation == null)` |
| `noAccess` | `hasCorpCapTable && !hasCorpCapTableAccess` |

Companies with `hasCorpCapTable == false` (and `isLlc == false`) are excluded entirely — no row, no count.

---

## Step 3: Suggest a default approach per company

For each company in buckets `newRound`, `draft`, `final`,
and `noValuation`, derive a suggested approach using the
priority order below. Never suggest for `noAccess` companies.

**Priority order:**

| Priority | Condition | Suggested approach |
|---|---|---|
| 1 | Company has one or more events (`newFinancingRound`, `newTenderOffer`, `newShareTransfer`) | Determined by the event with the **latest date** — see event date comparison rules below |
| 2 | `draft` bucket (no events) | Carry forward the existing draft approach (display label, no copy flag) |
| 3 | `final` bucket (no events) | Carry forward existing approach (display label) |
| 4 | `noValuation` bucket | _(blank — ask user)_ |

**Event date comparison rules (Priority 1):**

Compare the dates of every event present on the company. Use the one with the latest date to select the approach. If dates tie, financing round takes precedence over secondary market events.

| Event | Date field to compare | Suggested approach |
|---|---|---|
| `newFinancingRound` | `closingDate` (fall back to `initialClosingDate`) | **Post-Money** — pre-fill EV from `newFinancingRound.postMoney` |
| `newTenderOffer` | `date` | **Backsolve** |
| `newShareTransfer` | `date` | **Backsolve** |

**Backsolve caveat (accuracy):** the runner **can** create a Backsolve
valuation project — it simply does not auto-populate the Backsolve
transaction price from the event (that is entered in Carta afterward).
Never tell the user Backsolve "can't be created in bulk" or "requires a
value first"; only the transaction price entry is deferred to Carta.

**API approach name → display label mapping:**

| API value | Display label |
|---|---|
| `gpc` | GPC |
| `ma` | M&A |
| `dcf` | DCF |
| `backsolve` | Backsolve |
| `other_indication_of_value` | Custom Value |
| `post_money` | Post-Money |
| _(any other / null)_ | — |

`latestValuation.approaches` may be an array or a single string. If an
array, use the first non-null entry. Display label is derived from the
mapping above; if the value is unrecognised, show it as-is.

---

## Step 4: Render the table

Print a brief attention note **above the table** for every company that has at least one event.
List **all events** present on the company, then state the recommended approach and which event drove it.

Format (one line per company):
- *"{Company} — {event list} → **{Approach}** (latest event: {event type}, {date})"*

Event list examples:
- Single event: *"new financing round ($243.7M)"*
- Multiple events: *"new financing round ($243.7M) + tender offer (2026-03-15) + share transfer (2026-04-01)"*

Examples:
- *"IMIM [C] — new financing round ($62.5M) → **Post-Money** (latest event: financing round, 2018-03-02)"*
- *"Meetly [C] — tender offer (2020-01-10) + share transfer (2020-02-15) → **Backsolve** (latest event: share transfer, 2020-02-15)"*
- *"Acme Corp — new financing round ($50M) + tender offer (2026-04-01) → **Backsolve** (latest event: tender offer, 2026-04-01)"*

Skip the attention note section entirely if no company has any events.

Then render **two labelled sections**:

### Existing valuations

Companies in buckets `newRound`, `draft`, `final` — sorted: draft/new-round newest `latestValuation.date`
first, then the rest alphabetically.

| # | Company | Last Val. Date | Status | Suggested Approach | Suggested Date |
|---|---|---|---|---|---|

Columns:
- **#** — row number (runs as one sequence across both sections)
- **Company** — suffix `[C]` if `isCartaCompany == true` (e.g., `MangoCart, Inc. [C]`)
- **Last Val. Date** — `latestValuation.date` formatted `YYYY-MM-DD`
- **Status** — `Draft` or `Final`
- **Suggested Approach** — display label from Step 3. For Post-Money rows show the pre-filled EV inline: `Post-Money ($243.7M)`. For copy-from-previous rows show: `GPC (copy)` (or whichever approach + copy). Blank cell if no suggestion.
- **Suggested Date** — today's date as default (`YYYY-MM-DD`)

### No valuation

Companies in the `noValuation` bucket — sorted alphabetically.

| # | Company |
|---|---|

Row numbers continue from the "Existing valuations" section.

Omit a section entirely if it has no rows. Omit `noAccess` companies from both sections; add a note at the bottom: *"{N} companies excluded — cap table access required."*

---

## Step 5: Invite confirmation

After the table, output:

> To run, tell me which rows and any overrides — e.g. *"run 1–4, keep the suggestions"* or *"run 2 and 3 with GPC, skip the rest."*
> You can also override the date for any row: *"run 1 as of 2026-03-31."*

Wait for the user's reply before proceeding.

---

## Step 6: Parse the response

From the user's reply, extract:

- **Companies to run** — by row number, name, range (`1–4`), or description
  (`"everything"`, `"the new rounds"`, `"the drafts"`). Resolve against
  the rendered table.
- **Approach overrides** — explicit approach names or synonyms. Map
  directly to the `methodology` key `create:bulk` expects (Step 8 uses
  these verbatim — snake_case, not the display label): "manual", "manual
  EV", "custom" → `other_indication_of_value`; "post-money", "PM" →
  `post_money`; "backsolve", "BS" → `backsolve`; "GPC" → `gpc`; "M&A" →
  `ma`; "DCF" → `dcf`. For a row from the **Existing valuations** section
  where the user accepts the suggested "(copy)" approach as-is (no
  override), there is no `methodology` key at all — mark it
  `copyFromPrevious: true` instead (see Step 8.1).
- **Date overrides** — per-company or global. Must be today or earlier;
  if the user specifies a future date, refuse and ask again.
- **EV overrides** — explicit company value amounts (`"run 1 with EV $50M"`).
  Parse with B/M/K suffix support. These apply only to Post-Money, Custom
  Value, and Manual EV rows — `create:bulk` has no field for the value
  itself, so overrides captured here are applied in Step 8.3, after the
  bulk create completes.

If a company has **no approach** (blank suggestion, no override specified),
ask one focused clarifying question before proceeding:

> *"Which approach for **{company name}**? Options: GPC, Manual EV, Post-Money, Backsolve, M&A, DCF, Custom Value."*

Do not ask more than one clarifying question per reply round — gather all
missing approaches in a single numbered list if more than one company needs it.

---

## Step 7: Echo the plan and confirm

Print a numbered list of exactly what will be run, wrapped in a fenced
code block so it stands out visually from the surrounding chat. Follow it
with the confirmation prompt outside the block:

```
Here's what I'll create — all as Draft:

1. Acme Corp      — GPC,              as of 2026-03-31
2. BetaCo         — Post-Money ($243.7M), as of 2026-03-31
3. GammaCorp      — Manual EV ($15.0M),  as of 2026-03-31
```

Type **"yes"** / **"go"** / **"looks good"** to start, or tell me any last changes.

Do **not** proceed until the user gives a clear affirmation.

---

## Step 8: Execute — Draft only

**Whenever more than one company is being created, this MUST go through
`create:bulk` as a single call — never loop `create:project` per company.**
This is a non-negotiable rule across the whole skill, not just this
reference: one confirmed company → the single-company create call in
`create-val.md` is fine; two or more confirmed companies → always
`create:bulk`, no exceptions. `create:bulk` already supports everything
this reference needs per-row (its own `methodology`/`copyFromPrevious`
and `valuationDate` are set independently per item), so there is no
overrides gap that would justify falling back to individual creates.

### Step 8.1: Submit the bulk request

Call `call_tool({"name": "portfolio_valuations__create__bulk", "arguments": {"items": [...]}})` with **one `items` entry per confirmed company**:

```json
call_tool({
  "name": "portfolio_valuations__create__bulk",
  "arguments": {
    "items": [
      {
        "ownerId": "<org_pk>",
        "ownerKind": "FIRM",
        "targetId": "<corporation_id>",
        "targetKind": "CORPORATION",
        "valuationDate": "<YYYY-MM-DD, per-row per Step 6's date overrides>",
        "methodology": "<gpc | dcf | asset | invested_capital | ma | post_money | backsolve | other_indication_of_value>"
      }
      // one entry per confirmed row
    ]
  }
})
```

- **`ownerId` and `targetId` must be strings**, not integers — passing
  numbers fails validation with a `string_type` error for every item.
- Set **exactly one** of `methodology` or `copyFromPrevious: true` per
  item, never both. Use `copyFromPrevious: true` (and omit `methodology`)
  for an Existing-valuations row where the user kept the suggested
  "(copy)" approach as-is; use `methodology` for every other row,
  including every No-valuation row (there is nothing to copy from).
- **`methodology` keys are snake_case** (`gpc`, `backsolve`, `post_money`,
  `other_indication_of_value`, `ma`, `dcf`) — this does **not** match the
  camelCase field names on `portfolio_valuations:mutate:approaches`. Using
  the camelCase form fails with "Unknown methodology keys." Manual EV and
  Custom Value both map to `other_indication_of_value`.
- **The bulk API sets no value** — no `companyValue`, no
  `equityValueOverride`, for either Post-Money or Custom Value/Manual EV.
  The number captured in Step 6/7 is applied afterward, per company, in
  Step 8.3.
- **Backsolve creates fine** — the project is created just like any other
  methodology; only the transaction price is left for Carta. Never
  describe a Backsolve row as failed or skipped because of this.

Capture the `workflowId` from the response (`{status: "submitted",
workflowId}`). Tell the user:
> ⏳ Valuations are being created — this may take a moment…

### Step 8.2: Poll for completion

Call `read_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": {"workflowId": "<workflowId>"}})`
every **10 seconds** until complete:

```json
{
  "status": "completed",
  "workflowId": "<id>",
  "summary": { "created": 4, "errors": 1 },
  "results": [
    { "index": 0, "ownerId": "1", "targetId": "81", "status": "created", "projectId": 11, "candidateId": 12, "valuationId": 1589 },
    { "index": 2, "ownerId": "1", "targetId": "235", "status": "error", "error": "..." }
  ]
}
```

- `status` is `"pending"` while running, `"completed"` when done — treat
  any unrecognized status as pending and keep polling, up to a 60-minute
  cap.
- Per-item results are keyed by `targetId` (string) and carry
  **`projectId`/`candidateId`** (camelCase) — match each result to its
  company by `targetId`, then pass `projectId`/`candidateId` as
  `project_id`/`candidate_id` into Step 8.3.
- Failed items have `status: "error"` and an `error` message but no
  `projectId`/`candidateId` — surface the `error` text directly in the
  Step 10 summary; there's nothing to follow up on.

While polling, print a brief update each time so the user knows the run
is in progress: `⏳ Still creating valuations… (checked {N}s ago)`.

- **Complete** — proceed to Step 8.3.
- **Timeout** (60 minutes, no completion) — surface an error and proceed
  to Step 10 with whatever partial results are available.
- **Error** returned by the API — surface the error message and stop.

### Step 8.3: Set values for Post-Money, Custom Value, and Manual EV rows

After the bulk run completes, check whether any confirmed rows used
Post-Money, Custom Value, or Manual EV. If none, skip this step. **Manual
EV is Custom Value** — same `other_indication_of_value` methodology, same
call below, using the captured `companyValue`. Skip any such row that
failed in the bulk run (`status: "error"`) — there's no project to update.

For each **Post-Money** row that succeeded:
```json
call_tool({
  "name": "portfolio_valuations__mutate__post_money",
  "arguments": {
    "ownerId": "<org_pk>",
    "project_id": <projectId from bulk status>,
    "candidate_id": <candidateId from bulk status>,
    "equityValueOverride": <post-money value captured in Step 6/7>
  }
})
```

For each **Custom Value / Manual EV** row that succeeded:
```json
call_tool({
  "name": "portfolio_valuations__mutate__custom_value",
  "arguments": {
    "ownerId": "<org_pk>",
    "project_id": <projectId from bulk status>,
    "candidate_id": <candidateId from bulk status>,
    "companyValue": <custom value captured in Step 6/7>
  }
})
```

On failure of this follow-up call (after one retry), mark the row in the
Step 10 summary as `✓ Created · ❌ Value not set` rather than a full
failure — the valuation project itself still exists.

**Checklist items 1–5** from the main SKILL.md still apply per company
(cap table, financials, approach inputs, company value, holdings value).
**Item 6 (FINAL status) is intentionally omitted** — do NOT call any
finalize or status-update mutation. Leave every valuation in Draft.

---

## Step 9: Refresh the dashboard artifact

Do this **after Step 8.3 has finished**, before printing the Step 10 summary.
Refreshing at Step 8.2 (`get:bulk_status` → `completed`) is too early: the bulk
API creates the projects but sets no values, so a dashboard built at that point
bakes in a snapshot taken before Step 8.3's Post-Money and Custom Value writes
land, and every one of those rows renders as `—`.

If the session flag `dashboard_artifact_url` is set, follow the
**"Refreshing after a run"** section of `references/cowork-artifact.md` (in this
skill's own `references/`, not the plugin root's) and republish. If the flag is
not set, no dashboard was published this session — skip to Step 10.

This is not an offer. Do not ask the user whether to refresh, and do not skip it
because the Step 10 summary already lists what changed — the summary is chat
text, while the artifact is the surface the user actually reads. Refresh
silently; narrating the steps is noise.

**Then verify the republish took.** A redeploy of an unchanged payload returns
success and silently leaves the old data in place, which looks identical to a
real refresh. Pick one company that Step 8.3 confirmed, find it in the payload
you just built, and check its `latestValuationDate` equals the run's valuation
date. If it still carries the pre-run date, the refresh used a stale payload —
re-fetch `list:portfolio_dashboard` and rebuild before continuing.

---

## Step 10: Finish

Read `references/bulk/bulk-results.md` and follow it, using the **markdown
fallback**. The user picked the text runner, so the results stay in text too.
That file builds the **Bulk run results** table from the `get:bulk_status`
results (Step 8.2), after this runner's Step 8.3 follow-ups. The table has
one row per confirmed company: EV, holdings value, selected methodology,
required inputs missing, allocation status, and a link to Carta. It also
handles the "dive into {company}" hand-off into Step 2.5. A Backsolve row is
a success, not a failure. A row whose Step 8.3 value write failed is marked
`Value not set`, not failed.

Then remind the user:

> All valuations are in **Draft** status. Review them in Carta and finalize
> when ready.
