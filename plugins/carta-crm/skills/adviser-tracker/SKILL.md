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
<carta-plugin>carta-crm:1.16.2</carta-plugin>

# Adviser Tracker

The question this skill answers: **"Can you help me find the top twenty advisers in this
tenant?"** It publishes the answer as **`<Title> - <Organization>`** (both come from the tool
result), favicon **🤝**. The page is a static snapshot. All three years are in it, so its year
toggle needs no call.

## Voice

Never mention the template, the script, tool names, files, paths or this skill. Progress lines
speak in the user's words: "Pulling your advisers", "Checking the numbers", "Building the
tracker". Never describe a search or a retry. Fees are never added across currencies.

## Step 0: Gate

Read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` (the plugin's own
`references/`, not this skill's). Do not search for it. Pass silently.

## Step 1: Fetch the advisers

```
crm_call_tool({ "name": "crm:get_adviser_tracker", "arguments": { "limit": 20 } })
```

Save the result to a file in the outputs directory with `Write`. When the host already returns
a saved path, use that path.

- **Not configured.** An unknown-tool error, or an error whose text starts
  `adviser-tracker-not-configured:`. Build and publish nothing. Tell the user adviser tracking
  is not turned on for the organization, and stop.
- **Any other error.** Stop. Tell the user the adviser tracker could not be loaded right now.
  One attempt per call, no retries, and never fill a gap from `search_deals`,
  `search_companies` or any other tool.

## Step 2: Check the top bank

Take the bank with the most deals in the current year: the sum of its `dealsByMonth` counts for
that year. Check it with one call each:

- its deals created this year, with `crm:aggregate_deals` or `crm:search_deals`;
- its fees, with `crm:get_fees_by_deal`.

When a number disagrees with the tracker, write one plain line that says what the CRM shows and
pass it with `--notice`. When a check call fails, skip that check. Do not retry it.

## Step 3: Split the tiers

Use judgement on deals made and relationship strength. Tier 1 is the banks that bring deals
steadily and that our team knows well: strong or moderate relationships with a solid year total.
Tier 2 is the rest. Pass each Tier 1 bank by its exact `domain` with `--tier1`. When no bank
qualifies, pass no `--tier1`, and every bank goes to Tier 2.

## Step 4: Build the page

```
uv run "${CLAUDE_PLUGIN_ROOT}/skills/adviser-tracker/scripts/build_tracker.py" --result <file> --tier1 "<bank domain>" --tier1 "<bank domain>" --notice "<line from Step 2, omitted when the checks agree>" --out <outputs-directory>/adviser-tracker-<slug>.html
```

`<slug>` is the organization lowercased with non-alphanumerics collapsed to `-`.

The script exits with a typed code when the input is wrong (`result_not_json`, `result_empty`,
`result_invalid`, `row_invalid`, `not_configured`, `tier_unknown`, `no_result`,
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
