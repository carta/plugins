# ANZ Regional Reconciliation Rules

Additional reconciliation checks for Australia and New Zealand companies. Apply ON TOP of global rules.

---

## Check 1: Par Value

For ALL Australian/NZ share classes:
1. Is Par Value blank?
   - If populated → flag CRITICAL: "ANZ: Par value must be blank — Australia abolished par value (Corporations Act 2001)"
   - Do NOT compute par value from total paid ÷ shares
   - Do NOT use $1.00 as placeholder
   - This applies to ALL share classes (ordinary and preference)

---

## Check 2: ASIC Code to Carta Prefix Mapping

For Australian companies with ASIC register data, verify prefix mapping:

| ASIC Code | ASIC Description | Expected OBS Prefix |
|-----------|-----------------|-------------------|
| ORD | Ordinary | CS |
| SAPS | Series A Preference Shares | PSA |
| PRF | Preference | PA |
| FOU | Founder | CS |
| PPS | Preference-Participating | PA or PSA |

For each share class:
1. Does the OBS prefix match the expected mapping?
   - If ASIC code used as prefix (e.g., ORD- instead of CS-) → flag MAJOR: "ANZ: Use Carta prefix convention — ORD maps to CS"
2. Is the original ASIC code noted in Admin Notes?
   - If NO → flag MINOR: "ANZ: Note original ASIC code in Admin Notes"

---

## Check 3: Legends

For Australian/NZ companies:
1. Does the Legends tab contain US-style SEC legends (Securities Act of 1933, Rule 144)?
   - If YES → flag CRITICAL: "ANZ: Do not apply US legends to Australian/NZ companies"
2. Is the Legends tab empty (unless the Constitution/SHA explicitly defines restrictive legend text)?
   - If populated without Constitution basis → flag MAJOR: "ANZ: Legends should be empty unless Constitution defines them"

---

## Check 4: Nominee/Bare Trust Expansion for SAFE Conversions

For Australian companies with SAFE conversions through nominee entities:
1. Does the ASIC register show nominee entities as registered holders?
2. Has each nominee been expanded to individual beneficial owner rows?
   - If nominee entity appears as single certificate row → flag CRITICAL: "ANZ: Nominee must be expanded — read Nominee Deed for beneficial owners"
3. Does the conversion price (not subscription price) appear as PPS for SAFE converters?
   - If subscription price used → flag MAJOR: "ANZ: SAFE converters should use conversion price as PPS"

See global-nominee.md for full expansion procedure.

---

## Check 5: Current-State Certificates Only

For ANZ companies:
1. Are there certificate rows for historical members who have fully transferred out?
   - If YES → flag MAJOR: "ANZ: Do not create certificates for historical members who transferred out — note in Admin Notes of receiving certificates"
2. For holders with multiple allotment dates: is there ONE consolidated certificate with total current holding and earliest issue date?
   - If multiple certificates for same holder/class without separate cert IDs in source → flag MINOR: "ANZ: Consolidate to one certificate per holder per class unless source tracks separate cert IDs"

--- END ---
