---
name: carta-grant-vesting
description: >-
  See how much one person or grant has vested, and when the rest vests. Fetches the
  vesting schedule for one grant or holder: options (ISO/NSO), RSUs, SARs or CBUs. Use
  for "how much has [name] vested", "when does [name]'s cliff hit", "vesting progress
  for [name]", cliff dates, "how many shares are eligible for settlement", or unvested
  shares. NOT for portfolio-level / all-employees aggregate vesting.
when_to_use: >-
  Use when asked, for a single named grant or holder, about the vesting
  schedule, when the cliff hits, how many shares have vested or remain
  unvested, vesting progress for a named employee ("how much has Jane
  vested", "vesting progress for Jane"), RSU settlement eligibility, when
  a grant is fully vested, or wrong-vocab phrasings for the same idea —
  "stock payment schedule", "when does [name] actually own their stock",
  "what do they have rights to", "how much is still locked up". Stays
  scoped to ONE grant or holder. Do NOT use for aggregate vesting across
  all employees or the full option pool ("how much of my employees'
  equity has vested") — defer to a stakeholder/portfolio skill instead.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.122.15</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Grant Vesting Data

Fetch the full vesting schedule for a grant — options, RSUs, SARs, or CBUs — and present it with useful context, not just the raw table.

Send `_instrumentation_v2: {"surface": "<surface>"}` with every Carta tool call, as a parameter
of the tool next to `name` and `arguments`, never in `arguments`. `<surface>` is the closest of
`chat`, `cowork`, `code-terminal`, `code-desktop`, `code-remote`, `excel`, `sdk-cli`,
`sdk-typescript` and `sdk-python`, else `other`. Run no shell command for this or any other
`_instrumentation_v2` field: send `session_id` only when your system prompt already shows it.

## When to Use

Use this skill for vesting questions scoped to a **single grant or holder**:

- "What's the vesting schedule for this grant?"
- "When does the cliff hit?" / "When does Jane's cliff hit?"
- "How much has Jane vested?" / "How many shares are vested so far for Jane?"
- "Show vesting progress for Jane" / "How far along is Jane's grant?"
- "How many shares have vested so far?"
- "Show vesting progress for Jane's options"
- "Show the vesting schedule for Jane's RSU grant"
- "How many shares are eligible for settlement?"
- "How many unvested shares remain?"
- "When is this grant fully vested?"

**Wrong-vocab synonyms** (same intent, different words — all map to vesting for a single grant/holder):

- "What's Jane's stock payment schedule?" → vesting schedule
- "When does Jane actually own her stock?" / "When does this grant actually own out?" → vesting / when vested
- "How many shares does Jane have rights to so far?" → vested shares
- "How much of Jane's grant is still locked up?" → unvested shares

**Do NOT use for portfolio-level / all-employees aggregate vesting.** These triggers stay scoped to one grant or holder ("for [name]", "for this grant", "for grant #"). Questions like "how much of my employees' equity has vested" or "total vested across the whole option pool" are portfolio-level — defer to a stakeholder/portfolio/ownership skill instead. If a request spans more than one grant, see the "Multiple grants" branch under Workflow before fetching anything.

## Prerequisites

You need:
1. The company — do not call `list_accounts` before the first read (Step 0)
2. The grant — its label or id, sent as `security`; find it with the list command for the grant type (see below)
3. **Grant type** — required to pick the right list and detail commands. If unstated, infer from the user's wording ("options", "ISO", "NSO" → options; "RSU"; "SAR"; "CBU"). If still unclear, ask via `AskUserQuestion` before searching.

## Data Retrieval

> The server defaults to `detail=summary` for list commands. This skill needs individual records, so `"detail": "minimal"` is passed explicitly.

`cap_table:get:security` gives the vesting detail of every grant type:

| Grant type | List command | Vesting detail command |
|------------|--------------|------------------------|
| Options (ISO/NSO) | `cap_table:list:grants` | `cap_table:get:security` |
| RSUs | `cap_table:list:rsus` | `cap_table:get:security` |
| SARs | `cap_table:list:sars` | `cap_table:get:security` |
| CBUs | `cap_table:list:cbus` | `cap_table:get:security` |

```
read_tool({"name": "<list tool>", "arguments": {"corporation_id": corporation_id, "search": "<holder name>", "detail": "minimal"}})
```

Then send the grant's label or id as `security`, and its type from the list you read (`cap_table:list:grants` → `option_grant`, `cap_table:list:rsus` → `rsu`, `cap_table:list:sars` → `sar`, `cap_table:list:cbus` → `cbu`):

```
read_tool({"name": "cap_table__get__security", "arguments": {"corporation_id": corporation_id, "security": "<grant label or id>", "type": "<option_grant|rsu|sar|cbu>"}})
```

## Key Fields

**`cap_table:get:security`:**
- `quantity`, `issue_date`, `holder_name`, `label`
- `grant` — `option_type`, `exercise_price` and `base_value` (`{amount, currency}`), `expiration_date`, `vested_quantity`, `exercised_quantity` (for an RSU, the settled units), `outstanding_quantity`
- `vesting` — `vested_quantity`, `vested_outstanding_quantity` (for an RSU, the vested units that are not settled yet), `unvested_outstanding_quantity`; `schedule` with `name`, `type`, `cliff_summary`, `acceleration`
- `vesting.tranches[]` — each with `vest_date`, `quantity` (the target), `vested`, `time_vested` (the vest date has passed, whether or not its condition is met), `vested_quantity` (what vested), `cumulative_vested_quantity` and `performance_condition` (`name`, `evaluated_on`, `payout_multiplier`, where 1 is 100%); a milestone that is not met has a null `vest_date`. An RSU's second condition, such as a liquidity event, is its tranches' `performance_condition`: a tranche with `time_vested` true and `vested` false waits for that condition

## Workflow

### Step 0 — The company (no lookup call)

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). On an error, and for later calls, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it). Its reads are cap table reads: reuse `meta.company.id` on later calls. Never guess which company the user meant.

