# Fund terms & LPAs — Drill-down: single-fund tear-sheet

carta-lpa-audit's SKILL.md sends you here when the user selects "Drill into a fund" or names a specific fund. It names Steps B2 and B4, the cached JSON and the Caveats: Step B4 and the Caveats are in SKILL.md, Step B2 and the steps that build the cached JSON are in `text-fallback.md`.

### Step A

If the user hasn't named a fund, ask: "Which fund would you like to review?"

### Step B

Find the fund in the cached JSON by name (case-insensitive substring match). If not found:

> "No LPA data found for '<fund_name>'. Check that the fund name matches how it's listed in Carta, or run the full audit again."

### Step C

Present three sub-sections:

**Fund identity**

| Field | Value |
|-------|------|
| Fund name | <name> |
| LPA date | <lpa_date> |
| State of formation | <state> |
| General partner | <gp_name> (<gp_entity_type>, <gp_state>) |
| GP commitment | <gp_commitment_percentage>% · $<gp_commitment_amount> · “<commitmentFormula>” (any part alone when only that part was extracted; never wrap the amount in parentheses, which reads as negative; the quoted wording carries a "lesser of" / "greater of" floor or cap, so always show it when present) |

**Economic terms** (only shown when `termsExtracted == true`)

| Field | Value |
|-------|------|
| Management fee (investment period) | <rate>% of <basis>, or `Charged; rate set outside the LPA` when `lpa.mgmtFeeSetOutsideAgreement` is true |
| Management fee (post-investment) | <rate>% of <mgmtFeeBasisPostInvestment> |
| Carried interest | <carry>%<if carryTierRates: " (tiered)"> |
| Carry tiers | <carryTierRates joined with " → ", each as <rate>%> |
| Preferred return / hurdle | <hurdle>%, <multiple>x, or both as "<hurdle>% · <multiple>x" |
| Waterfall structure | <structure> |
| Fund term | <years> years (one decimal) |
| Investment period | <years> years (one decimal) |
| Capital call notice | <days> business days |
| Initial closing | <date> |

Both tables above list every field the extraction *can* carry. Omit any row whose value wasn't extracted rather than printing it with a `—` placeholder — an empty row reads as a data gap the reader has to check. If nothing in a table survives, skip the table and its heading.

A row whose field is in `lpa.termFlags` keeps its value and ends with `⚠ Check the LPA — <reason>`, as in Step B2.

If `lpaStatus == "PARTIAL"`, show this message before the tables (and instead of them when `termsExtracted == false`; keep the Economic terms table when `termsExtracted` is true):

> "The documents on file for this fund name it but state no headline fee, carry, hurdle or fund-term figures. They are often signature pages from a subscription packet. Drop the full LPA into this chat, or upload it in Carta, to see its terms."

