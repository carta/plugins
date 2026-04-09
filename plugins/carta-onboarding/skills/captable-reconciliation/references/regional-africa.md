# Africa Regional Reconciliation Rules

Additional reconciliation checks for South Africa, Nigeria, Kenya, and Egypt companies. Apply ON TOP of global rules.

---

## Check 1: South Africa — No Par Value

For South African companies (since 2011):
1. Is Par Value blank?
   - If populated → flag CRITICAL: "Africa/ZA: No par value since Companies Act 71 of 2008 — must be blank"

---

## Check 2: South Africa — Securities Register as Primary Proof

For South African companies:
1. Is the Securities Register (Section 24) available as a source document?
   - If YES → this is the PRIMARY proof of ownership (not CIPC, not share certificates)
   - Cross-reference OBS against Securities Register for all holders and quantities
   - If mismatch → flag CRITICAL: "Africa/ZA: OBS doesn't match Securities Register (Section 24)"
2. Are share certificates treated as SECONDARY proof?
   - If certificate data contradicts Securities Register → Securities Register wins

---

## Check 3: Nigeria — Foreign Ownership Capital

For Nigerian companies with foreign ownership:
1. Is total capital ≥ ₦100,000,000 (~USD $65,000)?
   - If NO → flag MAJOR: "Africa/NG: Foreign-owned companies require ₦100M minimum capital — verify compliance"
   - Note: this is a compliance flag for the IM, not an OBS data error

---

## Check 4: Nigeria — Preference Share Restrictions

For Nigerian companies with preference shares:
1. Are all preference shares redeemable?
   - CAMA 2020 prohibits irredeemable preference shares
   - If source docs show irredeemable preference → flag MAJOR: "Africa/NG: CAMA 2020 prohibits irredeemable preference shares — verify with legal"

--- END ---
