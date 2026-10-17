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
  - mcp__carta__crm_read_tool
  - mcp__claude_ai_Carta__crm_read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_read_tool
  - mcp__claude_ai_Carta__crm_call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__crm_call_tool
  - Artifact
  - Write
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_tracker.py" *)
version: 1.0.0
model: inherit
---

<!-- carta:plugin-version -->
<carta-plugin>carta-crm:1.16.15</carta-plugin>

# Adviser Tracker

The question this skill answers: **"Can you help me find the top twenty advisers in this
tenant?"** It publishes the answer as **`<Title> - <Organization>`** (both come from the tool
result), icon **handshake**. The page is a static snapshot. All three years are in it, so its year
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
`references/`, not this skill's). Do not search for it. When that path does not resolve, the
gate is this one rule: `Artifact` is in this session. Pass silently.

## Step 1: Fetch the advisers

1. Call `crm:get_deal_fields`.
2. Pick the bank field by a fixed rule. Look only at company and company-list fields. Take the
   first level that has a match:
   1. the label mentions Mandate or bank, for example "Mandate (bank)";
   2. the label mentions adviser, advisor, sell-side, sell side or M&A.

   When several fields match at the same level, take the one with the shortest label, then the
   first in field order. Never pick an introducer field.
3. Plan two runs in ONE message, as two parallel calls. The Mandate run takes that field's id as
   `dealFieldId`. The people run takes `linkBy` `dealPeople` and no `dealFieldId`. Each answer
   holds `runId` and `shards`:

```
crm_call_tool({ "name": "crm:get_adviser_tracker_plan", "arguments": { "limit": 20, "dealFieldId": "<id of that field>" } })
crm_call_tool({ "name": "crm:get_adviser_tracker_plan", "arguments": { "limit": 20, "linkBy": "dealPeople" } })
```

   The people run counts a deal for a bank when an introducer or adviser on the deal works at
   the bank today. It is a second view of the page.

4. Fan out. In ONE turn, as parallel tool calls in one message, call
   `crm:get_adviser_tracker_relationships` once for every number in `shards` of each run and
   `crm:get_adviser_tracker_details` once for each run. Each call takes the `runId` of the run
   that listed the shard. All of them go out together, never across turns.
   Send the shard calls in any order. A plan has at most 12 shards. A shard can hold several
   banks, and a large bank can span several shards. Never assume one shard per bank. Calling a
   shard again redoes that shard.

```
crm_call_tool({ "name": "crm:get_adviser_tracker_relationships", "arguments": { "runId": "<runId>", "shard": <a number from shards> } })
crm_call_tool({ "name": "crm:get_adviser_tracker_details", "arguments": { "runId": "<runId>" } })
```

   An error from a `crm:get_adviser_tracker_relationships` call or a
   `crm:get_adviser_tracker_details` call, here or in the retry below, does not stop the run
   unless its text is listed below. Go on to the result call below. It decides.

5. Collect the results. In ONE message, call the result once for each run. The answer carries the logos,
   so it can be large. Every call whose answer becomes `--result` or `--people-result` goes through
   `crm_read_tool` when it is in the session: these two calls and the single calls below. It
   saves a large answer to a file and returns the path. `crm_call_tool` cuts a large answer and
   returns no path, so use it only when there is no `crm_read_tool`. Pass the saved file to the
   build script as it is. Each answer has the shape the build script reads:

```
crm_read_tool({ "name": "crm:get_adviser_tracker_result", "arguments": { "runId": "<runId>" } })
```

An error comes back as the plain text of the tool answer, not as JSON. Find it by the text it
contains. Handle these, from whichever Mandate call returns them:

- **Incomplete.** The text contains `adviser_tracker_run_incomplete:` and names the missing
  parts, for example `adviser_tracker_run_incomplete: missingShards=[3,7] missingDetails=false`.
  Call again only the parts the text names: the shard calls for the numbers in `missingShards`,
  and the details call when it says `missingDetails=true`. Send them in one turn, one time. Then
  call the result again. When it is still incomplete, stop with the plain error below. Build
  nothing from a partial result.
- **Run not found.** The text contains `adviser_tracker_run_not_found`. The run is unknown or
  expired. A run part lives 15 minutes. Plan a new Mandate run with `crm:get_adviser_tracker_plan`,
  one time per skill run. Then fan out and collect again. A second
  `adviser_tracker_run_not_found` stops with the plain error below.
- **Unknown shard.** The text contains `adviser_tracker_unknown_shard`. Stop with the plain error
  below. Never retry.
- **Cache unavailable.** The text contains `adviser_tracker_cache_unavailable`. The run store did
  not keep a write. Make the single Mandate call below instead.

