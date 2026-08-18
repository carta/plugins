# Recorded incidents

Why the hard rules say what they say. Each entry is a real run that went wrong; the rule it
produced is stated in [SKILL.md](../SKILL.md) with a one-clause reason, and the full story
lives here.

**Read this file only when you need to justify, change, or argue with a rule** — never on the
happy path. If you are about to weaken a guardrail because it looks redundant, find it here
first: most of them look redundant precisely because the failure they prevent is invisible
when they work.

---

## Round-trips that bought nothing

| Incident | Rule it produced |
|---|---|
| The skill shelled out to `find … generate.py` to detect the side-panel renderer. In Cowork that command **always** returns `RENDERER_MISSING` — the sandbox has no such path — so it burned a round trip to learn what the tool list already said. Worse, the old wording ("never assume the panel is unavailable — run the probe") trained the model to distrust its own tool list, so it ran the dead probe *and then* fell back to chat anyway. | Detect the adapter from the tool surface. `Bash(find *)` was removed from `allowed-tools` so the capability is gone, not merely discouraged. |
| `set_context` was called on a corporation and **failed**, costing a round trip and changing nothing — the subsequent commands worked purely off their own `corporation_id`. | Never `set_context` for a corporation-scoped command. |
| `discover` / `search_tools` were called to look up command names the skill already hardcodes. A name-lookup tool is a pure round trip when you know the name. | Command names are hardcoded; `discover` is a debugging aid only. |
| The old `call_tool` + `cap_table__mutate__issue_securities` form returned *"Unknown tool"* and silently wasted the call. **The original write-up mis-stated the cause** as "these are commands, not tools". carta-mcp does generate one tool per command by swapping `:` for `__` (`src/tool_search.py`, `_tool_name_from_command`), registered unconditionally — so the dunder name is real. What it is *not* is visible: those tools are excluded from `tools/list` and reachable only via a `search_tools` → `call_tool` round trip, and they disappear entirely when hidden from the session (e.g. a `staff_only` command outside a staff request). The runtime's own descriptions deprecate `fetch` in favour of `call_tool`, which dresses this failing path up as the endorsed one — the Step 2a carve-out names that notice and overrides it deliberately. | Use the **pinned gateway**: `fetch`/`mutate` with colon-separated names and a `params` key. One hop, always in `tools/list`, scope and staff checks enforced in the executor. |
| An unfiltered `list_accounts()` for a prompt naming an account returned a large alphabetically-ordered page that ended before reaching that name. The model gave up and asked the user for the ID — never trying the tool's own `search` parameter, which resolves it in one call. | `list_accounts(search="<name>")`, never an unfiltered listing. |
| The stakeholder lookup was a second serial round trip before the form could open — `issuance_init` fetched reference data, *then* `cap_table:get:stakeholders` resolved the named people, even though neither depends on the other. | `issuance_init` takes `stakeholder_names` and returns a `stakeholders` section. Every section is gathered server-side in parallel, so the lookup costs no wall-clock and Phase 0.5 spends exactly one round trip. |
| A transient upstream failure — a Cloudflare **502 HTML error page** returned to a JSON call — was reported as *"the Carta MCP server isn't connected."* The server was connected and briefly unhealthy. The user re-checked a working connection, which is the "it wasn't connected but it was" complaint. | Classify before reporting: no Carta tool in the tool list = not connected; 5xx / gateway / HTML body / timeout = transient, **retry once**, then report a temporary problem. An HTML response to a JSON call is an outage signal, never content to parse. |
| Computing percent-of-fully-diluted, a user guessed `cap_table:get:cap_table_summary` and got *"Unknown command"* — a guess made attractive by carta-reporting's real `cap_table_summary_report` — then had to run `search_tools` mid-flow to find the actual totals command, `cap_table:get:cap_table_by_share_class`, whose name reads as a per-class breakdown rather than the totals source it is. | The totals command is hardcoded in the Step 2a table alongside every other name, so the closed discovery door has nothing missing behind it. |

The first four entries were ~7 avoidable backend round-trips in a single live Cowork run (a
batch of option grants on one company), plus one extra interactive prompt; the totals guess — a
failed call plus a `search_tools` round trip — is from a separate customer run. The
stakeholder-fetch and 502 entries come from a later run that took **6–12 minutes and several
attempts**; the 502 one is not a round trip at all but sits here because misreporting it sent
the user off to fix a connection that was already fine.

---

## Asking for what the surface already collects

