# Recorded incidents

Why the hard rules say what they say. Each entry is a real run that went wrong; the rule it
produced is stated in [SKILL.md](../SKILL.md) or [engine.md](engine.md) with a one-clause reason, and the full story
lives here.

**Read this file only when you need to justify, change, or argue with a rule** — never on the
happy path. If you are about to weaken a guardrail because it looks redundant, find it here
first: most of them look redundant precisely because the failure they prevent is invisible
when they work.

---

## Round-trips that bought nothing

| Incident | Rule it produced |
|---|---|
| The skill shelled out to `find … generate.py` to detect the side-panel renderer. In Cowork that command **always** returns `RENDERER_MISSING` — the sandbox has no such path — so it burned a round trip to learn what the tool list already said. Worse, the old wording ("never assume the panel is unavailable — run the probe") trained the model to distrust its own tool list, so it ran the dead probe *and then* fell back to chat anyway. | Pick the surface from what the user said and what Carta returned, never from the disk. `Bash(find *)` was removed from `allowed-tools` so the capability is gone, not merely discouraged. |
| `set_context` was called on a corporation and **failed**, costing a round trip and changing nothing — the subsequent commands worked purely off their own `corporation_id`. | Never `set_context` for a corporation-scoped command. |
| `discover` / `search_tools` were called to look up command names the skill already hardcodes. A name-lookup tool is a pure round trip when you know the name. | Command names are hardcoded; call `search_tools` only for a command the skill does not name. |
| A `ToolSearch` for `mcp__carta__fetch` / `mcp__carta__mutate` resolved nothing, in 23 of 26 traced runs (29 calls, none successful), and the two runs that called `fetch` anyway got *"No such tool available"*. Every run then rediscovered `call_tool` by hand — several by `jq`-ing a 50 KB `search_tools` dump — and had to work out that the wire name swaps `:` for `__` (`src/tool_search.py`, `_tool_name_from_command`). The gateway pair is flag-gated and the flag defaults off, so a skill that names it is naming a tool the session does not have. | Load `call_tool` in Step 2 and address commands by their double-underscore wire names, which [engine.md § Step 2](engine.md#step-2--command-names-and-base_url) tabulates next to the prose form. `search_tools` is for a command the skill does not name. |
| An unfiltered `list_accounts()` for a prompt naming an account returned a large alphabetically-ordered page that ended before reaching that name. The model gave up and asked the user for the ID — never trying the tool's own `search` parameter, which resolves it in one call. | `list_accounts(search="<name>")`, never an unfiltered listing. |
| The stakeholder lookup was a second serial round trip before the form could open — `issuance_init` fetched reference data, *then* `cap_table:get:stakeholders` resolved the named people, even though neither depends on the other. | `issuance_init` takes `stakeholder_names` and returns a `stakeholders` section. Every section is gathered server-side in parallel, so the lookup costs no wall-clock and Phase 0.5 spends exactly one round trip. |
| A transient upstream failure — a Cloudflare **502 HTML error page** returned to a JSON call — was reported as *"the Carta MCP server isn't connected."* The server was connected and briefly unhealthy. The user re-checked a working connection, which is the "it wasn't connected but it was" complaint. | Classify before reporting: no Carta tool in the tool list = not connected; 5xx / gateway / HTML body / timeout = transient, **retry once**, then report a temporary problem. An HTML response to a JSON call is an outage signal, never content to parse. |
| Computing percent-of-fully-diluted, a user guessed `cap_table:get:cap_table_summary` and got *"Unknown command"* — a guess made attractive by carta-reporting's real `cap_table_summary_report` — then had to run `search_tools` mid-flow to find the actual totals command, `cap_table:get:cap_table_by_share_class`, whose name reads as a per-class breakdown rather than the totals source it is. | The totals command is hardcoded in [engine.md Step 2](engine.md#step-2--command-names-and-base_url) alongside every other name, so the closed discovery door has nothing missing behind it. There is no `cap_table:get:cap_table_summary`. |

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
| A model conflated `acceleration_templates`' genuine `count: 0` with `document_sets`, told the user *"…doesn't have any option-grant document templates set up yet"* and **aborted the whole issuance** — when `document_sets` had actually returned `count: 1`. The misread stop fired on the side-panel flow, before the panel ever opened. | Read each `issuance_init` section under its own name. Only [engine.md's Account-setup gate](engine.md#account-setup-gate-option-grant-and-piu) may stop over a count, and only the one section that gate names for the active type, read under its exact name — `document_sets` on option grants, `certificate_share_classes` on PIUs. Every other section's zero is a normal state. A section joins the gate only after its proposed stop is checked against this incident. |
| The unfiltered `detail=full` roster **truncated at 150 of 167** stakeholders — it paid full latency *and* still missed people. | Resolve named recipients through `issuance_init`'s `stakeholder_names`, never by pulling the whole roster. A truncated page is indistinguishable from a short one. |
| Each grantee was resolved with its own `search` call — one serial round-trip per person. For a 10-person batch this was the dominant contributor to a ~7-minute runtime. | Stakeholder calls are bounded by roster **misses**, never by row count. Concatenating every name into one `OR`-ed `search` to disguise a per-row loop is the same bug. |
| A leftover JSON file from an earlier, unrelated run on the same corporation was reused instead of regenerated, because it "looked right". | Any file you hand a script is written fresh from this turn's own fetch, in this session's scratchpad. Never read one back and never inherit one. |
| Several named grantees were resolved with **one concatenated `search=`**, exactly as the skill then instructed ("issue one call covering them all"). The stakeholders endpoint inherits DRF's stock `SearchFilter`, which **AND-s** whitespace-separated terms across `full_name`/`email` — so `search="Jane Doe Bob Smith"` asks for a single human matching all four terms. It returned an empty list with a healthy `200`, indistinguishable from "nobody on this cap table". Commas don't escape it either: `search_smart_split` strips them before the AND. The run read the emptiness as "all new stakeholders", and the user saw it as "it couldn't find the employees" followed by several retries. | `search` is single-person only. Several people go through `stakeholder_names` (Phase 0.5) or `names=` (Phase 1). **A zero-result `search` that contained more than one name is a malformed query, not an absent person** — never conclude the people are new from one, because the silent outcome is duplicate stakeholders on a real cap table. |

---

## Silent data loss

| Incident | Rule it produced |
|---|---|
| A row reached `issue_securities` with `stakeholder_id=null`. Because name and email were also null it slipped duplicate detection, created **zero securities, and returned success** — so the user was told the batch was "in draft" when it could never issue. | The pre-save assertion: every `always` field holds a non-null value before any `save_drafts` or `issue_securities`. `save_drafts` accepts incomplete rows silently. |
| A user set an absurd quantity, clicked Review, reviewed an **unvalidated** summary, and only found out at the final **Confirm & Issue** that the server rejected it ("Not enough shares in the option plan") — after a draft row had already been silently created. | Save + validate *before* the review surface renders (Phase 1.5), not after it is confirmed. |
| A PIU was requested **with** a corresponding interest, on a named unit class. The share-class read returned no `has_corresponding_interest` key — not `false`, absent — because `ShareClassView` then omitted the field for corporations not yet enrolled in corresponding-interest admin issuance. The skill dropped the request, issued the unit anyway, and told the user *"Carta shows no link configured for this unit class"* — an assertion the evidence did not support; the manage-share-classes page showed the link plainly. The holder ended up with **zero records in the linked operating company**: a one-sided grant that reads as complete. | An absent key is **unknown**, never "no" — never report it as a configuration fact. An explicit request is never silently dropped: send it and let `DraftCorrespondingInterestValidator` rule, or block the review and say what you could not see (SECM-5751). |

---

## Confirmation gates

| Incident | Rule it produced |
|---|---|
| A fresh submit signal was second-guessed as a stale replay — the model asked *"did you mean to submit again?"* — which both stacked a question on what should have been a direct branch and made the click look like it "did nothing" until the user typed "continue" by hand. Every click POSTs and overwrites the action-request file, so a signal you have not branched on yet is real. | Branch directly on the action. Never re-ask after a confirmation. |

## Connection claims

| Incident | Rule it produced |
|---|---|
| A run opened by telling the user *"The Carta connector isn't authorized in this session"* and ended its turn. Carta was connected the whole time; the model had read `mcp__carta__authenticate` in its tool list — a *different*, local stdio server — as Carta needing auth. It took the user replying *"I am already connected"* to restart. | An `mcp__carta__authenticate`-shaped name is a local stdio server, never a verdict on the connection ([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)). |
| It happened again, on 2026-09-23, with the rule in place. This time the source was the host's own reminder, *"The following MCP servers require authentication before their tools can be used: carta … Tell the user that these servers need to be authorized"*. It arrived after the skill text, so it was the last instruction the model read, and the model relayed it word for word. `carta` was a local server the run never calls. | The rule quotes that reminder verbatim and says it names the local server ([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)). A paraphrase does not survive an explicit "tell the user" that arrives later. |
| A user on Demo was asked about Test. The most likely cause: a session that names its connector by UUID alone, where the only Carta connector name in the model's context was this skill's own worked example — which named the test connector. The model took it as the connected environment and hard-stopped on the mismatch with Demo. | Examples carry `<name>`, never a real connector. The connected Carta is the Carta connector whose tools the session has; when the request names an environment the session doesn't confirm, one `get_current_user` settles it ([SKILL.md § The connected Carta must be the intended Carta](../SKILL.md#the-connected-carta-must-be-the-intended-carta)). |

## Surfaces that cannot carry a form

Two rendering tools reach this skill's hosts and neither can carry an issuance form. The rule
in [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) is absolute because each failure
below is silent — the run looks like it worked.

| Tool | What went wrong |
|---|---|
| `show_widget` | Takes its HTML as an inline **string**, with no path form, no cache and no diff, so the whole document crosses the model's output tokens on every render. One traced run spent **256 seconds** re-emitting a 47KB form twice, after passing the docs' own `$FORM_HTML_PLACEHOLDER` token through verbatim and then failing twice on required arguments the examples omitted. It also **hangs silently past ~18.5KB** rather than erroring (carta/fund-admin#65619) — that form was 47KB. And on Claude Code its `sendPrompt` return path is defined but **no-ops**, so the form the user finally saw could never have been submitted. |
| `preview_start` | It opens an address in Claude's browser. The companion path uses it only for a page Carta returned ([companion-surface.md § 4](companion-surface.md#4-open-the-page-at-once)); a form the skill builds there has no way to reach Carta or this session. |
