# Carta Onboarding

Claude Code plugin for Carta's Corporation Implementation Manager (IM) onboarding workflow. Provides document upload and extraction via CLI, AI-assisted extraction review, validation, Shareworks migration, and CLI-integrated OBS import.

## Skills

### review-onboarding-documents

Upload documents for extraction, survey extraction status, inspect extracted data, download source documents, and fix bad extractions by rerunning with focused instructions.

**What it does:**

1. Uploads new documents to the extraction service (`carta web create extraction-upload`)
2. Lists all onboarding documents and their extraction status
3. Inspects extracted JSON for a specific document
4. Downloads source documents for comparison
5. Reruns extraction with focused instructions when results are wrong (`carta web create extraction-rerun`)

```
/review-onboarding-documents
```

### c-corp-obs-validation

Quality review of a completed C-Corp OBS before upload to Carta. Runs 33 critical data integrity checks.

**What it checks:** Holder types, par value for non-US companies, seniority, preferred share details, SAFE field defaults (Interest Accrual Period = "Daily", Interest Rate = BLANK, Maturity Date = BLANK), ESOP treasury cert existence, legends, certificate completeness, date formats, quantities, cross-tab reconciliation, and more.

```
/c-corp-obs-validation
```

### pe-llc-obs-validation

Quality review of a completed PE/LLC OBS before upload. Runs 55 validation checks.

```
/pe-llc-obs-validation
```

### shareworks-migration

Specialized guide for migrating cap table data from Morgan Stanley Shareworks to Carta. Maps all 8 standard Shareworks report exports to OBS tabs, handles field naming conventions, and includes cross-report reconciliation checks.

**Reports handled:** Master Cap Table, Stock Certificate Ledger, Demographics Report, Terminations Report, Share Pool Balancing, Grant Listing with Vesting Details, Awards Canceled Report, Stock Repurchase Report.

```
/shareworks-migration
```

### obs-import

CLI workflow for downloading, validating, and importing an OBS for a corporation. Use this when the OBS is already prepared and you need to run the CLI import flow.

**What it does:**

1. Downloads the current OBS from Carta (`carta web get onboarding-spreadsheet`)
2. Validates without importing (`carta web create onboarding-import --task check`)
3. Imports after IM approval (`carta web create onboarding-import --task import`)

```
/obs-import
```

### send-magic-link

Send, resend, or list onboarding magic link emails for a corporation. Use this when a customer hasn't received their link, their link has expired, or you need to send a fresh link to a new email address.

**What it does:**

1. Lists existing magic links for a corporation (`carta web list onboarding-magic-links`)
2. Sends a new magic link to a customer email (`carta web execute onboarding-send-magic-link`)
3. Resends an existing active magic link (`carta web execute onboarding-resend-magic-link`)

```
/send-magic-link
```

### create-controlled-entity

Create a new corporation and register it as a controlled entity of a firm using the Carta CLI.
Staff-only write operation.

**What it does:**

1. Creates a write session scoped to the firm
2. Runs `carta web create controlled-entity-corporation <firm_id> "<legal_name>" --company-type <type>`
3. Cleans up the session

```
/create-controlled-entity
```

## Typical Workflow

```
/review-onboarding-documents  ← upload docs, check extraction status, fix issues
/c-corp-obs-validation        ← review populated OBS before import
/obs-import                   ← validate and import to Carta
```

## Prerequisites

- [carta-cli](../carta-cli) plugin installed and configured — run `/setup-cli` if needed
- For imports: authenticated with write access to the target corporation

## Related Plugins

- `carta-cli` — CLI setup, session management, and scope controls
- `carta-cap-table` — Query existing cap table data via MCP
