# Payload reference

Authoritative shape for the `drafts` payload on `issue_securities` and
`save_drafts`. Read this before constructing any payload — no invented keys.
Unknown keys fail with `Unknown draft field` or are dropped silently.

This is the **final mutate** contract — unchanged by the config panel's per-stakeholder
block structure (every field below, unchanged). The *panel-side* `config_submit` payload is
a different, earlier-stage contract where every field lives inside each row (see
[issuance-config/SKILL.md](../issuance-config/SKILL.md#payload-delivered-on-submit)) —
don't confuse the two when reading `carta-issuance/SKILL.md`'s Phase 0.5/1.

Contents: [Common fields](#common-fields-both-flows) ·
[Certificate-only](#certificate-only-fields) · [Option-grant-only](#option-grant-only-fields) ·
[Never emit](#never-emit) · [Picklists](#picklists) ·
[so_type auto-fill](#so_type-auto-fill-rules) · [Date format quirks](#date-format-quirks) ·
[camelCase and snake_case](#camelcase-and-snake_case) · [Gotchas](#gotchas)

## Common fields (both flows)

| Field | Required | Type / format | Notes |
|---|---|---|---|
| `name` | always | string ≤ 256 | Full legal name |
| `email` | always | valid email | |
| `stakeholder_kind` | always | enum (uppercase) | `INDIVIDUAL` or `NON-INDIVIDUAL` — **case matters** |
| `issue_date_relationship` | always | enum | See [Picklists](#picklists) |
| `issue_date` | always | `YYYY-MM-DD` or `MM/DD/YYYY` | |
| `board_approval_date` | certs: always. Grants: when `needs_board_approval = false` | `YYYY-MM-DD` or `MM/DD/YYYY` | Usually ≤ `issue_date`. Grants: omit entirely when pending — server rejects empty string. |
| `currency` | always | ISO 4217 | `USD` for US; per-`so_type` autofills for grants |
| `state_of_residency` | optional | 2-letter US state OR 3-letter ISO country | Server doesn't enforce. **Not collected by carta-issuance** (dropped from the panel entirely — design feedback; remains valid server-side for other callers) |
| `notes` | optional | string | |
| `draft_pk` | retry | int | Pk of existing draft row — updates in place |
| `stakeholder_id` | optional | int | Bypasses duplicate detection |
| `delete` | optional | bool | With `draft_pk`, removes row on next save |
| `fund_structure` | optional — paper corps only | bool (Yes/No), tri-state | "Part of fund structure" designation. **Never prompt for it** — accepted when the caller supplies it (parameter or sheet column), and otherwise only surfaced when `validate_drafts` demands it. `null` / `false` / `true` are distinct; send `false` as `false`, never omit it. See [fund-structure recovery](#recovering-a-fund-structure-block) |

## Certificate-only fields

| Field | Required | Type / format | Notes |
|---|---|---|---|
| `prefix` | always | string (1–10 chars) | Share-class prefix. **NOT `share_class` / `shareClass` / `share_class_id`** |
| `quantity` | always | positive number | |
| `law_firm_price` | paid issuances | decimal | Up to 50 decimal places. `0` allowed for LLC corporations (rejected with *"Value must be greater than 0"* for non-LLC corps) |
| `legend_id` | US issuers | int | **Never send `legend` body** |
| `exemption` | US issuers | enum | Default `Section 4(a)(2)` |
| `prefix_number` | optional | int or `<letters>-<digits>` | Server auto-numbers if omitted. Free-form strings raise `ValueError` |
| `cash_paid` | optional | decimal ≥ 0 | |
| `debt_canceled` | optional | decimal ≥ 0 | |
| `convertible_note` | optional | string ≤ 256 | Pk or label — no server FK validation. **Not collected by carta-issuance** (dropped from the panel entirely — design feedback; remains valid server-side for other callers) |
| `returned_invested_capital` | optional — LLC only | decimal ≥ 0 | **Not collected by carta-issuance** (no MCP command can confirm LLC status, so the field is dropped from the panel entirely; remains valid server-side for other callers) |
| `rule_144_date` | US restricted | `MM/DD/YYYY` only (CharField) | Optional at save; enforced at issue |
| `rule_144_difference_reason` | if `rule_144_date` ≠ `issue_date` | enum | |
| `vesting_template` | opt-in | int | |
| `vesting_start_date` | if `vesting_template` set | `MM/DD/YYYY` only (CharField) | |
| `acceleration_template` | optional | int | |
| `dividend_accrual_start_date` | when share class has non-cash dividends | `YYYY-MM-DD` or `MM/DD/YYYY` | Required for non-cash dividend share classes; server rejects when set on cash / no-dividend share classes. Omit entirely outside that case |
| `employment_related` | optional — UK issuers | bool (Yes/No) | UK HMRC "Other ERS" designation. Accepted, but **not collected by carta-issuance** — unlike Unapproved option grants, no certificate validation rule requires it, so the panel doesn't ask. Remains valid server-side for other callers |

## Option-grant-only fields

| Field | Required | Type / format | Notes |
|---|---|---|---|
| `so_type` | always | enum (case-sensitive) | |
| `quantity` | always | positive integer | |
| `exercise_price` | always except ZEPO | decimal | **ZEPO: hard-set `"0"`**. ISO warns if `< FMV` |
| `needs_board_approval` | always | bool | `true` = grant is pending board approval (omit `board_approval_date`). `false` = grant already approved (collect `board_approval_date`). Resolved via Board approval resolution. |
| `vesting_template` | always | int | Required server-side |
| `vesting_start_date` | non-milestone template | `MM/DD/YYYY` only (CharField) | Milestone defaults server-side |
| `acceleration_template` | optional | int | |
| `grant_expiration_date` | always | `MM/DD/YYYY` only (`CharField`) | Default `issue_date + 10 years`. Required for ISO. ISO `YYYY-MM-DD` is rejected with `Date is invalid` — see [Date format quirks](#date-format-quirks) |
| `exemption` | US issuers | enum | Autofilled by `so_type` |
| `state_exemption` | US, optional | string | Free-form; don't default. **Not collected by carta-issuance** (dropped from the panel entirely — design feedback; remains valid server-side for other callers) |
| `document_set_id` | always | int | |
| `custom_label` | optional | string | Server auto-generates `ES-{n}`. Unique per corp |
| `early_exercise` | optional | bool | **Rejected for ZEPO** |
| `auto_exercise_at_vest` | optional | bool | |
| `is_flexible_issue_date` | optional | bool | |
| `is_hmrc_notified` | EMI only, optional | bool | Cleared for other `so_type` |
| `hmrc_notified` | EMI only, optional | `YYYY-MM-DD` or `MM/DD/YYYY` | Stored as `DateTimeField` on the draft model — server normalises both inputs |
| `is_ato_notified` | ESS/Non-Concessional/ZEPO only, optional | bool | |
| `employment_related` | **`Unapproved` — required** | bool (Yes/No) | UK HMRC "Other ERS" designation. `validate_drafts` rejects a blank one, so **collect it up front**. `No` is a valid answer; only unanswered fails. Not required for `EMI` / `CSOP` (own returns) — omit for every other `so_type`. See [so_type auto-fill rules](#so_type-auto-fill-rules) |
| `grant_reason` | optional | enum | See [Picklists](#picklists) — schema-enforced, not free text |
| `employee_id`, `cost_center`, `job_title`, `salary` | optional | string / decimal | Pass-through — **not collected by carta-issuance** (design feedback dropped these from the panel entirely; they remain valid server-side for other callers) |

`equity_plan_id` lives on the draft **set**, not the row — pass on the first mutate only.

## Never emit

Server-resolved, UI-only, or vestigial. Sending these raises `Unknown draft field` or is dropped.

- **Certificates**: `legend` (server fills from `legend_id`), `vesting_acceleration_name`, `vesting_acceleration`, `custom_vesting`, `vesting_type`, `early_exercise`, `milestone_terms`, `publish_board_consent`.
- **Option grants**: `exercise_periods`; all termination/exercise count+period pairs (`voluntary_termination_count`/`_period`, `involuntary_termination_count`/`_period`, `involuntary_termination_cause_count`/`_period`, `death_exercise_count`/`_period`, `disability_exercise_count`/`_period`, `retirement_exercise_count`/`_period`); `document_set`; `form_of_option_doc`, `form_of_exercise_doc`, `equity_incentive_plan_doc`, `attachments_uuid`.

## Picklists

**`stakeholder_kind`** (uppercase): `INDIVIDUAL` · `NON-INDIVIDUAL`.

**`issue_date_relationship`** (exact strings):

| | |
|---|---|
| `Advisor`, `Ex-Advisor` | `Board member`, `Ex-Board member` |
| `Consultant`, `Ex-Consultant` | `Employee`, `Ex-Employee` |
| `Executive` | `Founder` |
| `International Employee`, `Ex-International Employee` | `Investor` |
| `Officer` | `Other` |

If user gives an unfamiliar value, ask them to pick from this list — never guess.

**`exemption`** (federal, US issuers):

- `Section 4(a)(2)` (default if blank), `Section 4(a)(1-1/2)`, `Section 4(a)(7)`
- `Rule 144`, `Rule 701`
- `Reg D - 506(b)`, `Reg D - 506(c)`, `Reg D - 506`, `Reg D - 505`, `Reg D - 504`
- `Reg S`, `Reg A (Tier 1)`, `Reg A (Tier 2)`, `Reg CF`
- `Non-U.S.`, `Small Scale`, `Other`

**`so_type`** (case-sensitive — from carta-frontend-platform `drafts-v2/src/DraftsV2/constants/soType.ts`):

| Region | Values |
|---|---|
| US | `ISO`, `NSO`, `INTL` |
| UK | `EMI`, `CSOP`, `Unapproved` |
| AU | `Startup Concessions`, `Non-Concessional`, `ZEPO` |

Frontend enum key for *Startup Concessions* is `ESS`; canonical persisted string is `Startup Concessions`. Always emit `Startup Concessions` regardless of user phrasing. *ESOP* is ambiguous — ask which of `Startup Concessions` / `Non-Concessional` / `ZEPO`.

**`rule_144_difference_reason`** (only when `rule_144_date` ≠ `issue_date`):

`has_determined_144_date` · `non_restricted_144` · `relevance_provision` · `affiliates` · `non_affiliates`

**`grant_reason`** (carta-web's own field schema — [carta-modify-issuables/references/field-contract.md](../../carta-modify-issuables/references/field-contract.md) is authoritative):

New Hire · Merit · Promotion · Refresh · Corporate transaction · Relationship change · Retention · Advisor · Consultant · Board · Performance bonus · Boxcar grant

## so_type auto-fill rules

Apply before review. Tag each as `(autofill — <so_type> rule)`. Override only on explicit user input.

| `so_type` | `currency` | `exemption` |
|---|---|---|
| `ISO`, `NSO`, `INTL` | `USD` | `Section 4(a)(2)` |
| `EMI`, `CSOP` | `GBP` | `Non-U.S.` |
| `Unapproved` | `GBP` | (pass through corp default) |
| `Startup Concessions`, `Non-Concessional`, `ZEPO` | `AUD` | `Small Scale` |

**ZEPO** — `exercise_price = "0"` (hard-set); `early_exercise = false` (server rejects ZEPO + early exercise).

**HMRC fields** — show `is_hmrc_notified` / `hmrc_notified` only when `so_type = EMI`. Cleared otherwise.

**ATO field** — show `is_ato_notified` only when `so_type ∈ {Startup Concessions, Non-Concessional, ZEPO}`.

**`employment_related`** — **collect up front when `so_type = Unapproved`**, never leave it to validation. `validate_drafts` hard-fails a blank one: *"Unapproved grants must be designated as employment related so they can be reported correctly in the HMRC Other ERS annual return. Select Yes or No."* Because the draft set already exists by then, the admin is stranded mid-flow — ask at collection instead.

Yes/No, and **`No` is a real answer** — only "unanswered" fails. Ask plainly: *was this grant acquired by reason of employment?* (HMRC's ITEPA 2003 Part 7 concept; the Other ERS annual return only covers grants flagged as employment related, so a blank silently drops the grant out of the return).

`EMI` and `CSOP` are **not** affected — they are reported on their own HMRC returns and the field stays optional there. Omit it entirely for every `so_type` other than `Unapproved`.

Server-side the field is gated per-issuer (UK incorporation + the `SIB_1160_EMPLOYMENT_RELATED_SECURITIES` flag), so a non-UK issuer never sees the rule. Sending it is harmless when the gate is off, so key the question off `so_type = Unapproved` rather than trying to detect the flag.

## Recovering a fund-structure block

`fund_structure` is the one conditionally-required field the skill **must not ask about
up front**. It applies to a single customer, the gate is server-owned (paper corp + the
`BBO_DRAFT_ISSUANCE_HOLDING_ENTITY` flag), and a run that never touches it must behave
exactly as before. So: no panel field, no chat question, no prompt. Accept it when the
caller supplies it — as a `save_drafts` parameter or the sheet's "Part of fund structure"
column — and otherwise wait for the server to ask.

`validate_drafts` asks by failing. When a holder resolves to the firm's fund structure and
the designation is not `true`, it returns a critical error keyed `fundStructure`:

> `"<name>" matches an entity in <firm>'s fund structure. Enable Fund Structure for this security to continue.`

or, when the stakeholder is already linked:

> `"<name>" is already linked to <firm>'s fund structure. Enable Fund Structure for this security to continue.`

Recover in place — the draft set already exists, so never restart the flow:

1. Surface the server's message **verbatim**, naming the row it came from. Do not
   paraphrase it or infer the designation on the admin's behalf; the message names a real
   entity match and the answer is theirs to confirm.
2. Ask only now, and only for the blocked rows, via `AskUserQuestion`.
3. Re-save just those rows with `save_drafts`, carrying `draft_set_id` **and** each row's
   `draft_pk` so they update in place instead of duplicating.
4. Re-run `validate_drafts` and confirm it comes back clean before issuing.

A `false` answer does not clear this error — only `true` does. If the admin says the holder
is genuinely unrelated to the fund structure, the match itself is wrong: persist the
`false`, stop, and route them to Carta support rather than looping on validation.

## Date format quirks

Most date fields are `DateField`s and accept both `YYYY-MM-DD` and `MM/DD/YYYY`. Three fields are stored as `CharField(max_length=10)` on the draft model and accept **`MM/DD/YYYY` only** — an ISO `YYYY-MM-DD` string is rejected with `Date is invalid`:

- `rule_144_date` (certificate)
- `vesting_start_date` (both flows)
- `grant_expiration_date` (option grant)

`hmrc_notified` (option grant) is a `DateTimeField` — it accepts both `YYYY-MM-DD` and `MM/DD/YYYY` and the server normalises the input.

Mixing formats across a payload is fine — each field is parsed independently. Date inputs in the panel return ISO; reformat the three CharFields to `MM/DD/YYYY` before the mutate.

## camelCase and snake_case

The MCP gateway auto-converts a known allow-list (`lawFirmPrice` → `law_firm_price`, `legendId` → `legend_id`, `soType` → `so_type`, `exercisePrice` → `exercise_price`, `vestingTemplate` → `vesting_template`, `vestingStartDate` → `vesting_start_date`, `accelerationTemplate` → `acceleration_template`, `grantExpirationDate` → `grant_expiration_date`, `customLabel` → `custom_label`, `earlyExercise` → `early_exercise`, `autoExerciseAtVest` → `auto_exercise_at_vest`, `isFlexibleIssueDate` → `is_flexible_issue_date`, `isHmrcNotified` → `is_hmrc_notified`, `hmrcNotified` → `hmrc_notified`, `isAtoNotified` → `is_ato_notified`, `needsBoardApproval` → `needs_board_approval`, `documentSetId` → `document_set_id`, `employeeId` → `employee_id`, `costCenter` → `cost_center`, `jobTitle` → `job_title`, `grantReason` → `grant_reason`, `issueDateRelationship` → `issue_date_relationship`, `stakeholderKind` → `stakeholder_kind`, `stakeholderId` → `stakeholder_id`, `boardApprovalDate` → `board_approval_date`, `issueDate` → `issue_date`, `prefixNumber` → `prefix_number`, `ruleOf144Date` → `rule_144_date`, `rule144Date` → `rule_144_date`, `rule144DifferenceReason` → `rule_144_difference_reason`, `stateOfResidency` → `state_of_residency`, `stateExemption` → `state_exemption`, `cashPaid` → `cash_paid`, `debtCanceled` → `debt_canceled`, `convertibleNote` → `convertible_note`, `dividendAccrualStartDate` → `dividend_accrual_start_date`, `returnedInvestedCapital` → `returned_invested_capital`, `employmentRelated` → `employment_related`, `fundStructure` → `fund_structure`).

Unknown camelCase or snake_case typos fail with `UsageError: Unknown draft field <key>`. **Always emit snake_case.**

## Timeouts & retries

Each mutate has a different server-side ceiling (`validate_drafts` 90s, `save_drafts` and
`issue_securities` up to 600s for large batches) — a timeout on any of them is a real
possibility for a big batch, not an edge case. **The wrong retry re-sends the call with the
wrong params and creates a duplicate draft set or double-issues** — the retry contract
below exists to prevent that. Never blindly repeat the exact call that just timed out; the
draft set may already have been created or updated server-side even though the response
never came back.

- **`validate_drafts` timeout** — retry with `draft_set_id` only, no `drafts` (the
  `draft_set_id`-only path — see [Run the issue securities
  mutate](../SKILL.md#run-the-issue-securities-mutate) and [Validate without
  issuing](../SKILL.md#validate-without-issuing)). The rows are already saved server-side
  from the preceding `save_drafts` call in this same phase, so re-sending them isn't
  necessary and the smaller payload is also less likely to time out again. Never fall back
  to re-sending the full `drafts` array on a `validate_drafts` retry — that's strictly more
  data for no benefit.
- **`save_drafts` timeout** — the response never arrived, but some or all rows may have
  saved anyway. On retry, thread `draft_pk` for every row this phase has already assigned
  one to (from a prior successful save this session, per [Draft-state
  bookkeeping](save-validate-flow.md#draft-state-bookkeeping)) — rows with a known
  `draft_pk` update in place instead of creating a duplicate row. Rows that never got a
  `draft_pk` (this is their first save) go in the retry with their full payload, unchanged.
  Never retry a timed-out `save_drafts` by omitting `draft_set_id` — that mints a **second**
  draft set with the same rows (Hard rule 4), doubling the draft clutter on the corp.
- **`issue_securities` timeout** — the highest-stakes case: the mutate may have already
  issued live securities before the response was lost. **Never blindly re-call
  `issue_securities`** on a timeout — check the draft set's real state first via
  `cap_table:get:load_drafts` (`corporation_id`, `security_type`, `draft_set_id`). If the
  loaded rows show securities already issued (or the corp's ledger reflects the new
  certificates/grants), the call succeeded despite the timeout — report success, don't
  re-issue. If the rows are still in draft state, the call never completed server-side —
  safe to retry `issue_securities` with the same `draft_set_id` and each row's `draft_pk`,
  same as any other retry (Hard rule 4). This check is a mandatory gate before any
  post-timeout `issue_securities` retry, not an optional precaution — issuing the same
  batch twice creates duplicate live securities with no automatic undo.

## Gotchas

| Gotcha | Detail |
|---|---|
| Stakeholder match vs. create | Without `stakeholder_id`, carta-web matches on (`name`, `email`). Match → issues to existing; no match → creates new. Include `stakeholder_id` to bypass dup detection entirely. |
| Vesting required for grants | Unlike certs (opt-in), grants persist `vesting_template` server-side. "No vesting" accepted but atypical — warn. |
| Exercise periods come from plan | Display only. Custom → Drafts UI. |
| Document set is server-resolved | Send `document_set_id` only; server populates the 3 doc pks + attachments uuid. |
| FMV gate (grants) | If `corporation.require_fmv() AND draft.from_plan` and no current FMV: server returns *"Fair market value is required"* with a link. Skill cannot update FMV — surface verbatim, route to UI. |
| Custom-label clash | User-supplied `custom_label` colliding with `ES-{n}` or another grant's label is rejected. Ask for new label or clear, re-save with `draft_pk`. |
| Set name length | carta-web rejects `draft_set_name` > 30 chars with a 400. Trim if user volunteers a long label. |
| Dividend accrual start date is share-class-gated | The resolved share class's `dividend` field (`"Non-cash"` / `"Cash"` / `null`, returned by `cap_table:get:certificate_share_classes`) controls whether to prompt — required for `"Non-cash"`, forbidden otherwise. Sending the wrong shape raises a server validation error; surface verbatim and recover via `AskUserQuestion`. `save_drafts` skips this check (the validator honors `ignore_empty`), so a row missing the field saves cleanly but will fail at issue. |
| Fund-structure block is server-detected, never predicted | Only carta-web knows whether a holder matches the firm's fund structure, so don't guess and don't pre-prompt. Let `validate_drafts` raise the critical `fundStructure` error, then recover in place — see [fund-structure recovery](#recovering-a-fund-structure-block). Only `true` clears it; a `false` persists but stays blocked. |
| `law_firm_price = 0` is LLC-only | A `0` price per share validates only for LLC corporations; non-LLC corps are rejected at the validate/issue step with *"Value must be greater than 0"*. Don't pre-block `0` for LLC issuers (alongside ZEPO option grants). Server-gated by the `LLCCW_SUPPORT_ZERO_LAW_FIRM_PRICE_LLC` flag, so treat the server as the source of truth — surface its message verbatim if a non-LLC `0` is rejected. |
