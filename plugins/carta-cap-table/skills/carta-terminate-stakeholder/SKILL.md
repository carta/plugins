---
name: carta-terminate-stakeholder
description: >-
  Offboard someone who left: stop vesting and set exercise deadlines. Terminates the
  stakeholder on the Carta cap table, cancels unvested equity, and sets the
  post-termination exercise deadline on vested equity. Use when the user asks to
  terminate, offboard, or end someone's relationship with the company, or says
  "terminate", "offboard", "they've left", "they resigned", "we laid off", "last day
  was", "mark as departed", "stop their vesting", or names a departure and a date. Also
  USE WHEN terminating several stakeholders at once (a layoff or RIF batch). Covers
  option grants, RSUs, SARs, CBUs, certificates, RSAs and PIUs. Share transfers (e.g. to
  an estate) are handed off to carta-manage-securities, not performed.
owner: Hire & Retain
model: inherit
allowed-tools:
  - AskUserQuestion
  - Skill(carta-cap-table:carta-manage-securities)
  - Read
  - ToolSearch
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__list_accounts
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_accounts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_accounts
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.123.0</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Terminate a Stakeholder

Walk a company admin through terminating one or more stakeholders on a Carta cap table —
the same flow as **Stakeholders → Terminate** in the Carta web app.

