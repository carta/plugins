# Spreadsheet column map

The header vocabulary `parse_upload.py` recognizes, and the value picklists it
normalizes against. `COLUMN_SYNONYMS` in the script is what actually runs — this
file is the human-readable copy, and the two must be kept in step. Written as
shared data so `carta-modify-issuables` can point at it rather than
fork a second table that drifts.

Matching is on a **normalized** key: lowercased, every run of non-alphanumerics
folded to a single space, trimmed. So `Vesting Commencement Date`,
`vesting_commencement_date` and `VESTING  COMMENCEMENT  DATE` are one header.

## Where the vocabulary comes from

Two real surfaces, because these are the two things a Carta admin already has:

1. **carta-web's importer template** — `static_files/lib/eshares/example_importer_template_v2_14{,_uk,_au}.xlsx`,
   sheets **Common Certificates**, **Preferred Certificates**, **Equity Plan
   Awards**. Row 1 is instruction prose, row 2 is the header.
2. **The drafts-v2 in-app grid import** — carta-frontend-platform
   `apps/securities-management/drafts-v2/src/DraftsV2/pages/ModalImportDraftSetScreenReader/`.

Synonyms beyond those two are the obvious hand-rolled variants (`Grantee`,
`Number Of Options`, `Strike Price`) an admin's own sheet tends to use.

## Shared columns

| Header (and synonyms) | Row field |
|---|---|
| Name · Shareholder · Stakeholder · Holder · Grantee · Recipient · Full Name · Legal Name · Employee Name · Stakeholder Name | `name` |
| Email · Email Address · Stakeholder Email · Work Email | `email` |
| Relationship · Relationship To Company · Issue Date Relationship | `relationship` |
| Holder Type · Stakeholder Type · Entity Type · Individual Or Non Individual | `stakeholder_kind` |
| Quantity · Shares · Number Of Shares · Share Quantity · Options · Number Of Options · Units · Amount | `quantity` |
| Notes · Note · Comment · Comments | `notes` |
| Board Approval Date · Board Approved · Board Approval · Board Consent Date | `board_approval_date` |
| Vesting Schedule · Vesting · Vesting Template | `vesting_template_id` *(resolved)* |
| Vesting Commencement Date · Vesting Start Date · Vesting Start · Vesting Commencement | `vesting_start_date` |
| Acceleration · Acceleration Terms · Acceleration Template | `acceleration_template` *(resolved)* |
| Part of fund structure · Fund Structure | `fund_structure` — only on a paper corp's sheet. An explicit "No" carries through, like `employment_related`; `validate_drafts` blocks a row whose holder resolves to the firm's fund structure until this is Yes |

## Option grant

| Header (and synonyms) | Row field |
|---|---|
| Grant Date · Issue Date · Date Issued · Date Of Grant | `issue_date` |
| Type · Award Type · Option Type · Grant Type | `option_type` |
| Exercise Price · Strike Price · Exercise Price Per Share | `exercise_price` |
| Document Set · Documents · Document Template | `document_set_id` *(resolved)* |
| Award ID · Label · Custom Label · Grant Label · Award Label · Grant Number | `custom_label` |
| Grant Reason · Reason | `grant_reason` |
| Early Exercise · Allow Early Exercise | `early_exercise` |
| Auto Exercise At Vest · Auto Exercise | `auto_exercise_at_vest` |
| HMRC Notified · HMRC Notification | `is_hmrc_notified` |
| HMRC Notified Date · HMRC Notification Date | `hmrc_notified` (also sets `is_hmrc_notified`) |
| ATO Notified · ATO Notification | `is_ato_notified` |
| Employment Related · Employment Related Securities · Employment-Related · ERS | `employment_related` — an explicit "No" carries through, unlike the yes/no flags above (a blank is what `validate_drafts` rejects on Unapproved grants) |
| Expiration Date · Grant Expiration Date · Expiry Date · Expiration · Grant Expiry | `grant_expiration_date` |
| Equity Plan Name · Equity Plan · Plan · Plan Name · Option Plan · Equity Plan For RSAs | *set-level* → `equity_plan_id` |

**`Expiration Date` is not `Exercise Expiration Date`.** The importer template carries both.
The first is when the grant itself expires (`grant_expiration_date`); the second is the
post-termination exercise window, which this skill never sends — the plan supplies it. Only the
first is mapped; the second stays unmapped and therefore reported. Don't "helpfully" add it as a
synonym.

**Precedence:** a value in the file wins over the plan's computed default (usually
`issue_date + 10 years`). If the column is absent or blank the default applies exactly as
before. This matters because on a standard ten-year term the two agree and nobody notices,
while on a shortened term the default silently disagrees and still reads as plausible — the same
failure shape as an unmatched vesting schedule.

