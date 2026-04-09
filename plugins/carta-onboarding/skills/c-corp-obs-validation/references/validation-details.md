# C-Corp OBS Validation — Complete 33-Point Checklist

## 1. HOLDER TYPE VALIDATION

**What to Check:** Every holder/stakeholder entry in the OBS

**Valid Values Only:**
- "Individual" — for people
- "Non-Individual" — for everything else (companies, funds, trusts, LLCs, partnerships)

**Error Condition:**
- Flag any entry using "Entity", "Trust", "Company", "Corporation", "Fund", or any other variation

**Severity:** Critical

**How to Report:**
- Tab: [Tab Name]
- Cell: [Row, Column]
- Issue: Invalid holder type
- Expected: "Individual" or "Non-Individual"
- Actual: [Invalid value found]

---

## 2. PAR VALUE — NON-US COMPANIES

**What to Check:** Par value field for every company, cross-referenced with incorporation jurisdiction

**Rule:**
- If company is NOT incorporated in the US, par value MUST be BLANK
- Do NOT populate par value for non-US incorporated companies

**Error Conditions:**
1. Par value is populated AND company is non-US incorporated
2. Par value is blank but HIGHLIGHTED yellow for non-US company (should not be highlighted — it's simply not required)

**Severity:**
- Populated par value for non-US: Critical
- Incorrectly highlighted blank par value: Major

**How to Report:**
- Tab: [Certificates tab]
- Cell: [Row, Column F (or par value column)]
- Issue: Par value populated for non-US company / Unnecessary yellow highlight on non-US par value
- Expected: Blank / Blank without highlight
- Actual: [Value shown]

---

## 3. SENIORITY — NO INFERENCE

**What to Check:** Every seniority ranking entry in preferred share tabs

**Rule:**
- Seniority must come from source documents ONLY
- Do NOT infer or assume seniority ranking

**Error Conditions:**
1. Seniority is populated but no liquidation preference clause or explicit seniority ranking exists in the source documents
2. Liquidation preferences exist in source documents BUT seniority is not explicitly numbered — should be BLANK and YELLOW

**Valid State:**
- If source documents explicitly state "Series A is senior to Series B", populate seniority
- If source documents show liquidation preference order but don't number it, leave BLANK and highlight YELLOW

**Severity:**
- Seniority without source support: Critical
- Unsupported inferred ranking: Critical
- Missing yellow on ambiguous seniority: Major

**How to Report:**
- Tab: [Preferred Certificates]
- Cell: [Row, Seniority column]
- Issue: Seniority populated without explicit source support / Seniority should be blank and yellow when not explicitly numbered
- Expected: [Source document statement] / Blank + Yellow
- Actual: [Value found]

---

## 4. CUMULATIVE DIVIDENDS — PREFERRED SHARES

**What to Check:** Cumulative Dividends field for every preferred share class

**Rule:**
- Every preferred share class MUST have Cumulative Dividends marked "Yes" or "No"
- If not documented in source documents, it MUST be BLANK and YELLOW

**Error Conditions:**
1. Cumulative Dividends is populated but no source document supports the answer
2. Cumulative Dividends is missing (blank) but NOT highlighted yellow

**Severity:**
- Populated without source: Critical
- Missing without yellow: Major

**How to Report:**
- Tab: [Preferred Certificates or Share Classes]
- Cell: [Row, Cumulative Dividends column]
- Issue: Cumulative Dividends populated without source / Cumulative Dividends missing without yellow highlight
- Expected: Yes/No (with source) or Blank + Yellow
- Actual: [Value found]

---

## 5. MISSING EMAIL HIGHLIGHTING

**What to Check:** Email address field for every stakeholder/holder

**Rule:**
- Every stakeholder should have an email address
- If an email is missing, the cell MUST be highlighted yellow

**Error Condition:**
- Any blank email field that is NOT highlighted yellow

**Severity:** Major

**How to Report:**
- Tab: [Stakeholders or Equity Plan Awards]
- Cell: [Row, Email column]
- Issue: Missing email without yellow highlight
- Expected: Email address OR Blank + Yellow
- Actual: Blank without highlight

---

## 6. LEGENDS — NON-US COMPANIES

**What to Check:** Legend entries for any non-US incorporated company

**Rule:**
- Non-US companies should NOT have default US legends applied
- Each legend must correspond to actual content/entry in Legends tab

**Error Conditions:**
1. Legend entry appears to be a US-standard template applied to a non-US company (e.g., "US_STANDARD_LEGENDS", boilerplate US legend text)
2. Legend reference like "NO_LEGEND" or placeholder text that doesn't correspond to an actual entry in the Legends tab

**Severity:** Major

**How to Report:**
- Tab: [Certificate tabs]
- Cell: [Row, Legend column]
- Issue: US template legend applied to non-US company / Legend code has no matching Legends tab entry
- Expected: Non-US appropriate legend or null
- Actual: [Template found]

---

## 7. LEGEND CROSS-REFERENCE

**What to Check:** Every legend code used in certificate tabs against the Legends tab

**Rule:**
- Every legend code referenced in Common/Preferred Certificates must have a matching entry in the Legends tab
- No orphaned legend codes

**Error Condition:**
- Certificate references a legend code that has no matching Legends tab entry

**Severity:** Critical

**How to Report:**
- Tab: [Certificate tab]
- Cell: [Row, Legend column]
- Issue: Legend code not found in Legends tab
- Expected: Legend code exists in Legends tab
- Actual: "LEGEND_CODE_XYZ" (not found in Legends tab)

---

## 8. SHARE CLASS NAMING AND CERTIFICATE PREFIX

**What to Check:** Certificate prefixes follow Carta platform conventions and are consistent across all tabs. Also checks for cross-tab name consistency. *(Note: check #29 covers Share Class Name field conventions specifically, at Minor severity.)*

**Rule:**
- All ordinary/common shares use the CS- prefix (including non-US — ORD→CS, SAPS→PSA)
- ESOP treasury shares use ES- prefix; Preferred Series A/B/C use PSA-/PSB-/PSC-
- Government register class names go in Admin Notes only, not as the OBS Share Class Name
- Share class name must be consistent between Share Classes tab and Certificate tabs (no tab uses a different name for the same class)

**Error Conditions:**
1. Certificate prefix uses registry codes (e.g., OS-, ORD-, SAPS-) instead of Carta conventions (CS-, PSA-)
2. Share class name inconsistent between Share Classes tab and Certificate tabs
3. ESOP certificates use ESOP- or ESP- instead of ES-

**Severity:** Major

**How to Report:**
- Tab: [Share Classes or Certificates]
- Cell: [Row, Share Class / Prefix column]
- Issue: Share class name or prefix uses registry terminology instead of Carta platform conventions
- Expected: [Carta convention name/prefix]
- Actual: [Value found]

---

## 9. DATE FORMAT

**What to Check:** Every date field in the OBS (issue dates, acquisition dates, maturity dates, exercise dates, etc.)

**Rule:**
- ALL dates must be in MM/DD/YYYY format
- Flag any date using DD/MM/YYYY, YYYY-MM-DD, or other formats

**Special Attention:**
- Dates where day ≤ 12 are ambiguous between MM/DD and DD/MM
- Cross-reference with source documents to confirm intent

**Severity:** Critical (ambiguous dates can lead to wrong cap table dates)

**How to Report:**
- Tab: [Any tab with dates]
- Cell: [Row, Date column]
- Issue: Date in wrong format
- Expected: MM/DD/YYYY
- Actual: [Format found]

---

## 10. COMBINED ISSUANCES

**What to Check:** Verify one OBS row per distinct issuance

**Rule:**
- Each distinct issuance in source documents must be a separate OBS entry
- Do NOT combine multiple issuances into one row

**Red Flags:**
- Two different investors in the same row
- Two different dates merged into one row
- Quantities that are suspiciously round sums (e.g., row shows 1,500,000 but source has separate issuances of 1,000,000 + 500,000)

**Reconciliation Check:**
- Count of issuances in source documents should equal count of certificate entries in OBS

**Severity:** Critical

**How to Report:**
- Tab: [Certificate tabs]
- Cell: [Row number]
- Issue: Multiple issuances combined into single entry
- Expected: Separate OBS rows for each issuance
- Actual: [List the combined issuances]

---

## 11. QUANTITY VERIFICATION

**What to Check:** Quantity field for every certificate/award

**Rule:**
- Quantity must match the source document exactly
- Pay special attention to digit counts — a common error is dropped or added zeros

**Examples of Common Errors:**
- Source: 1,250,000 | OBS: 12,500,000 (extra zero)
- Source: 1,250,000 | OBS: 125,000 (dropped zero)

**Severity:** Critical

**How to Report:**
- Tab: [Certificate tab]
- Cell: [Row, Quantity column]
- Issue: Quantity mismatch from source document
- Expected: [Exact quantity from source]
- Actual: [Quantity in OBS]

---

## 12. CASH VERIFICATION

**What to Check:** Cash paid field for every certificate/award

**Rule:**
- Cash paid must match the source document exactly
- Pay special attention to digit counts and decimal places

**Special Cases:**
- Transfers: cash paid should be $0.00
- SAFE/Note conversions: cash paid should be $0.00

**Severity:** Critical

**How to Report:**
- Tab: [Certificate tab]
- Cell: [Row, Cash Paid column]
- Issue: Cash paid amount mismatch from source document
- Expected: [Exact amount from source]
- Actual: [Amount in OBS]

---

## 13. CURRENCY VALIDATION

**What to Check:** Currency field for Convertible Notes, SAFEs, and Equity Plan Awards

**Critical Rule:**
- Convertible Notes / SAFEs: currency MUST match the CN/SAFE agreement, NOT the company's operating currency
- Equity Plan Awards: currency MUST match the grant agreement or equity plan, NOT the company's operating currency

**Error Condition:**
- Any entry where currency appears to have been defaulted to the company's operating currency without checking the source document

**Example:**
- Company operates in EUR, but SAFE agreement is in USD → OBS currency must be USD, not EUR

**Severity:** Critical

**How to Report:**
- Tab: [Convertible Notes, SAFEs, or Equity Plan Awards]
- Cell: [Row, Currency column]
- Issue: Currency appears to be defaulted to company operating currency without source verification
- Expected: [Currency from source agreement]
- Actual: [Currency in OBS]

---

## 14. CONVERTIBLE NOTE / SAFE FIELD CHECKS

**What to Check:** Field completeness and format for Convertible Notes and SAFEs

### 14.1 Conversion Discount Format

**Rule:**
- Conversion Discount must be formatted as percentage with % symbol
- Valid: "20%"
- Invalid: "0.20" or "20" (without %)

**Severity:** Major

### 14.2 Interest Rate

**Rule:**
- SAFEs should have NO interest rate — leave blank
- Convertible Notes MUST have an interest rate populated
- If not in source documents, highlight yellow

**Error Conditions:**
- SAFE has interest rate populated
- Convertible Note has blank interest rate (should be highlighted yellow if not found)

**Severity:** Critical

### 14.3 Maturity Date

**Rule:**
- SAFEs should have NO maturity date — leave blank
- Convertible Notes MUST have a maturity date populated
- If not in source documents, highlight yellow

**Error Conditions:**
- SAFE has maturity date populated
- Convertible Note has blank maturity date (should be highlighted yellow if not found)

**Severity:** Critical

### 14.4 SAFE vs CN Mislabeling

**Rule:**
- Verify type is correctly labeled as "SAFE" or "CN"

**Error Condition:**
- SAFE labeled as CN or vice versa

**Severity:** Critical

**How to Report (Section 14):**
- Tab: [Convertible Notes or SAFEs]
- Cell: [Row, specific field column]
- Issue: [Interest Rate missing from CN / SAFE has interest rate / Conversion Discount missing % / etc.]
- Expected: [Correct format/value]
- Actual: [Value found]

---

## 15. PTEP (POST-TERMINATION EXERCISE PERIOD)

**What to Check:** PTEP field when an equity plan exists

**Rule:**
- If an equity plan exists, PTEP must either be:
  - Populated from the plan document, OR
  - Blank and highlighted yellow

**Error Conditions:**
1. PTEP shows "0" — this is not a valid value; use blank + yellow if unknown
2. PTEP is missing (blank) with no yellow highlight when an equity plan exists

**Severity:**
- PTEP = "0": Critical
- PTEP missing without yellow: Major

**How to Report:**
- Tab: [Equity Plans]
- Cell: [Row, PTEP column]
- Issue: PTEP populated as "0" / PTEP missing without yellow highlight
- Expected: [Number of days from source] or Blank + Yellow
- Actual: [Value found]

---

## 16. ESOP / EQUITY PLAN TREATMENT

**What to Check:** ESOP pool entries across all tabs

**Rule:**
- ESOP pool definitions must be in the Equity Plans tab
- Company-held ES- treasury certificates in the Common Certificates tab are **required and correct** — they represent the unissued pool held by the company (see check #25)
- Flag only non-company ESOP certificate holders (i.e., ES- certs where the holder is NOT the company itself, or ES- certs placed in Preferred Certificates)
- ESOP pools must NOT appear as stakeholder line items

**Error Conditions:**
1. ES- certificate in Common Certificates tab with a holder other than the company itself (Holder Type = Individual, or holder name is not the issuing company)
2. ESOP pool listed as a stakeholder entry
3. ESOP pool missing from Equity Plans tab entirely

**Severity:** Critical

**How to Report:**
- Tab: [Common Certificates or Stakeholders]
- Cell: [Row]
- Issue: ESOP certificate held by non-company holder / ESOP pool missing from Equity Plans tab
- Expected: ES- certs held by company (Non Individual) + Equity Plans tab entry
- Actual: [What was found]

---

## 17. VESTING SCHEDULE VALIDATION

**What to Check:** Grant Date and Vesting Commencement Date for all equity plan awards

**Rule:**
- Grant Date and Vesting Commencement Date are different fields
- Do NOT assume they are the same without explicit source document confirmation

**Error Conditions:**
1. Grant Date and Vesting Commencement Date appear to be identical without explicit source document confirmation
2. A cliff is assumed without being stated in the grant agreement
3. Termination type is assumed (e.g., "voluntary termination") without source document support

**Severity:** Major

**How to Report:**
- Tab: [Equity Plan Awards]
- Cell: [Row, Grant Date / Vesting Commencement Date columns]
- Issue: Assumed grant date = vesting commencement date without source / Assumed cliff without documentation / Assumed termination type
- Expected: [Source document confirmation or different values]
- Actual: [Values found]

---

## 18. MISSING ISSUANCES

**What to Check:** Total count of issuances across all source documents vs. OBS entries

**Reconciliation Process:**
1. Count total distinct issuances across all source documents (by shareholder and date)
2. Count total certificate entries in OBS (Common + Preferred tabs)
3. If OBS count < source document count, identify the missing issuances by shareholder and date

**Special Attention:**
- Preferred share issuances are most commonly missed

**Severity:** Critical

**How to Report:**
- Tab: [Summary]
- Issue: Missing issuances in OBS
- Expected: [Total issuance count from source documents]
- Actual: [Count of certificates in OBS]
- Detail: [List missing issuances by shareholder and date]

---

## 19. PRICE PER SHARE AND CASH PAID

**What to Check:** Price per share and cash paid fields across all certificate tabs

**Rule:**
- If price per share is not in source documents: MUST be BLANK and YELLOW (not $0.00)
- If cash paid is not in source documents: MUST be BLANK and YELLOW (not $0.00)
- $0.00 is only valid when documents explicitly state no cash was paid

**Special Cases:**
- Transfers: cash paid should be $0.00 (no payment made)
- SAFE/Note conversions: cash paid should be $0.00 (no new cash paid)

**Error Conditions:**
1. Price per share or cash paid is $0.00 when it should be blank + yellow
2. Blank field without yellow when not in source documents

**Severity:**
- $0.00 instead of blank + yellow: Major
- Blank without yellow: Major

**How to Report:**
- Tab: [Certificate tab]
- Cell: [Row, Price Per Share / Cash Paid column]
- Issue: Unknown price/cash shown as $0.00 instead of blank + yellow / Missing yellow on unknown value
- Expected: Blank + Yellow / [Value from source]
- Actual: $0.00 / Blank without highlight

---

## 20. SHEET INTEGRITY

**What to Check:** Data type placement across all tabs

**Rule:**
- Share Classes tab: ONLY share class definitions (no certificates, no grants)
- Common/Preferred Certificates: ONLY certificates (no plan metadata, no grant data)
- Equity Plans: ONLY plan-level metadata (no individual grants, no certificates)
- Equity Plan Awards: ONLY individual grants (no plan metadata, no certificates)

**Error Condition:**
- Any data type appearing in the wrong tab

**Severity:** Major

**How to Report:**
- Tab: [Wrong tab]
- Cell: [Row]
- Issue: [Data type] found in [tab name] — should be in [correct tab]
- Expected: Data in [correct tab]
- Actual: [Found in wrong tab]

---

## 21. DOCUMENT EXECUTION STATUS

**What to Check:** Any data extracted from unexecuted documents

**Rule:**
- Data extracted from unexecuted (unsigned/draft) documents must be highlighted yellow
- Every unexecuted document used must be noted in the audit report

**Error Conditions:**
1. Data extracted from unexecuted document is NOT highlighted yellow
2. Unexecuted document not noted in audit report

**Severity:** Major

**How to Report:**
- Tab: [Affected tabs]
- Cell: [Row with data from unexecuted document]
- Issue: Data from unexecuted document without yellow highlight / Unexecuted document not noted in audit report
- Expected: Yellow highlight on data from unexecuted docs / All unexecuted docs noted in audit
- Actual: [Found without highlight]

---

## 22. TRANSFER MATH

**What to Check:** Every transfer entry

**Rule:**
- Original certificate quantity must equal Transferee quantity + Balance quantity (if partial transfer)
- For full transfers: Original quantity = Transferee quantity

**Formula:**
- Original Qty = Transferee Qty + Remaining Balance Qty

**Severity:** Critical

**How to Report:**
- Tab: [Certificate tab showing transfer]
- Cell: [Original certificate row + Transferee certificate row]
- Issue: Transfer math does not balance
- Expected: Original Qty (100,000) = Transferee Qty (60,000) + Balance (40,000)
- Actual: [Values found]

---

## 23. SHARE CLASS CONVERSION VALIDATION

**What to Check:** Every share class conversion entry

**All of the following must be true:**

1. **Same Stakeholder:** Original and resulting certificate must be for the same shareholder
2. **Different Share Class:** Original certificate must be Class A; resulting must be Class B (they MUST differ)
3. **Original Certificate Must Exist:** Certificate ID in "Share Class Converted From" field must exist in the OBS
4. **Issue Date Ordering:** Resulting certificate issue date must be on or after original certificate issue date
5. **No Reuse:** Each original certificate can only be used once in "Share Class Converted From"
6. **Acquisition Date:** Original Acquisition Date on resulting certificate should be BLANK (it auto-inherits from original)

**Severity:** Critical for items 1-5; Major for item 6

**How to Report:**
- Tab: [Certificate tab]
- Cell: [Row of resulting certificate]
- Issue: [Which validation rule violated]
- Expected: [Correct relationship]
- Actual: [Found]

---

## 24. AUTHORIZED vs OUTSTANDING

**What to Check:** Authorized and outstanding share counts per class

**Rule:**
- Total outstanding shares per share class must NOT exceed authorized shares for that class

**Formula:**
- Outstanding Shares ≤ Authorized Shares (for each share class)

**Error Condition:**
- Outstanding > Authorized for any share class

**Severity:** Critical

**Reconciliation Check:**
- For each share class:
  - Sum all active certificates (Common/Preferred tabs) = Issued count
  - Compare against Share Classes tab "Authorized" amount
  - Create a reconciliation table:

| Share Class | Authorized | Issued (from certs) | Outstanding | Match (Yes/No) |
|---|---|---|---|---|
| Common | 10,000,000 | 5,250,000 | 5,250,000 | Yes |
| Series A | 2,000,000 | 2,000,000 | 2,000,000 | Yes |
| Series B | 3,000,000 | 2,500,000 | 2,500,000 | Yes |

**How to Report:**
- Tab: [Summary / Share Classes]
- Issue: Outstanding shares exceed authorized for [Share Class]
- Expected: Outstanding ≤ Authorized
- Actual: [Numbers showing violation]

**Additional Reconciliation Checks:**
- For each equity plan: Sum of awards in Equity Plan Awards tab must not exceed Authorized Shares in Equity Plans tab
- For convertible notes: Count of conversion certificates must match count of converted notes
- For exercises: Count of exercised certificates must match count of exercised grants/warrants

---

## 25. ESOP TREASURY CERTIFICATE EXISTENCE

**What to Check:** If the Equity Plans tab has a Reserved Shares value, matching treasury certificates must exist on the Common Certificates tab.

**Rule:**
- When Equity Plans tab has Reserved Shares populated, Common Certificates must contain one or more rows held by the company itself (Holder = company name, Holder Type = Non Individual, Relationship = Other, Share Class prefix = ES-)
- Sum of all ES- treasury certificate quantities must equal Equity Plans Reserved Shares exactly

**Error Conditions:**
1. Equity Plans tab has Reserved Shares but no ES- treasury certs exist in Common Certificates
2. Sum of ES- treasury cert quantities does not equal Reserved Shares
3. ES- certs exist but Holder Type is "Individual" or Holder is not the company itself

**Severity:** Critical

**How to Report:**
- Tab: Common Certificates
- Issue: ESOP treasury certificates missing or quantity mismatch
- Expected: ES- cert(s) with total quantity = Equity Plans Reserved Shares
- Actual: [Count found / total quantity found]

---

## 26. SAFE INTEREST ACCRUAL PERIOD

**What to Check:** All SAFEs in the Convertible Notes tab have Interest Accrual Period = "Daily"

**Rule:**
- Every row in the Convertible Notes tab that is a SAFE (no Interest Rate, no Maturity Date) must have Interest Accrual Period = "Daily"
- "Annually", blank, or any other value is incorrect and causes import failure

**Error Conditions:**
1. Interest Accrual Period is blank on a SAFE
2. Interest Accrual Period is "Annually" or any value other than "Daily" on a SAFE

**Severity:** Critical (causes import error)

**How to Report:**
- Tab: Convertible Notes
- Row: [Row number]
- Issue: SAFE Interest Accrual Period must be "Daily"
- Expected: "Daily"
- Actual: [Value found]

---

## 27. SAFE VALUATION CAP TYPE

**What to Check:** All SAFEs with a Valuation Cap have Valuation Cap Type populated

**Rule:**
- If Valuation Cap is populated on a SAFE, Valuation Cap Type must be "Pre-money" or "Post-money"
- Blank Valuation Cap Type when Valuation Cap has a value is an error
- YC standard SAFEs are Post-money; verify against the actual SAFE document

**Error Conditions:**
1. Valuation Cap is populated but Valuation Cap Type is blank
2. Valuation Cap Type has a value other than "Pre-money" or "Post-money"

**Severity:** Critical

**How to Report:**
- Tab: Convertible Notes
- Row: [Row number]
- Issue: Valuation Cap Type missing or invalid on SAFE
- Expected: "Pre-money" or "Post-money"
- Actual: [Value found]

---

## 28. SAFE INTEREST RATE / MATURITY DATE BLANK

**What to Check:** SAFEs have Interest Rate and Maturity Date left blank

**Rule:**
- SAFEs do not accrue interest and have no maturity date; these fields must be blank
- Interest Rate = 0% or "N/A" is incorrect — must be blank
- Maturity Date populated on a SAFE is incorrect — must be blank

**Error Conditions:**
1. Interest Rate is populated (including 0%) on a SAFE
2. Maturity Date is populated on a SAFE

**Severity:** Critical (causes import error)

**How to Report:**
- Tab: Convertible Notes
- Row: [Row number]
- Issue: SAFE Interest Rate / Maturity Date must be blank
- Expected: Blank
- Actual: [Value found]

---

## 29. SHARE CLASS NAME CONVENTION

**What to Check:** The Share Class Name field uses Carta platform naming conventions, not government registry terminology. *(Note: check #8 covers prefix conventions and cross-tab consistency at Major severity. This check covers only the Name field and is Minor because registry names don't block import but reduce data quality.)*

**Rule:**
- Share Class Names must use Carta platform conventions: "Common" (not "Ordinary Shares" or "Ordinary"), "Series A Preferred" (not "Series A Preference Shares" or "SAPS")
- Registry names (ORD, Ordinary Shares, SAPS, Preference Shares) should appear in Admin Notes only
- This applies to ALL jurisdictions including non-US — the OBS Share Class Name is a Carta platform field, not a registry field

**Error Conditions:**
1. Share Class Name uses registry terminology instead of Carta platform names
2. "Ordinary Shares", "Preference Shares", or other registry names used as Share Class Name

**Severity:** Minor — registry names in the Name field don't block import but create confusion for future OBS users

**How to Report:**
- Tab: Share Classes
- Row: [Row number]
- Issue: Share Class Name uses registry terminology
- Expected: Carta platform name (e.g., "Common", "Series A Preferred")
- Actual: [Value found]

---

## 30. NOMINAL PPS FOR NON-US REGISTER COMPANIES

**What to Check:** For non-US companies where the government register records nominal/par value, certificate Price Per Share reflects the nominal register value

**Rule:**
- Government registers (ASIC, ACRA, ADGM, etc.) record share issuances at nominal/par value (e.g., $0.0001)
- OBS certificates for these jurisdictions must use the register value as Price Per Share
- Actual investment pricing belongs in Share Classes Original Issue Price field and Admin Notes
- Exception: jurisdictions with no par value (AU post-2001, HK post-2014, SG, SA) — leave blank

**Error Conditions:**
1. Non-US certificates use actual economic investment price instead of nominal register value as Price Per Share
2. Share Classes OIP not populated for non-US preferred where actual investment price is known

**Severity:** Major

**How to Report:**
- Tab: [Common or Preferred Certificates]
- Row: [Row number]
- Issue: Price Per Share should be nominal register value, not economic investment price
- Expected: Nominal value from register
- Actual: [Economic price found]

---

## 31. CARTA PREFIX CONVENTIONS

**What to Check:** All certificate prefixes use Carta standard conventions, not government registry codes

**Rule:**
- Ordinary/common shares: CS- (including non-US; ORD→CS, Ordinary→CS)
- ESOP treasury shares: ES- (not ESOP-, not ESP-)
- Preferred Series A/B/C: PSA-, PSB-, PSC-
- Registry codes (ORD-, SAPS-, PRF-, OS-) must never appear as OBS prefixes

**Error Conditions:**
1. Common/ordinary certificates use OS-, ORD-, or other registry codes instead of CS-
2. ESOP certificates use ESOP- instead of ES-
3. Preferred certificates use registry codes (SAPS-, PRF-) instead of PSA-/PSB-/PSC-

**Severity:** Major

**How to Report:**
- Tab: [Share Classes or Certificates]
- Row: [Row number]
- Issue: Non-standard prefix used
- Expected: [Carta convention prefix]
- Actual: [Registry code prefix found]

---

## 32. TRANSFER CHAIN COMPLETENESS

**What to Check:** When the shareholder register shows entity restructuring (renames, splits), both original certs and transfer certs exist with proper linkage

**Rule:**
- If source documents show a share transfer due to entity renaming, restructuring, or splitting, the OBS must contain both the original certificate AND transfer certificate(s)
- Transfer certs must have "Transferred From" referencing the original cert ID
- If the original entity retained some shares, a balance certificate must also exist
- Transfer cert Issue Date = transfer date from register (not the original issuance date)

**Error Conditions:**
1. Transfer exists in source documents but only the post-transfer state is modeled (missing original cert)
2. Transfer cert exists but "Transferred From" field is blank
3. Transfer math is wrong (original quantity ≠ sum of all transfer + balance quantities)

**Severity:** Major

**How to Report:**
- Tab: [Common or Preferred Certificates]
- Issue: Transfer chain incomplete — original cert or "Transferred From" missing
- Expected: Original cert + transfer cert(s) with "Transferred From" references
- Actual: [What is present]

---

## 33. FOUNDER ISSUE DATE ACCURACY

**What to Check:** Founders added after incorporation have issue dates from SHA or government register, not the incorporation date

**Rule:**
- Original founders (named in the Certificate of Incorporation / initial government filing) may use the incorporation date
- Founders added later via SHA or subsequent share issuances must use the SHA execution date or the date shown in the shareholder register for their first entry
- Cross-reference government register appointment dates — if a founder's appointment date is after incorporation, their issue date should reflect that

**Error Conditions:**
1. All founders have the same incorporation date even when the register shows different appointment dates for some founders
2. A founder whose shares are documented in the SHA (not the COI) has the incorporation date as Issue Date instead of the SHA date

**Severity:** Major

**How to Report:**
- Tab: Common Certificates
- Row: [Row number, founder name]
- Issue: Issue Date should be SHA/register date, not incorporation date
- Expected: [Date from SHA or register appointment]
- Actual: [Incorporation date found]

---

## Summary Report Template

After completing all 33 checks, provide this summary:

```
TOTAL ISSUES FOUND: X

BREAKDOWN BY SEVERITY:
- Critical Issues (data accuracy problems / import blockers): X
- Major Issues (missing highlights, formatting, incomplete data): X
- Minor Issues (style/convention): X

DETAILED FINDINGS:
[List each issue in table format: Tab | Row/Cell | Issue | Expected | Actual | Severity]

RECONCILIATION SUMMARY:

Share Classes Reconciliation:
[Table showing Authorized | Issued | Outstanding | Match for each class]

Equity Plans Reconciliation:
[Table showing Plan | Authorized | Awards Sum | Match for each plan]

Convertible Notes Reconciliation:
[Count of notes | Count of conversion certs | Match]

ESOP Treasury Reconciliation:
[Equity Plans Reserved Shares | Sum of ES- cert quantities | Match]

PASS/FAIL STATUS: [PASS if no critical issues | FAIL if any critical issues exist]
```

