# Canada Regional Reconciliation Rules

Additional reconciliation checks for Canadian corporations. Apply ON TOP of global rules.

---

## Check 1: Par Value

For Canadian corporations:
1. Is Par Value blank?
   - If populated → flag CRITICAL: "Canada: No par value — CBCA eliminated par value in 1975"
2. If source documents reference "stated capital":
   - This is NOT par value — it's an accounting entry
   - Do NOT populate the Par Value field
   - If "stated capital" appears in Par Value → flag CRITICAL: "Canada: 'Stated capital' is not par value — leave blank"

**Exception:** Very old corporations incorporated before par value abolition may still have par value shares. Only populate if explicitly stated in Articles of Incorporation as "par value".

---

## Check 2: Option Type

For Canadian companies with equity plan awards:
1. Is Option Type set to "INTL"?
   - If "ISO" or "NSO" used → flag MAJOR: "Canada: Use 'INTL' option type — no ISO/NSO distinction in Canada"

---

## Check 3: Currency (CAD/USD Mix)

For Canadian companies:
1. Is currency extracted per-agreement (not defaulted to company currency)?
   - Common pattern: company operates in CAD, but SAFEs/convertible notes denominated in USD for US investors
   - If all instruments show same currency but source docs show mixed → flag CRITICAL: "Canada: Mixed currency detected in source docs but OBS uses single currency"
2. Is "CAD" used (not "C$" or "CA$")?
   - If wrong format → flag MINOR: "Canada: Use 'CAD' not 'C$'"

---

## Check 4: Share Class Naming

For Canadian companies:
1. Do Share Class Names use Carta convention?
   - "Common" not "Common Shares" (Canadian legal docs often say "Common Shares")
   - "Series A Preferred" not "Class A Preferred Shares"
   - If Canadian legal terminology used → flag MINOR: "Canada: Use Carta convention — put legal terminology in Admin Notes"
2. For dual-class common structures:
   - Are distinct prefixes used? (CSA-/CSB- or CS-/CSB-)
   - If same prefix for both classes → flag CRITICAL: "Canada: Dual-class common shares need distinct prefixes"

---

## Check 5: No US Legends

For Canadian companies:
1. Does the Legends tab contain US-style legends?
   - If YES → flag MAJOR: "Canada: Do not apply US legends to Canadian companies"

--- END ---
