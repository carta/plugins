# Global Reconciliation Rules

These checks apply to ALL reconciliations (C-Corp and PE/LLC).

---

## Check 1: Three-Way Holder Comparison

For each holder in the OBS:
1. Does this holder exist in extraction data?
   - If NO → flag MAJOR: "In OBS but not in extractions"
2. Does this holder exist in local files / source docs?
   - If NO → flag MAJOR: "In OBS but not in source docs"
3. Does the name match exactly across all sources?
   - If NO → flag CRITICAL: "Name mismatch" — show all variants

For each holder in extraction data NOT already checked:
1. Flag CRITICAL: "In extractions but not in OBS — missing from cap table"

For each holder in local files NOT already checked:
1. Flag CRITICAL: "In source docs but not in OBS — missing from cap table"

---

## Check 2: Cross-Tab Consistency

For each holder name in the OBS:
1. Does the name appear identically in every tab they appear in?
   - If NO → flag CRITICAL: "Name inconsistent across tabs" — list the tabs and variants

For each share class / interest type in the OBS:
1. Does the name match exactly between the definition tab (Share Classes / Interest Types) and transaction tabs (Certificates, Awards, etc.)?
   - If NO → flag CRITICAL: "Share class name mismatch between tabs"
2. Does the prefix in the definition tab match the prefix on certificates/interests?
   - If NO → flag CRITICAL: "Prefix mismatch"
3. Does each certificate/interest ID referenced in one tab exist in its originating tab?
   - If NO → flag CRITICAL: "Certificate ID not found in source tab"

---

## Check 3: Deduplication

For each holder in the OBS:
1. Normalize name: strip periods, collapse whitespace, lowercase
2. Compare normalized name against all other normalized holder names
3. If two names match after normalization but differ in original form:
   - Flag MAJOR: "Possible duplicate holder" — show both names
4. Also check entity name variations: "LLC" vs ", LLC" vs " LLC"

Rule: when in doubt, flag for IM review rather than assuming they are the same.

---

## Check 4: Math Checks

For each share class:
1. Total issued (sum of certificate quantities) ≤ total authorized?
   - If NO → flag CRITICAL: "Issued exceeds authorized" — show both values

For each transfer:
1. Original certificate quantity = transferee quantity + balance quantity?
   - If NO → flag CRITICAL: "Transfer math error" — show all three values

For each exercise:
1. Number of options exercised reduces outstanding option count?
   - If NO → flag CRITICAL: "Exercise doesn't reduce option pool"

For each class:
1. Sum of (quantity × PPS) across all certificates = expected capital raised?
   - If NO → flag MAJOR: "Capital raised mismatch" — show expected vs actual

For each certificate:
1. Quantity × PPS = cash paid?
   - If NO → flag CRITICAL: "Cash paid doesn't match quantity × PPS"

---

## Check 5: Count Verification

**Use Python to count OBS rows** — do not count manually. LLMs miscount rows in large spreadsheets.

```bash
uv run --with openpyxl python3 - "<OBS_FILE_PATH>" <<'PYEOF'
import sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1], data_only=True)
for name in wb.sheetnames:
    ws = wb[name]
    data_rows = sum(1 for row in ws.iter_rows(min_row=2) if any(c.value is not None for c in row))
    if data_rows > 0:
        print(f"{name}: {data_rows} rows")
PYEOF
```

Then for each tab:
1. Use the Python row count for the OBS side
2. Count distinct transactions in source documents for that category (by reading the documents)
3. Do they match?
   - If NO → flag CRITICAL: "Row count mismatch — OBS has {X}, source docs have {Y}"

---

## Check 6: Cancel + Reissue Patterns

For each cancellation in the OBS:
1. Is there a corresponding reissue with the same quantity?
   - If YES → verify net effect is zero on total outstanding
   - If NO → flag MAJOR: "Cancellation without matching reissue"
2. Are cancel/reissue pairs double-counted in totals?
   - If YES → flag CRITICAL: "Cancel/reissue double-counted"

---

## Check 7: ESOP Treasury Certificate Reconciliation

If the Equity Plans tab has a Reserved Shares value:
1. Do Common Certificates contain treasury cert(s) where holder = company name and prefix = ES-?
   - If NO → flag CRITICAL: "Missing ESOP treasury certificate(s)"
2. Sum of treasury cert quantities = Equity Plans Reserved Shares?
   - If NO → flag CRITICAL: "ESOP treasury sum mismatch — treasury has {X}, Reserved Shares is {Y}"
3. If pool was established in multiple tranches, is there one treasury cert per tranche?
   - If fewer certs than tranches → flag MAJOR: "Possible missing tranche treasury cert"

