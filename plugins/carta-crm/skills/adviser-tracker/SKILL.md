---
name: adviser-tracker
description: >
  Shows the organization's top twenty M&A advisers (investment banks) as a page: each bank with
  its logo, deals created per quarter and per year, relationship strength with our team and the
  top contact, split into Tier 1 and Tier 2, with a year-over-year chart per bank and a monthly
  deal chart for the last three years. Use this skill when the user says things like "adviser
  tracker", "advisor tracker", "M&A adviser tracker", "show our advisers", "who are our top
  banks", or "/adviser-tracker". For one adviser's record use search-companies.
allowed-tools:
  - mcp__carta__crm_call_tool
  - mcp__claude_ai_Carta__crm_call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_call_tool
  - Artifact
  - Write
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_tracker.py" *)
version: 1.0.0
model: inherit
---

<!-- carta:plugin-version -->
<carta-plugin>carta-crm:1.16.9</carta-plugin>

# Adviser Tracker

The question this skill answers: **"Can you help me find the top twenty advisers in this
tenant?"** It publishes the answer as **`<Title> - <Organization>`** (both come from the tool
result), favicon **🤝**. The page is a static snapshot. All three years are in it, so its year
toggle needs no call.

## Voice

Never mention the template, the script, tool names, files, paths or this skill. Progress lines
speak in the user's words: "Pulling your advisers", "Checking the numbers", "Building the
tracker". Never describe a search or a retry. Fees are never added across currencies.

## The page

One artifact holds three cards, and a View toggle (By mandate, By introducer & adviser) that
switches all three together. By mandate is the default. The toggle is absent when the people
view is missing. The cards: the tracker table (year toggle, Q1 to Q4, year total,
relationship strength, top contact, by tier), deals by bank year over year, and deals created
per month for the last three years. Fees show per currency. They are never converted and never
summed across currencies. A bank with no logo gets an empty bordered tile, never initials.

