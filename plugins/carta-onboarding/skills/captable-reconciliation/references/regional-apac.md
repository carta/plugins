# APAC Regional Reconciliation Rules

Additional reconciliation checks for Singapore and Hong Kong companies. Apply ON TOP of global rules.

---

## Check 1: Par Value

**Singapore:**
1. Is Par Value blank?
   - If populated → flag CRITICAL: "APAC/SG: Par value should be blank for Singapore companies"

**Hong Kong:**
1. When was the company incorporated?
   - Post-March 2014: Par value must be blank
     - If populated → flag CRITICAL: "APAC/HK: Par value abolished March 2014 — must be blank"
   - Pre-March 2014: Par value may exist (check source documents)
     - If populated, verify against Articles/M&A

---

## Check 2: Authoritative Register

**Singapore:**
1. Is ACRA BizFile/BizProfile the source for shareholder data?
   - Cross-reference OBS holders against ACRA data if available
   - If mismatch → flag CRITICAL: "APAC/SG: OBS doesn't match ACRA register"

**Hong Kong:**
1. Is Companies Registry (Form NAR1) the source for shareholder data?
   - Cross-reference OBS holders against NAR1 if available
   - If mismatch → flag CRITICAL: "APAC/HK: OBS doesn't match Companies Registry"

---

## Check 3: Option Type

For APAC companies with equity plan awards:
1. Is Option Type set to "INTL" for non-US holders?
   - If "ISO" or "NSO" used → flag MAJOR: "APAC: Use 'INTL' option type for non-US companies"

---

## Check 4: Share Certificate Timing (Singapore)

For Singapore companies:
1. Are share certificates issued within 60 days of formation / 30 days after allotment?
   - If issue dates in OBS are significantly after the transaction dates in source docs → flag MINOR: "APAC/SG: Verify share certificate timing (60-day/30-day requirement)"

--- END ---
