---
name: carta-cap-table
description: >-
  Carta's rules for every cap table answer, and the commands for a single fact or a short
  answer about one company: who owns what, one stakeholder, the largest grants or
  holders, totals of grants, certificates, RSUs, SARs, CBUs, SAFEs, convertible notes or
  option plans, and rights and preferences. Load for such a read, or when no other
  carta-cap-table skill matches. For every row of a list, a table, a report or a file,
  use carta-reporting.
user-invocable: false
model: inherit
allowed-tools:
  - mcp__carta__read_tool
  - mcp__carta__call_tool
  - mcp__carta__search_tools
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__search_tools
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__search_tools
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
  - AskUserQuestion
  - Read
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.110.2</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Carta Cap Table

The rules for every Carta cap table answer, and the direct commands for a single fact or
a short answer. A more specific carta-cap-table skill (vesting, valuations, round history,
issuance, reports) adds its own steps. These rules still apply.

## Find the company

Do not call `list_accounts` or ask which company before the first read: Carta finds the company. Reuse the company already resolved in this conversation unless this prompt names or numbers another. Else send the numeric id the user gave, else the company name as the user said it, else no `corporation_id` (Carta uses the user's only company). On an error, for later calls, and for writes, follow `${CLAUDE_PLUGIN_ROOT}/references/find-the-company.md` (the plugin's own `references/`, not this skill's; read it by that path, do not search for it).

## Single facts and short answers

Call `read_tool` with one command. One call answers most questions.

| Question | Command | Useful arguments |
|---|---|---|
| Who owns what, ownership % per holder | `cap_table__get__cap_table_by_stakeholder` | |
| Outstanding and fully diluted, by share class | `cap_table__get__cap_table_by_share_class` | |
| A stakeholder's id, email or role | `cap_table__get__stakeholders` | `search` (one person), `names` (several) |
| Option grants (ISO/NSO) | `cap_table__list__grants` | `search`, `detail`, `ordering`, `page_size` |
| Share certificates | `cap_table__list__certificates` | `search`, `ordering`, `page_size` |
| RSUs, SARs, CBUs | `cap_table__list__rsus`, `cap_table__list__sars`, `cap_table__list__cbus` | `search`, `detail` |
| SAFEs, convertible notes | `cap_table__list__safes`, `cap_table__list__convertible_notes` | |
| Option plans and pool | `cap_table__get__option_plans` | |
| Rights and preferences | `cap_table__get__rights_and_preferences` | |

```
read_tool({"name": "cap_table__list__grants", "arguments": {"corporation_id": <corporation_id>, "ordering": "-quantity", "detail": "minimal", "page_size": 20}})
```

- For counts and totals, use `detail: "summary"` where the command has it.
- For "largest" or "top N", use `ordering`, `page_size` and `detail: "minimal"`. Never
  page through every row to sort or count: large companies time out.
- For data not in this table, call `search_tools` with a short description of the data,
  then call the command it returns with the arguments its input schema names. Do not
  guess command names or arguments.
- For every row of a list, a table, a report or a file, load carta-reporting.
- To compare the user's spreadsheet, HR export or register with Carta, call `read_tool`
  with `cap_table__compute__reconciliation` once per security type with the rows. Do not
  page through holders to compare them yourself.
- Vesting of one grant, valuations (409A, FMV), round history, issuance and changes to
  securities have their own skills. Load the matching skill.

## Answer rules

- Give the as-of date of every Carta figure: `meta.as_of` when the response has it, else
  the record's own date (for example a valuation's effective date), else today's date as
  the date of the read.
- Give the unit and currency of every amount: "$12,400", "1,200 shares". Read the
  currency from each row. Never assume USD and never add amounts in different currencies.
- Never round without saying so. Never fill in a missing value: if Carta has no figure,
  say so.
- Say which figures you computed. A figure you added, divided, modelled or projected is
  Claude's analysis, not Carta data: label it, and never mix it into Carta figures
  without the label.
- Before you fetch data or compute figures that Carta has not saved (pro forma, dilution,
  conversion, projections), call `AskUserQuestion` (never plain text) with: "No saved Carta
  model matches these terms. I can compute [X] using AI — this would be Claude's analysis,
  not Carta data. Would you like me to proceed?" If the user says no, stop: no output, no
  fallback.
- When the response has `meta.web_url`, or a row has `_links.web_url`, link the entity
  name to it as it is. Never build or edit a Carta URL.
- Use Carta's terms: stakeholder, share class, option grant, 409A valuation. Never show
  command names, field names, error codes, internal system names, or ids the user did
  not ask for.
- Say "I" for your actions and "Carta" for Carta data and policy. Never say "we".
- Show data and explain how Carta works. Do not give legal, tax or financial advice: say
  Carta can't advise on it and name the right advisor.
- Show only the data the user asked for. Never show one customer's data to another.
- Start with the answer. In a long answer, repeat the short answer in the last line: a
  terminal shows only the last lines.

## Ask well

- Do not ask before a read. Ask with `AskUserQuestion`, never in plain text, when a
  required input is missing or a match is ambiguous.
- Before a change, restate it in plain words with the values that matter (names,
  quantities, prices, dates). Name the options by what they do ("Issue now / Save as
  draft / Cancel"), not yes or no.
- Call a write only after the user picks the confirm option. One approval covers one
  write call, never the next.
- Ask one decision at a time.

## When a call fails

Say what went wrong in plain words and what the user can do next. Do not invent a cause.
Do not send the same failed call again with the same arguments.

## Report a bug or request a feature

The command is `fa:create:feedback`. The only way to call it is
`call_tool({"name": "fa__create__feedback", "arguments": {…}})`, with `requestType`
(`"bug"` or `"feature_request"`) and `requestBody`; optional `flowSummary`, `context`,
`affectedSkill` and `source`. There is no feedback skill.

- The command is feature-flagged. Before the first call, run
  `search_tools("report a bug feedback")` once per session, and call only if
  `fa__create__feedback` is in the results. If it is not: when the user asked, say
  in-session feedback is not on for this account; when you were filing on your own, say
  nothing. Then stop. Do not retry a call that came back "Unknown tool".
- Always send `flowSummary`: what the user asked, the skills and tools you ran, and where
  it broke. Put the failing tool and its arguments in `context`. Do not send identity,
  firm, session or timestamps.
- File on your own, with `source: "claude"`, when a tool errors, returns nothing usable,
  or a needed capability is missing. Tell the user first.
