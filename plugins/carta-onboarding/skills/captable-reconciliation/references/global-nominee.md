# Global Nominee Expansion Rules

Checks for nominee/bare trust structures. Apply when the document set includes Nominee Deeds, Bare Trust Deeds, Declarations of Trust, or references to nominee entities.

---

## Detection

Before running checks, scan local files and OBS for nominee indicators:
- Documents titled "Nominee Deed", "Bare Trust Deed", "Declaration of Trust"
- Entity names containing "Investments No", "Nominees", "as trustee for"
- Board resolutions referencing beneficial owners held through nominees

If NO nominee indicators found → skip all checks in this file.

---

## Check 1: Nominee Expansion

For each nominee entity detected:
1. Is the nominee entity listed as a single certificate row in the OBS?
   - If YES → flag CRITICAL: "Nominee entity '{name}' must be expanded into individual beneficial owner rows"
2. Are individual beneficial owner rows present instead?
   - If YES → verify each:
     a. Full legal name (including trust names if applicable)?
     b. Holder Type based on the BENEFICIAL OWNER's nature (not the nominee)?
     c. Nominee notation in Notes column: "Held via nominee: {ENTITY} (ACN {number})"?
        - If missing → flag MAJOR: "Missing nominee notation in Notes"

---

## Check 2: Nominee Share Sum

For each expanded nominee:
1. Sum of all beneficial owner certificate quantities = nominee's registered total?
   - If NO → flag CRITICAL: "Expanded shares ({sum}) ≠ nominee registered total ({total})"

---

## Check 3: Nominee Pricing

For each beneficial owner held through a nominee:
1. Is the PPS the actual per-investor price (not a blended average)?
   - Direct subscribers: subscription price from Subscription Agreement
   - SAFE converters: conversion price (SAFE amount ÷ shares received)
   - If all beneficial owners have the same PPS but some are SAFE converters → flag MAJOR: "Possible blended pricing — SAFE converters should have conversion price, not subscription price"

---

## Check 4: Certificate Numbering

For expanded nominee rows:
1. Are certificate IDs sequential across ALL holders in that class (direct + expanded)?
   - If separate numbering for nominee vs direct → flag MINOR: "Certificate IDs should be sequential across all holders, not separate for nominee beneficiaries"