The retry budgets are one incomplete retry and one new-plan retry per skill run. There are no
other retries.

These rules are for the Mandate run only. Any error in the people run drops the people view:
an error from its plan or its result, a tool that rejects `linkBy` (an older environment), or an
incomplete or expired run. Then publish the Mandate view alone and add one plain line to the
notice in Step 4 that the introducer and adviser view is not shown. This never stops the run, is
never retried, and no other tool fills it in. A new Mandate plan never plans the people run again.

When `crm:get_adviser_tracker_plan` is an unknown tool, this environment has no split tools. Make
two single calls instead, in one message, and use their answers as the results. The people call
follows the people rules above:

```
crm_read_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20, "dealFieldId": "<id of that field>" } })
crm_read_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20, "linkBy": "dealPeople" } })
```

Step 4 carries one plain line in its notice that names the field used. When no field
qualifies, leave `dealFieldId` out and say so in that line: deals are counted from every
company field.

Use the saved path when the answer returns one, for the Mandate result and for the people result
when it succeeded. When an answer comes back without a saved path, write it to its own file in the
outputs directory with `Write`.

- **Not configured.** An error whose text starts `adviser-tracker-not-configured:`, or an
  unknown-tool error on the single call. Build and publish nothing. Tell the user adviser
  tracking is not turned on for the organization, and stop.
- **Any other error.** In the Mandate run, except for a `crm:get_adviser_tracker_relationships`
  or `crm:get_adviser_tracker_details` call, stop. Tell the user the adviser
  tracker could not be loaded right now. Never fill a gap from `search_deals`,
  `search_companies` or any other tool.

## Step 2: Check the top bank

The check stays on the Mandate view. Take the bank with the most deals in the current year: the
sum of its `dealsByMonth` counts for that year. Check it with the calls below, once each. Do not retry any of them. When a call fails, skip its check:

- its deals created this year, with `crm:aggregate_deals`. Call `crm:get_deal_fields` first if its
  answer is not in the conversation. Pass `group_by` as the bank field id in an array. Pass
  `filters` with two items: the bank field `eq` the bank name, and the deal created-date field
  `between` the first day of the year and today. Leave `metric` out: every group already carries
  a `count`;
- its fees, only when that count is 25 or fewer. Call `crm:search_deals` once with the same two
  filters and that count as `limit`. Then call `crm:get_fees_by_deal` once for each returned deal, with its
  `deal_id`, all in one message. Add the fee totals per currency. When any call in this sequence
  fails, skip the whole fees check.

When a number disagrees with the tracker, write one plain line that says what the CRM shows. Step 4
carries it in the notice.

## Step 3: Split the tiers

The script splits the tiers by a fixed rule: Tier 1 is the top half of the banks by deals
created over the three years, Tier 2 is the rest. Do not choose, change or override the tiers.

## Step 4: Build the page

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_tracker.py" --result <file> --people-result <people file> --notice "<the Step 1 field line, plus the Step 2 disagreement line when there is one, joined into one line>" --out <outputs-directory>/adviser-tracker-<slug>.html
```

The notice belongs to the Mandate view. The script gives the introducer and adviser view its own fixed line that says banks are counted from the introducers and advisers on each deal.

Leave out `--people-result` when the people run failed. The page then has no view toggle. When
the script drops a people file it cannot use, it adds its own line to the notice and builds the
Mandate view. The notice also carries the plain line from Step 1 when the people run failed.

`<slug>` is the organization lowercased with non-alphanumerics collapsed to `-`.

The script exits with a typed code when the input is wrong (`result_not_json`, `result_empty`,
`result_invalid`, `row_invalid`, `not_configured`, `no_result`,
`template_invalid`). Tell the user the tracker could not be built and stop. Do not repair the
data by hand.

## Step 5: Publish

```
Artifact({action: "list", scope: "mine", limit: 50})
```

Find the artifact titled exactly `<Title> - <Organization>` and keep its `url`. An artifact for
another organization is not a match. Then publish. `url` is the only difference between a first
publish and a redeploy.

```
Artifact({
  file_path: "<outputs-directory>/adviser-tracker-<slug>.html",
  url: "<url from the list, omitted on a first publish>",
  description: "Top advisers by deals created, relationship strength and top contact, by tier.",
  icon: "handshake",
  label: "Rebuilt from the CRM"
})
```

Pass no `capabilities`: the page is static and reads nothing when opened. Omit `icon` on a
redeploy.

## Step 6: Reply

Give the URL and one line: it is a snapshot as of today. Name the check result from Step 2 when
it disagreed. For an empty organization, say there are no advisers yet.
