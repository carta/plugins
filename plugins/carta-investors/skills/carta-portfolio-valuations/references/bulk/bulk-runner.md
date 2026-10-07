# Bulk Valuation Runner

Steps 3–7 of the portfolio valuations bulk path. Read this file when
entering bulk mode — either for a general portfolio run or a pre-selected
set of named companies. Creates draft valuations via `create:bulk` (new
drafts, and copy-from-previous for GPC).

---

## Step 3: Discover commands + render portfolio dashboard (bulk, many companies)

Used when the entry intent is general ("run all my valuations",
"review the portfolio") and there's no pre-selected company list.
Steps 3.1 and 3.2 (data load + table render) live in `SKILL.md` and are
shared with the bare-entry welcome flow. Access was already settled by
**Gate 1** on first invocation — do not re-check it here.

### Step 3.3: Present options, route by selection

The grouped portfolio dashboard from Step 3.2 (in `SKILL.md`) is now on screen. Print
a one-line bucket summary in prose, then suggest the two main paths as
plain text (same open-ended copy as `SKILL.md` Step 2.3).

#### Bucket summary (prose, one line)

Build dynamically from non-empty buckets only:

- Two buckets: `"**{N_eligible}** companies eligible — {N_draft} draft, {N_no_val} with no valuation."`
- One bucket: `"**{N_eligible}** companies eligible — {N_X} {label}."` 
- No buckets: `"**{firm_name}**'s eligible companies all have non-draft valuations."`

#### Suggest the two paths (plain text, open-ended)

After the bucket summary, suggest the two headline actions and leave the
prompt open, asked inline as plain text:

> What would you like to do next?
> - **Bulk-create draft valuations** — I'll open the runner to create drafts across the companies that need one (new and in-progress).
> - **Dive into one** — open a single company and work through it.
>
> Just tell me — or name specific companies. In `artifact` or
> `preview-server` mode, you can also say something like "reopen the
> runner" to bring back the bulk runner widget and pick companies and
> methods visually instead of typing names.