`Equity Plan Name` is deliberately **not** a row field: the plan lives on the
draft *set*, passed on the first mutate only (carta-issuance *Option-plan
reconciliation*). More than one distinct plan in a sheet is a `batch_errors`
entry, not a per-row value.

## Certificate

| Header (and synonyms) | Row field |
|---|---|
| Share Class · Class · Security Class · Share Class Name | `share_class_prefix` *(resolved — matches name **or** prefix)* |
| Price Per Share · Purchase Price · Price · Price Paid Per Share | `price_per_share` |
| Legend · Legend Code · Build Legend | `legend_id` *(resolved — matches code, name or label)* |
| Certificate ID · Certificate Number · Cert ID · Certificate No | `prefix_number` |
| Rule 144 Date · 144 Date | `rule_144_date` |
| Cash Paid · Total Cash Paid | `cash_paid` |
| Debt Canceled · Debt Cancelled | `debt_canceled` |
| Returned Invested Capital | `returned_invested_capital` |

`Certificate ID` in the template is a prefix plus a number (`CS-1`), but only
the number is a payload field — the prefix comes from the resolved share class.
The script keeps the numeric part and records the original in `import_notes`, so
the panel shows what the sheet actually said instead of silently reshaping it.

A `Rule 144 Date` that differs from the issue date also sets
`rule_144_mode: "other"` and notes that a reason is still needed — no template
column carries `rule_144_difference_reason`, so the admin picks it in the panel.

## Headers recognized but carrying no field

`Currency` — informational. Real payload `currency` comes from the per-`so_type`
autofill, not the sheet (carta-issuance Phase 0.5).

## Value picklists

Matched exactly against the panel's own choices, case- and
punctuation-insensitively. **No fuzzy matching** — an unmatched value leaves the
field blank with an `import_notes` entry.

**`relationship`** — the full `issue_date_relationship` list, identical to the
importer template's own: Advisor · Ex-Advisor · Board member · Ex-Board member ·
Consultant · Ex-Consultant · Employee · Ex-Employee · Executive · Founder ·
International Employee · Ex-International Employee · Investor · Officer · Other

**`stakeholder_kind`** — `INDIVIDUAL` from *individual, person, natural person*;
`NON-INDIVIDUAL` from *non individual, entity, organization, organisation,
company, corporation, trust, llc*. Note the **hyphen**: it matches
`build_config.py`'s `STAKEHOLDER_KIND_CHOICES`, not the Django enum's
`ORGANIZATION`.

**`option_type`** — ISO · NSO · INTL · EMI · CSOP · Unapproved ·
Startup Concessions · Non-Concessional · ZEPO

**`grant_reason`** — New Hire · Merit · Promotion · Refresh ·
Corporate transaction · Relationship change · Retention · Advisor · Consultant ·
Board · Performance bonus · Boxcar grant

**Booleans** — true from *yes, y, true, t, 1, x, checked*; false from
*no, n, false, f, 0*, blank. Anything else is a note, not a guess.

## Out-of-scope security types

A row whose `Type` names one of these is **skipped** with a reason pointing at
the Drafts UI, never coerced into a certificate or grant:

RSU · SAR · CBU · Warrant · RSA · Convertible Note · SAFE

The importer template's `Type` column also lists Israeli types (`3(i)`,
`102 Capital Gains Track`, `102 Ordinary Income Track`, `Non-Trustee`). Those
aren't in `OPTION_TYPES` and aren't in the skip list either, so they land as an
unmatched `option_type` note — the row imports and the admin picks a type the
skill can actually issue. If Carta adds them to the issuance flow, add them to
`OPTION_TYPES`; if they should be refused outright, add them to
`OUT_OF_SCOPE_TYPES`.

## Dates

Parsed in this order: `YYYY-MM-DD`, `MM/DD/YYYY`, `DD/MM/YYYY`, `MM-DD-YYYY`,
`DD-MM-YYYY`, `YYYY/MM/DD`, `Mon D, YYYY`, `D Mon YYYY`, `Month D, YYYY`.
Excel-native date cells are read as dates directly, which is the common case and
sidesteps the ambiguity entirely.

**`MM/DD` wins over `DD/MM` when both parse** — the template's own examples are
US-format, and a silent flip between them is the kind of error that reaches the
cap table looking plausible. `03/04/2026` reads as March 4. A non-US admin whose
sheet means April 3 sees the date in the panel before anything is saved, which is
the intended catch — but if UK/AU imports turn out to trip on this regularly,
the fix is an explicit `--date-order` flag, not a heuristic.
