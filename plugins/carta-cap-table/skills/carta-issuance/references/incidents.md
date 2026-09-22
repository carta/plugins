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
| An `AskUserQuestion` was stacked on an open side panel. The open question suspends the panel's submit watcher, so the user's click never landed. | While the server panel is open, emit no `AskUserQuestion` ([SKILL.md § 4 Wait](../SKILL.md#4-wait)). The button is the gate. The chat surface has no watcher, so its recovery questions are unrestricted. |
| A fresh submit signal was second-guessed as a stale replay — the model asked *"did you mean to submit again?"* — which both stacked a question on what should have been a direct branch and made the click look like it "did nothing" until the user typed "continue" by hand. Every click POSTs and overwrites the action-request file, so a signal you have not branched on yet is real. | Branch directly on the action. Never re-ask after a confirmation. |
| The `cap_table_issuance_panel` call returned a clean payload, the model said the panel opened, and it waited — the host silently never rendered the `ui://` view. The user had to say *"where is the panel?"* and then *"I don't see it"* before the run left the wait, because nothing treated the first report as the trigger; it read as a hypothesis to double-check instead of a fact to act on. | [SKILL.md § 4 Wait](../SKILL.md#4-wait): the first user report that they don't see the panel **is** trigger 3 firing — there is no timeout or liveness signal, so the user's own words are the only observable proof, and one report is enough. That report also retires the submit watcher, so `AskUserQuestion` is no longer restricted from that point on. |

## The artifact surface

One traced Claude Desktop run, *"I want to issue 100 option grants to Tagg Palmer in IMIM"*.
It reached a published form in 76 seconds and then could not issue at all.

| Incident | Rule it produced |
|---|---|
| The run opened by telling the user *"The Carta connector isn't authorized in this session"* and ended its turn. Carta was connected the whole time; the model had read `mcp__carta__authenticate` in its tool list — a *different*, local stdio server — as Carta needing auth. It took the user replying *"I am already connected"* to restart, and the corrective `ToolSearch` then resolved every Carta tool in 10ms. [§ Carta is connected](../SKILL.md#carta-is-connected--read-this-before-you-conclude-otherwise) already said this and was not followed. | Say nothing about the connection until a `ToolSearch` for the suffixes has come back **empty**. The rule is now an ordered action rather than a caveat. |
| The build command was copied out of `artifact-surface.md` with `${CLAUDE_PLUGIN_ROOT}` still in it. That variable is substituted in **skill content** and not in a file opened with `Read`, and it is not exported into the Bash tool's shell — so it expanded to nothing and `uv run` failed on `/skills/carta-issuance/…`. The signature is a path starting with a bare `/skills/`. | `artifact-surface.md` never writes `${CLAUDE_PLUGIN_ROOT}`: the command sets `SKILL` to the absolute path SKILL.md already resolved, and says what the failure looks like. |
| The publish was rejected: *`"33b9b857-…" is the id of connector "Carta (Test)" — set "server" to "Carta (Test)"`*. Every Carta tool the model could see was named by that uuid, so it was the only identifier it had, and the display name appears nowhere else in that host's context. The retry differed by one string and worked. | The rejection **is** the name lookup. Publish with the segment, and when the host names the connector, republish with that name — one retry, expected, never reported as a failure. |
| The user filled in the form, hit **Issue**, and nothing happened in Carta. By design the page stopped at a validated draft set and wrote a hand-off document for the model to pick up — but the publish result said *"Live subscription: skipped"*, so nothing notified the session, and the model's only read of that document fired **2.4 seconds after publish**, before a human could have clicked anything. The page's own success banner said *"Nothing is issued yet"*. | The artifact page performs the issue itself, behind its own confirm sheet ([artifact-surface.md § 4](artifact-surface.md#4-the-page-issues-you-report)). A button labelled Issue that cannot issue is a broken promise whatever the plumbing. The model reads the hand-off at the start of its next turn to report, never to write. |
| Carta refused the save with *"Issue date can't be in the future"* — on a date the page itself had chosen. `today()` read `new Date().toISOString()`, which is UTC; the user was at UTC−3, so at 23:51 local the page stamped tomorrow. The same anchor fed `board_approval_date`, `vesting_start_date`, `grant_expiration_date` and the draft-set name. Carta's own validator compares against `America/Los_Angeles`, so the two clocks can differ by a day for eight hours daily. | Never read a calendar day off a UTC clock. `cap_table:get:issuance_bootstrap` returns `today` — the date the validator will accept — and the page anchors every date on it, falling back to the browser's **local** day. The two dates Carta refuses past today also cap their own pickers. |
| The review screen showed six grey `default — …` / `autofill — …` tags at once on a single-plan company, beside a red error box. Each was defensible alone; together they turned a confirmation into a diagnostic dump. | The review lists each term's label and value. The page still derives those values; it no longer annotates where each came from. |
| `Saving and checking…` was one line of text under the form, over three sequential round trips, with both buttons greyed out and no progress or timeout. Against a `save_drafts` call with a 30s ceiling it reads as a hang. | The save, the check, the one confirmation and the result all happen in a modal sheet that names the step it is on. |
| First paint drew the real controls with every dropdown empty and every derived price blank, which reads as a form with no answers rather than a form still loading — while seven runtime calls were still in flight. | The shared-terms grid is a skeleton until the terms land; the stakeholder rows are real from the first paint, because they carry what the prompt already said. |
| Eight reads before the form was usable: the bootstrap, then a six-call reference fan-out plus an eager 200-row roster page — six of which the bootstrap had **already fetched server-side and discarded**. | `include_sections=true` returns them with it, projected to the keys the form reads. One call. The fan-out stays as the fallback for an MCP that does not know the argument. |

## Surfaces that cannot carry a form

Two rendering tools reach this skill's hosts and neither can carry an issuance form. The rule
in [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) is absolute because each failure
below is silent — the run looks like it worked.

| Tool | What went wrong |
|---|---|
| `show_widget` | Takes its HTML as an inline **string**, with no path form, no cache and no diff, so the whole document crosses the model's output tokens on every render. One traced run spent **256 seconds** re-emitting a 47KB form twice, after passing the docs' own `$FORM_HTML_PLACEHOLDER` token through verbatim and then failing twice on required arguments the examples omitted. It also **hangs silently past ~18.5KB** rather than erroring (carta/fund-admin#65619) — that form was 47KB. And on Claude Code its `sendPrompt` return path is defined but **no-ops**, so the form the user finally saw could never have been submitted. |
| `preview_start` | Not present on any host that reaches this skill. A host that has it has the panel, which outranks it. |