**Amendments** (only when the fund's `lpa.documentVariant` is `Amendment` or `Amended and Restated`, or its `amendments` list is not empty)

Say which agreement the terms above come from: "Terms come from the amended and restated agreement dated <lpaDate>", "…from an amendment dated <lpaDate>" or "…from the LPA dated <lpaDate>". Then list each `amendments` entry as `Amendment No. <amendmentNumber> · <date>` (an entry whose `variant` is `Amended and Restated` is a restated agreement the table passed over, so list it as `Amended and restated agreement · <date>`, never with a number), adding `States different <term labels>` when `changedTerms` is not empty and `states no different term` otherwise. Copies of one agreement (same variant, number and date; when an agreement has no number or date, the terms it states too) are listed once, and copies of the agreement shown are not listed. Close with: "Amendments are listed, not applied: check an amendment for the value in force." Each document is read on its own, and the table never merges an amendment into the agreement it amends.

**Side letters — <count> on file · <N> with extracted provisions**

`<count>` is `sideLetterCount`: the letters the fund granted its own LPs. Side letters with any extracted provision sort to the top of the table. Deduplication is by (counterparty, issue date, role), the counterparty compared modulo case and punctuation, and an undated, draft, unfilled or fund-unsigned copy folds into that counterparty's one signed, dated letter — repeated uploads of the same letter across investor subscription bundles collapse to one row (cleanest extraction wins). Two signed letters to one LP on different dates stay two rows.

A letter with no counterparty name reads **Template, no investor named** in the Counterparty column when `hasUnfilledPlaceholders` is set (a blank form, not yet filled in), and **Investor not named** otherwise. Never leave the cell empty or show `—`.

| # | Counterparty | Issue date | Capital commitment | Summary |
|---|-------------|-----------|--------------------|---------|
| 1 | Sample LP | Mar 24, 2022 | MYR 15,000,000 | • **Reduced carry:** 15% (LPA: 20.00%) |
| 2 | Another LP | Oct 12, 2019 | $5,000,000 `[from LPA]` | — |
| 3 | Sample LP III `[All series]` | Jan 15, 2026 | — | — |

A row with `sharedAcrossSeries: true` carries an `[All series]` chip: the letter names a series LLC but not one of its series, so it is listed on every series of that LLC and counted once in `totalSideLetters`. A letter that names a series is listed on that series alone.

Letters with `role: "investor"` are the fund receiving terms as an LP of another manager's fund; the counterparty is that fund. A portfolio company's round letter is never one of them: it counts as a `company` letter. List them after the table under **Received as an investor — <N>**, same columns, and never include them in `<count>` or `totalSideLetters`: those count what the fund granted its LPs.

**Capital commitment** prefers the side letter's own `lpCapitalCommitment` — a pipeline-formatted string (e.g. `"MYR 15,000,000"`), shown verbatim, populated on a minority of side letters.

When that is absent, `process.py` backfills from the fund's own LPA: it matches the side letter's `lpName` against the LPA's `limited_partner` roster (`best_match`, a normalized fuzzy match at `≥ 0.85` — investor names only; fund names use the stricter matcher in Caveats) and takes that LP's `commitment_amount`, writing `lpCapitalCommitmentAmount`, `lpCapitalCommitmentCurrency` and `lpCapitalCommitmentFromLpa: true`. Render a backfilled figure with the LPA's own amount formatting and a `[from LPA]` chip — never bare, since it was not stated in the side letter and rests on a name match. `—` when neither source has a figure.

The backfill is skipped for `role: "investor"` rows (the counterparty is another manager's fund and this fund is its LP, so neither side matches this fund's roster) and when the name clears no roster entry at the threshold. It also can't help when the fund's selected LPA carries no LP roster at all — LPA selection prefers `headlineTermCount` first, then `termsExtracted`, which biases toward the roster-bearing extraction, but does not guarantee one.

**Summary rendering rules:**
- Each `economic_provisions[].provision_type` renders as a bulleted line.
- After those, each non-empty `complexManagementFee`, `complexCarry`, `mfnProvision`, `excuseRight` and `transferRestrictionModification` renders as a bulleted line: the label (`Custom management fee`, `Custom carry`, `MFN`, `Excuse right`, `Transfer`) in bold, then its extracted sentence verbatim.
- Known types compare against the fund's own LPA where relevant:
  - `REDUCED_CARRIED_INTEREST` → `Reduced carry: <rate> (LPA: <lpa carry>)`
  - `REDUCED_MANAGEMENT_FEE` → `Reduced management fee: <rate> (LPA: <lpa mgmt fee>)`
  - `INCREASED_PREFERRED_RETURN` / `INCREASED_HURDLE` → `Increased hurdle: <rate> (LPA: <lpa hurdle>)`
- Full waivers render as a bare label — no rate, no trailing `—`, and no `(LPA: …)` comparison. A waiver isn't a rate to compare against the LPA, and a trailing dash reads as missing data when nothing is in fact missing:
  - `WAIVED_MANAGEMENT_FEE` → `Waived management fee`
  - `WAIVED_CARRIED_INTEREST` → `Waived carried interest`
- Known labels are sentence case — only the first word is capitalized.
- Unknown types fall through with a title-cased raw label so they're still visible.
- Empty summary shows `—` — extraction may just not cover the provisions this side letter modifies yet, not necessarily "no modifications."

Always follow the side letter table (or empty state) with:

> *"Provisions in the Summary column are extracted from each side letter; LPA comparisons pull from this fund's extracted terms. See Step B4 to search across all funds' extracted provisions."*

### Step D

```python
AskUserQuestion(
    questions=[{
        "question": "What would you like to do next?",
        "header": "Next step",
        "multiSelect": False,
        "options": [
            {"label": "Back to full audit", "description": "Return to the three-bucket fund summary. ← recommended"},
            {"label": "Look up another fund", "description": "Search LPA data for a different fund."},
        ],
    }]
)
```
