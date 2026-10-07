# Portfolio Valuation — Create (Bulk)

Create a new valuation candidate for one portfolio company. No prompts —
all inputs come from the orchestrator's context.

## User-Facing Output Rules

Do not surface raw command names, API payloads, HTTP codes, or numeric
project/candidate IDs in chat. Speak in outcomes ("Your **Q2 2026**
valuation is created…"). Backend mechanics stay internal.

## Prerequisites (from orchestrator context)

- `ownerId` — firm's org_pk integer
- `targetId` — portfolio company's `corporationId`; also used as the DWH
  filter in Step 4
- `companyName` — for user-facing confirmations and messaging
- `valuationDate` — captured in the up-front questionnaire and applied
  silently

## Step 1: Generate the valuation name

Build the name from the valuation date's quarter and year:

- Jan-Mar → `Q1`
- Apr-Jun → `Q2`
- Jul-Sep → `Q3`
- Oct-Dec → `Q4`

Example: valuation date `2026-05-15` → `Q2 2026`.

If a project with this name already exists for this company (visible
via `list:projects`), append a disambiguator: `Q2 2026 (auto-2)`.

## Step 2: Create

**If `isRollForward = true` (GPC path only)**, use
`call_tool({"name": "portfolio_valuations__create__project_from_copy", "arguments": {...}})`. This copies the approach config and comp
set from the previous project — no need to re-select comps:

```json
call_tool({
  "name": "portfolio_valuations__create__project_from_copy",
  "arguments": {
    "ownerId": <ownerId>,
    "ownerKind": "FIRM",
    "targetId": <targetId>,
    "targetKind": "CORPORATION",
    "valuationDate": "<YYYY-MM-DD>",
    "copyFromProjectId": <previousProjectId>
  }
})
```

**Otherwise** (fresh run, or Manual EV refresh), use
`call_tool({"name": "portfolio_valuations__create__bulk", "arguments": {"items": [...]}})` — even for a single company. Do not use `call_tool({"name": "portfolio_valuations__create__project", "arguments": {...}})`.

Use the **exact `items[]` shape defined in `bulk-runner.md` Step 6.1** —
it is the single source of truth for this payload. Do not hand-author a
different item shape here: each item carries `ownerId`, `ownerKind`,
`targetId`, `targetKind` (all strings), `valuationDate`, and **exactly
one** of `methodology` or `copyFromPrevious: true` — there is no
`candidateName` field on a `create:bulk` item.

After calling `call_tool({"name": "portfolio_valuations__create__bulk", "arguments": {"items": [...]}})`, you **must** poll `call_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": {"workflowId": <workflowId>}})`
before proceeding — never skip this step.

1. Capture `workflowId` from the `call_tool({"name": "portfolio_valuations__create__bulk", "arguments": {"items": [...]}})` response.
2. Call `call_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": { "workflowId": <workflowId> }})`
   every 8 seconds.
3. Repeat until the top-level `status` is `"completed"` or `"failed"`. Do not
   proceed to Step 3 until one of these terminal states is reached.
4. On `"completed"`: extract `project_id`, `candidate_id`, and `valuation_id`
   from the per-item result.
5. On `"failed"`: treat as a create error — apply the Error handling rules below.

### ⚠ `call_tool({"name": "portfolio_valuations__create__project_from_copy", "arguments": {...}})` copies data, not computation

The copied candidate will have `companyValue: 0` — that is expected.
The subsequent pipeline steps (`call_tool({"name": "portfolio_valuations__mutate__approaches", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, ...}})`, `call_tool({"name": "portfolio_valuations__mutate__financials", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "financials": [...]}})`,
`call_tool({"name": "portfolio_valuations__mutate__gpc_multiples_selection", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>, "multiples": [...]}})`
— all on `call_tool`, and each with required body fields; see the Tool
surface section in `SKILL.md` — plus `call_tool({"name": "portfolio_valuations__compute__allocation", "arguments": {"ownerId": <ownerId>, "project_id": <project_id>, "candidate_id": <candidate_id>}})`) run real analysis on the
new candidate and produce a non-zero company value. Do not treat the
post-copy `companyValue: 0` as a bug — it resolves after GPC analysis
and allocation run.

## Step 3: Capture IDs

From the response, extract and hold in context:
- `project_id`
- `candidate_id`
- `valuation_id` (the `valuationDetails.id`)
- `valuationName` (the candidate name) — for the summary

These flow into every subsequent step.

## Step 4: Fetch corporation profile from DWH (silent)

Call `call_tool({"name": "dwh__execute__query", "arguments": {"sql": "<query below>"}})` directly. Substitute `<corporationId>`
(the `targetId` from the orchestrator context).

```sql
SELECT corporation_name, corporation_description, website_url, ceo_name, corporation_id, corporation_uuid
FROM FUND_ADMIN.CORPORATION_BASIC_INFO
WHERE corporation_id = '<corporationId>'
LIMIT 1
```

Capture the first row into context as `dwh_profile`:

```
dwh_profile = {
  corporationId:   "<corporation_id from result>",
  corporationUuid: "<corporation_uuid from result>",
  description:     "<corporation_description>",
  website:         "<website_url>",
  ceo:             "<ceo_name>"
}
```

If the query fails or returns zero rows, set `dwh_profile = null` and
continue — downstream steps fall back gracefully. Do not fail the
company on a missing DWH profile.

## Error handling

- **404 / 500**: retry once. If still failing, mark this company as
  `❌ Failed at create: {short reason}` and return to the orchestrator
  for the next company.
- **Existing duplicate name**: bump the disambiguator and retry.

Do not surface raw status codes to the user.

## No deep link surfacing

The orchestrator surfaces the deep link in the per-company summary
(`summary.md`). This reference is silent on success — emission is
just a status update from the orchestrator (`Running: create…` →
`Running: approach…`).
