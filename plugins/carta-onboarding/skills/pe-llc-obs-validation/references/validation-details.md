# PE/LLC OBS Validation Details — Complete Checklist

Complete specifications for all 55 validation checks in the PE/LLC OBS validation framework. Each check includes validation rules, error conditions, valid values, and severity guidance.

---

## ENTITY & STRUCTURE VALIDATION

### 1. Entity Type Validity

**Valid Entity Types:**
- Individual
- Corporation
- LLC
- Trust
- Partnership
- Limited Partnership
- Non-Profit
- Other

**Invalid/Non-Standard Labels:**
- Company, Fund, Person, Firm, or other informal variations
- Acronyms without full entity type (e.g., "Corp" instead of "Corporation")
- Abbreviations like "LP" without matching the actual entity type

**Error Conditions:**
- Any entry using a label not in the valid list
- Natural persons labeled as anything other than "Individual"
- Registered legal entities using informal labels

**Severity:** Critical (data integrity issue)

---

### 2. Entity Type Consistency

**Rule:** Entity type must align with both the holder's name and the formation documents.

**Validation Checks:**
- "Individual" entity type must have a personal name (e.g., "John Smith"), not an organization name
- Organization names (containing "Fund," "Capital," "Partners," "LP," "LLC") must NOT be classified as "Individual"
- Entity type must match the Operating Agreement, LP Agreement, or formation documents
- For international entities: use the closest US equivalent (e.g., "GmbH" → "Corporation")

**Error Conditions:**
- "Individual" for "River Cities Capital Fund VII, L.P." — flag as contradiction
- "Corporation" for "John A. Smith" — flag as contradiction
- Entity type in OBS differs from formation documents

**Severity:** Critical

---

### 3. Account Name Accuracy

**Rule:** Account Name on Entity & Interests tab must match the exact legal name from the Operating Agreement or LPA cover page.

**Validation Checks:**
- Compare Account Name character-by-character with the OA/LPA cover page
- Flag abbreviated names (e.g., "River Cities Fund VII" vs. "River Cities Capital Fund VII, L.P.")
- Flag informal/email-derived names (e.g., "RC Fund" or "rivercities@example.com")
- Verify Account Name is consistent across all references in the OBS

**Error Conditions:**
- Account Name abbreviated or informal
- Account Name differs between Entity & Interests tab and other tabs
- Account Name doesn't match any official source document name

**Severity:** Critical

---

### 4. Multi-Entity Separation

**Rule:** Each OBS must cover exactly ONE issuing entity. No mixing of fund-level and portfolio company data.

**Validation Checks:**
- Confirm the OBS is for a single issuing entity by reviewing the Operating Agreement hierarchy
- Identify any rows that reference entities other than the primary issuing entity
- For PE structures with multiple levels (OpCo, HoldCo, Fund), verify all data belongs to the same level
- Flag any data that appears to come from a different entity's cap table

**Error Conditions:**
- OBS contains data from both a PE fund and its portfolio companies
- Mix of LP cap table data and management company data
- Unclear entity boundary with holders from multiple entities

**Severity:** Critical (CRITICAL flag in original prompt)

---

### 5. Entity Hierarchy Compliance

**Rule:** For PE fund structures, verify parent/subsidiary entities referenced in the OBS match the documented hierarchy.

**Validation Checks:**
- Cross-reference any OpCo, HoldCo, or subsidiary entities mentioned in the OBS against the audit report's entity hierarchy documentation
- Verify the OBS correctly identifies which entity is the issuing entity
- Confirm all subordinate entity references match formation documents
- Flag any entity references not documented in the audit report

**Error Conditions:**
- Entity hierarchy in OBS contradicts the Operating Agreement or audit report
- Orphaned entity references with no supporting documentation
- Unclear which entity is the primary issuing entity

**Severity:** Critical

---

## INTEREST HOLDER VALIDATION

### 6. Interest Holder Name Consistency

**Rule:** Every Interest Holder name must be identical across ALL tabs (Capital Interests, Profits Interests, Phantom Units, Transfers, Repurchases, Terminations, Cancelations, Exercise/Conversion, etc.).

**Validation Checks:**
- Extract all unique holder names from each tab
- Perform exact string matching across tabs
- Flag any name variation (e.g., "John A. Doe" vs. "John Adam Doe" vs. "J.A. Doe")
- Check for extra spaces, capitalization differences, or punctuation variations
- Verify common name patterns:
  - Full legal name vs. nickname or shortened version
  - Name with/without middle initial
  - Name with/without suffix (Jr., Sr., III)
  - Organization names with/without punctuation (LLC vs. L.L.C.)

**Error Conditions:**
- Same holder appears with different name spellings across tabs
- Holder exists in transaction tab (Transfer, Repurchase) but not in Interest Holders tab
- Holder in Interest Holders tab has zero issuances across all issuance tabs (orphaned)
- Holder in OBS does not appear in Schedule 1.7 of Operating Agreement
- Holder in Schedule 1.7 does not appear in OBS

**Severity:** Critical

---

### 7. Deduplication Check

**Rule:** No duplicate Interest Holders with minor name variations.

**Validation Checks:**
- Identify holders with similar names (fuzzy matching on first/last name, organization initials)
- Verify audit report documents which canonical name was chosen
- Check for:
  - "John A. Doe" vs. "John Adam Doe" vs. "J.A. Doe" — should be one canonical entry
  - "River Cities Fund VII, L.P." vs. "River Cities Capital Fund VII, L.P." — check source docs for correct legal name
  - Entity name changes due to acquisition or rebranding — verify effective date of change
- Confirm each unique holder appears exactly once in Interest Holders tab

**Error Conditions:**
- Same economic interest holder appears as multiple rows with name variations
- Audit report doesn't document the deduplication decision
- Name variations exist without resolution

**Severity:** Critical

---

### 8. Orphaned Holder Detection

**Rule:** No Interest Holder should exist with zero issuances across all issuance tabs.

**Validation Checks:**
- Sum total issuances per holder across all issuance tabs (Capital Interests, Preferred Units, Profits Interests, Phantom Units, Options, Warrants, SAFEs, Convertible Notes)
- Verify each holder in Interest Holders tab has at least one issuance
- If a holder has zero issuances, flag for deletion or documentation of why they're included

**Error Conditions:**
- Holder exists in Interest Holders tab but appears in no issuance tabs
- Placeholder holder not documented as such in audit report

**Severity:** Major (indicates incomplete extraction or stale entry)

---

### 9. Schedule 1.7 Reconciliation

**Rule:** Schedule 1.7 (or equivalent member schedule) is the PRIMARY AUTHORITATIVE UNIT HOLDER LIST. Every holder in Schedule 1.7 must appear in the OBS, and vice versa.

**Validation Checks:**
- Extract all holder names from Schedule 1.7 of the Operating Agreement (or most recent amended version)
- Extract all holder names from Interest Holders tab in OBS
- Perform exact match reconciliation
- For each holder in Schedule 1.7:
  - Verify they have a corresponding row in Interest Holders tab
  - Verify their total unit count in OBS (sum of all issuances) matches Schedule 1.7
  - Flag if missing from OBS