**The user's own grants** ("my vesting", "when do my options vest"): read them as for any holder, with the user's name. This skill reads a company's cap table, so it works only when the user has access to that company on Carta. When the company read fails, follow the company errors in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`: its *No company account* section says what to tell a user who has only a personal portfolio.

### Step 1 — Identify the Grant

**If the grant's label or id is already known** from prior conversation context (e.g. the user just viewed a grants list), skip directly to Step 2.

Otherwise, pick the list command based on grant type and search:

- **Type stated by the user** (e.g. "Jane's RSU", "the SAR"): use the matching list command from the table above.
- **Type unknown**: try `cap_table:list:grants` first (options are most common). If the holder is not found, try `list:rsus`, then `list:sars`, then `list:cbus`. Do not conclude vesting data is unavailable until all four have been checked.

```
read_tool({"name": "<list tool>", "arguments": {"corporation_id": corporation_id, "search": "<holder name>", "detail": "minimal"}})
```

If multiple grants are returned, ask the user which one, or pick the most relevant based on context.

#### Branch — "All grants" / multiple grants

If the user asks about **"all grants"**, **"each grant"**, multiple grants, or every grant for a holder, **do NOT fan out to one `cap_table:get:security` call per grant.** A holder or company can have dozens-to-hundreds of grants, and N detail fetches is slow and wasteful. Instead:

1. List the grants once (the summary list already includes `vested`/`unvested`/`quantity` signals) and present that summary table.
2. Either **ask the user to narrow** to a specific grant before pulling the full vesting detail, or **present the summary totals** (per grant, never summing across currencies) and **offer to drill into** a single grant's event-level schedule.

Only fetch the per-grant vesting detail (Step 2) once the user has narrowed to a specific grant.

### Step 2 — Fetch Vesting Data

Read the grant with its type (`option_grant`, `rsu`, `sar` or `cbu`):

