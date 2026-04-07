---
name: carta-fund-properties
description: >
  Create or edit fund properties in the Carta CLI. Read fund properties by
  namespace, set simple namespace properties (general, financials_export, spv,
  related_parties, valuation_policy), and set specialized property sets
  (fund-terms, fund-kyc, fund-tax-properties, fund-capital, etc.).
  
  Trigger phrases: "set fund properties", "update fund properties",
  "edit fund properties", "change fund properties", "fund property",
  "set general properties", "set fund terms", "set fund kyc"
allowed-tools:
  - Bash(carta fa set fund-properties *)
  - Bash(carta fa get fund-properties *)
  - Bash(carta fa schema fund-properties *)
  - Bash(carta fa get fund *)
  - Bash(carta fa list fund *)
  - Read
  - Write
args:
  - name: fund_uuid
    description: Fund UUID to read or update properties for
    required: false
  - name: action
    description: "What to do: 'get' (default) or 'set'"
    required: false
---

<!-- Part of the official Carta AI Agent Plugin -->

# Fund Properties

Help the user read and write fund properties via the Carta CLI.


## Overview

Fund properties are organized into two categories:

### Simple namespaces
Flat key-value properties accessed via `--namespace`:
- **general** — churned status, partner transaction source, liquidation, etc.
- **financials_export** — financial export settings
- **spv** — SPV-specific settings
- **related_parties** — related party information
- **valuation_policy** — valuation cadence and policy

### Specialized property sets
Structured property groups accessed via `--property-set` (most require `lpa_id` in the payload):
- **fund-terms** — address, domicile, tax ID, term length, GP entity
- **fund-kyc** — KYC/AML fields, registered address, incorporation date
- **fund-expense-properties** — expense reserve and cap
- **fund-tax-properties** — tax classification, incorporation address
- **fund-audit-report** — audit settings, reporting standard/cadence, fiscal year end
- **fund-capital** — capital call settings, late interest, GP contribution
- **fund-allocations** — allocation rules, carry percentages, hurdle
- **fund-distributions** — distribution waterfall, carry, hurdle
- **fund-borrowing-properties** — reinvestment cap, CCL, recycling
- **management-fee-page** — management fee details, fees, and offsets
- **management-fees** — management fee list only
- **service-providers** — legal, bank, tax, auditor team IDs
- **auditor-point-of-contact** — auditor POC assignment
- **tax-team-point-of-contact** — tax team POC assignment
- **form-d-section** — Form D filing data
- **international-properties** — GIIN, AEOI, UTR, regulatory structure

## Step 1: Identify the fund

If the fund UUID was not provided, ask for it. You can help look it up:

```bash
carta fa list fund --firm-uuid <FIRM_UUID>
carta fa get fund <FUND_UUID>
```

## Step 2: Read current properties

Always read the current state before making changes so you can show the user what exists.

**All properties (combined flattened view):**
```bash
carta fa get fund-properties --fund-uuid <FUND_UUID>
```

**Single namespace:**
```bash
carta fa get fund-properties --fund-uuid <FUND_UUID> --namespace general
```

## Step 3: Show the schema (if setting properties)

If the user wants to set properties and hasn't provided a payload, show the relevant schema:

```bash
carta fa schema fund-properties --verb set-general
carta fa schema fund-properties --verb set-fund-terms
carta fa schema fund-properties --verb set-fund-kyc
# ... etc. Use --verb set-<namespace> or set-<property-set>
```

Help the user build the payload from the schema. For property sets that require `lpa_id`, check the current fund properties to find the correct LPA ID.

## Step 4: Set properties

**Simple namespace properties:**
```bash
carta fa set fund-properties --fund-uuid <FUND_UUID> --namespace general \
  --data '{"is_churned": true, "service_stop_date": "2025-12-31", "last_reporting_period": "Q4", "last_reporting_period_year": 2025}'
```

**Specialized property sets:**
```bash
carta fa set fund-properties --fund-uuid <FUND_UUID> --property-set fund-terms \
  --data '{"lpa_id": 1, "domicile_country": "US", "state_of_incorporation": "DE"}'
```

For complex payloads, write to a temp file and use `--data-file`:
```bash
carta fa set fund-properties --fund-uuid <FUND_UUID> --property-set fund-capital \
  --data-file /tmp/fund_capital.json
```

## Step 5: Confirm

After setting properties, read them back to confirm the change took effect:

```bash
carta fa get fund-properties --fund-uuid <FUND_UUID> --namespace general
```

## Important notes

- **Simple namespace `set` uses upsert semantics** — fields you provide are set; fields you omit keep their current values (via `update_or_create` on the backend).
- **Specialized property sets** vary — most use upsert semantics too, but some (like service-providers) fully replace the list.
- **`lpa_id` is required** for most specialized property sets. Find it by reading the combined flattened properties first.
- **Churned funds** require `service_stop_date`, `last_reporting_period`, and `last_reporting_period_year` when setting `is_churned: true`.
- The `set` verb requires write scope — the CLI will prompt for session confirmation if not already in a write session.

## Error handling

| Error | Cause | Fix |
|-------|-------|-----|
| "Invalid namespace" | Typo in --namespace value | Use one of: general, financials_export, spv, related_parties, valuation_policy |
| "Unknown property set" | Typo in --property-set value | Check the list above or run `carta fa set fund-properties --help` |
| "specify --namespace or --property-set" | Neither flag provided | Must provide exactly one |
| HTTP 400 validation error | Missing required fields or invalid values | Check the schema: `carta fa schema fund-properties --verb set-<name>` |
| HTTP 404 | Fund not found | Verify the fund UUID |