- For each holder in OBS:
  - Verify they appear in Schedule 1.7 (exceptions: holders added after OA was last amended)
  - If missing from Schedule 1.7, verify source document supports post-amendment issuance
- If Schedule 1.7 has been amended multiple times, confirm MOST RECENT amended version was used

**Error Conditions:**
- Holder in Schedule 1.7 missing from OBS (without documented explanation)
- Holder in OBS missing from Schedule 1.7 (without post-amendment documentation)
- Unit counts don't reconcile between Schedule 1.7 and OBS
- Using stale/unamended Schedule 1.7

**Severity:** Critical

---

### 10. Missing Email Highlighting

**Rule:** Every Interest Holder should have an email address. Missing emails must be highlighted yellow.

**Validation Checks:**
- Review Interest Holder Email field for each holder
- Identify any blank email cells
- Verify blank cells are highlighted yellow
- For non-blank emails, verify they appear legitimate:
  - Check for fabricated emails: "placeholder@company.com," "noemail@na.com," "TBD," "unknown@example.com"
  - Verify email format follows standard conventions
  - Flag obviously fake/placeholder emails for replacement with actual contact info

**Error Conditions:**
- Blank email field that is NOT highlighted yellow
- Email appears fabricated or placeholder-like
- Email missing without corresponding yellow highlight or audit report entry

**Severity:** Major (formatting/documentation)

---

### 11. Interest ID Uniqueness

**Rule:** Every Interest ID across all issuance tabs must be unique. No duplicates.

**Validation Checks:**
- Extract all Interest IDs from:
  - Capital Interests
  - Preferred Units
  - Profits Interests
  - Phantom Units
  - Options & Warrants
  - SAFEs
  - Convertible Notes
- Sort and identify any duplicates
- For each transaction (Transfer, Repurchase, Termination, Cancelation, Exercise):
  - Verify the Interest ID referenced exists in the corresponding issuance tab
  - Verify the interest type matches the transaction type