**Always offer the widget re-open option in this prompt** on every
platform where a widget path exists (`env_mode: "artifact"` or `"preview-server"` — see Step 2.2a's environment detection), not just
the first time the runner is shown in a session. A user asking for "a few more companies" after a run has
completed has no way to know the widget can be reopened unless the text
prompt reminds them each time — don't assume they'll remember from
earlier in the session.

Then route the free-text reply via the table below.

#### Intent routing

The reply is free text. Match on intent generously — the table below
covers the two headline paths and common freeform paraphrases.

| Reply intent | Action |
|---|---|
| Bulk-create (e.g. "bulk", "create drafts", "run them", "do the ones that need it") | All eligible companies → Step 3.4 confirm prose |
| "just the drafts", "work on drafts" | Draft bucket → Step 3.4 confirm prose |
| "the no-val ones", "run new valuations" | No-val bucket → Step 3.4 confirm prose |
| Dive into one (e.g. "dive in", "take a closer look") | Go to **Step 2.5 (dive into one)** in `SKILL.md` — ask which company in prose if not named |
| "pick specific companies", "let me choose", row numbers | Step 3.5 row-number picker |
| "run new for {name[, name…]}", "create one for Acme and BetaCo" | Filter no-val bucket to named matches → Step 3.4 confirm prose. If a name doesn't match an eligible no-val company, surface the mismatch and ask. |
| "everything", "all of them", "the whole portfolio" | All eligible companies → Step 3.4 confirm prose (no `isRollForward`; user can specify per-company in Step 4) |
| "reopen the runner", "show me the widget again" | `artifact` or `preview-server` mode only: reopen the **Plan card** — follow the **Plan card** section of `references/cowork-artifact.md` with the current eligible-company set (this is the explicit re-open case the "do not re-show unless asked" rule in that doc's "Refreshing after a run" section allows for). The card's **Adjust by company** button reaches the full list. |
| "let me pick in the UI", "customize the methods", "open the full list" | `artifact` or `preview-server` mode only: skip the Plan card and reopen the editable **Runner widget** list directly — follow the **Runner widget** section of `references/cowork-artifact.md` with the current eligible-company set |
| Mixed freeform (e.g. "add Zeta") | Pre-fill the bucket, append named matches, go to Step 3.4 confirm prose |
| Ambiguous or unclear | Ask one short clarifying prose question. |

If a freeform reply names a single eligible company, treat it as
**dive-in intent** — route to Step 2.5 (dive into one). If the named
company is in the no-val bucket and the user clearly wants to bulk-create
a valuation for just it, run the bulk runner on that one company instead.

If zero eligible companies match the expressed intent, surface the
mismatch and re-ask. Do not silently fall through to "all."

### Step 3.4: Confirm the picked list (prose loop)

Reached after Step 3.3 routes a bucket / mixed intent into a concrete
company list. Display the picked companies as a numbered list and ask
in prose:

Tailor the lead-in to the routed intent:

| Routed intent | Lead-in |
|---|---|
| Draft | "I'll reopen these **{N} draft valuations**:" |
| No-val (all) | "I'll start new valuations for these **{N} companies** (no prior valuation):" |
| No-val (filtered to named matches) | "I'll start new valuations for **{N} companies** you named:" |
| Mixed (e.g. draft + named additions) | "I'll work on these **{N} companies**:" |
| Everything | "I'll work on all **{N}** eligible companies:" |
| Pick specific (from Step 3.5) | "I'll work on these **{N} companies** you picked:" |

Then render the numbered list (one row per company, with last
valuation date or `— no prior valuation` as appropriate):

> 1. Acme Corp — last valued Mar 31, 2025
> 2. BetaCo — last valued Dec 31, 2024
> 3. GammaCorp — no prior valuation
>
> Reply **confirm** to proceed, or tell me which to add or remove
> (e.g. `remove 2` or `add Zeta`).

Wait for the user's free-text reply:
- **"confirm"** (or any clear affirmation) — proceed with the list as-is.
- **"add {name[, name…]}"** — match each name against the full
  eligible list (case-insensitive substring match); merge matches into
  the list. If a name is ambiguous (matches >1 eligible company) or
  doesn't match anything, surface the ambiguity and ask the user to
  disambiguate. Re-display the updated list and ask the same question
  again.
- **"remove N[, M…]"** — drop those row numbers from the current
  list, re-display, ask again.

Repeat until the user confirms.

Leave `isRollForward` off for all buckets (the per-company refresh check in Step 4.0 still runs
per company for `Run new` and "Pick specific" entries).

**Single-company check**: after the user confirms, if the final list
has exactly **1 company**, route to **Step 2.5 (dive into one)** before
proceeding to Step 4 — show the recap so the user can confirm bulk-create
is what they want vs. working on it directly. If the list has 2+
companies, skip Step 2.5 and go directly to Step 4.

### Step 3.5: Row-number resolution (when the user picks by hand)

Reached when Step 3.3's prose router detects a "pick by row number"
intent — e.g. "1, 3, 7" or "let me choose" or "I want specifics."
The grouped portfolio table is already rendered from Step 3.2 — do
**not** re-render it.

If the user hasn't yet provided row numbers, ask in prose:

> "Which companies should I work on? Pick numbers separated by commas
> (e.g. `1, 3, 7`), or `all`."

Resolve the row numbers against the numbered companies from Step 3.2.
Per Step 3.2, row numbers run as a **single sequence across the events
groups and the valuation groups** (Recent financing rounds / tender
offers / share transfers, plus Draft valuation, Final valuation, and No
valuation). The **No cap table access** and **No cap table** groups carry
no row numbers and are not pickable here. Each numbered entry holds
`corporationId`, `name`, and (later) the per-company config.

Then hand off to Step 3.4's confirm prose loop with the **"Pick
specific companies"** lead-in:

> "I'll work on these **{N} companies** you picked:"

The user can still `add`/`remove`/`confirm` from there.

If zero companies match the picked numbers, surface and stop.

### Valuation date

Ask the valuation date once for the entire run, inline as plain text.
Compute date shortcuts dynamically based on today. **All shortcut
options must be today or earlier — never future-date.** The four
"End of previous {period}" shortcuts are inherently in the past
because they're computed relative to today; just don't generate any
forward-looking option.

Ask (use "this valuation" if one company; "all valuations in this
batch" if many):

> **What date should this valuation be as of?**
> 1. **Today** — `{today's date}`
> 2. **End of previous month** — `{eom date}`
> 3. **End of previous quarter** — `{eoq date}`
> 4. **End of previous year** — `{eoy date}`
>
> Or tell me a specific date.

Wait for the reply.

**If the user picks one of options 1–4**: capture as
`runValuationDate` and proceed.

**If the user enters a custom date**: capture the entered value as
`runValuationDate` (YYYY-MM-DD).
Validate before proceeding:
- **Format check**: must be valid YYYY-MM-DD.
- **Future-date check**: must be today or earlier. If the user enters
  a future date, respond in prose with the next-valid-options:
  > "**{user's date}** is in the future. Today is **{today's date}**,
  > so the valuation date has to be today or earlier. Want to use
  > today, or pick a different date?"
  Then re-prompt with the four shortcut options + custom date.

If invalid for any reason, ask again in prose.

This date is applied to every company in the bulk request. Date conflicts
(a valuation already exists for a company on `runValuationDate`) are
handled by the API — any conflicts will appear as failures or skips in
the `call_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": {"workflowId": "<workflowId>"}})` response. Surface them in the Step 7 results.

---

## Step 4: Per-company approach configuration

For each picked company (in order), ask the approach before moving to
the next company. This builds the payload for the bulk call in Step 6 —
no API calls happen here yet.

### 4.1 Valuation date

The valuation date was captured once for the whole run in Step 3
(`runValuationDate`). Apply it to every company silently — do not ask
per company.

### 4.2 Approach

Ask inline as plain text:

> **{company name}** — which valuation approach?
> 1. **GPC** — Guideline Public Company method. Configure comps and
>    multiples in Carta afterwards.
> 2. **Manual EV** — Enter a known company value directly.
> 3. **Post-Money** — Use a recent financing round's post-money valuation.

Wait for the reply, then route by the answer below.

**If "GPC"**: set `valuationMethod = "GPC"`. No further questions.

**If "Manual EV"**: ask in prose — "What is the EV for **{company
name}**? (e.g. `15000000`)" Parse into `companyValue` (number). Set
`valuationMethod = "MANUAL_EV"`. Manual EV is the same methodology as
Custom Value (`other_indication_of_value`); the bulk API creates the
valuation but cannot set the value — it is applied separately after the
bulk run completes (Step 6.3), exactly like Custom Value.

**If "Post-Money"**: ask in prose — "What is the post-money value for
**{company name}**? (e.g. `25000000`)" Parse into `equityValueOverride`
(number). Set `valuationMethod = "POST_MONEY"`. Note: the bulk API
creates the valuation but cannot set the post-money value — that is
applied separately after the bulk run completes (Step 6.3).

Repeat for every company in the confirmed list. Once all companies have
an approach, proceed to Step 5.

---

## Step 5: Render initial state

Print a one-time run summary table before submitting the bulk request.
Wrap it in a fenced code block so it stands out visually from the surrounding chat:

```
# | Company        | Approach      | Status
--|----------------|---------------|--------
1 | Acme Corp      | GPC           | Pending
2 | BetaCo         | Manual EV     | Pending
```

For a single-company run, the table has one row.

---

## Step 6: Bulk execution

### Step 6.1: Submit the bulk request

Call `call_tool({"name": "portfolio_valuations__create__bulk", "arguments": {"items": [...]}})` with **one `items` entry per
company**. This is the real API contract — do not use the shape from
older drafts of this doc (`organizationId`/`companies`/`approach`/
`companyValue` at the top level does not exist on this command).

Every item carries its own `valuationDate` — apply the single date
captured in Step 3 (`runValuationDate`) to **every** item; the widget and
this flow only ever collect one date for the whole run, so this is just
copying the same value onto each entry, not a per-company ask.

```json
call_tool({
  "name": "portfolio_valuations__create__bulk",
  "arguments": {
    "items": [
      {
        "ownerId": "<ownerId>",
        "ownerKind": "FIRM",
        "targetId": "<corporationId>",
        "targetKind": "CORPORATION",
        "valuationDate": "<runValuationDate>",
        "methodology": "<gpc | dcf | asset | invested_capital | ma | post_money | backsolve | other_indication_of_value>"
      }
    ]
  }
})
```

- **`ownerId` and `targetId` must be strings, not integers or numbers.**
  Passing them as numbers (e.g. `"ownerId": 1` instead of `"ownerId":
  "1"`) fails validation with a `string_type` error for every affected
  item — cast both to strings even though the values you're carrying in
  context (org_pk, corporationId) are numeric everywhere else in this
  skill.
- Set **exactly one** of `methodology` or `copyFromPrevious: true` per
  item — never both. Use `copyFromPrevious: true` (and omit
  `methodology`) for the "Previous period" method; use `methodology`
  for every other method.
- **`methodology` keys are snake_case**, not camelCase — this does NOT
  match the camelCase field names on `portfolio_valuations:mutate:approaches`
  (`postMoney`, `otherIndicationOfValue`, `investedCapital`). Using the
  camelCase form fails with "Unknown methodology keys."
- **Approach → `methodology` key mapping**:

  | Widget method    | `methodology` key         |
  |------------------|----------------------------|
  | GPC              | `gpc`                      |
  | Backsolve        | `backsolve`                |
  | Post-Money       | `post_money`               |
  | Custom Value      | `other_indication_of_value` |
  | M&A              | `ma`                       |
  | (Manual EV, if offered outside the widget) | `other_indication_of_value` |

  The server also accepts `dcf`, `asset`, and `invested_capital`
  (unused by this skill's widget today). It additionally lists
  `pre_seed_benchmarking` and `mid_round_benchmarking` — these are
  deprecated relics, not real options; do not offer them and do not add
  them to this table.
- **The bulk API has no field for setting a value** (no `companyValue`,
  no `equityValueOverride`). This applies to **both** Post-Money and
  Custom Value — not just Post-Money. Both are submitted with only their
  `methodology` key; the actual number is always applied afterward, per
  company, in Step 6.3.

Capture the `workflowId` from the response (`{status: "submitted",
workflowId}`).

Tell the user:
> ⏳ Valuations are being created — this may take a moment…

### Step 6.2: Poll for completion

Call `call_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": {"workflowId": "<workflowId>"}})` every
**10 seconds** until the response indicates the run is complete.

```json
call_tool({
  "name": "portfolio_valuations__get__bulk_status",
  "arguments": { "workflowId": "<workflowId>" }
})
```

**Confirmed response shape** (verified against a live `completed` run):

```json
{
  "status": "completed",
  "workflowId": "<id>",
  "summary": { "created": 4, "errors": 1 },
  "results": [
    {
      "index": 0,
      "ownerId": "1",
      "targetId": "81",
      "status": "created",
      "projectId": 11,
      "candidateId": 12,
      "valuationId": 1589
    },
    {
      "index": 2,
      "ownerId": "1",
      "targetId": "235",
      "status": "error",
      "error": "OIP or conversion ratio is missing for share class \"Series A Preferred\""
    }
  ]
}
```

- `status` is `"pending"` while running, `"completed"` when done (no
  observed `"failed"` case yet — treat any unrecognized status as
  pending and keep polling, but don't poll past the 60-minute cap).
- Per-item results are keyed by `targetId` (string) and carry
  **`projectId`/`candidateId`** (camelCase, not the `project_id`/
  `candidate_id` used elsewhere in this doc and in every other
  `portfolio_valuations:mutate:*` command's params) — match on `targetId`
  to find each company's row, then pass its `projectId`/`candidateId`
  as `project_id`/`candidate_id` (the mutate commands' own param names)
  into Step 6.3.
- Failed items have `status: "error"` and an `error` message but no
  `projectId`/`candidateId` — there is nothing to follow up on for these;
  surface the `error` text directly in the Step 7 summary.
- **`created` doesn't always mean a new draft.** When the company already
  has a FINAL valuation on `runValuationDate`, a `copyFromPrevious` item can
  come back `created` with the ids of that existing final valuation. The
  bulk status doesn't say so. Only `get:valuation`'s `candidateStatus:
  "FINAL"` shows it (see Step 6.3's guard and `bulk-results.md`).

Poll using a background Bash loop:

```bash
uv run python -c "
import time, sys
# Signal file written by the skill when bulk is done
import pathlib
p = pathlib.Path('.claude/preview/bulk-status.json')
for _ in range(360):   # 60-minute hard cap
    time.sleep(10)
    print('POLL', flush=True)
    sys.exit(0)         # exit after each tick so the skill re-calls portfolio_valuations:get:bulk_status
print('TIMEOUT')
" &
```

Alternatively, run `call_tool({"name": "portfolio_valuations__get__bulk_status", "arguments": {"workflowId": "<workflowId>"}})` directly in a loop — call it,
check the status field, and if not yet complete wait 10 seconds and
call again. Repeat until:

- **Complete** — the response contains final results for all companies.
  Proceed to Step 6.3, then Step 7.
- **Timeout** (60 minutes elapsed with no completion) — surface an
  error and proceed to Step 7 with whatever partial results are
  available.
- **Error** returned by the API — surface the error message and stop.

While polling, print a brief update each time so the user knows the
run is in progress:

```
⏳ Still creating valuations… (checked {N}s ago)
```

### Step 6.3: Set values for Post-Money and Custom Value companies

After the bulk run completes, check whether any companies in the
confirmed list used the **Post-Money**, **Custom Value**, or **Manual
EV** method. If none, skip this step entirely. The bulk API set none of
these values (Step 6.1), so each needs its own follow-up call. **Manual
EV is Custom Value** — it uses the same `other_indication_of_value`
methodology and the same `mutate:custom_value` call below; treat a
`MANUAL_EV` company exactly like a Custom Value company here, passing its
captured `companyValue`. If you skip this, the valuation is left at $0
while the Step 7 summary claims a value was set.

**Backsolve is different — the project IS created, only the price is
not.** A Backsolve item in the bulk run **succeeds and creates the
valuation project** just like any other methodology; do not describe it
as failed, skipped, or "couldn't be created." What the bulk run does not
do is populate the Backsolve **transaction price** (and date/share
class) from the underlying event — and unlike Post-Money and Custom
Value, this skill has **no** API to set it either. So there is no
follow-up call here for Backsolve. Instead, render the company in the
Step 7 summary as **created** with a "set price in Carta" note (see Step
7) and, when the user asks about it, say the Backsolve valuation **was
created** and only its transaction price needs to be entered in Carta.
Never tell the user Backsolve "can't be created in bulk" or "can't be
created without a value" — that is false; only the price entry is
deferred to Carta.

For each **Post-Money** company that succeeded in the bulk run, call
`call_tool({"name": "portfolio_valuations__mutate__post_money", "arguments": {...}})`:

```json
call_tool({
  "name": "portfolio_valuations__mutate__post_money",
  "arguments": {
    "ownerId": "<ownerId>",
    "project_id": <projectId from bulk status>,
    "candidate_id": <candidateId from bulk status>,
    "equityValueOverride": <post-money value captured in Step 4.2 / the widget>
  }
})
```

For each **Custom Value** company — **and each Manual EV company** —
that succeeded in the bulk run, call
`call_tool({"name": "portfolio_valuations__mutate__custom_value", "arguments": {...}})`
(Manual EV and Custom Value are the same methodology, so both use this
call with their captured `companyValue`):

```json
call_tool({
  "name": "portfolio_valuations__mutate__custom_value",
  "arguments": {
    "ownerId": "<ownerId>",
    "project_id": <projectId from bulk status>,
    "candidate_id": <candidateId from bulk status>,
    "companyValue": <custom value captured in Step 4.2 / the widget>
  }
})
```

Print a status line for each:

```
`{Company}  → Setting post-money value...`
`{Company}  ✓ Post-money value  ($X)`
`{Company}  → Setting custom value...`
`{Company}  ✓ Custom value  ($X)`
```

On failure (after one retry): mark the company's row in the Step 7
summary with a note — `✓ Created · ❌ Value not set` — so the user knows
the valuation exists but needs the value set manually.

Skip any Post-Money, Custom Value, or Manual EV company that failed in
the bulk run — there is no project to update.

**Never write a value onto a final valuation.** Before the first write for a
row, call `get:valuation` for it. If `candidateStatus` is `FINAL`, the bulk
run handed back an existing final valuation (see Step 6.2), so skip the
write. The results then show that row as already final.

---

## Step 7: Bulk run results

Once Step 6.3's value writes have finished, read
`references/bulk/bulk-results.md` and follow it. That file builds the
**Bulk run results** view: a widget in `artifact` or `preview-server` mode, and a markdown table otherwise. It covers every row,
including failed ones (error text plus a **Fix in Carta** link) and
Backsolve rows (created, with a "set transaction price" note, never shown as
failures). It also handles the **Dive in** hand-off into Step 2.5.

Don't start it earlier. Built before Step 6.3 lands, Post-Money and Custom
Value rows would show a zero EV.
