# Portfolio Valuation — Comparables (Guided)

Build or edit the **comparables** (peer companies) saved on a portfolio
valuation candidate. The user picks comps from three entry points:

1. **Browse industry suggestions** — start from a list of public
   companies in a chosen industry.
2. **Search by ticker or name** — find a specific public company
   (e.g. "Snowflake", "SNOW", "DataDog").
3. **Review what's already saved** — show the current comp set on
   this candidate, then optionally edit.

The comparables collection is approach-agnostic in the API — comps
tagged `isGpc: true` feed the GPC methodology — but this reference
only handles **GPC peers**. M&A transaction search will land in a
separate flow when its inputs are wired up.

Rendered tables show tickers, company names and enterprise values —
that's expected output.

## Prerequisites

You need a selected candidate:
- `ownerId`, `project_id`, `candidate_id` — for the API calls.
- `targetId` — for opening its page in the dashboard MCP App.
- The company name and (optionally) industry — to seed industry-comp
  suggestions and confirmation messages.

These should be in conversation context from the orchestrator
(`carta-portfolio-valuations`). If any are missing, route back to the
orchestrator and ask the user to pick a valuation row first.

If GPC is **not** enabled in approaches, this reference still works —
comps can be saved before deciding methodology, or imported
speculatively for a future GPC enablement. The reference does not gate
on GPC being enabled.

## Step 1: Ask what the user wants to do

Ask inline as plain text:

> **What would you like to do with comps?**
> 1. **Browse industry suggestions** — start from a list of public
>    companies in a chosen industry.
> 2. **Search by ticker or name** — find a specific public company
>    (e.g. "Snowflake", "SNOW", "DataDog").
> 3. **Review what's already saved** — show the current comp set on
>    this candidate, then optionally edit.
> 4. **Cancel** — return to the orchestrator's routing.

Wait for the reply, then route: option 1 to Step 2A, option 2 to
Step 2B, option 3 to Step 2C, option 4 back to the orchestrator's
routing.

If the user has already mentioned an intent in their request (e.g.
"add Snowflake", "show me SaaS comps", "what comps are saved?"), skip
the question and proceed directly with that intent.

## Step 2A: Browse industry suggestions

Triggered by Step 1 option 1, or when the user says "show me {industry}
comps".

### Step 2A.1: Pick an industry

**Before presenting choices, read
`${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/references/dive-in/industry-groups.json`.**
It contains the full list of valid industry groups, each with a
human-readable `api_value` (display string) and an `enum_name` (the
ALL_CAPS Python enum member), plus keyword synonyms. **Display and match
on `api_value`; pass `enum_name` to the API** — see `_meta.note` in that
file. Passing `api_value` to `get:industry_comparables` raises a lookup
error. Never show `enum_name` in chat.