**Error Conditions:**
- Same Interest ID appears twice in the same tab
- Same Interest ID appears in different tabs
- Transaction references an Interest ID that doesn't exist in any issuance tab
- Interest ID references wrong interest type (e.g., Transfer references a Phantom Unit as if it's Capital Interest)

**Severity:** Critical

---

## INTEREST TYPE & CLASSIFICATION

### 12. Interest Type Classification

**Rule:** Every interest type must be classified as INVESTMENT, EQUITY COMPENSATION, or both.

**Valid Classifications:**
- Capital Interests purchased by external investors = INVESTMENT
- Profits Interests granted to employees/managers = EQUITY COMPENSATION
- Phantom Units / UARs = EQUITY COMPENSATION (cash payout rights only, not real equity)
- Options granted to employees = EQUITY COMPENSATION
- Warrants issued to investors = INVESTMENT
- SAFEs = INVESTMENT (convertible investment instrument)
- Convertible Notes = INVESTMENT

**Error Conditions:**
- Profits Interest classified as INVESTMENT
- Warrant classified as EQUITY COMPENSATION
- Capital Interest classified as EQUITY COMPENSATION
- Phantom Unit placed in INVESTMENT category
- Option placed in INVESTMENT category (unless granted to non-employee investors)

**Severity:** Critical

---

### 13. Phantom Units/UARs Placement

**Rule:** Phantom Units and UARs are NOT real equity and must be in a dedicated tab, NOT in Capital Interests or Profits Interests tabs.

**Validation Checks:**
- Scan Capital Interests tab for any entries marked as "Phantom" or "UAR"
- Scan Profits Interests tab for any entries marked as "Phantom" or "UAR"
- Verify all phantom units/UARs appear in a dedicated Phantom Units tab or working sheet
- Verify classification is EQUITY COMPENSATION
- Verify:
  - No OIP or Invested Capital values populated (these don't apply to phantom equity)
  - W-2 status confirmation exists (holder remains W-2 employee, not partner)
  - Payment trigger is documented (exit, change of control, sale, etc.)
  - For UARs specifically: Threshold Value is populated (UARs only pay out above threshold)

**Error Conditions:**
- Phantom units appear in Capital Interests or Profits Interests tabs
- Phantom units have OIP or Invested Capital values
- Phantom units classified as INVESTMENT
- Missing W-2 status confirmation
- Missing payment trigger documentation
- UAR missing Threshold Value

**Severity:** Critical

---

### 14. Interest Type Tab Integrity

**Rule:** Every Interest Type referenced in the OBS must exist in the Interest Types tab.

**Validation Checks:**
- Extract all unique Interest Types from issuance tabs
- Verify each Interest Type appears in the Interest Types tab
- Verify Interest Type names are exactly spelled/formatted consistently

**Error Conditions:**
- Interest Type referenced in Capital Interests tab doesn't exist in Interest Types tab
- Interest Type spelled differently in different tabs
- Typo in Interest Type name across tabs

**Severity:** Critical

---

### 15. Subscription + Joinder Pairing

**Rule:** For PE deals with subscription and joinder agreements, each should have a separate issuance row.

**Validation Checks:**
- Identify all subscription agreements and joinder agreements in the source documents
- Verify each has a separate issuance row in the Capital Interests or Preferred Units tab
- Verify each row is dated correctly (subscription date vs. joinder date)
- Verify Documents field references the correct agreement type (subscription vs. joinder with date)
- Cross-check: Cumulative units per investor (subscription + all joiners) must match cap table total for that investor
- If investor has multiple joiners, verify each joinder is documented separately

**Error Conditions:**
- Single row appears to combine subscription + joinder into one entry
- Joinder agreement missing from OBS
- Documents field doesn't specify subscription vs. joinder
- Cumulative units per investor don't reconcile

**Severity:** Critical

---

## PRICING & CAPITAL VALIDATION

### 16. Original Issue Price (OIP) Validity

**Rule:** OIP must come from source documents. If not documented, must be BLANK and YELLOW (not $0.00).

**Validation Checks for Capital Interests & Preferred Units:**
- Verify OIP comes from source documents (subscription agreement, capital call, etc.)
- If OIP is not documented:
  - Cell must be BLANK (not $0.00)
  - Cell must be YELLOW
  - Audit report must document missing OIP
- If $0.00 OIP exists:
  - Verify source documents explicitly state no cash consideration
  - Valid scenarios: sweat equity, gift, earn-in with zero cash
  - Flag any $0.00 OIP without documented justification

**Validation Checks for Profits Interests:**
- OIP is typically $0.00 or not applicable (profits interests have no present value at grant)
- If OIP is populated with non-zero value, flag and verify against source document
- Non-zero OIP for profits interests is unusual and requires documentation

**Validation Checks for Transfers:**
- New OIP for transferee should reflect transfer price, NOT original OIP
- Exception: gifts at $0.00 (transfer price is $0.00)
- Verify source document shows transfer price
- If transfer price not documented: blank/yellow

**Validation Checks for Phantom Units/UARs:**
- These are NOT real equity — there should be NO OIP or Invested Capital
- Flag any Phantom Unit or UAR with OIP or Invested Capital populated

**Error Conditions:**
- OIP missing (blank) but NOT highlighted yellow
- $0.00 OIP without documented justification in source or audit report
- Non-zero OIP for Profits Interest without verification
- Transfer shows original OIP instead of transfer price
- Phantom Unit has OIP or Invested Capital

**Severity:** Critical

---

### 17. Invested Capital Accuracy

**Rule:** Invested Capital should approximately equal OIP × Issued Quantity. Flag any misalignment.

**Validation Checks:**
- For each issuance, calculate: Expected Invested Capital = OIP × Issued Quantity
- Compare to actual Invested Capital in OBS
- Flag any entry where math doesn't align
- Valid reasons for mismatch:
  - Non-cash consideration (must be documented)
  - Partial payment (must be documented with payment schedule)
  - Different currency in OIP vs. Invested Capital (verify currency notation)
  - Rounding on quantity (verify exact digit count matches source)
- Flag if Invested Capital is suspiciously round when source shows precise figures, or vice versa
- For multi-tranche issuances, verify cumulative math across all tranches

**Error Conditions:**
- Invested Capital ≠ OIP × Quantity without documented explanation
- Rounding error exceeds tolerance
- OIP/Quantity calculation doesn't match cap table
- Invested Capital is round number when source shows precision (e.g., $1,000,000 vs. $987,654.32)

**Severity:** Critical

---

### 18. Transfer Pricing Correctness

**Rule:** New OIP for transferee reflects transfer price (secondary sale) or $0.00 for gifts.

**Validation Checks:**
- For each transfer, verify transfer price in source documents
- If transfer is a secondary sale:
  - New OIP = Transfer Price per unit (from sale agreement)
  - New Invested Capital = Transfer Price × Quantity Transferred
  - Verify math
- If transfer is a gift:
  - Transfer Price should be $0.00
  - New OIP = $0.00
  - New Invested Capital = $0.00
  - Verify gift is documented in source (amendment, resolution, etc.)
- Flag transfers that look like sales but have $0.00 pricing (may be incorrectly coded as gifts)

**Error Conditions:**
- Transfer shows original OIP instead of transfer price
- Secondary sale has $0.00 pricing
- Gift labeled as secondary sale with non-zero price
- New Invested Capital math doesn't match transfer economics

**Severity:** Critical

---

### 19. Phantom Unit/UAR Pricing

**Rule:** Phantom Units and UARs are NOT real equity — there should be NO OIP or Invested Capital.

**Validation Checks:**
- Scan Phantom Units tab for any OIP or Invested Capital values
- Verify all Phantom Unit/UAR entries have blank OIP and Invested Capital
- These instruments represent cash payout rights only, not equity ownership
- If OIP or Invested Capital appears, flag for removal

**Error Conditions:**
- Phantom Unit has OIP value
- Phantom Unit has Invested Capital value
- Any phantom equity showing as "issued" with dollar amounts in capital fields

**Severity:** Critical

---

### 20. Profits Interest OIP

**Rule:** Profits Interests typically have $0.00 or N/A OIP. Non-zero values require verification.

**Validation Checks:**
- For each Profits Interest entry, verify OIP
- If OIP is $0.00 or blank:
  - This is standard for profits interests
  - Verify against source document that this is a profits interest (carried interest, management equity, etc.)
- If OIP is non-zero:
  - Flag for verification against source document
  - This is unusual and may indicate misclassification
  - Verify holder actually paid cash consideration for profits interest
  - Check if this should be classified as a different interest type

**Error Conditions:**
- Profits Interest has non-zero OIP without source document support
- Profits Interest OIP doesn't match source grant agreement
- Confusion between capital interest and profits interest

**Severity:** Critical

---

### 21. SAFE/Convertible Note Field Validation

**Rule:** SAFEs and Convertible Notes have distinct field requirements.

**SAFE-Specific Rules:**
- Should have NO interest rate (leave blank) — flag if populated
- Should have NO maturity date (leave blank) — flag if populated
- Must have Discount Rate % (formatted as percentage, e.g., "20" not "0.20")
- Must have Valuation Cap Type and Valuation Cap $ (if applicable)
- Principal Amount must be populated
- If SAFE has a post-money safe vs. pre-money safe distinction, verify source document

**Convertible Note-Specific Rules:**
- Must have Interest Rate (formatted as percentage) — flag if blank without yellow highlight
- Must have Maturity Date (MM/DD/YYYY) — flag if blank without yellow highlight
- Must have Discount Rate % and/or Valuation Cap
- Principal Amount must be populated

**Common Error Conditions:**
- SAFE labeled as Convertible Note (or vice versa)
- SAFE has interest rate populated (shouldn't)
- SAFE has maturity date populated (shouldn't)
- Convertible Note missing interest rate
- Convertible Note missing maturity date
- Discount Rate in decimal format (0.20) instead of percentage (20)
- Instrument mislabeled for tax/accounting purposes

**Severity:** Critical

---

### 22. Currency Consistency

**Rule:** Multi-currency is common in PE. All monetary values within a single issuance use consistent currency.

**Validation Checks:**
- For each issuance (row), verify:
  - OIP, Invested Capital, and any return/preference amounts are in the same currency
  - If source documents use a different currency than the company's operating currency, the source document currency must be used (not converted)
- If multiple currencies exist across the OBS:
  - Verify audit report documents all currencies used
  - Verify any exchange rates applied
  - Flag entries where currency appears defaulted to company operating currency without verification
  - Verify country/region of holder against currency used
- For transfers and transactions: verify currency remains consistent with original issuance

**Error Conditions:**
- OIP in EUR but Invested Capital in USD
- Currency converted without documentation
- Multiple currencies in OBS without audit report explanation
- Defaulted to USD without verifying source document currency
- Currency mismatch between issuance and related transactions

**Severity:** Critical

---

## DATE & TIMELINE VALIDATION

### 23. Date Format Compliance

**Rule:** Every date in the OBS must be MM/DD/YYYY.

**Validation Checks:**
- Scan all date fields across all tabs
- Verify format is MM/DD/YYYY
- Flag any dates using:
  - DD/MM/YYYY
  - YYYY-MM-DD
  - Month-name format (e.g., "January 15, 2023")
  - Other variations
- Pay special attention to dates where day ≤ 12 (ambiguous between MM/DD and DD/MM):
  - Cross-reference with source documents to confirm
  - Example: "03/05/2023" could be March 5 or May 3 — verify with source

**Error Conditions:**
- Non-standard date format used
- Ambiguous date not verified against source document
- Date format inconsistent across tabs

**Severity:** Major (formatting)

---

### 24. Date Sequence Logic

**Rule:** Transaction dates must follow logical sequence relative to issuance dates.

**Validation Checks:**
- Transfer Date ≥ original Issue Date of the transferred interest
- Repurchase Date ≥ Issue Date
- Termination Date ≥ Issue Date
- Cancelation Date ≥ Issue Date
- Vesting Start Date ≥ Issue Date (flag if before; may be intentional for backdated vesting but requires verification)
- Exercise Date ≥ Grant Date of the option/warrant
- 83(b) election date ≤ Grant Date + 30 days (if documented)
- For multi-tranche interests: Tranche 2 Issue Date ≥ Tranche 1 Issue Date

**Error Conditions:**
- Transaction date before original Issue Date
- Vesting start before Issue Date without documented backdating justification
- Exercise date before Grant Date
- 83(b) election date more than 30 days after grant
- Date sequence violates logical order

**Severity:** Critical

---

### 25. Vesting Start Date Clarity

**Rule:** Vesting Start Date is separate from Grant Date (Issue Date). Do not default to Issue Date without source document confirmation.

**Validation Checks:**
- For each vested interest (with vesting schedule), verify Vesting Start Date
- If Vesting Start Date is explicitly stated in source document:
  - Populate with actual date
  - Compare to Issue Date
  - Flag if different from Issue Date but matches source
- If Vesting Start Date is NOT explicitly stated in source document:
  - Leave BLANK and YELLOW (do not default to Issue Date)
  - Add note to audit report explaining missing data
- Common scenarios:
  - Grant date May 1 → Vesting starts May 1 (same day) — must be documented
  - Grant date May 1 → Vesting starts June 1 (delayed start) — must be documented
  - No vesting start date in source → blank/yellow

**Error Conditions:**
- Vesting Start Date defaulted to Issue Date without source verification
- Vesting Start Date populated but source document shows different date
- Vesting Start Date before Issue Date without documented justification
- Blank Vesting Start Date NOT highlighted yellow when uncertain

**Severity:** Major

---

### 26. PTEP Validity

**Rule:** Post-Termination Exercise Period (PTEP) must either be populated from the plan document OR be blank and highlighted yellow.

**Valid PTEP Values:**
- 3 months (typical for voluntary terminations)
- 6 months (intermediate period)
- 12 months (typical for involuntary terminations without cause)
- Other documented periods from source plan

**Invalid PTEP Values:**
- "0" — This means immediate forfeiture (flag as data entry error — rarely correct)
- Blank without yellow highlight
- Assumed values not documented in source

**Validation Checks:**
- For each option/warrant entry, verify PTEP if equity plan exists
- If PTEP is documented in plan:
  - Populate with actual value
  - Verify against source document
- If PTEP is not documented:
  - Leave BLANK and YELLOW
  - Add to audit report Data Quality Issues
- Flag any PTEP showing "0" — this is almost never correct

**Error Conditions:**
- PTEP shows "0" (immediate forfeiture claim)
- PTEP missing with no yellow highlight when plan exists
- PTEP value doesn't match source plan document
- PTEP assumed without source documentation

**Severity:** Major

---

### 27. 83(b) Election Timing

**Rule:** If documented, 83(b) election must be within 30 days of grant date.

**Validation Checks:**
- For Profits Interests or Capital Interests with vesting, verify 83(b) Eligible field
- If 83(b) is marked "Yes":
  - Verify source document supports eligibility
  - Verify holder is US taxpayer (non-US taxpayers → "No" or "N/A")
  - If 83(b) election date is documented, verify: Election Date ≤ Grant Date + 30 days
- If 83(b) is marked "No" or "N/A":
  - Verify rationale in source document or audit report
  - Flag non-US taxpayers if marked "Yes"

**Error Conditions:**
- 83(b) marked "Yes" but source document doesn't support
- Non-US taxpayer marked as 83(b) eligible
- 83(b) election date more than 30 days after grant
- 83(b) field blank without yellow highlight

**Severity:** Critical (tax implication)

---

## PREFERRED RETURN & LIQUIDATION MECHANICS

### 28. Preferred Return Field Completeness

**Rule:** For every Preferred Unit entry, verify all return mechanics fields are populated from source document.

**Required Fields for Preferred Units:**
1. Compounding Period — matches source document: Simple, Annual, Semi-annual, Quarterly, Monthly, Daily
2. Accrual Period — matches source document
3. Accrual Rate % — formatted as percentage (e.g., "8" not "0.08")
4. Accrual Start Date — populated (often same as Issue Date but sometimes different — verify)
5. Principal Amount — populated and reasonable relative to Invested Capital
6. Day Count Convention — populated: Actual/360, Actual/365, 30/360, Actual/Actual

**Validation Checks:**
- For each Preferred Unit, verify all 6 fields above are populated
- Compare to source document (preferred unit agreement, operating agreement, term sheet)
- Verify Accrual Start Date matches source (not assumed to be Issue Date)
- Verify Compounding Period matches source (don't assume Annual if not stated)
- Cross-check: Accrual Rate and Principal Amount should mathematically produce reasonable annual accrual

**Error Conditions:**
- Any preferred return field blank without yellow highlight
- Accrual Rate in decimal format (0.08) instead of percentage (8)
- Compounding Period is "Simple" but source describes compounding, or vice versa
- Principal Amount doesn't match documentation
- Day Count Convention not specified in source

**Severity:** Critical

---

### 29. Accrual Rate Format

**Rule:** Accrual Rate must be in percentage format (e.g., "8" not "0.08").

**Validation Checks:**
- Review all Accrual Rate fields
- Verify format is percentage (e.g., "8" for 8%)
- Flag any rate in decimal format ("0.08")
- Flag any rate with % symbol ("8%")
- Convert and correct any formatting errors

**Error Conditions:**
- Accrual Rate formatted as decimal (0.08 instead of 8)
- Accrual Rate formatted with % symbol (8% instead of 8)
- Accrual Rate appears to be divided by 100 (0.08 when source shows 8%)

**Severity:** Major (format but causes math errors)

---

### 30. Liquidation Multiplier Validation

**Rule:** Liquidation Multiplier must be a number and match the source document.

**Valid Liquidation Multiplier Examples:**
- 1.0 (non-preferred, pari passu)
- 1.5 (1.5x liquidation preference)
- 2.0 (2x liquidation preference)
- Other specific multiples from source

**Validation Checks:**
- For each Preferred Unit or Pref Return/Conversion/Participation entry with liquidation multiplier:
  - Verify source document specifies the multiplier
  - Verify OBS matches source document exactly
  - Verify multiplier is a number (not text)
  - Calculate: Liquidation Preference Amount = Principal Amount × Liquidation Multiplier
  - Verify calculation is reasonable relative to cap table

**Error Conditions:**
- Liquidation Multiplier doesn't match source document
- Liquidation Multiplier is text (e.g., "one point five" instead of "1.5")
- Liquidation Multiplier missing without documentation

**Severity:** Critical

---

### 31. Participation Cap Specification

**Rule:** Participation Cap Type must be populated and, if applicable, Participation Cap Value must be populated.

**Valid Participation Cap Types:**
- Multiple of — (e.g., "2x" cap on participation)
- Amount per unit — (e.g., $X cap per unit)
- Capped amount — (e.g., total cap of $X)
- Uncapped — (no cap on participation; must verify against source document)

**Validation Checks:**
- For each entry with liquidation preference, verify Participation Cap Type
- If "Multiple of": Verify Participation Cap Value is populated (e.g., "2.0")
- If "Amount per unit": Verify Participation Cap Value is populated in $ per unit
- If "Capped amount": Verify total cap amount is populated
- If "Uncapped": Verify source document explicitly grants uncapped participation
- Cross-check: "Double dip" scenario — if Liquidation Multiplier > 1.0 AND Participation is Uncapped, verify source document explicitly grants both liquidation preference AND uncapped participation

**Error Conditions:**
- Participation Cap Type blank without specification
- "Uncapped" marked but source document specifies a cap
- Participation Cap Value missing when required
- Double dip scenario not documented in source

**Severity:** Critical

---

### 32. Threshold Value (Profits Interests)

**Rule:** Every Profits Interest must have Threshold Value Type and Threshold Value populated.

**Valid Threshold Value Types:**
- Cumulative distribution
- Return multiple
- Fixed amount
- Percentage

**Validation Checks:**
- For each Profits Interest, verify Threshold Value Type is populated
- Verify Threshold Value (numeric amount) is populated
- Cross-check against source document (grant agreement, operating agreement, carry agreement)
- If Threshold Value Type is "Return multiple" (e.g., "3.0"):
  - Verify source document specifies this exact MOIC (do NOT assume standard values)
  - Flag if 3.0x appears to be assumed default without source confirmation
- If Threshold Value blank:
  - Must be highlighted yellow
  - Audit report must document missing data

**Error Conditions:**
- Profits Interest with blank Threshold Value NOT highlighted yellow
- Threshold Value Type mismatches source document
- Threshold Value doesn't match source document amount
- Assumed standard values (3.0x, 100% carry, etc.) without source verification

**Severity:** Critical

---

### 33. MOC Schedule Verification

**Rule:** MOC schedules are NOT standardized. Verify the specific schedule was extracted from source, not assumed.

**Validation Checks:**
- For Profits Interests with performance conditions based on Multiple on Invested Capital (MOC/MOIC):
  - Verify source document specifies the MOC schedule (LP agreement, carry grant document)
  - Do NOT assume generic defaults (e.g., "0% at <1x, 100% at 3.0x")
  - Verify specific MOC thresholds match source exactly
  - Verify Vesting Plan Description includes specific MOC threshold details
  - Check for variations per investor/holder (different MOC schedules for different carry interests)

**Example MOC Schedules (must be verified against source, not assumed):**
- 0% at <1.0x MOIC, 50% at 1.5x, 100% at 2.0x
- 0% at <1.5x MOIC, 100% at 2.0x and above
- Tiered schedule with multiple thresholds

**Error Conditions:**
- MOC schedule appears to be generic default without source verification
- Vesting Plan Description doesn't include specific MOC thresholds
- MOC schedule doesn't match source document
- Different MOC schedules for different carry interests not separately documented

**Severity:** Critical

---

## PHANTOM UNITS / UARS

### 34. Option/Warrant Strike Price

**Rule:** Strike Price must be populated and match the grant agreement.

**Validation Checks:**
- For each Option entry:
  - Verify Strike Price is populated
  - Cross-check against grant agreement
  - Verify Strike Price matches source document exactly
  - If Strike Price is $0.00:
    - Source document must explicitly state cashless exercise
    - Flag any $0.00 strike without documented justification
- For each Warrant entry:
  - Verify Strike Price is populated
  - Cross-check against warrant agreement or investor agreement
  - Verify Strike Price matches source exactly

**Error Conditions:**
- Strike Price blank without yellow highlight
- Strike Price doesn't match source document
- $0.00 Strike Price without documented cashless exercise justification
- Strike Price format inconsistency (e.g., decimal places)

**Severity:** Critical

---

### 35. Exercise Destination Interest Type

**Rule:** Exercise Destination Interest Type must be populated and must exist in the Interest Types tab.

**Validation Checks:**
- For each Option or Warrant:
  - Verify Exercise Destination Interest Type is populated (e.g., "Common Units," "Preferred Units Class A")
  - Verify this Interest Type exists in Interest Types tab
  - Exact string match (case-sensitive, no typos)
  - Verify Interest Type matches source document (option should convert to which class of interest?)

**Error Conditions:**
- Exercise Destination Interest Type blank
- Exercise Destination Interest Type doesn't exist in Interest Types tab
- Typo or spelling variation in Interest Type name
- Interest Type doesn't match source document

**Severity:** Critical

---

### 36. SAFE Field Integrity

**Rule:** SAFEs should have NO interest rate or maturity date.

**Validation Checks:**
- For each SAFE entry:
  - Interest Rate field should be BLANK — flag if populated
  - Maturity Date field should be BLANK — flag if populated
  - Discount Rate % must be populated (formatted as "20" not "0.20")
  - Valuation Cap Type must be populated
  - Valuation Cap $ must be populated (if applicable)
  - Principal Amount must be populated
  - Verify instrument is actually a SAFE (not mislabeled convertible note)

**Error Conditions:**
- SAFE has interest rate populated
- SAFE has maturity date populated
- Discount Rate missing or in decimal format
- Valuation Cap not specified
- SAFE labeled as Convertible Note

**Severity:** Critical

---

### 37. Convertible Note Field Integrity

**Rule:** Convertible Notes must have Interest Rate and Maturity Date populated.

**Validation Checks:**
- For each Convertible Note:
  - Interest Rate must be populated and formatted as percentage (e.g., "8" not "0.08")
  - Maturity Date must be populated (MM/DD/YYYY)
  - Flag if either blank without yellow highlight
  - Discount Rate % should be populated
  - Valuation Cap should be populated or documented as not applicable
  - Principal Amount must be populated
  - Verify instrument is actually a Convertible Note (not mislabeled SAFE)

**Error Conditions:**
- Interest Rate blank without yellow highlight
- Maturity Date blank without yellow highlight
- Interest Rate in decimal format (0.08 instead of 8)
- Convertible Note labeled as SAFE
- Missing principal amount

**Severity:** Critical

---

### 38. SAFE vs. Convertible Note Labeling

**Rule:** Instrument type must be correctly labeled.

**Validation Checks:**
- Verify each SAFE-classified entry is actually a SAFE (convertible instrument, no interest, no maturity)
- Verify each Convertible Note-classified entry is actually a Convertible Note (has interest, has maturity)
- Review source documents to confirm instrument type
- Flag any misclassification that would affect accounting treatment or terms

**Error Conditions:**
- SAFE with interest rate and maturity date (should be Convertible Note)
- Convertible Note with no interest rate or maturity date (should be SAFE)
- Mislabeling for tax/accounting purposes

**Severity:** Critical

---

## VESTING & EQUITY COMPENSATION

### 39. Vesting Plan Template References

**Rule:** Every Vesting Plan Name referenced in Profits Interests, Phantom Units, or Options tabs must exist in Vesting Plan Templates tab.

**Validation Checks:**
- Extract all unique Vesting Plan Names from:
  - Profits Interests
  - Phantom Units
  - Options & Warrants
- Verify each referenced plan exists as a row in Vesting Plan Templates tab
- Exact string matching (no typos, consistent spelling)
- For each Vesting Plan Template entry:
  - Description must be comprehensive (not just "Monthly Vesting")
  - Performance Condition field must be "Yes" or "No"
  - If "Yes": Performance Condition Details must be populated with specific metric, threshold, timing
  - If "No": no additional details needed

**Error Conditions:**
- Vesting Plan referenced that doesn't exist in Vesting Plan Templates tab
- Typo in Vesting Plan Name between tabs
- Vesting Plan Template with vague description (doesn't explain schedule)
- Missing Performance Condition Details when marked "Yes"

**Severity:** Critical

---

### 40. Vesting Plan Description Completeness

**Rule:** Vesting Plan Description must be comprehensive and match source grant documents.

**Validation Checks:**
- For each Vesting Plan Template:
  - Description should include:
    - Vesting schedule (e.g., "4-year vest with 1-year cliff")
    - Monthly/daily vesting rate
    - Any performance conditions
    - Any MOC-specific metrics
  - Do NOT assume cliff exists — flag if cliff assumed without grant agreement stating it
  - If grant says "monthly vesting" with no cliff mention, there is NO cliff
  - Verify schedule exactly matches source document terms
  - For MOC-based vesting: include specific MOC thresholds
  - For condition-based vesting: include specific conditions and metrics

**Examples of Adequate Descriptions:**
- "4-year vest, 12-month cliff, monthly vesting thereafter"
- "Performance-based carry: 0% at <1.5x MOIC, 50% at 1.5x-2.0x, 100% at >2.0x"
- "Monthly vesting over 48 months with no cliff"

**Examples of Inadequate Descriptions:**
- "Vesting" (too vague)
- "Performance-based" (doesn't specify metrics)
- "Per grant agreement" (doesn't summarize specifics)

**Error Conditions:**
- Vesting Plan Description too vague or generic
- Cliff assumed without source document evidence
- MOC-based vesting missing specific thresholds
- Description doesn't match source grant document

**Severity:** Major

---

### 41. 83(b) Eligibility Field

**Rule:** 83(b) Eligible field must be populated (Yes/No) for Profits Interests and Capital Interests with vesting.

**Validation Checks:**
- For each vested interest (Profits Interest or Capital Interest with vesting schedule):
  - 83(b) Eligible field must be populated: "Yes" or "No" (not blank)
  - If blank: must be highlighted yellow
  - If marked "Yes":
    - Verify source document supports 83(b) eligibility
    - Verify holder is US taxpayer
    - Flag if non-US holder marked as eligible (should be "No" or "N/A")
  - If marked "No":
    - Verify source document or holder status supports this (e.g., non-US taxpayer, LLC interest not subject to 83(b), etc.)

**Error Conditions:**
- 83(b) Eligible field blank without yellow highlight
- Non-US taxpayer marked as "Yes"
- Mark "Yes" without source document support
- Inconsistent 83(b) status across similar interests

**Severity:** Major (tax implication)

---

## TRANSACTION VALIDATION

### 42. Transaction Validation Overview

**Rule:** All transaction records (transfers, repurchases, terminations, cancelations, exercises, rollovers) must have required fields populated, quantities that reconcile, and dates that are logically consistent. See checks 43–48 for full per-transaction-type specifications.

**Validation Checks:**
- Every transaction record has the required interest ID, holder, date, quantity, and reason fields populated
- All transaction quantities balance against original issuance quantities
- All transaction dates are on or after the associated issuance date
- Termination and cancelation reasons come from the valid set in source documents
- No orphaned transactions (every transaction references a valid interest ID)

**Severity:** Critical (quantity/date errors); Major (missing fields)

---

### 43. Transfer Validation

**Rule:** Transfers must have valid transferor/transferee, quantities must balance, dates must be logical.

**Validation Checks:**
- For each Transfer entry:
  - Transferor must exist in Interest Holders tab
  - Transferee must exist in Interest Holders tab
  - Interest ID must reference valid issuance in corresponding issuance tab
  - Transfer Quantity must not exceed original issuance quantity (minus any prior partial transfers)
  - Transfer Date must be ≥ original Issue Date
  - For partial transfers:
    - Original Quantity = Transferred Quantity + Balance Quantity
    - Verify math balances
    - If partial transfer creates balance certificate, verify balance certificate row exists
  - Transfer Pricing:
    - For secondary sales: Transfer Price per unit and New Invested Capital must match
    - For gifts: Price should be $0.00, New Invested Capital should be $0.00
    - Flag transfers that look like sales but have $0.00 pricing

**LLC Platform Behavior:**
- Transfers are recorded as cancellations in Carta LLC platform
- Original holder's units appear as "CANCELLED" in Carta Interest Ledger (EXPECTED — do NOT flag as error)
- Transferee's units appear as newly "ISSUED"

**Error Conditions:**
- Transferor or Transferee doesn't exist in Interest Holders
- Interest ID doesn't exist in source issuance tab
- Transfer Quantity exceeds original issuance
- Transfer Date before Issue Date
- Partial transfer math doesn't balance
- Secondary sale with $0.00 pricing (should be gift documentation)
- Missing balance certificate for partial transfer

**Severity:** Critical

---

### 44. Repurchase Validation

**Rule:** Repurchases must reference valid issuances, quantities must not exceed outstanding, dates logical.

**Validation Checks:**
- For each Repurchase entry:
  - Interest ID must reference valid issuance
  - Repurchase Quantity must not exceed outstanding quantity
  - Repurchase Price must be documented (or blank/yellow if missing)
  - Repurchase Date must be ≥ Issue Date
  - Verify quantity math: Outstanding Before = Outstanding After + Repurchase Quantity
  - Flag any repurchase where:
    - Price is $0.00 but source documents indicate cash was paid
    - Quantity exceeds holder's outstanding balance
    - No source document supports the repurchase

**LLC Platform Behavior:**
- Repurchase of VESTED units appears as "CANCELLED" in Carta (EXPECTED — do NOT flag as error)
- UNVESTED units that are terminated appear as "FORFEITED" (different handling)

**Error Conditions:**
- Interest ID doesn't exist in source issuance tab
- Repurchase Quantity exceeds outstanding
- Repurchase Date before Issue Date
- Repurchase Price missing without yellow highlight
- $0.00 price not supported by documentation
- Repurchase quantity doesn't reconcile with outstanding balance

**Severity:** Critical

---

### 45. Termination Validation

**Rule:** Terminations should only apply to unvested portions. Termination quantity must match unvested balance.

**Validation Checks:**
- For each Termination entry:
  - Interest ID must reference valid issuance that HAS vesting
  - Termination Date must be ≥ Issue Date
  - Verify vesting schedule applies to this interest
  - Calculate unvested balance at Termination Date based on Vesting Plan
  - Termination Quantity should equal unvested portion (or specific documented portion being terminated)
  - Flag:
    - Termination of fully vested interests (these should be repurchases or cancelations)
    - Termination quantity doesn't match unvested balance

**Calculation Example:**
- Grant 1,000 units with 4-year vest, 1-year cliff
- Termination occurs 2 years after grant
- Vested at termination = 500 units (cliff + 1 year of vesting)
- Unvested at termination = 500 units
- Termination Quantity should be 500 (or documented subset)

**Error Conditions:**
- Termination applied to fully vested interest
- Termination Quantity doesn't match calculated unvested balance
- Interest doesn't have vesting schedule
- Termination Date before Issue Date

**Severity:** Critical

---

### 46. Cancelation Validation

**Rule:** Cancelations must have documented reason and valid reference to source issuance.

**Validation Checks:**
- For each Cancelation entry:
  - Interest ID must reference valid issuance
  - Cancelation Date must be ≥ Issue Date
  - Cancelation Reason must be populated with valid reason:
    - "Acquisition/merger closeout"
    - "Deemed exercise/conversion"
    - "Amendment/restatement"
    - "Legal cancellation"
    - Other documented reason from source
  - Verify reason is supported by source document
  - Flag cancelations that should actually be:
    - Transfer (units moved to another holder)
    - Repurchase (company bought back units)
    - Termination (unvested portion forfeited on employment termination)

**Error Conditions:**
- Cancelation without documented reason
- Cancelation Reason doesn't match source document
- Cancelation that's actually a transfer or repurchase
- Cancelation Date before Issue Date

**Severity:** Critical

---

### 47. Exercise / Conversion Validation

**Rule:** Exercises must reference valid convertible issuances, pricing must match terms, resulting interest type must exist.

**Validation Checks:**
- For each Exercise/Conversion entry:
  - Interest ID must reference valid Option, Warrant, SAFE, or Convertible Note issuance
  - Exercise Date must be ≥ original Grant/Issue Date
  - Quantity of new units must be reasonable given conversion ratio or exercise terms
  - Per Unit Price must match:
    - Strike Price for options/warrants
    - Conversion price for SAFEs/notes (may differ from SAFE principal)
  - Resulting Interest Type must exist in Interest Types tab
  - For SAFE conversions:
    - Per Unit Price should reflect conversion price (based on valuation cap/discount)
    - NOT the SAFE principal amount
  - For Option exercises:
    - Cash paid = Quantity × Strike Price (verify if documented)
  - Verify new issuance reflects correct conversion ratio

**Calculation Examples:**
- Option: 1,000 shares @ $10 strike → 1,000 × $10 = $10,000 cash at exercise
- SAFE with $1M principal, 20% discount on $10M valuation = $10M / 0.8 = $12.5M post, price per unit = $12.5M / pre-calculated units
- Warrant: similar to option but may be immediately exercisable

**Error Conditions:**
- Interest ID doesn't reference convertible issuance
- Exercise Date before Grant Date
- Per Unit Price doesn't match strike/conversion terms
- Resulting Interest Type doesn't exist
- SAFE conversion price uses principal instead of true conversion price

**Severity:** Critical

---

### 48. Rollover Validation

**Rule:** Rollovers recorded as (1) Cancelation + (2) Issuance with verified rollover ratio.

**Validation Checks:**
- For each rollover sequence (cancelation + issuance pair):
  - Verify rollover ratio from exchange agreement or amendment
  - Verify math: Original Quantity × Rollover Ratio = New Quantity
  - Verify whether Invested Capital carries forward or resets:
    - If carries forward: New OIP = Original Invested Capital / New Quantity
    - If resets: New OIP matches source terms
  - For rollovers with different ratios per holder:
    - Each holder should have separate cancelation + issuance pair
    - Verify each holder's ratio matches source document
    - Flag if all holders use same ratio when source specifies different ratios
  - For rollovers involving class conversion (e.g., preferred → common):
    - Verify entries in BOTH Cancelations tab (original class) AND Exercise/Conversion or new issuance tab (new class)
    - Verify share class names correct for both canceled and new units

**Error Conditions:**
- Rollover ratio doesn't match source document
- Math doesn't balance (Original × Ratio ≠ New)
- Invested Capital handled incorrectly (carries forward vs. resets)
- Missing cancelation or issuance entry in rollover pair
- Different rollover ratios per holder not separately documented
- Class conversion missing from one tab

**Severity:** Critical

---

## ADDITIONAL DATA QUALITY CHECKS

### 49. Quantity & Digit Accuracy

**Rule:** For every numerical value, digit count and decimal precision must match source document exactly.

**Validation Checks:**
- Verify digit count matches source (e.g., 1,250,000 vs. 12,500,000)
- Verify decimal precision (e.g., 1,234.5678 units vs. 1,234.57)
- Cross-check multiplication: Issued Quantity × OIP should approximately equal Invested Capital
- Flag quantities that appear suspiciously round when source shows precision (or vice versa)
- Common errors:
  - Dropped zeros (1,000 vs. 10,000)
  - Added zeros (125,000 vs. 1,250,000)
  - Rounding errors exceeding tolerance
  - Incorrect decimal placement

**Error Conditions:**
- Digit count or decimal precision doesn't match source
- Math check (Qty × Price) fails without documented explanation
- Round number when source shows precision

**Severity:** Critical

---

### 50. Cross-Tab Quantity Reconciliation

**Rule:** For each Interest Type, sum of active issuances must reconcile across tabs.

**Validation Checks:**
- For each Interest Type:
  - Sum all issued quantities in corresponding issuance tab
  - Subtract canceled quantities
  - Subtract terminated quantities
  - Subtract transferred out quantities
  - Add transferred in quantities (if applicable)
  - Result = Outstanding Active Units
- For each holder across all tabs:
  - Total Outstanding = Sum(Issued) - Sum(Repurchased) - Sum(Terminated) - Sum(Transferred out) - Sum(Canceled) + Sum(Transferred in)
  - This must match cap table's outstanding balance for that holder
  - Flag any holder where math doesn't reconcile

**Create Reconciliation Summary Table:**
```
Interest Type | Total Issued | Total Canceled | Total Terminated |
Total Transferred | Total Outstanding | Cap Table Match (Yes/No)
```

**Error Conditions:**
- Active units don't reconcile across tabs
- Holder outstanding balance doesn't match calculated total
- Math doesn't balance
- Discrepancies not explained in audit report

**Severity:** Critical

---

### 51. Three-Way Reconciliation

**Rule:** After all tab-level checks, perform three-way reconciliation between client cap table, OBS totals, and source PDF agreements.

**Reconciliation Points:**
1. **Client Cap Table** — The authoritative cap table the client maintains
2. **OBS Totals** — Aggregated from all issuance tabs in the OBS
3. **Source PDF Agreements** — Subscription agreements, joinder agreements, grant agreements, etc.

**For Each Holder:**
- Cap table issued quantity = OBS issued quantity = PDF aggregate quantity?
- Outstanding quantities match across all three?
- Any agreements in PDFs not reflected in OBS? (flag for investigation)
- Any interests in OBS not backed by a PDF? (flag for verification)

**Reconciliation Result:**
- PASS — All three sources reconcile for all holders
- FAIL — Discrepancies exist (document specific holders and differences)

**Document Known Carta LLC Platform Behaviors:**
1. Transfers appear as "CANCELLED" (not "transferred") — this is normal
2. Repurchase of vested units = "CANCELLED"; unvested terminated = "FORFEITED"
3. Interest Ledger may double-count invested capital on transfers (expected behavior)

**Error Conditions:**
- Three-way quantities don't match
- Missing agreements in PDF not in OBS
- OBS interests not backed by PDF
- Platform behaviors not accounted for

**Severity:** Critical

---

### 52. Tab Integrity

**Rule:** Each tab must contain ONLY appropriate data for its category.

**Tab-Specific Data Rules:**
- **Entity & Interests**: Only entity-level definitions (no holder data, no transactions)
- **Interest Types**: Only interest type definitions (no individual issuances)
- **Interest Holders**: Only holder directory (no issuance data, no transactions)
- **Vesting Plan Templates**: Only vesting schedule definitions (no individual grants)
- **Capital Interests**: Only capital interest issuances (no profits interests, no phantom units)
- **Preferred Units**: Only preferred unit issuances with return mechanics
- **Pref Return / Conversion / Participation**: Only complex preferred with liquidation + participation
- **Profits Interests**: Only carried interest / management equity grants
- **Phantom Units**: Only phantom unit / UAR grants (NOT real equity)
- **Options & Warrants**: Only option and warrant grants
- **SAFEs**: Only SAFE instruments
- **Convertible Notes**: Only convertible note instruments
- **Terminations**: Only termination events
- **Repurchases**: Only repurchase events
- **Transfers**: Only transfer events
- **Cancelations**: Only cancelation events
- **Exercise/Conversion**: Only exercise and conversion events
- **Audit Report**: Must be first tab; must contain all required sections

**Error Conditions:**
- Data appears in wrong tab (e.g., phantom units in Capital Interests)
- Misclassified interest type in wrong tab
- Transaction data in issuance tabs

**Severity:** Major (organization)

---

### 53. Audit Report Completeness

**Rule:** The Audit Report must be the first tab and contain all required sections.

**Required Sections:**
1. Document Inventory — all source documents reviewed
2. Missing Documents — with impact classification (Critical/Major/Minor)
3. Interest Types Verification — authorized vs. issued vs. outstanding
4. Data Quality Issues & Assumptions — with severity
5. Mathematical Verification — total unit counts, capital raised
6. Action Items for Client — with priority: HIGH/MEDIUM/LOW
7. Certificate/Interest Tracking — chain of custody verification
8. Transaction Log — all transactions chronologically
9. Discrepancy Register & Notes — issues found and resolutions
10. Triple-Check Verification Results — final reconciliation results
11. Currency Handling — if multi-currency (all currencies documented)

**Validation Checks:**
- Verify all 11 sections are present
- Verify each section is comprehensive (not just headers)
- Verify any action items that reference yellow-highlighted data are marked HIGH priority
- Flag any data quality issue referenced in OBS (yellow highlighting) that lacks corresponding audit report entry
- Flag any action item that should be HIGH priority but is marked MEDIUM or LOW

**Error Conditions:**
- Missing section
- Section header present but no content
- Action item priority inappropriate for severity
- Yellow-highlighted cell with no audit report entry
- Action items that should be HIGH priority marked as MEDIUM or LOW

**Severity:** Major (documentation)

---

### 54. Bulk Extraction Verification

**Rule:** For deals with 100+ documents, verify count reconciliation and no missed issuances.

**Validation Checks:**
- Count total source documents provided
- Count total issuance entries across ALL issuance tabs in OBS
- If OBS entry count < source document count:
  - Identify missing entries by holder and date
  - Investigate commonly missed issuances:
    - Profits interest grants filed separately
    - Joinder agreements (later capital commitments)
    - Phantom unit PDFs in large batches (individual documents missed)
  - Verify no source document was skipped
- Check signature page extraction:
  - Addresses should be captured where available
  - Flag any garbled/incomplete addresses

**Error Conditions:**
- Entry count doesn't reconcile
- Missing issuance identified
- Source document skipped
- Batch extraction incomplete

**Severity:** Critical

---

### 55. Yellow Highlighting Completeness

**Rule:** Every uncertain, estimated, or missing data MUST be highlighted yellow. Every yellow cell must have corresponding audit report entry.

**Fields Commonly Requiring Yellow:**
- OIP (Original Issue Price) if missing/undocumented
- Invested Capital if uncertain
- Email addresses if blank
- Threshold Values (Profits Interests) if blank
- Strike Price (Options) if missing
- PTEP if missing or unclear
- Vesting Start Date if not explicitly stated
- Any field sourced from unexecuted document

**Validation Checks:**
- Scan all tabs for blank or uncertain required fields
- Verify blank required fields are highlighted yellow
- For each yellow cell:
  - Verify corresponding entry in audit report Data Quality Issues section
  - Verify rationale for why field is missing/uncertain
- Flag:
  - Any blank required field NOT highlighted yellow
  - Any yellow cell with NO corresponding audit report entry
  - Any field with $0.00 that should be blank/yellow instead

**Error Conditions:**
- Blank required field not highlighted
- Yellow cell without audit report explanation
- $0.00 used when blank/yellow appropriate
- Over-use of yellow (normal values highlighted unnecessarily)

**Severity:** Major (compliance)

---

## MASTER RECONCILIATION CHECKLIST

### Final Verification Steps

**After all individual checks, perform final reconciliation:**

1. **Holder Count Reconciliation**
   - Interest Holders tab count = Schedule 1.7 count
   - Any additions documented as post-amendment
   - Flag any discrepancies

2. **Interest Type Count**
   - Interest Types tab = all interest types referenced in issuance tabs
   - No orphaned interest types
   - No missing interest types

3. **Vesting Plan Count**
   - Vesting Plan Templates tab = all plans referenced in Profits Interests, Phantom Units, Options tabs
   - No orphaned vesting plans

4. **Quantity Mathematics**
   - All cross-tab quantity calculations verified
   - Outstanding balances reconcile per holder
   - Three-way reconciliation PASS or specific FAIL details documented

5. **Date Sequence**
   - All transaction dates on/after Issue Dates
   - No date logic violations
   - Vesting start dates verified

6. **Pricing & Capital**
   - All OIP × Quantity ≈ Invested Capital math verified
   - No missing pricing documentation
   - Currency consistency verified

7. **Documentation & Highlighting**
   - All yellow cells have audit report entries
   - No required fields blank without highlighting
   - No unnecessary yellow highlighting

8. **Platform Behaviors**
   - Transfers appear as "CANCELLED" — accounted for
   - Repurchases appear as "CANCELLED" (vested) or "FORFEITED" (unvested) — accounted for
   - Invested capital double-counting on transfers — documented

---

## SEVERITY SUMMARY

After completing all checks, provide final summary:

```
CRITICAL ISSUES (Data is wrong): X
- Incorrect quantities, prices, dates, holder names, misclassified interests
- Would cause upload errors or financial misstatement

MAJOR ISSUES (Missing highlights or formatting): X
- Missing highlights, formatting errors, incomplete documentation
- Could cause confusion or require rework

MINOR ISSUES (Style/convention): X
- Naming inconsistencies, style preferences, presentation
- No financial impact
```
