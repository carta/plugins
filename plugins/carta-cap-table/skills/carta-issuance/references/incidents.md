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
| The skill shelled out to `find … generate.py` to detect the side-panel renderer. In Cowork that command **always** returns `RENDERER_MISSING` — the sandbox has no such path — so it burned a round trip to learn what the tool list already said. Worse, the old wording ("never assume the panel is unavailable — run the probe") trained the model to distrust its own tool list, so it ran the dead probe *and then* fell back to chat anyway. | Pick the surface from the tool list, never from the disk. `Bash(find *)` was removed from `allowed-tools` so the capability is gone, not merely discouraged. |
| `set_context` was called on a corporation and **failed**, costing a round trip and changing nothing — the subsequent commands worked purely off their own `corporation_id`. | Never `set_context` for a corporation-scoped command. |
| `discover` / `search_tools` were called to look up command names the skill already hardcodes. A name-lookup tool is a pure round trip when you know the name. | Command names are hardcoded; `discover` is a debugging aid only. |
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
| A PIU was requested **with** a corresponding interest, on a named unit class. The share-class read returned no `has_corresponding_interest` key — not `false`, absent — because `ShareClassView` pops the field when `CORRESPONDING_INTEREST_ADMIN_ISSUANCE` is off for that corporation. The skill dropped the request, issued the unit anyway, and told the user *"Carta shows no link configured for this unit class"* — an assertion the evidence did not support; the manage-share-classes page showed the link plainly. The holder ended up with **zero records in the linked operating company**: a one-sided grant that reads as complete. | An absent key is **unknown**, never "no" — never report it as a configuration fact. An explicit request is never silently dropped: send it and let `DraftCorrespondingInterestValidator` rule, or block the review and say what you could not see (SECM-5751). |

---

## Confirmation gates

| Incident | Rule it produced |
|---|---|
| A fresh submit signal was second-guessed as a stale replay — the model asked *"did you mean to submit again?"* — which both stacked a question on what should have been a direct branch and made the click look like it "did nothing" until the user typed "continue" by hand. Every click POSTs and overwrites the action-request file, so a signal you have not branched on yet is real. | Branch directly on the action. Never re-ask after a confirmation. |

## The artifact surface

One traced Claude Desktop run, *"I want to issue 100 option grants to Tagg Palmer in IMIM"*.
It reached a published form in 76 seconds and then could not issue at all.

