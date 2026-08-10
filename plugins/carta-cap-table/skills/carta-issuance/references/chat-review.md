# Chat review content

The **Cowork adapter's** `showReview` content spec — printed as markdown, then confirmed
with one `AskUserQuestion` ([cowork-adapter.md §2–3](cowork-adapter.md#2-showreview--chat-markdown)).
Referenced from [SKILL.md Phase 2](../SKILL.md#phase-2--render-the-review-surface-mandatory-pre-save-gate).
The Code adapter renders its panel instead and does not use this file.

Render **every** always-render column when there's no richer surface to lean on;
defaulted/autofilled/looked-up values appear too, each with a `(default)` /
`(autofill — <so_type> rule)` / `(from existing record)` tag, never a hidden column (the
customer consents to defaults too). All date columns in `MM/DD/YYYY`.

**The Code panel's `DETAIL_TABLE` is a deliberately shorter recap, not this same list** — design
feedback trimmed it to the fields worth a quick per-row scan (see
[issuance-review/SKILL.md](../issuance-review/SKILL.md#block-detail_table) for the exact
columns). The panel doesn't lose the dropped fields: Plan and Currency are stated once in the
header subheading / KPI strip instead of repeating per row, and Relationship / Stakeholder
type / Exemption / Documents / Exercise periods were already shown and confirmed one screen
earlier in the config panel — "Back to edit" revisits them. The chat review has no header or
KPI strip, so it keeps the full list below.

- **Certificate — always (13):** Stakeholder · Type · Email · Relationship · Share class
  (prefix) · Quantity · Price/share · Board approval · Issue date · Rule 144 date · Build
  legend (body text — full body in a fenced block if long) · Exemption · Currency.
- **Option grant — always (16):** Stakeholder · Type · Email · Relationship · Plan · Option
  type · Quantity · Exercise price · Currency · Board approval · Issue date · Vesting schedule
  · Exercise periods · Grant expiration · Exemption · Documents.

**Conditional columns** (render only when the trigger fires): Rule 144 reason (when
`rule_144_date` ≠ `issue_date`); Dividend accrual start date (share class `dividend =
"Non-cash"`); grant `HMRC notified` (EMI), `ATO notified` (AU types). **Optional columns**
(append only when at least one row carries the field, then `—` for unset cells):
certificate number, vesting + start, acceleration, cash paid, debt canceled,
notes, returned invested capital (LLC); grant custom label, grant reason, early exercise,
auto-exercise-at-vest, flexible issue date. (`state_exemption`, `state_of_residency`,
`convertible_note`, `employee_id`, `cost_center`, `job_title`, `salary` are dropped from this
skill entirely — design feedback; never render or collect them, even if a prompt happens to
name one.)
Render `ZEPO` exercise price as
`$0.00 (ZEPO — must be zero)` and pending board approval as `Pending — needs board approval`.

**Default explanations** (attach a one-liner below the table for each value the skill chose):
Rule 144 date (holding-period start for restricted securities); Board approval pending
(grant issues pending; record the date later in Carta); Federal exemption (defaulting to
Section 4(a)(2) private placement); Stakeholder type (INDIVIDUAL = person; NON-INDIVIDUAL =
trust/LLC/fund/corp); Build/Exercise legend (legal transfer-restriction text — full body
shown to read before confirming); Option type (ISO/NSO/INTL/EMI/CSOP/Unapproved/AU types,
ZEPO = zero-exercise-price); Currency/Exemption autofill (set by the option type's
jurisdiction); Vesting schedule; Exercise periods (copied from the plan); Grant expiration
(10 years standard, required for ISO); Documents (form-of-option/exercise/plan docs);
HMRC/ATO notified; Dividend accrual start date (required for non-cash dividend classes,
forbidden otherwise).

**Confirm** — one `AskUserQuestion`: `"Issue N \<type\> now"` → issue · `"Save as draft"` →
save · `"Edit a row"` → re-collect, re-present · `"Cancel"` → stop. Free-text affirmatives
(*"yes"*, *"go"*) map to **Issue now**.

---

## Compressed format — identical-term batches

The full per-row table above is the single largest source of chat bloat for a large,
uniform batch: 30 grantees at the same terms produces ~300 lines of near-duplicate rows.
When every row genuinely shares the same terms, collapse the review instead of repeating
them per person.

**When to compress.** After [Phase 1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only)
saves and validates the batch, compare every row's non-personal terms:

- **Option grant** — `exercise_price`, `issue_date`, `vesting_template`, `document_set_id`,
  `so_type`.
- **Certificate** — `law_firm_price` (price/share), `issue_date`, `vesting_template`,
  `prefix` (share class), `legend_id`.

**All rows match on every one of these fields** → render the compressed format below.
**Any row differs on any one field** → fall back to the full per-row table
([above](#chat-review-content)), unchanged — a mixed batch needs the per-row detail to show
*which* row carries the different term.

**Compressed layout** (target: under 25 lines of markdown):

1. **Shared terms, once** — one small block (not a table; a short list) stating every
   always-column value from the [full spec](#chat-review-content) that's now identical across
   the batch, each still tagged `(default)` / `(autofill — <so_type> rule)` / `(from existing
   record)` exactly as the per-row table would — compressing the layout must never compress
   away a default's disclosure (Voice & defaults' rule that every skill-chosen value stays
   visible and overridable still applies here).
2. **Compact grantee list, below** — one line per person: name and quantity only (the two
   fields that are never identical across a batch). Stakeholder-specific fields the full table
   would show per-row (email, relationship, stakeholder type) are omitted from the compact
   list on the assumption they matched the roster silently; if any person's row needed a
   `(from config surface — new stakeholder)` tag or similar per-row exception, that person
   breaks batch-uniformity for review purposes — show them in an "exceptions" mini-table
   appended below the compact list instead of silently dropping the caveat.

**Always add a one-line offer to expand**, right after the compressed view:

> *"Showing the shared terms once since all N rows match. Say 'show the full table' to see
> every row's complete detail."*

If the user asks for the full table, render the [full per-row spec](#chat-review-content) for
this same batch — the underlying resolved rows don't change, only the rendering.

**State the draft set and hand off to confirm exactly as the full format does** — the
compressed view is a rendering choice, not a different capability; §3's confirm question is
unchanged.