If the user already named an industry in their request (e.g. "pull
biotech comps", "show me SaaS comps"), match their words against the
`keywords` array and resolve to the matching entry silently — skip the
question entirely and proceed to Step 2A.2 with that entry's `enum_name`.

Otherwise, render the `api_value` of every entry in `values[]` as a
numbered markdown list, in the order they appear in the file. Then ask:

> "Which industry should I pull suggestions from? Pick a number, or
> describe the industry in your own words and I'll match it."
>
> *(numbered list derived from industry-groups.json at runtime)*
>
> Or type **cancel** to return to the previous menu.

When the user replies, resolve their answer to an entry (hold its
`enum_name` for Step 2A.2):
- **Number** — use the corresponding entry from the list above.
- **Exact or near-exact name** — match directly on `api_value`.
- **Natural language / synonym** — match against the `keywords` array
  in `industry-groups.json`. If multiple entries match, pick the
  closest and confirm: "I'll use **{api_value}** — does that sound
  right?"
- **No match** — ask the user to pick a number from the list.

### Step 2A.2: Fetch suggestions

Call, using the resolved entry's **`enum_name`**:

```json
read_tool({
  "name": "portfolio_valuations__get__industry_comparables",
  "arguments": {
    "ownerId": <ownerId>,
    "project_id": <project_id>,
    "candidate_id": <candidate_id>,
    "industry": "<chosen entry's enum_name, e.g. GENERAL_SAAS>"
  }
})
```

**Do this silently.**

If the call returns zero rows, surface:

> "No industry comps found for **{industry}**. Try a different industry,
> or search by ticker instead."

Then re-prompt with Step 1.

If the call fails, retry once. If it fails again, surface a plain-
language fallback:

> "Couldn't pull industry suggestions right now. Try again in a moment,
> or search by ticker instead."

### Step 2A.3: Render and pick

Render returned suggestions as a markdown table:

| # | Ticker | Company | Industry | Enterprise Value |
|---|---|---|---|---|
| 1 | SNOW | Snowflake Inc. | General SaaS | 52.4B |
| 2 | DDOG | DataDog Inc. | General SaaS | 38.1B |

Format enterprise value with thousands separators and a B/M/K suffix
where natural, in the currency the comp row names (bare number when it
names none — SKILL.md § Currency default). Show "—" if not available.

If more than 30 rows, render the top 30 by enterprise value
(descending) and add:
> Showing 30 of {total} suggestions. Refine by industry to narrow
> further.

Then ask:

> "Which of these would you like to add to the comp set? You can pick
> numbers (e.g. '1, 3, 5'), names, or 'all'."

### Step 2A.4: Pull reference data for the picks

`get:reference_comparables` requires a `scenarioId` — the candidate's
standard scenario ID (`standardScenario.id` from `get:valuation`;
`gpc.id` from `get:approaches` is the same ID). If it's not already in
context, fetch `get:valuation`. Omitting `scenarioId` fails the call
outright.

For the picked tickers, call:

```json
read_tool({
  "name": "portfolio_valuations__get__reference_comparables",
  "arguments": {
    "tickers": ["SNOW", "DDOG", "..."],
    "scenarioId": <standardScenario.id>
  }
})
```

This returns financial metrics (revenue, EBITDA, multiples). **Do this
silently.** Capture the response — you'll need fields like
`company_name`, `business_description`, `ipo_date`, and
`enterprise_value` for the save in Step 2A.5.

If a ticker isn't found in the reference data, drop it from the save
list and tell the user once at the end:
> "Couldn't pull reference data for {dropped tickers} — they weren't
> added."

### Step 2A.5: Save the comp set

Proceed to **Step 4: Save**.

## Step 2B: Search by ticker or name

Triggered by Step 1 option 2, or when the user names a specific company.

### Step 2B.1: Get the search query

If the user already provided a name/ticker in their request, use it
directly. Otherwise:

> "What company are you looking for? You can use a name (e.g.
> 'Snowflake') or a ticker (e.g. 'SNOW')."

### Step 2B.2: Search tickers

Call:

```json
read_tool({
  "name": "portfolio_valuations__search__tickers",
  "arguments": {
    "query": "<user input>"
  }
})
```

**Do this silently.**

If zero results, surface:
> "No public companies match **{query}**. Try a different name or
> ticker."

Then re-prompt with Step 2B.1, or offer to return to Step 1.

### Step 2B.3: Render and pick

Render results as a markdown table:

| # | Ticker | Company | Exchange |
|---|---|---|---|

Then ask:

> "Which of these would you like to add? You can pick numbers, names,
> or 'all'. Pick 'none' to search again."

If the user picks none, re-prompt with Step 2B.1.

### Step 2B.4: Pull reference data

Same as Step 2A.4, for the picked tickers.

### Step 2B.5: Save

Proceed to **Step 4: Save**. Offer the user the chance to keep
searching or move on:

> "Anything else to add?"
> 1. **Search for another company** — re-prompt with Step 2B.1.
> 2. **Browse industry suggestions** — go to Step 2A.
> 3. **Save and continue** — proceed to Step 4.