## Step 0: Gate

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` (the plugin's own
`references/`, not this skill's). Do not search for it. Pass silently.

## Step 1: Fetch the advisers

1. Call `crm:get_deal_fields`.
2. Pick the bank field by a fixed rule. Look only at company and company-list fields. Take the
   first level that has a match:
   1. the label mentions Mandate or bank, for example "Mandate (bank)";
   2. the label mentions adviser, advisor, sell-side, sell side or M&A.

   When several fields match at the same level, take the one with the shortest label, then the
   first in field order. Never pick an introducer field.
3. Plan the run with that field's id as `dealFieldId`. The answer holds `runId` and `shards`:

```
crm_call_tool({ "name": "crm:get_adviser_tracker_plan", "arguments": { "limit": 20, "dealFieldId": "<id of that field>" } })
```

4. Fan out. In ONE turn, as parallel tool calls in one message, call
   `crm:get_adviser_tracker_relationships` once for every number in `shards` and
   `crm:get_adviser_tracker_details` once. In the same message, also make the people call below.
   All of them go out together, never across turns.
   Send the shard calls in any order. A plan has 10 to 20 shards, often more than banks. Never
   assume one shard per bank. Calling a shard again redoes that shard.

```
crm_call_tool({ "name": "crm:get_adviser_tracker_relationships", "arguments": { "runId": "<runId>", "shard": <a number from shards> } })
crm_call_tool({ "name": "crm:get_adviser_tracker_details", "arguments": { "runId": "<runId>" } })
```

```
crm_call_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20, "linkBy": "dealPeople" } })
```

   The people call counts a deal for a bank when an introducer or adviser on the deal works at
   the bank today. It takes no `dealFieldId`. Its answer has the same shape as the result and
   echoes `linkBy`. It is a second view of the page. Save it to its own file, as for the result
   below. When it errors, or the tool rejects `linkBy` (an older environment), publish the
   Mandate view alone and add one plain line to the notice in Step 4 that the introducer and
   adviser view is not shown. This never stops the run, is never retried, and no other tool
   fills it in.

   An error from a `crm:get_adviser_tracker_relationships` call or a
   `crm:get_adviser_tracker_details` call, here or in the retry below, does not stop the run
   unless its code is listed below. Go on to the result call below. It decides.

5. Collect the result. It has the shape the build script reads:

```
crm_call_tool({ "name": "crm:get_adviser_tracker_result", "arguments": { "runId": "<runId>" } })
```

Each error carries a message prefix and a structured code. Handle these, from whichever call
returns them:

These rules are for the Mandate calls only. The people call is sent once per skill run, never
again on a new plan or the single-call fallback, and its errors are handled only as in item 4
above.

- **Incomplete.** Code `ADVISER_TRACKER_RUN_INCOMPLETE`, message prefix
  `adviser-tracker-run-incomplete:`, details `{ missingShards: number[], missingDetails: boolean }`.
  Call again only the parts the details name: the shard calls for `missingShards`, and the
  details call when `missingDetails` is true. Send them in one turn, one time. Then call the
  result again. When it is still incomplete, stop with the plain error below. Build nothing from
  a partial result.
- **Run not found.** Code `ADVISER_TRACKER_RUN_NOT_FOUND`. The run is unknown or expired. A run
  part lives 15 minutes. Plan a new run with `crm:get_adviser_tracker_plan`, one time per skill
  run. Then fan out and collect again. A second `ADVISER_TRACKER_RUN_NOT_FOUND` stops with the
  plain error below.
- **Unknown shard.** Code `ADVISER_TRACKER_UNKNOWN_SHARD`. Stop with the plain error below. Never
  retry.
- **Cache unavailable.** Code `ADVISER_TRACKER_CACHE_UNAVAILABLE`. The run store did not keep a
  write. Make the single call below instead.

The retry budgets are one incomplete retry and one new-plan retry per skill run. There are no
other retries.

When `crm:get_adviser_tracker_plan` is an unknown tool, this environment has no split tools. Make
one call instead, and use its answer as the result. Send the people call with it, in the same
message:

```
crm_call_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20, "dealFieldId": "<id of that field>" } })
crm_call_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20, "linkBy": "dealPeople" } })
```

Step 4 carries one plain line in its notice that names the field used. When no field
qualifies, leave `dealFieldId` out and say so in that line: deals are counted from every
company field.

Save the result, and the people answer when it succeeded, each to its own file in the outputs
directory with `Write`. When the host already returns a saved path, use that path.

- **Not configured.** An error whose text starts `adviser-tracker-not-configured:`, or an
  unknown-tool error on the single call. Build and publish nothing. Tell the user adviser
  tracking is not turned on for the organization, and stop.
- **Any other error.** Except for a `crm:get_adviser_tracker_relationships` or
  `crm:get_adviser_tracker_details` call, stop. Tell the user the adviser
  tracker could not be loaded right now. Never fill a gap from `search_deals`,
  `search_companies` or any other tool.

## Step 2: Check the top bank

The check stays on the Mandate view. Take the bank with the most deals in the current year: the
sum of its `dealsByMonth` counts for that year. Check it with one call each:

- its deals created this year, with `crm:aggregate_deals` or `crm:search_deals`;
- its fees, with `crm:get_fees_by_deal`.

When a number disagrees with the tracker, write one plain line that says what the CRM shows. Step 4
carries it in the notice. When a check call fails, skip that check. Do not retry it.

## Step 3: Split the tiers

The script splits the tiers by a fixed rule: Tier 1 is the top half of the banks by deals
created over the three years, Tier 2 is the rest. Do not choose, change or override the tiers.

## Step 4: Build the page

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_tracker.py" --result <file> --people-result <people file> --notice "<the Step 1 field line, plus the Step 2 disagreement line when there is one, joined into one line>" --out <outputs-directory>/adviser-tracker-<slug>.html
```

Leave out `--people-result` when the people call failed. The page then has no view toggle. When
the script drops a people file it cannot use, it adds its own line to the notice and builds the
Mandate view. The notice also carries the plain line from Step 1 when the people call failed.

`<slug>` is the organization lowercased with non-alphanumerics collapsed to `-`.

The script exits with a typed code when the input is wrong (`result_not_json`, `result_empty`,
`result_invalid`, `row_invalid`, `not_configured`, `no_result`,
`template_invalid`). Tell the user the tracker could not be built and stop. Do not repair the
data by hand.

## Step 5: Publish

```
Artifact({action: "list", scope: "mine"})
```

Find the artifact titled exactly `<Title> - <Organization>` and keep its `url`. An artifact for
another organization is not a match. Then publish. `url` is the only difference between a first
publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/adviser-tracker-<slug>.html",
  url: "<url from the list, omitted on a first publish>",
  description: "Top advisers by deals created, relationship strength and top contact, by tier.",
  favicon: "🤝",
  label: "Rebuilt from the CRM"
})
```

Pass no `capabilities`: the page is static and reads nothing when opened. Omit `favicon` on a
redeploy.

## Step 6: Reply

Give the URL and one line: it is a snapshot as of today. Name the check result from Step 2 when
it disagreed. For an empty organization, say there are no advisers yet.
