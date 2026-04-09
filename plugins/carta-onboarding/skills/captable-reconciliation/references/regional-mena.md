# MENA Regional Reconciliation Rules

Additional reconciliation checks for UAE (ADGM, DIFC, Mainland) and Saudi Arabia companies. Apply ON TOP of global rules.

---

## Check 1: Par Value (ADGM Exception)

ADGM companies DO have par value (unlike most non-US jurisdictions):
1. Is Par Value populated for ADGM companies?
   - If blank → flag MAJOR: "MENA/ADGM: ADGM companies have par value — check ADGM register"
2. Does the nominal PPS match the ADGM register value (typically $0.00001/share)?
   - If NO → flag CRITICAL: "MENA/ADGM: Nominal PPS doesn't match register"

For DIFC and UAE Mainland: follow global rules (check source documents for par value status).

---

## Check 2: Register Class Name Override

For ADGM companies:
1. Does the OBS Share Class Name match the ADGM register's class name?
   - ADGM register often uses simplified names (e.g., "Class A Preferred Shares")
   - Articles may define more specific sub-classes (e.g., "Series Seed Preferred", "Series Seed2 Preferred")
   - **Always use the ADGM register's class name**
   - If Articles terminology used instead → flag CRITICAL: "MENA/ADGM: Use register class name, not Articles — put Articles names in Admin Notes"

---

## Check 3: Transfer Chains for Entity Restructuring

For ADGM companies where the register shows entity renames or restructuring:
1. Is there an original certificate + transfer certificate with "Transferred From" reference?
   - If NO → flag MAJOR: "MENA/ADGM: Entity restructuring requires original cert + transfer cert with 'Transferred From'"
   - Example: "Dallah Albaraka (International) Limited" → new entity name requires transfer chain

---

## Check 4: Founder Dates

For ADGM companies:
1. Do founder issue dates match the ADGM Business Extract?
   - Founders in original incorporation → use incorporation date
   - Founders added after incorporation → use SHA execution date or register appointment date
   - If incorporation date used for a post-incorporation founder → flag MAJOR: "MENA/ADGM: Founder added after incorporation — use appointment date, not incorporation date"

---

## Check 5: ESOP Treasury Certs

For ADGM companies with ESOP pools:
1. Do Common Certificates contain treasury certs held by the company with ES- prefix?
   - If NO → flag CRITICAL: "MENA/ADGM: Missing ESOP treasury certificates"
   - (Also covered by global Check 7, but flagged here for MENA-specific awareness)

--- END ---