This is the most consequential write in the cap-table surface. It stops vesting, cancels
unvested equity, and starts a clock on vested equity that the holder can miss. **An admin
cannot undo it themselves** — reversal requires Carta staff (see [Reversal](#reversal)). So
the review gates below are not a formality; they are the last point at which a mistake is cheap.

The flow is five steps, mirroring the app:

1. **Establish the company, then the stakeholder(s)** — resolve both to Carta records.
2. **Termination date + reason** — plus the post-termination relationship.
3. **Review the securities** — what happens to each holding, with per-security deadlines.
4. **Confirm** — two separate stops: check the full consequence, then a final yes.
5. **Write** — `apply_plan` on the previewed plan, then follow its job and report per person.

Read **[references/security-treatment.md](references/security-treatment.md)** before
presenting the review step, and
**[references/errors.md](references/errors.md)** when any call fails.

Send `_instrumentation_v2: {"surface": "<surface>"}` with every Carta tool call, as a parameter
of the tool next to `name` and `arguments`, never in `arguments`. `<surface>` is the closest of
`chat`, `cowork`, `code-terminal`, `code-desktop`, `code-remote`, `excel`, `sdk-cli`,
`sdk-typescript` and `sdk-python`, else `other`. Run no shell command for this or any other
`_instrumentation_v2` field: send `session_id` only when your system prompt already shows it.

## When to use

*"Terminate Jamie Chen — last day was March 14."* · *"Jordan resigned effective 2026-04-01,
please offboard them."* · *"We laid off 4 people on Friday, here are their names."* ·
*"Mark Priya as departed and stop her vesting."* · *"Alex passed away last month — we need
to update the cap table."*

## Out of scope

- **Reversing or correcting a completed termination** — per security that is
  `carta-manage-securities`; the relationship change and the recorded date need Carta
  Support. See [Reversal](#reversal).
- **Warrants, convertible notes and SAFEs** — not part of the termination flow at all. Step 3
  reads what the stakeholder holds of each and reports it; nothing here changes them.
- **Editing a grant's terms or vesting schedule** outside a termination — that's
  `carta-manage-securities` / the Carta app. A PTEP policy change is the Carta app.
- **Cancelling or repurchasing a single security** without terminating the person. That is
  `carta-manage-securities`.
- **Performing a share transfer** (to an estate, a trust, or a new holder) — that is
  `carta-manage-securities`; see [Transfers](#transfers).
- **Advising whether to terminate, or on severance, or on the tax treatment** of any choice
  here. Present what Carta will record; the decision and its legal/tax consequences are the
  company's and its advisors'.

---

## Hard rules

1. **Never guess the date or the reason.** Both change what the holder gets: the reason
   selects which post-termination exercise period (PTEP) the server applies, and the date
   sets vesting cutoff and every deadline. If the user didn't state one, ask. An HRIS prefill
   is a *suggestion to confirm*, never a silent default.
2. **Always run the preview and show it before confirming.** The preview saves a plan and
   writes nothing; `apply_plan` commits that exact plan. So what the user approves is what
   runs — provided you show them the preview. Never go from a date straight to `apply_plan`.
3. **Two stops before the write, both with `AskUserQuestion`, and both written by this skill.**
   First a preview the user checks (*Looks right / Change something / Cancel*), then a separate
   final question naming the point of no return (*Terminate N stakeholder(s) now / Not yet*).
   Never count on the host's own approval prompt as one of them — it is absent when tools are
   auto-approved. Free text is not a yes: anything but the affirmative option stops the flow.
   One approval covers one `apply_plan` call, never the next.
4. **Ask repurchase-vs-forfeit for an RSA. Never ask for a PIU — derive it.** The two are
   materially different for the holder, and the Carta page treats them differently: an RSA is
   the company's choice, which the user makes, while a PIU's is read from the preview. Asking
   about a PIU offers a choice Carta does not have. See
   [security-treatment.md](references/security-treatment.md#rsas-and-pius).
5. **A deadline you override goes into the preview, not a separate check.** Put it in
   `deadlines` and preview again. A date Carta refuses comes back as a failed check naming that
   security, with `status: "blocked"` and no plan — so a bad date never reaches a commit.
6. **`apply_plan` answering is not the termination finishing.** It starts a job and returns a
   `task`. Read `cap_table:get:task` until `done`, then report per stakeholder from `rows` and
   `counts`: a job can answer `partially_failed` with one stakeholder terminated and one not.
7. **Re-sending the same `plan_id` is safe; previewing again after a commit is not.**
   `apply_plan` commits a plan once and returns the stored result on a second call, so a
   timeout is retried with the same `plan_id` and summary. Never run a fresh preview and apply
   that instead — it double-terminates.
8. **Surface the server's messages verbatim.** Termination errors name a specific security and
   rule; paraphrasing strips the detail that tells the user what to fix.
9. **Never delegate this skill to a background agent.** It requires interactive gates, and an
   agent cannot hold the confirmation.
10. **Keep ids out of customer-facing text.** *"Terminated Jamie Chen on Acme"*, not
    *"terminated stakeholder 8821 on corp 40"*.

## Voice

The audience is an admin or HR/People operator — often not an equity specialist, and usually
doing this on a bad day, about a real colleague. Match that.

- **Plain, unceremonious, and precise.** No euphemism ("separated from the business") and no
  breeziness. State what the record will say.
- **Explain any jargon the first time** — *PTEP*, *unvested*, *forfeit vs. repurchase*,
  *post-termination relationship*. One clause is enough: *"their post-termination exercise
  period (PTEP) — the window to exercise vested options before they expire)"*.
- **Explain anything the skill chose.** A derived relationship, an HRIS-prefilled date, a
  server-computed deadline — each gets a one-line note on where it came from. Never let a
  value the user didn't type look like one they did.
- **Dates as `D Mon YYYY` for display** (*14 Mar 2026*) — `03/04/2026` reads as two different
  days to a US and a UK admin, and these are deadlines people miss. The payload uses ISO
  `YYYY-MM-DD`.
- **Say "units" not "shares" for profits interest units.** A PIU is an LLC instrument and its
  quantity is units. Nothing in this flow reports a company-wide unit label, so take the word
  from the security in front of you rather than applying one label to the whole termination.
- **Quantities exact, with units** — *"800 unvested options"*, not *"some unvested equity"*.

---

## Phase 0 — Preflight

**Pick the Carta server first.** `mcp__carta__*` in this file stands for the session's Carta
server, and a session can have several (production, sandbox, test, …). With exactly one, use
it. With several, ask which environment before gathering anything else, and **never default to
production** — a termination on the wrong environment is still a real termination. Use that
server's prefix in every call below.

**Load the connector tools in one call**, so nothing loads at an interactive moment:

```
ToolSearch: "select:mcp__carta__read_tool,mcp__carta__welcome,mcp__carta__list_accounts"
```

Every command below goes through `read_tool` — including the preview, which saves a plan but
changes nothing on the cap table. Its argument keys are **`name`** and **`arguments`**, and the
`name` is the command with **double underscores** (`cap_table__get__stakeholders`); the colon
form below is prose, never the argument. These commands are hidden from `tools/list`, so load
`read_tool`, never the command names, in the `ToolSearch` above.

**The apply is the exception: it is a tool of its own, and Carta refuses it through `read_tool`
or `call_tool`.** It is often deferred, so load it with a second `ToolSearch` (`+apply_plan`)
**right after the one above** — here, where nothing is interactive, never at 4b. If no apply
tool loads, say so now and stop, rather than taking the user through both stops and failing at
the write ([errors.md](references/errors.md#the-apply-tool-is-not-available)).

| Purpose | Command | Tool |
|---|---|---|
| List the companies on the account | — | `list_accounts` |
| Resolve a name to a stakeholder | `cap_table:get:stakeholders` | `read_tool` |
| Per-stakeholder defaults (relationship, HRIS date, exercise windows) | `cap_table:get:stakeholder_bootstrap` | `read_tool` |
| Stage the termination: the securities it ends, and a plan | `cap_table:compute:terminate_stakeholders_preview` | `read_tool` |
| What else the holder holds (warrants, notes, SAFEs) | `cap_table:list:securities` | `read_tool` |
| One security's own terms and vesting | `cap_table:get:security` | `read_tool` |
| One grant's stored deadline, after the write | `cap_table:get:option_grant` | `read_tool` |
| **Commit the previewed plan** | `cap_table:mutate:apply_plan` | the **named** `cap_table__mutate__apply_plan` tool |
| Follow the job the commit started | `cap_table:get:task` | `read_tool` |

The flow depends on the Carta MCP server. If no Carta MCP tool is available (none in the tool
list, or `welcome` errors), **stop before gathering any input**:

> *"I can't reach Carta — the Carta MCP server isn't connected. Connect it and try again."*

**Permissions.** The flow needs **HR permission** and **TERMINATIONS product access**.
`stakeholder_bootstrap` reports the first as `permissions.can_terminate: false` rather than
failing, and the preview answers **403** without them. Either way it is a
company-access problem, not something to retry or work around:

> *"Your Carta login doesn't have the access needed to terminate stakeholders (HR permission
> plus the Terminations product). Ask a full-access admin at \<company\> to grant it, or to
> run the termination."*

A **share-class-scoped limited admin** may also be blocked when the stakeholder's holdings
fall outside their scope. Surface that as-is rather than retrying.

---

## Step 1 — Establish the company, then the stakeholder(s)

### 1a — The company

Every later call needs this company's id, so settle it first — and **never go hunting for one
on your own initiative**. Send it as `corporation_id` to `cap_table:get:stakeholders`, and as
`company` to every other command here. It is the same id; only the key differs.

```
mcp__carta__list_accounts({"search": "<company name>"})   # or ({}) when no company was named
```

It returns `id: "corporation_pk:<n>"`; `<n>` is that id.

| Situation | Do |
|---|---|
| The user already named a company (this or an earlier turn) | Use it. Resolve the name with `list_accounts`' `search` param; confirm only if the match is inexact. |
| **Exactly one** company on the account | **Propose it, don't interrogate** — state it and carry on: *"Terminating on \<company\> — pulling Jamie's record."* The user corrects you if it's wrong. |
| **Several** companies | **Ask which**, with `AskUserQuestion`, one option per company (name · a distinguishing detail). Never pick, and never terminate against a guess. |
| Many companies (`total_count` above the accounts listed) | Don't page through them all. Ask the user to name it, then resolve with `search`. |
| **No** company | Stop: *"I don't see a company on your Carta account to terminate from."* |

Hold the `corporation_id` for the rest of the run; don't re-resolve it at each step. Keep it
out of customer-facing text (Hard rule 10) — say the company's **name**.

**Take the company name from `list_accounts`**, not from later responses — `meta.company.name`
on the cap-table commands can be null. If `list_accounts` itself returns a blank name, ask the
user to name the company and resolve it with `search`. A bare id is not something to show the
user or to act on silently; never present *"corporation 2456"* as a choice.

### 1b — The stakeholder(s)

Resolve every name to a Carta record before collecting anything else.

```
mcp__carta__read_tool({"name": "cap_table__get__stakeholders", "arguments": {
  "corporation_id": <corporation_id>, "search": "Jamie Chen"}})
```

- **No match** — say so and stop; don't fuzzy-match a person for a termination:
  *"I don't see a stakeholder matching "Jamie Chen" on Acme. Check the spelling, or the name
  on the cap table (it may be a legal name)."*
- **One match, but not the name the user gave** — the search is a loose match, so
  *"Jamie Chen"* can return *"Jaime Chen"*. Confirm before going on:
  *"The cap table has "Jaime Chen" (Employee) — is that who you mean?"* Only an exact
  match proceeds without asking.
- **Several matches** — present a small disambiguation table (name · relationship · email
  domain) and ask which. Never pick for the user.
- **Already terminated** — the search row's `event_relationship` starts with `Ex-`. Don't
  terminate them again; it can't fix anything ([Reversal](#reversal)). Alone, stop: *"Jamie
  Chen is already terminated on Acme. Changing a recorded termination needs Carta Support —
  see below."* In a batch, drop only that person, name them, and carry on with the rest.

Then pull the defaults for everyone in the batch — **one call, all ids**. Note it takes
`stakeholder`, not `stakeholder_ids`:

```
mcp__carta__read_tool({"name": "cap_table__get__stakeholder_bootstrap", "arguments": {
  "company": <corporation_id>, "stakeholder": ["8821", "8822"]}})
```

**Read `blockers` first, before anything else in the response.** Each one carries a
`severity`: `hard_stop` means do not go on — say its `message` and stop; `needs_decision`
means ask the user before continuing; `informational` means tell them and carry on. Every
blocker also carries a `fix` worth passing along.

Then `permissions.can_terminate`. False means this login cannot terminate on this company —
stop and route to a full-access admin rather than calling anything else.

The per-stakeholder defaults are in **`sections.terminations`**, one entry per stakeholder:

- **`new_relationship`** — the post-termination relationship the server derives from the
  current one (Employee → Ex-Employee, Consultant → Ex-Consultant, Advisor → Ex-Advisor, and
  so on). **Null** when there is no `Ex-` counterpart — **Founder**, Executive, Officer,
  Investor — and *only then* ask the user to choose. It is required at submit, so a null must
  be resolved.
- **`termination_date` / `termination_reason`** — prefilled from the company's HRIS
  integration when there is one, and null when there isn't. **Confirm; never silently adopt**
  (Hard rule 1): *"Your HRIS has Jamie's last day as 14 Mar 2026, reason Voluntary — is that
  right?"* A prefilled reason is a suggestion like any other: check it against the offerable
  set in [Step 2](#termination-reason) before showing it, and hand off if it isn't there.
- **`option_grants`** — each grant a termination changes, with its `expiration_date` and an
  `exercise_windows` entry **per termination reason**. This is how long the holder would have
  to exercise under each reason, so you can show the consequence of the choice *while the user
  is making it*, before the Step 3 preview. Use it; it is the one thing the old flow could not
  answer.
- **`option_grant_count`** — the real number, which can exceed the grants listed when the
  response hit `limits.option_grants`. Check it before saying "all of them".

Two other sections matter: **`fields.termination_reason`**, which narrows the Step 2 options
to this company's reasons; and **`sections.stakeholders.rows`**, which carries each holder's
`name`, `email` and current `relationship` for the confirmation text.

An id that is not on this company simply has no entry in `sections.terminations`. Name any id
you asked for and did not get back, and drop it rather than guessing.

**Batch terminations (a layoff) run as one call**, sharing a date, a reason and a
`new_relationship` — the last is one value for every id in the preview call. **At most 10 stakeholders
per call**; a larger layoff is several runs, and say so rather than silently dropping anyone.
Split into separate runs too, and say so, when people need a different date, reason, or
relationship override: an Executive's null filled with *Ex-Employee* must not ride in the same
call as a Consultant, or the Consultant is recorded as Ex-Employee too. Each run is its own
pass through Steps 3–5, with its own preview and its own two stops; an approval for one run
never covers the next. The preview answers one entry per stakeholder, so the review table is
per person.

---

## Step 2 — Termination date and reason

### Termination date

ISO `YYYY-MM-DD` in the payload; accept whatever the user says (*"last Friday"*, *"3/14"*) and
**echo the resolved date back for confirmation** — never resolve a relative date silently.

The date is the vesting cutoff and the anchor for every deadline. What the server enforces:

- **Cannot be before a security's issue date** (E197).
- **Cannot be after a deadline it anchors** — a last day to exercise, settle or repurchase has
  to fall on or after it.
- **Future dates are allowed** — for options, certificates, and repurchased RSAs/PIUs. This is
  normal for a known last day.
- **But a future date is rejected when forfeiting** an RSA (`SERVICE` type) or a PIU
  (`WITHOUT_CAPITAL_INVESTMENT`). Since a PIU is forfeited whenever the preview gives it no
  last day to repurchase, **a holder with such a PIU cannot be terminated on a future date at
  all** — surface that conflict rather than picking a way out of it.

There is **no** rule against a date before a prior termination, and no global no-future rule.
Don't invent constraints; let the server speak (Hard rule 8).

### Termination reason

Ask which applies — **it selects the PTEP the server applies**, so it is a substantive choice,
not metadata.

**Which reasons to offer, in one rule:** `fields.termination_reason` from the bootstrap is this
company's list, and it is the **offerable set**. Offer those values as `AskUserQuestion`
options, labelled exactly as the bootstrap spells them, and send the label unchanged. The
preview refuses anything else, naming the company's own list in the refusal.

**Every reason that reaches the user comes from that set** — one you inferred from their
words, one a leaver term maps to, or one HRIS prefilled. Check each against the set before
you put it in front of them; none of the three is exempt.

**When the set can't give you a reason, stop rather than improvise.** If it is empty, or the
value the user's words point at isn't in it, say so and hand off: *"Acme's termination reasons
in Carta don't include one that matches 'let them go'. Set the reason on Acme's Terminate page
in Carta."* Same if `fields.termination_reason` is missing from the response — it wasn't
loaded, so you don't know this company's reasons; say that and hand off rather than guessing a
list. The reason sets the holder's exercise deadline, so a guess here is a wrong deadline, not
a tidy default.

What each value means, for the ones a company usually lists:

| Value | What it means |
|---|---|
| Voluntary | They chose to leave — resignation, new role, end of contract. |
| Involuntary | The company ended it without cause — layoff, RIF, restructuring, performance. |
| With cause | Ended for cause — misconduct, policy violation, breach. Usually the harshest PTEP. |
| Retirement | |
| Disability | |
| Death | Handle with particular care; the holder's estate inherits the deadlines. |
| Good leaver / Bad leaver | A UK/EU convention some companies use in place of Involuntary and With cause. What counts as each is set by the company's plan or articles — a bad leaver is often someone who resigned — so confirm rather than inferring from how they left. |

**Infer a reason only from unambiguous wording, only if it is offerable, and still confirm
it.** *"laid off"*, *"RIF"*, *"position eliminated"*, *"restructuring"* → Involuntary.
*"resigned"*, *"quit"*, *"took another job"* → Voluntary. *"misconduct"*, *"for cause"*,
*"policy violation"* → With cause. *"passed away"* → Death. Each of those holds only when the
value is in the offerable set; when it isn't, hand off rather than offering it. Anything
vaguer (*"we let them go"*, *"it didn't work out"*) is **ambiguous between Involuntary and
With cause** — the two with the most different consequences for the holder. Ask.

*"Good leaver"* and *"bad leaver"* map to those values where a company lists them and not the
leaver terms, and go through as themselves where it lists the leaver terms. Either way the
offerable set decides, and either way confirm.

### Post-termination relationship

Use the derived `new_relationship` from `stakeholder_bootstrap` and **say where it came from**:
*"Their relationship will change from Employee to Ex-Employee."* Only ask when it is null
(Founder, Executive, Officer, Investor).

**Offer the values from that company's own `fields.relationship`, never a list from memory.**
The set is per company: it carries Carta's standard relationships plus the company's own, and
which `Ex-` values a company has depends on when it was created — `Ex-Founder` reaches some
companies and not others. Read the list, filter it to the `Ex-` values, and offer those. A
value you supply from memory is rejected for the companies that don't carry it, and a value
you leave out is one the admin needed.

Pass `new_relationship` **to the preview** only when overriding or filling a null; omit it to
let the server derive one per stakeholder.

---

## Step 3 — Review the securities

The staging call. It writes nothing, saves a plan, and covers **the whole batch in one call**:

```
mcp__carta__read_tool({"name": "cap_table__compute__terminate_stakeholders_preview", "arguments": {
  "company": <corporation_id>, "stakeholders": [8821],
  "termination_reason": "Voluntary", "termination_date": "2026-03-14",
  # optional, each settled before the preview that 4b commits:
  "new_relationship": "Ex-Employee",     # only when overriding or filling a null
  "send_review_changes": false,
  "deadlines": [{"security_type": "option_grant", "security": 104, "date": "2027-03-14"}],
  "forfeit": [{"security_type": "rsa", "security": 77}]}})
```

It answers `{plan_id, status, summary, side_effects, checks, expires_at, stakeholders}`.
`stakeholders` has one entry per person — `id`, `name`, `relationship`, `new_relationship` and
`securities` — and each security carries `security_type`, `id`, `label`, `deadline`,
`expiration_date`, `forfeited`, `acceptance_status`, `quantity`, `vested_quantity` and
`unvested_quantity`. Grants whose exercise window already lapsed as of the termination date are
omitted.

**Run it with no `deadlines` and no `forfeit` the first time.** Those two are inputs, so what
comes back shows Carta's own defaults — which is what you need in order to ask about them at
all. Each later preview of the same termination replaces the one before it, and only the last
plan is applied.

**`status: "blocked"` means nothing was saved.** `plan_id` and `summary` are null, and every
refusal is in `checks` as a `state: "fail"` entry with the server's own `message` and the
`field` it is about. Show them verbatim, then go back to the input that `field` names — the
routing table is in
[errors.md](references/errors.md#the-preview-comes-back-blocked), so an admin whose exercise
extension was refused is not asked to change the person's last day. Never retry with a value of
your own choosing.

**If a stakeholder's `securities` is empty**, there is nothing to cancel and no deadline to set
— say so plainly rather than presenting an empty table: *"Jamie holds no securities this
termination affects, so only their record changes: relationship to Ex-Employee, effective
14 Mar 2026."* Mention that already-lapsed grants are left out, so empty doesn't prove they
never held equity. The flow continues to Step 4 as normal, with the same confirmation gate.

**The plan expires.** `expires_at` is when; past it, `apply_plan` refuses with `plan_expired`
and the answer is a fresh preview and a fresh confirmation, never a retry.

**Present the result as a table per stakeholder**, and lead with the two numbers that matter:
what stops and what starts a clock. Per-type treatment, the fields to show, and the editable
deadlines are in
**[references/security-treatment.md](references/security-treatment.md)** — read it before
writing this table. In outline:

- **Option grants / SARs** — unvested is cancelled; **vested keeps a deadline to exercise**.
- **RSUs / CBUs** — unvested cancelled; a deadline to settle.
- **Certificates** — nothing moves; a **last day to repurchase** is set.
- **RSAs** — repurchased (nothing moves, a deadline is set) or forfeited (unvested removed).
  **Ask which** (Hard rule 4), then name the forfeited ones in `forfeit` and preview again.
- **PIUs** — same two outcomes, but **derive it from the first preview, never ask**: a PIU that
  comes back with a `deadline` is one Carta repurchases; a `deadline` of null on that first
  preview is Carta saying it has no repurchase window, so forfeit it — name it in `forfeit` and
  preview again. Read the signal only from the preview that sent no `forfeit`: afterwards
  `forfeited` and `deadline` echo what you asked for, not what Carta decided.

State the exercise deadline in the holder's terms, because this is what people miss. The
window closes on the **earlier** of the last day to exercise and the grant's expiration date,
so give that date:

> *"Jamie has 1,200 vested options (ES-104) with a last day to exercise of 12 Jun 2026 — 90
> days after their last day. 800 unvested options will be cancelled."*

When the grant expires first, name the expiry instead and say why:

> *"ES-190's exercise deadline would be 29 May 2027, but the grant itself expires 25 May 2027,
> so 25 May is the real last day."*

### Check the preview before you present it

The preview can hand you a grant whose numbers or dates do not hold together, and each one
changes what the user should be approving. Check **every** security against all three rows
below — each reads straight off the preview row, with no extra call. A hit is not a footnote:
**settle it as a Step 4 input, before [4a](#4a--preview)**, the way an RSA's
repurchase-or-forfeit is settled.

| What to look for | What it means |
|---|---|
| `deadline` **after** `expiration_date` | The window really closes at the expiry — see [the earlier-of rule](references/security-treatment.md#option-grants-rsus-sars-cbus). `expiration_date` is the grant's own lifetime, and is null for a certificate, RSA or PIU, which do not expire |
| `unvested_quantity` greater than `quantity` | The two figures are computed separately, so one of them is wrong and the cancelled number cannot be trusted. `cap_table:get:security` gives the vesting tranches to compare against the issued quantity |
| `acceptance_status` that is not accepted | The holder, or the company, never signed — see [an unaccepted grant](references/security-treatment.md#an-unaccepted-grant). The value says which signature is missing |

**One `AskUserQuestion` per hit**, naming that security and offering only that hit's options.
Put up to four questions in one call and make another call for more — never fold two hits into
one question, and never add a hit's options to 4a, which has its own three and no room.

| Hit | Options |
|---|---|
| A deadline past the expiry | *Proceed; the window closes \<expiry\>* / *Set the last day to exercise to \<expiry\>* / *Hold \<name\>'s termination* |
| Unvested above the total | *Proceed with the preview's figures* / *Hold \<name\>'s termination* |
| An unaccepted grant | *Proceed* / *Hold \<name\>'s termination* |

Say in the question what you read and what you believe, so the choice is informed: which
figure the tranches support and which you do not believe, or whose signature is missing — an
officer signature is the company's own to fix, today, before this. Never pick a quantity of
your own.

Then, before 4a:

- **A chosen deadline** goes into `deadlines`, so the next preview carries the date the commit
  will use. A date Carta refuses comes back blocked, naming that security.
- **A hold** drops that stakeholder from this run. There is no way to terminate someone and
  leave one of their securities out, so holding a security holds the person. Say who was
  dropped and why. **If that leaves nobody, stop there** — say plainly that nothing was
  changed, and don't go on to 4a.
- **Ask the summary-email question** ([The summary email](#step-4--confirm)), unless it is
  already answered: its answer is an argument of the preview below.
- **Preview again** with every answer folded in: the remaining `stakeholders`, plus
  `new_relationship`, `send_review_changes`, `deadlines` and `forfeit`. The plan holds only
  what this call carried, and `apply_plan` can add nothing, so a value missing here is a value
  4a shows and the termination does not do. That preview's plan is the one 4a shows and 4b
  commits.

4a then shows what the final preview staged, and 4b's count is that batch.

### What else the stakeholder holds

Warrants, convertible notes and SAFEs are outside this flow and never appear in the preview, so
**read them rather than asserting they are unaffected**. One type per call, with the
stakeholder id from Step 1b:

```
mcp__carta__read_tool({"name": "cap_table__list__securities", "arguments": {
  "company": <corporation_id>, "type": "warrant", "holder": ["8821"]}})
```

`convertible_note` is the second call, and it covers SAFEs and ASAs. Report each row by label
and quantity, and say a termination does not touch it; with no rows either time, say they hold
none of the three.

Both lists are company-viewer reads: an HR admin is refused both, and a limited admin is
refused the notes. When a call is refused for access, say you could not check — *"none"* and
*"I can't see them"* are different answers to an admin closing someone's file.

**Overriding a deadline.** The server's computed date comes from the plan's PTEP rules and is
usually right. If the user wants a different one (a negotiated extension, or a date the holder
can actually reach), add it to `deadlines` and preview again:

```
"deadlines": [{"security_type": "option_grant", "security": 104, "date": "2027-03-14"}]
```

`security_type` is the preview row's own value — `option_grant`, `rsu`, `sar`, `cbu`,
`certificate`, `rsa` or `piu` — and `security` its `id`. A grant id and a certificate id can be
equal, so both are required. The date must be on or after the termination date; a date Carta
refuses blocks the preview with a check naming that security, and the answer is to re-ask the
user, never to pick a date yourself. The same shape names a forfeited RSA or PIU in `forfeit`,
without the date. **A security cannot be in both** — a forfeited one has no repurchase window,
and sending both blocks the preview.

> A longer PTEP can change an ISO's tax character. Note that it can have tax consequences and
> point to their advisors — don't characterise the outcome.

---

## Step 4 — Confirm

Two different stops (Hard rule 3). Settle every input that changes what runs **before** the
first one — the date, reason and relationship, each RSA repurchase-or-forfeit choice, each
PIU disposition derived from the preview, every answer to a
[preview check](#check-the-preview-before-you-present-it) that hit and the override or the
dropped stakeholder it leaves behind, every deadline override, and whether to send you the
summary email — so nothing the user approves can change after they approve it. Every one of them
is an input to the preview, so they are settled before the preview whose plan 4b commits.

Those preview-check questions collect inputs; they are not a third stop. Each is its own
question, asked before 4a, so 4a keeps its three options and shows what every answer settled.

**The summary email.** `send_review_changes` (default `false`) emails *you* the list of changes
to the terminated securities. Ask it as its own question, before the final preview since it is
one of that call's arguments, defaulting to not sending: *"Send yourself the Carta summary of
these changes?"*

**It does not reach the holder, and nothing here does.** Carta emails a holder about their
equity after they leave whenever a security was released to them, whatever is answered above.
The preview lists every such effect in `side_effects`: read each entry back in 4a as a line of
its own, in the server's words, rather than asserting who will or will not hear from Carta.

### 4a — Preview

**Build this from the final preview** — the one that carried every answer: `new_relationship`,
`send_review_changes`, `deadlines` and `forfeit` — and hold its `plan_id` and `summary` for
Step 5. Don't re-run it afterwards: a new
preview saves a new plan, and the one the user approved is the one that must be applied. If
the final preview differs from the first, say what changed. Then show every value it staged,
per stakeholder:

> **Terminating Jamie Chen on Acme** — effective **14 Mar 2026**, reason **Voluntary**
> (as of 10:42 today).
>
> - Vesting stops on 14 Mar 2026. **800 unvested options are cancelled** (ES-104).
> - **1,200 vested options** stay exercisable until **12 Jun 2026**, then expire.
> - **900 vested options** (ES-190) until **25 May 2027** — you set this, because the grant
>   expires then and its computed 29 May 2027 deadline is four days the holder can't use.
> - Certificate CS-22 (5,000 shares) — keeps all 5,000; Acme has until **1 Sep 2026** to
>   repurchase them (you set this date; the plan's was 12 Jun 2026).
> - RSA-12 — **2,000 unvested shares forfeited**, no payback (your choice).
> - PIU-4 — **500 unvested units forfeited** (Carta sets this for profits interest units).
> - Relationship changes from Employee to **Ex-Employee** (set by Carta from their current one).
> - Carta lists these side effects: *"Jamie Chen gets an email about their equity after they
>   leave, if Carta released a security to them"*. You will not get the summary email.
>
> Jamie also holds warrant W-3 (10,000 shares), which a termination doesn't touch.

Use `AskUserQuestion` with options **"Looks right"** / **"Change something"** / **"Cancel"**
— those three and no more. Every [preview check](#check-the-preview-before-you-present-it)
that hit was answered before this, so what it settled is a line in the preview above, not an
option here.

*Change something* collects the edit — a new date or reason goes back to Step 2 — then previews
again and shows 4a again. The new preview saves a new plan, and only that one is applied. On
*Cancel*, stop and say plainly that nothing was changed.

### 4b — Final check

A separate question that names what can't be undone:

> **Last step — this can't be undone from your account.** Terminate **1 stakeholder** on Acme
> now: vesting stops and **800 options are cancelled** immediately. Correcting a recorded
> termination needs Carta Support.

Use `AskUserQuestion` with options **"Terminate 1 stakeholder now"** / **"Not yet"** — the
affirmative label repeats the count. Continue to Step 5 only on that option; anything else,
including free text, stops the flow and nothing is changed.

---

## Step 5 — Write

Commit the plan the user approved in 4a — its `plan_id` and its `summary`, unchanged:

```
mcp__carta__cap_table__mutate__apply_plan({
  "company": <corporation_id>,
  "plan_id": "<plan_id from the final preview>",
  "summary": "<that preview's summary, verbatim>"})
```

This is the connector's **named** apply tool, loaded in [Phase 0](#phase-0--preflight).

Nothing else goes in: the date, reason, relationship, notification choice, deadlines and
forfeits are already in the plan, and this call cannot add or change one. **Never edit the
summary** — Carta compares it with the stored plan and refuses a mismatch, which is the guard
that the thing approved is the thing applied. The host may add its own approval prompt on this
call; that is on top of Step 4's two stops, never in place of them.

**It is destructive and long-running.** Alongside the securities changes it stops vesting,
writes the relationship event, expires stakeholder documentation, ends any ESPP participation
as of the termination date, and sends the emails the preview listed.

**Response**: `{plan_id, status: "applied", summary, labels, undo, task}`. `task` is the job
that finishes the work, so **`applied` is not `done`**. Follow it:

```
mcp__carta__read_tool({"name": "cap_table__get__task", "arguments": {
  "company": <corporation_id>, "task_id": "<task.task_id>"}})
```

It answers `{status, done, poll_after_seconds, counts, rows, error}`. Wait
`poll_after_seconds` between calls, and read it only until `done` is true:

- **`succeeded`** — every stakeholder terminated.
- **`partially_failed`** — some did and some did not. `counts` gives the split and `rows` lists
  the failures first, each with the stakeholder id as its `key` and Carta's own `error`. Report
  exactly who terminated and who didn't, verbatim. Never summarise a partial result as a
  failure. → [errors.md](references/errors.md)
- **`failed`** or **`canceled`** — read the job's `error`, and `rows` for anything per person.

**Never apply a second plan to retry a failure** (Hard rule 7). Re-sending the *same*
`plan_id` after a timeout is safe and returns the stored result; a fresh preview and apply
terminates the people who already succeeded a second time.

**Read a grant back when its deadline mattered** — one whose preview check hit, or whose
deadline you overrode. `cap_table:get:option_grant` answers the three fields the termination
wrote:

- **`ptep_expiration_date`** — the last day to exercise Carta stored. Check it against what
  you told the user. It is the only read of that date. `grant_expiration_date` beside it is
  the grant's own lifetime, and the window still closes on the earlier of the two.
- **`termination_date` and `termination_reason`** — what was recorded.

**A read-back only adds information. It never contradicts the write and never leads to a
second one.** If `termination_date` is set but `ptep_expiration_date` is absent, the
termination still happened — say you could not read the stored deadline back and report the
one you sent. If the stored date differs from what you told the user, report both as a
discrepancy to fix in Carta. Never apply a second plan (Hard rule 7).

Its `status_explanation` reads **canceled** for a terminated grant, with no cancelled date and
a cancelled quantity of zero. That is the ledger's word for a terminated grant, not a second
event — nothing was cancelled as its own transaction, and the unvested units stopped because
vesting stopped on the termination date. Don't report it as a cancellation whose date is
missing.

Only option grants carry a stored deadline a read can reach: carta-web serves
`ptep_expiration_date` on this endpoint alone. For an RSU, SAR or CBU, report the deadline the
preview computed and don't claim to have checked it.

---

## Transfers

A termination never moves securities to anyone. A transfer — a deceased holder's shares to
their estate, a certificate to a family trust, repurchased shares to a new holder — is a
separate action in `carta-manage-securities`, with its own preview and approval. This skill
never performs it; hand off.

It comes up when the user asks for one, and is worth one line in the closing when the reason
is **Death**, since the estate usually needs it — offer, don't assume. The recipient must be a
stakeholder of the company before the transfer.

**If the user wants both a transfer and the termination, settle the order before Step 3.** A
certificate transferred away first is no longer the stakeholder's, so the termination may not
cover it — re-run the preview after any transfer and check what it shows. Ask which order they
intend; don't pick.

---

## Reversal

**Reversal is per security, and it is not part of this skill.** A company admin or HR admin
can undo the termination of **one security at a time** — a grant, certificate, RSA or PIU —
with `cap_table:compute:undo_termination_preview` followed by `apply_plan`. A share-class
scope limits which certificates they can reach. That is `carta-manage-securities`' flow, not
this one: hand off rather than calling it here.

**Undoing every security does not undo the termination.** The relationship event the
termination wrote is not a security, so no number of per-security undos restores the person
to Employee or clears the recorded date. That part needs Carta Support.

So when a recorded termination is wrong (wrong date, wrong person, wrong relationship), say
what can and cannot be fixed, and route:

> *"I can't change a recorded termination from here. Jamie's individual grants and
> certificates can be undone one at a time in Carta, but their relationship change and the
> 14 Mar 2026 date can only be cleared by Carta Support. Contact Support to reverse the
> termination; once it's reversed, we can redo it with the correct date."*

Never re-terminate to "fix" a date. Securities that are already terminated are refused
(E170/E172), and a second termination to the same relationship dedupes into nothing, so the
original date sticks even where the call answers without error. Don't attempt a workaround,
and never report a corrected date that came from a re-termination.

---

## Closing

At a terminal state, close briefly:

1. **Domain summary** — who, company, date, and what happened to the equity:
   - *"Jamie Chen terminated on Acme, effective 14 Mar 2026 — vesting stopped, 800 unvested
     options cancelled, 1,200 vested options exercisable until 12 Jun 2026."*
   - *"3 of 4 stakeholders terminated on Acme. Priya Raman failed — ES-88 is locked. The other
     three are complete."*
   - *"Termination canceled — nothing was changed on Acme."*
2. **Where to go next** (when written): *"Open \<company\>'s stakeholder ledger in Carta to
   review."* **Never generate a URL** — sandbox/preprod/custom-box users would land on the
   wrong host.

When vested equity now has a deadline, add one line so it isn't missed, naming the earlier of
the deadline and the grant's expiry: *"Jamie's exercise window closes 12 Jun 2026 — they'll
need to exercise or the options expire."*