## Step 2C: Review what's already saved

Triggered by Step 1 option 3, or when the user says "show me my comps",
"what's in the comp set?", etc.

### Step 2C.1: Fetch current

Silently call `get:comparables`.

### Step 2C.2: Render

Render as a markdown table, **filtered to `isGpc: true`** (M&A comps
are out of scope for this reference):

| # | Ticker | Company | Industry | EV | Added |
|---|---|---|---|---|---|

Show "—" for any column that's unavailable.

If zero GPC comps exist on this candidate, surface:
> "No GPC comps are saved on **{candidate name}** yet. Want to add
> some?"

Then route to Step 1 with options 1 and 2 highlighted.

### Step 2C.3: Edit

Ask inline as plain text:

> **What would you like to do?**
> 1. **Add more comps** — go to Step 1 (browse or search).
> 2. **Remove some** — follow up: "Which should I remove? You can pick
>    numbers." Capture the remove list.
> 3. **Looks good** — confirm the comp set and return control.

Wait for the reply, then route: option 1 to Step 1, option 2 to the
remove follow-up above, option 3 returns control.

If the user removes comps, build the new comparables list (current set
minus removed) and proceed to **Step 4: Save**.

If the user adds comps, the chosen Add path (industry or search) ends
at Step 4; the save will merge the new picks with the existing set.

## Step 4: Save the comp set

Call
`call_tool({"name": "portfolio_valuations__mutate__comparables", "arguments": {...}})`
with:

```json
{
  "ownerId": <ownerId>,
  "project_id": <project_id>,
  "candidate_id": <candidate_id>,
  "comparable_industry": "<industry enum_name, e.g. GENERAL_SAAS, if known>",
  "comparables": [
    {
      "ticker": "SNOW",
      "capiq_id": "<from reference data, if present>",
      "company_name": "Snowflake Inc.",
      "business_description": "<from reference data, if present>",
      "ipo_date": "2020-09-16",
      "enterprise_value": 52400000000,
      "isGpc": true
    },
    // ... one entry per comp in the new set
  ]
}
```

**Important — this is a full replacement, not an append.** `comparables`
is required, and the list passed in becomes the candidate's saved list. To
preserve existing comps, include them in the payload alongside any
additions; to remove comps, omit them.

When merging adds with existing (Step 2C scenario or after Step 2A/2B
landing on a candidate that already has comps), first call
`get:comparables` to get the current list, filter to `isGpc: true`,
union with the new additions (deduping by ticker), and pass the union.

**Always set `isGpc: true`** on entries written by this reference.
M&A comps stay out.

`comparable_industry` is optional — set it only when the user picked
an industry in Step 2A, and pass its `enum_name` (Step 2A.1).

When merging an industry-sourced add into an existing set with a
different industry label, ask:

> "The existing comp set is labeled **{existing industry}**. Should I
> change the industry label to **{new industry}**, or keep it?"

`get:comparables`'s `comparableIndustry` comes back as the `enum_name`;
show the matching `api_value` from `industry-groups.json` instead.

### Error handling

- **404 on mutate**: re-fetch `get:comparables` to verify the candidate
  exists and the IDs are right; retry once. Do not surface the 404.
- **500 on mutate**: check `comparable_industry` is the `enum_name`. If
  that's not it, re-check that every entry has a non-null `ticker` and
  `company_name`; retry. Do not surface the 500.
- **Persistent failure**: surface the plain-language fallback, and don't
  retry again unless the user asks:
  > "Couldn't save the comp set right now. Want me to try again in a
  > moment?"

## Step 5: Success messaging

State the outcome in plain language. Mention the count and the
industry, but do not list every ticker (that's already on screen
above):

> "Saved **{N} GPC comps** on **{candidate name}**{ for {company name}}{ in **{industry}**}.{Optional: previous count → new count}"

Then return control.
