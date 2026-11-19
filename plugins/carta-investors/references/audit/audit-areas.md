# Audit areas

The seven areas match the tabs on Carta's investor-portal Audit Documents page, so an
auditor already recognises them. **Always show the label; never show the slug.** The
slug is an argument value only.

| Label | `audit_area` | What an auditor finds here |
|---|---|---|
| General | `general` | Formation and governance documents — the LPA, side letters, organisational records |
| Cash | `cash` | Bank statements and cash-side support |
| Investments | `investment` | Portfolio holdings support — purchase agreements, valuation support |
| Partners' Equity | `partner-equity` | Partner-level records — capital account statements, capital call and distribution notices |
| Income & Expenses | `income-and-expenses` | Invoices, management fee support, expense documentation |
| Financial Packages | `financial-packages` | Published financial statement packages for the period |
| Supplemental | `supplemental` | Anything the fund filed outside the six areas above |

"All" means every area above — see each skill's own instructions for how it loops.

## Document readiness

Every document carries a `lifecycle_status`. **These raw values are internal — never
show them to the caller.** Translate first:

| `lifecycle_status` | Auditor sees | Badge |
|---|---|---|
| `Completed` | Ready | success |
| `New`, `Processing`, `Uncategorized`, `AI Categorized`, `AI Extracted` | Still processing | warning |
| `AI Error` | Needs attention — Carta couldn't process this document | danger |
| `Drafted` | Draft — not yet final | warning |
| `Archived`, `Retracted` | Withdrawn | neutral |
| `null` | *(omit — not tracked for this document type)* | neutral |

Zero documents in an area is also neutral, and is a normal state — plenty of funds
legitimately file nothing under Cash or Supplemental.

## Last updated in Carta

Each document row carries `updated_at`. Show it as **Last updated in Carta**, as a
date only (e.g. 12 Oct 2026), never the raw timestamp. It is the last time Carta's
record of the document changed. That includes the fund re-filing it under another
area, not only a new upload. For a Financial Package it is when the newest file in
the package was added. If a row has no `updated_at`, leave the date blank rather than
guessing one.

## Financial Packages appear only once published

A financial package can exist and still not show up here, because it surfaces only
after the GP publishes it. If the caller asks why the area is empty, say that plainly
— "the fund hasn't published a financial package for this period yet" — rather than
describing a publish workflow. It isn't a bug and it isn't an access problem.

## Partners' Equity: `audit_year` filtering is type-dependent

Within `partner-equity`, `audit_year` scopes some document types and not others,
because the underlying documents split into two kinds:

- **Periodic types** — capital account statements, consolidated capital account
  statements, capital calls, distribution notices, financial packages, and tax
  documents (including K-1s) — are scoped to the requested `audit_year` and carry a
  populated `year` field.
- **One-time-signing types** — subscription agreements, side letters, commitment
  changes, and similar — are returned regardless of `audit_year` and always carry
  `year: null`. A signing only ever happens once, so it stays relevant to every future
  audit rather than belonging to one year.

A 2020 side letter legitimately appearing alongside 2025 capital account statements in
a `2025` `audit_year` list is this behavior working as intended, not a data error —
don't flag it as stale or miscategorised. This is a list-only guarantee: an out-of-year
one-time-signing document shows up in the list but is not included in either delivered
zip for that `audit_year` — don't assume list membership predicts what a caller
actually receives from an export. A periodic-type document with no
usable date is included rather than silently dropped, with `year: null` the same as a
one-time-signing type; don't treat the null as proof it's exempt from year-scoping.