| Incident | Rule it produced |
|---|---|
| A prompt for "100 option grants" (no names given) produced *"Before I open the batch config panel, I need to know who these 100 grants go to — the request didn't name anyone"* via `AskUserQuestion`, instead of opening the panel. | Never ask who the grantees are before opening the collection surface. A missing recipient is a blank field, never a chat question. |
| A prompt for "100 certificates" (no names, no person-language) opened the panel with **100 blank stakeholder blocks** instead of one block with `quantity: 100` — the exact opposite of what was asked. | A bare "N \<securities\>" is a **quantity** for one recipient. Only people-language ("100 employees", "100 new hires") makes N a row count. |
| Values the skill can compute (issue date, expiration, FMV-derived exercise price, the only active plan) were pre-asked in chat, turning a 2-wait flow into a 3+-wait one. | Stamp computable defaults and surface them tagged and overridable in the review. The review *is* the override point. |

---

## Reading server data wrong

| Incident | Rule it produced |
|---|---|
| A model conflated `acceleration_templates`' genuine `count: 0` with `document_sets`, told the user *"…doesn't have any option-grant document templates set up yet"* and **aborted the whole issuance** — when `document_sets` had actually returned `count: 1`. The misread stop fired on the side-panel flow, before the panel ever opened. | Read each `issuance_init` section under its own name. Only [SKILL.md's Account-setup gate](../SKILL.md#account-setup-gate-option-grant-only) may stop over a count — `document_sets.count` alone, on option grants, read under that exact section name. Every other section's zero is a normal state. A section joins the gate only after its proposed stop is checked against this incident. |
| The unfiltered `detail=full` roster **truncated at 150 of 167** stakeholders — it paid full latency *and* still missed people. | Cowork resolves named recipients with a targeted `search=`. The Code adapter keeps the full roster only because its autocomplete genuinely needs every row. |
| Each grantee was resolved with its own `search` call — one serial round-trip per person. For a 10-person batch this was the dominant contributor to a ~7-minute runtime. | Stakeholder calls are bounded by roster **misses**, never by row count. Concatenating every name into one `OR`-ed `search` to disguise a per-row loop is the same bug. |
| A leftover `_vesting_templates_arr.json` from an earlier, unrelated run was reused instead of regenerated, because it "looked right". `OUT_DIR` is keyed only by `corporation_id` and persists across sessions. | Always rewrite the raw fetched envelopes fresh from this turn's fetch. |
| Several named grantees were resolved with **one concatenated `search=`**, exactly as the skill then instructed ("issue one call covering them all"). The stakeholders endpoint inherits DRF's stock `SearchFilter`, which **AND-s** whitespace-separated terms across `full_name`/`email` — so `search="Jane Doe Bob Smith"` asks for a single human matching all four terms. It returned an empty list with a healthy `200`, indistinguishable from "nobody on this cap table". Commas don't escape it either: `search_smart_split` strips them before the AND. The run read the emptiness as "all new stakeholders", and the user saw it as "it couldn't find the employees" followed by several retries. | `search` is single-person only. Several people go through `stakeholder_names` (Phase 0.5) or `names=` (Phase 1). **A zero-result `search` that contained more than one name is a malformed query, not an absent person** — never conclude the people are new from one, because the silent outcome is duplicate stakeholders on a real cap table. |

---

## Silent data loss

| Incident | Rule it produced |
|---|---|
| A row reached `issue_securities` with `stakeholder_id=null`. Because name and email were also null it slipped duplicate detection, created **zero securities, and returned success** — so the user was told the batch was "in draft" when it could never issue. | The pre-save assertion: every `always` field holds a non-null value before any `save_drafts` or `issue_securities`. `save_drafts` accepts incomplete rows silently. |
| A user set an absurd quantity, clicked Review, reviewed an **unvalidated** summary, and only found out at the final **Confirm & Issue** that the server rejected it ("Not enough shares in the option plan") — after a draft row had already been silently created. | Save + validate *before* the review surface renders (Phase 1.5), not after it is confirmed. |

---

## Confirmation gates

| Incident | Rule it produced |
|---|---|
| An `AskUserQuestion` was stacked on an open side panel. The open question suspends the panel's submit watcher, so the user's click never landed. | Code adapter only: while a panel is open, emit no `AskUserQuestion`. The button is the gate. Cowork has no watcher, so its recovery questions are unrestricted. |
| A fresh submit signal was second-guessed as a stale replay — the model asked *"did you mean to submit again?"* — which both stacked a question on what should have been a direct branch and made the click look like it "did nothing" until the user typed "continue" by hand. Every click POSTs and overwrites the action-request file, so a signal you have not branched on yet is real. | Branch directly on the action. Never re-ask after a confirmation. |