| Incident | Rule it produced |
|---|---|
| The run opened by telling the user *"The Carta connector isn't authorized in this session"* and ended its turn. Carta was connected the whole time; the model had read `mcp__carta__authenticate` in its tool list — a *different*, local stdio server — as Carta needing auth. It took the user replying *"I am already connected"* to restart, and the corrective `ToolSearch` then resolved every Carta tool in 10ms. | The artifact path makes no claim about the connection at all ([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)) — the page finds the connector itself at runtime, and an `mcp__carta__authenticate`-shaped name is a local stdio server rather than a verdict on anything. |
| It happened again, on 2026-09-23, with the rule in place. This time the source was the host's own reminder, *"The following MCP servers require authentication before their tools can be used: carta … Tell the user that these servers need to be authorized"*. It arrived after the skill text, so it was the last instruction the model read, and the model relayed it word for word. `carta` was a local server this path never calls. | The rule quotes that reminder verbatim, says it names the local server, and makes the build's `Bash` the first tool call with no text before it ([SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)). A paraphrase does not survive an explicit "tell the user" that arrives later. |
| The build command was copied with `${CLAUDE_PLUGIN_ROOT}` still in it. That variable is not exported into the Bash tool's shell — so it expanded to nothing and `uv run` failed on `/skills/carta-issuance/…`. The signature is a path starting with a bare `/skills/`. | The build block never writes `${CLAUDE_PLUGIN_ROOT}` ([SKILL.md § 2](../SKILL.md#2-build-the-page)): it sets `SKILL` to the absolute path [§ Where everything else lives](../SKILL.md#where-everything-else-lives) resolves, and says what the failure looks like. |
| The publish was rejected: *`"33b9b857-…" is the id of connector "Carta (Test)" — set "server" to "Carta (Test)"`*. Every Carta tool the model could see was named by that uuid, so it was the only identifier it had, and the display name appears nowhere else in that host's context. The retry differed by one string and worked. | The rejection **is** the name lookup. Publish with the segment, and when the host names the connector, republish with that name — one retry, expected, never reported as a failure. Carta's MCP server now states `Default connector name: "…"` in its instructions, so the segment is the fallback, not the first try ([SKILL.md § 3](../SKILL.md#3-publish-it)). |
| The user filled in the form, hit **Issue**, and nothing happened in Carta. By design the page stopped at a validated draft set and wrote a hand-off document for the model to pick up — but the publish result said *"Live subscription: skipped"*, so nothing notified the session, and the model's only read of that document fired **2.4 seconds after publish**, before a human could have clicked anything. The page's own success banner said *"Nothing is issued yet"*. | The artifact page performs the issue itself, behind its own confirm sheet ([SKILL.md § 4](../SKILL.md#4-the-page-issues-you-report)). A button labelled Issue that cannot issue is a broken promise whatever the plumbing. The model reads the hand-off at the start of its next turn to report, never to write. |
| Carta refused the save with *"Issue date can't be in the future"* — on a date the page itself had chosen. `today()` read `new Date().toISOString()`, which is UTC; the user was at UTC−3, so at 23:51 local the page stamped tomorrow. The same anchor fed `board_approval_date`, `vesting_start_date`, `grant_expiration_date` and the draft-set name. Carta's own validator compares against `America/Los_Angeles`, so the two clocks can differ by a day for eight hours daily. | Never read a calendar day off a UTC clock. `cap_table:get:issuance_bootstrap` returns `today` — the date the validator will accept — and the page anchors every date on it, falling back to the browser's **local** day. The two dates Carta refuses past today also cap their own pickers. |
| The review screen showed six grey `default — …` / `autofill — …` tags at once on a single-plan company, beside a red error box. Each was defensible alone; together they turned a confirmation into a diagnostic dump. | The review lists each term's label and value. The page still derives those values; it no longer annotates where each came from. |
| `Saving and checking…` was one line of text under the form, over three sequential round trips, with both buttons greyed out and no progress or timeout. Against a `save_drafts` call with a 30s ceiling it reads as a hang. | The save, the check, the one confirmation and the result all happen in a modal sheet that names the step it is on. |
| First paint drew the real controls with every dropdown empty and every derived price blank, which reads as a form with no answers rather than a form still loading — while seven runtime calls were still in flight. | The shared-terms grid is a skeleton until the terms land; the stakeholder rows are real from the first paint, because they carry what the prompt already said. |
| Eight reads before the form was usable: the bootstrap, then a six-call reference fan-out plus an eager 200-row roster page — six of which the bootstrap had **already fetched server-side and discarded**. | `include_sections=true` returns them with it, projected to the keys the form reads. One call. The fan-out stays as the fallback for an MCP that does not know the argument. |

## The artifact surface, second traced run

The same prompt again, *"I want to issue 100 option grants to Tagg Palmer in IMIM"*. It reached
a published form in **56 seconds** — and the form could not see Carta. The user said *"I am
connected"* three times, in capitals by the third, and the run talked them through a consent
prompt that was never going to appear before abandoning the page for the chat surface.

| Incident | Rule it produced |
|---|---|
| **The page declared a live connector absent, on every open.** `connect()` filtered servers on `s.tools.includes("call_tool")`, but `listTools()` answers with tool *descriptor objects* — `{name, description, annotations}` — so that test was false for every server that had the gateway. The page painted *"This page cannot see a Carta connector"* with empty dropdowns, which is indistinguishable from the user's connector really being off. Nothing in the page said what the host had actually answered, so three rounds of "I am connected" produced no new information for either side. | Read tool **names** out of the descriptors. A failure to confirm the connector logs what `listTools()` returned — servers, kinds, auth statuses, tool names — to the console, where the next run can read it. The copy still names a fix; the diagnosis is not the user's job. |
| **Declining the connector prompt left a form that could not work and did not say so.** `listTools()` never asks for consent, so the first `callTool` *is* the prompt. A viewer who declines gets `not_in_manifest` on every read — one of nine host error codes the page had no branch for — and `S.connErr` was only ever set by `connect()`. So the form rendered complete, with every dropdown empty and a live **Review and issue** that could never be satisfied, and a **Save as draft** that failed and invited the user to press it again. | Each error code carries its own copy and its own behaviour. A read that fails with a code no retry can clear disarms the footer and states the fix once, whatever stage the page is at — not once per section. |
| **The review screen called a vested grant unvested.** The row summary read `d.vesting_template ? name : "No vesting"`. On the wire `null` is the only "no vesting" — `rowPayload()` writes it deliberately — so template id `0` rendered as *No vesting* directly above a shared term naming a four-year schedule. The one screen whose job is to state what each holder is being given contradicted itself. | Compare against `null`, not truthiness, anywhere a server id decides user-facing text. |
| The turn opened with a `ToolSearch` for the Carta suffixes. The tools were already in the tool list, so it returned **empty** — the one answer that means "Carta is absent" — and cost a round trip to say nothing. The run read its own tool list correctly and carried on, which is the only reason this was harmless. | The artifact path opens with the build, never a probe. Where the tools really are needed — the chat surface — [engine.md § Step 1](engine.md#step-1--load-every-tool-in-one-toolsearch-call) loads them in one deterministic `select:` call. |
| The form's URL was given as `[Issue Option Grants — IMIM](https://…)`. On the host that opens the form in a side panel a markdown link renders as its title alone — so when the panel is the thing that is broken, the address is the one thing the user cannot see or copy. The user asked for the link in chat. | The bare URL goes on its own line, every time, including when the panel did open. |
| A hand-off write that never landed was reported as one that had. `handoff()` returns `false` when the store is unavailable or refuses the write, and no caller read it; the issued sheet said *"Claude has the result"* unconditionally. With `db: {}` only `interact` and above write shared documents, so a viewer the page was shared with read-only can issue — on their own connector credentials — and leave no hand-off at all. [SKILL.md § 4](../SKILL.md#4-the-page-issues-you-report) then tells the model a missing document is the normal unfinished state, which makes *"go ahead and issue"* a second issuance. | Every `handoff()` call site reads the result. When it does not land after a successful issue, the page names the draft set on screen and says not to issue again — the page is then the only record, so it has to be legible. |
| A `validate_drafts` that timed out after a `save_drafts` that succeeded sealed the page as outcome-unknown. Both calls sat in one `try` tagged `"save"`, so a failed **check** was treated as a write that may have landed: every button hidden, a `needs_claude / unknown_outcome` hand-off written, and the model sent to find out whether rows were issued when nothing had been attempted. | The save and the check carry their own tags. A failed check says the rows are saved and the check did not finish, and leaves the buttons live. |

**The two connection entries above contradicted each other, and this is how that resolves.**
The first run's rule — *say nothing about the connection until a `ToolSearch` for the suffixes
has come back empty* — and the second's — *`ToolSearch` is never the turn's first call* — left
no legal opening move, and a run with no legal move infers from the tool list instead, which is
the poisoned input that started the first incident. Both are history now.
[SKILL.md § Do not diagnose the Carta connection](../SKILL.md#do-not-diagnose-the-carta-connection)
supersedes them on the artifact path: there is no connection claim to make, so there is nothing
to settle and no probe to run. On the chat surface,
[engine.md § Step 1](engine.md#step-1--load-every-tool-in-one-toolsearch-call)'s single
`select:` call supersedes them both — it loads the tools and is the one place an absence is
ever concluded.

## Refusals the page read as approvals

Found by reading the wire against the server rather than from a run, so there is no user
report behind these — which is the point: each one is silent, and two of them end with the
page telling the user something reassuring and wrong.

| Incident | Rule it produced |
|---|---|
| **A validation that failed was reported as "no problems found."** `absorb()` derived its verdict from `validation.errors` being non-empty. But three kinds of refusal never appear in that map — `banner_errors` (a refused or vanished draft set), `corporation_errors` (the missing-signatory refusal `issue_securities` raises and `validate_drafts` does not) and `issuance_errors` — and a failed validation workflow reports only a `success` that is not `true`, naming nothing at all. All three keys sit *beside* `errors`, never inside it. The skill's own prose taught the wrong rule too: *"`validation.errors` — empty/absent → clean."* | **Clean is `validation.success === true`.** An empty error map is not a pass. Set-level messages are collected from the three sibling keys and said once, above the per-row lines. |
| **One unassigned signatory produced the worst message in the flow.** `issue_securities` refuses a set whose corporation has no signatory, returning the reason in `corporation_errors`. The page read neither that key nor `success`, fell through every branch, and landed on *"Carta accepted the request and reported nothing issued — ask Claude to check this draft set in Carta. Do not issue again from here"* — then sealed itself. The user was handed a possible-partial-write dead end, for a cause that is one click to fix and where nothing had been attempted. | The same fix: the refusal is surfaced in Carta's own words at the moment it happens. A sealed page is for an outcome nobody can establish, never for a refusal that named itself. |
| **`include_sections: true` was silently ignored, so one call was seven.** The gateway types a plain command's scalars as `str \| int \| dict \| list` — no `bool` — so a JSON boolean arrives as `1`, and the server's `value is True` check misses it. The sections came back absent with no error, and the page's own fallback quietly ran the six-call per-section fan-out plus a 200-row roster page on every open. Verified live: `"true"` returns the fat payload, `true` returns the lean one. | Send `"true"`. A string boolean is a supported wire form on this gateway, and the one-call boot is the whole reason the argument exists. The fan-out stays as the fallback, but it must not be reachable by a typo. |

## Surfaces that cannot carry a form

Two rendering tools reach this skill's hosts and neither can carry an issuance form. The rule
in [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) is absolute because each failure
below is silent — the run looks like it worked.

| Tool | What went wrong |
|---|---|
| `show_widget` | Takes its HTML as an inline **string**, with no path form, no cache and no diff, so the whole document crosses the model's output tokens on every render. One traced run spent **256 seconds** re-emitting a 47KB form twice, after passing the docs' own `$FORM_HTML_PLACEHOLDER` token through verbatim and then failing twice on required arguments the examples omitted. It also **hangs silently past ~18.5KB** rather than erroring (carta/fund-admin#65619) — that form was 47KB. And on Claude Code its `sendPrompt` return path is defined but **no-ops**, so the form the user finally saw could never have been submitted. |
| `preview_start` | Not present on any host that reaches this skill. Where it exists the `Artifact` tool exists too, and [the surface table](../SKILL.md#pick-the-surface) takes that row first. |
