# Global Platform Constraint Rules

Carta platform constraints that affect reconciliation. Violations will cause import failures.

---

## Check 1: Holder Types

**For C-Corp entities:**
For each holder in the Holders tab:
1. Is Holder Type either "Individual" or "Non Individual"?
   - If ANY other value → flag CRITICAL: "Invalid holder type '{value}' — C-Corp only allows 'Individual' or 'Non Individual'"

**For PE/LLC entities:**
For each holder in Interest Holders tab:
1. Is Holder Type one of: "Individual", "Corporation", "LLC", "Trust", "Partnership", "Limited Partnership", "Non-Profit", "Other"?
   - If not → flag CRITICAL: "Invalid holder type '{value}'"

---

## Check 2: Batch Limits

For each tab in the OBS:
1. Count the number of data rows (excluding headers)
2. Are there more than 50 rows?
   - If YES → flag MINOR: "Tab has {N} rows — exceeds 50-row import batch limit. Mark batch split points."

---

## Check 3: Tab Structure

For C-Corp OBS:
1. Verify data appears only in expected tabs (Share Classes, Common Certs, Preferred Certs, Equity Plans, Awards, Vesting Schedules, Warrants, SAFEs, Convertible Notes, Legends, etc.)
2. Is there data in the wrong tab (e.g., certificates in Share Classes tab)?
   - If YES → flag CRITICAL: "Data in wrong tab — {description} found in {tab name}"

For PE/LLC OBS:
1. Same check against PE/LLC tab structure (Entity & Interests, Interest Types, Interest Holders, Capital Interests, Profits Interests, etc.)

---

## Check 4: SAFE / CN Platform Defaults

For each SAFE:
1. Interest Accrual Period = "Daily"?
   - If "Annually" or blank → flag CRITICAL: "SAFE Interest Accrual Period must be 'Daily'"
2. Valuation Cap Type populated when Valuation Cap has a value?
   - Must be "Pre-money" or "Post-money"
   - If blank → flag CRITICAL: "SAFE Valuation Cap Type required"
3. Interest Rate = BLANK?
   - If "0%" or "N/A" or any value → flag CRITICAL: "SAFE Interest Rate must be blank (not 0% or N/A)"
4. Maturity Date = BLANK?
   - If any value → flag CRITICAL: "SAFE Maturity Date must be blank"

---

## Check 5: ESOP Treasury Certificate Requirement

If Equity Plans tab has Reserved Shares:
1. Do Common Certificates contain matching treasury cert rows?
   - Holder = company name
   - Holder Type = "Non Individual"
   - Prefix = ES-
   - If missing → flag CRITICAL: "No ESOP treasury certificates found"
2. Sum of treasury cert quantities = Reserved Shares?
   - If mismatch → flag CRITICAL: "Treasury cert sum ({X}) ≠ Reserved Shares ({Y})"

---

## Check 6: Nominal PPS for Non-US Companies

For non-US companies with government register data:
1. Certificate PPS should match the nominal/par value from the register
   - Actual investment price belongs in Share Classes OIP field
   - If certificate PPS has economic price instead of nominal → flag MAJOR: "Use register nominal value as certificate PPS"

---

## Check 7: Share Class Name Convention

For all companies:
1. Do Share Class Names use Carta platform convention?
   - "Common" not "Ordinary Shares"
   - "Series A Preferred" not "Series A Preference Shares"
   - Registry terminology should be in Admin Notes only
   - If registry terminology used as Share Class Name → flag MINOR: "Use Carta convention for Share Class Name — put registry name in Admin Notes"