---

## Check 8: SAFE / Convertible Note Field Completeness

For each SAFE in the OBS:
1. Interest Accrual Period = "Daily"?
   - If NO → flag CRITICAL: "SAFE Interest Accrual Period must be 'Daily'"
2. Interest Rate = BLANK?
   - If populated → flag CRITICAL: "SAFEs must not have interest rate"
3. Maturity Date = BLANK?
   - If populated → flag CRITICAL: "SAFEs must not have maturity date"
4. Valuation Cap Type populated when Valuation Cap has value?
   - If blank → flag CRITICAL: "SAFE Valuation Cap Type required when Valuation Cap is set"

For each Convertible Note:
1. Interest Rate populated?
   - If blank → flag CRITICAL: "CN missing interest rate"
2. Maturity Date populated?
   - If blank → flag CRITICAL: "CN missing maturity date"

Cross-check: if Interest Rate is populated but Maturity Date is blank (or vice versa):
- Flag MAJOR: "Possible SAFE/CN misclassification"

---

## Check 9: Register vs OBS Share Class Name Match

For non-US companies with government register data:
1. Do Share Class Names in OBS match the register's terminology?
   - If NO → flag CRITICAL: "Share class name doesn't match register"
   - Example: register says "Class A Preferred Shares" but OBS has "Series Seed Preferred"
2. Are alternative class names from Articles noted in Admin Notes?
   - If NO → flag MINOR: "Missing Admin Notes for alternative class names"

---

## Check 10: LLC Platform Behavior (PE/LLC only)

For PE/LLC entities:
1. Are transfers recorded as cancellations? This is EXPECTED — do NOT flag as error
2. Are repurchases of vested units showing as "cancelled"? This is EXPECTED
3. Does the Interest Ledger double-count initial invested capital on transfers?
   - If YES → note as MINOR: "Known Carta LLC behavior — adjust accordingly"

---

## Check 11: ESOP Ledger Cross-Reference

If the IM provided an ESOP summary spreadsheet or grant register as a local file:
1. Extract all grantee names and grant quantities from the ESOP summary
2. For each grantee in the ESOP summary:
   a. Does this grantee exist in OBS Equity Plan Awards tab?
      - If NO → flag CRITICAL: "Grantee in ESOP summary but missing from OBS"
   b. Does the grant quantity match?
      - If NO → flag CRITICAL: "Grant quantity mismatch" — show both values
   c. Does a matching individual grant agreement exist in local files?
      - If NO → flag MAJOR: "Grantee in ESOP summary but no grant agreement provided"
3. For each grantee in OBS Equity Plan Awards NOT in the ESOP summary:
   - Flag MAJOR: "Grantee in OBS but not in ESOP summary — verify if post-summary grant"

---

## Check 12: Per-Holder Transaction Completeness

For each holder present in ANY source (OBS, extractions, local files):
1. List all transactions for this holder in source docs (issuances, transfers, exercises, repurchases, cancellations)
2. List all OBS entries for this holder (certificates, awards, conversions, transfers)
3. For each transaction in source docs:
   a. Does a matching OBS entry exist (by type, quantity, date)?
      - If NO → flag CRITICAL: "Transaction in source docs but missing from OBS"
4. For each OBS entry for this holder:
   a. Is it backed by a source document?
      - If NO → flag MAJOR: "OBS entry with no supporting source document"
5. Compare total shares/units per holder across all sources
   - If mismatch → flag CRITICAL: "Per-holder total mismatch" — show per-source totals

---

## Check 13: Hidden Transactions

For each holder in the OBS:
1. Does this holder appear in multiple rounds/closings?
2. For each round/closing in source docs:
   a. Does this holder have a participation that isn't in the OBS?
      - If YES → flag CRITICAL: "Hidden transaction — existing shareholder's additional investment in {round} missing from OBS"

Specifically watch for:
- Founders participating in later rounds
- Existing investors making follow-on investments in a new round
- Pro-rata participation in bridge rounds

---

## Check 14: Multiple Closings

For each funding round with multiple closings (different dates or prices):
1. Does each investor's participation in each closing have a separate certificate?
   - If combined into one row → flag CRITICAL: "Multiple closings collapsed — each closing needs its own certificate"
2. Are certificates created even when cash paid is $0 (e.g., note conversion)?
   - If missing → flag CRITICAL: "Missing $0 cash-paid certificate for note/SAFE conversion in {round}"
3. Do the per-closing share prices differ?
   - If YES and all certs use same price → flag CRITICAL: "All certificates use same PPS but closings had different prices"