- `read_tool({"name": "cap_table__get__security", "arguments": {"corporation_id": ..., "security": ..., "type": ...}})`

### Step 3 — Present with Context

Lead with a one-sentence plain-English summary before showing the table (see Presentation section).

## Gates

**Required inputs**: the grant (its label or id) and grant type (options, RSU, SAR, or CBU). The company is not an input to ask for: it comes from Step 0 (omitted, a name, or `meta.company.id`).
If grant type is missing or ambiguous, call `AskUserQuestion` before proceeding.
If the grant is unknown, use Step 1 of the Workflow to search by holder name.

**AI computation**: No — this skill presents Carta data directly.

## Presentation

**Format**: Summary sentence + vesting events / tranches table

**BLUF lead**: Lead with a one-sentence plain-English summary of the vesting state before showing the table.

**Sort order**: By vesting date ascending (chronological).

**Date format**: MMM d, yyyy (e.g. "Jan 15, 2026").

Tailor the summary based on vesting state:
- **Pre-cliff**: how long until the cliff, how many shares vest at cliff
- **Partially vested**: what % has vested, what the ongoing cadence is (monthly/quarterly), when fully vested
- **Fully vested**: confirm and note if any shares remain unexercised (options/SARs) or unsettled (RSUs/CBUs)

Format as the **vesting events / tranches table** returned by the tool, sorted by vesting date ascending (chronological). For a `cap_table:get:security` tranche, show `vested_quantity` as vested: a performance tranche can vest less than its target `quantity`.

Flag anything time-sensitive:
- Cliff date within the next 90 days
- Grant expiring soon
- **Already-expired grant with forfeit exposure** (options/SARs): if `grant.expiration_date < today` AND `grant.vested_quantity > grant.exercised_quantity`, flag it prominently — the holder has vested-but-expired-unexercised shares that may already be forfeited. This is distinct from (and more urgent than) the "expiring soon" flag above, which warns about a future date; here the window has already closed.
- Large unvested block concentrated at a future date
- **Deep in-the-money grants** (options only — ISO/NSO): if the current 409A FMV is available and the spread between exercise price and FMV exceeds 10x, flag it. Note that holders face significant ordinary income (NSO) or AMT (ISO) exposure at exercise, and recommend the company consider a tender offer, early exercise program, or liquidity event planning. Skip this flag for RSUs, SARs, and CBUs.
- **RSU settlement window** (RSUs only): if `vesting.vested_outstanding_quantity` is more than 0, note how many shares are awaiting settlement, and when `status` is `exercisable_until`, flag that the holder was terminated and `grant.expiration_date` is the last day to settle.

Then show the formatted table from the tool.

## Error Handling

| Situation | What to do |
|---|---|
| No stakeholder or grant matches the name (`not_found`, or no row in all four list commands) | Ask the user with `AskUserQuestion` for the name as Carta shows it. Never pick a person by guess. |
| Response too large on a list command | Call it again with `search` (the holder name) and `"detail": "minimal"`. |
| 403, `role_required` or access denied | Say the user's role can't see this grant's vesting. Do not retry, and do not look for the grant with other tools. |
| Company error | Follow *Company errors* in `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md`. |

## Caveats

- Send the grant's label or id as `security`, with its `type`. If the user gives a holder name, search the list command for the grant type (see Data Retrieval).
- `cap_table:list:grants` excludes RSUs, SARs, and CBUs. A "not found" result there does **not** mean the grant has no vesting data — check the other three list commands.
- The exercise-price / 409A FMV spread flag applies to options (ISO/NSO) only. RSUs, SARs, and CBUs do not have an exercise price in the same sense — skip that flag for non-option grants.
- Vesting schedules reflect the original grant terms; any modifications (e.g., acceleration clauses, leaves of absence) may not be captured in the data.
- The 10x in-the-money flag requires a current 409A FMV — if no valuation data is available, skip the flag rather than guessing.
- Exercised/settled vs. outstanding status may not be reflected in the vesting schedule itself; check grant-level fields for exercise/settlement history.
