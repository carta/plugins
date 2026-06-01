---
name: generate-smart-document
description: >
  Generate a smart document (legal agreement, formation doc) via the Carta CLI.
  Walks the user through template selection, fund lookup, and payload construction
  interactively, or accepts a pre-built JSON payload. Supports UK Co-Investment
  SPV templates: LP Agreement (LPA) and Investment Management Agreement (IMA).
  Use when the user wants to generate, create, or draft a smart document, legal
  document, formation document, LP agreement, LPA, investment management agreement,
  IMA, or UK co-invest document — even if they don't use the phrase "smart document".
  Also trigger when the user provides a JSON payload with keys like template_key,
  fees, waterfall, manager, or partner in the context of document generation.
allowed-tools:
  - Bash(carta fa generate smart-document *)
  - Bash(carta fa get smart-document *)
  - Bash(carta fa list smart-document-template *)
  - Bash(carta fa list fund *)
  - Bash(carta scope *)
  - Bash(carta auth-status *)
  - Bash(carta workspace *)
  - Bash(jq *)
  - Read
  - Write
  - AskUserQuestion
args:
  - name: template_key
    description: >
      Template key to use (e.g. co_invest_gp_lp_spv_investment_management_agreement).
      If omitted, the skill lists available templates and asks the user to choose.
    required: false
  - name: payload_file
    description: >
      Absolute path to a JSON file containing the full payload. When provided,
      the skill validates it against the schema and fills in any missing required
      fields interactively. Skips the interactive walkthrough for fields already present.
    required: false
  - name: fund_uuid
    description: >
      Fund UUID to generate the document for. If omitted, the skill asks the user
      to search for a fund.
    required: false
model: sonnet
---

# Generate Smart Document

Generate a smart document from a template via the Carta CLI.

## Schema Directory Location

Template payload schemas live in the `schemas/` directory at the **plugin root**
(two levels up from this SKILL.md file). When this skill is invoked, its base
directory is provided. Resolve schema paths as:

```
{base_dir}/../../schemas/<template_key>.json
```

Read schema files using the Read tool with the resolved absolute path.

Each schema defines sections, fields, types, enum values, conditional
dependencies, and user prompts.

**Supported templates:**

| Template Key | Display Name |
|---|---|
| `co_invest_gp_lp_spv_investment_management_agreement` | Investment Management Agreement (UK Co-Invest GP/LP SPV) |
| `coinvest_gplp_lp_agreement` | LP Agreement (UK Co-Invest GP/LP SPV) |

## Workflow

### Gate 0: Prerequisites

1. Run `carta auth-status` to verify the user is logged in.
   - If not logged in, tell the user to run `carta login` and retry.
2. Note the environment from `auth-status` output.
3. Open a write scope: `carta scope set write`.

### Gate 1: Template Selection

If `template_key` arg is provided, use it directly.

Otherwise, present the available templates using **AskUserQuestion**:

> Which document would you like to generate?
> 1. **Investment Management Agreement** — Agreement between the SPV and its investment manager
> 2. **LP Agreement** — Limited Partnership Agreement for a UK co-investment SPV

Map the selection to the template key.

### Gate 2: Input Mode

Check if `payload_file` arg was provided, OR if the user's original message
contained a JSON blob (look for `{` with nested keys matching the schema sections).

**If a payload was provided:**
- Parse it (from file or inline JSON).
- Load the schema for the selected template from `schemas/<template_key>.json`.
- Read the schema file using the Read tool.
- Validate: check each required field in the schema is present in the payload.
- For any missing required fields, ask the user interactively (Gate 4 style).
- Skip to Gate 5 with the completed payload.

**If no payload was provided:**
- Proceed to Gate 3 (fund lookup) then Gate 4 (interactive walkthrough).

### Gate 3: Fund Resolution

If `fund_uuid` arg is provided, use it. Fetch the fund details:
```bash
carta fa list fund --search "<partial name or fund_uuid>"
```

If `fund_uuid` is NOT provided:
1. Ask the user: "Which fund is this document for?"
2. Search: `carta fa list fund --search "<user input>"`
3. If multiple results, present them and let the user pick.

From the selected fund, capture all available metadata for `auto_populate_from`
resolution in Gate 4:
- `fund_uuid` — the fund's UUID
- `fund_name` — the fund's display name (`fund.name`)
- `fund_currency` — the fund's currency code, e.g. GBP, EUR (`fund.currency`)
- `fund_currency_symbol` — e.g. £, € (`fund.currency_symbol`)
- `fund_gp_entity_name` — GP entity name (`fund.gp_entity_name`)
- `fund_management_company_name` — management company if present (`fund.management_company_name`)

These values are used by Gate 4 step 2b when a schema field has
`auto_populate_from` set. If a field cannot be resolved from the fund data,
prompt the user explicitly — do not fall back to a hardcoded currency.

### Gate 4: Interactive Payload Construction

Load the schema file for the template using the Read tool:
```
Read({base_dir}/../../schemas/<template_key>.json)
```

Walk through each **section** in the schema's `sections` array, in order:

1. Announce the section: "**Fee Structure** — Management fee configuration."
2. For each **field** in the section:
   a. Check `depends_on`: if the field has a dependency, check whether the
      dependency is satisfied. Skip the field if not.
   b. Check `auto_populate_from`: if set (e.g. `fund.name`), use the value
      from Gate 3 and show it to the user for confirmation.
   c. Check `default`: if set and the field is optional, show the default
      and ask if the user wants to change it.
   d. Based on `type`:
      - **`string`**: Ask the user with the `prompt` text. Accept free text.
      - **`enum`**: Use **AskUserQuestion** with options from `values` array,
        using `labels` for display text.
      - **`signature_list`**: Ask for signatory name and email. After each,
        ask "Add another signatory? [y/N]". Build an array of
        `{"name": "...", "email": "..."}` objects.
      - **`investor_list`**: Ask for each investor's name, email, and
        investment amount. After each, ask "Add another investor? [y/N]".
        Build an array of investor objects.
      - **`string_list`**: Ask the user to enter items one at a time.
        After each, ask "Add another? [y/N]".
   e. If the field is `required: false` and the user provides no input,
      omit it from the payload (do not include null values).

3. Assemble the payload as nested JSON matching the schema structure:
   ```json
   {
     "section_key": {
       "field_key": "value",
       ...
     },
     ...
   }
   ```

### Gate 5: Review & Confirm

Present a clean summary of the assembled payload (not raw JSON). Group by section:

```
📋 **Document Summary**

**Template:** Investment Management Agreement (UK Co-Invest GP/LP SPV)
**Fund:** My Magic Fund (448e5c6e-...)

**Fee Structure**
  Management fee: Annual percentage — 10%
  Fee recipient: Investment Manager

**Investment Manager**
  Name: Alex Smith
  Address: 3 Street Some Road London
  Signatories: Alex Smith (signatory@example.com)

**General Partner**
  Entity: Mayfair GP
  Signatories: Jordan Lee (signatory@example.com)

**Carried Interest**
  Payee: Investment Manager
```

Ask the user to confirm: "Does this look correct? [Y/n/edit]"
- If edit: ask which section to change, re-run that section's fields.
- If no: abort.
- If yes: proceed to Gate 6.

### Gate 6: Generate

1. Assemble the full CLI payload:
   ```json
   {
     "template_key": "<template_key>",
     "name": "<fund_name> - <template_display_name>",
     "fund_uuid": "<fund_uuid>",
     "payload": { ...assembled payload from Gate 4/5... }
   }
   ```

2. Get a workspace scratch file path (this returns a **file path**, not a directory):
   ```bash
   SCRATCH=$(carta workspace scratch)
   ```
   Read the scratch file first (it will be empty), then write the JSON
   directly to `$SCRATCH` using the Write tool — it is the destination
   file, not a directory to write into.

3. Generate:
   ```bash
   carta fa generate smart-document --data-file "$SCRATCH"
   ```

4. Parse the response. Extract `id`, `document_id`, `status`, `document_service_url`.

### Gate 7: Result & Next Steps

Present the result:

```
✅ **Document generated successfully**

  **Document ID:** 116
  **Status:** PREVIEW
  **Preview URL:** https://documents.carta.com/documents/<document_id>/preview

You can check the status later with:
  carta fa get smart-document 116
```

Then ask about signing:

> Would you like to send this document for signature?
> 1. **Yes** — Use /send-smart-document-signature to send for signing
> 2. **No** — Done for now

If yes, tell the user:
```
To send for signature, run:
  /send-smart-document-signature <document_id>
```

## Error Handling

- **Auth failure**: Tell the user to run `carta login`.
- **Fund not found**: Suggest a broader search term.
- **CLI error on generate**: Show the error message and suggest checking
  the payload. Offer to show the raw JSON for debugging.
- **Template key not recognized**: List available templates.

## Important Notes

- The `payload` field in the CLI input is the nested template data.
  The top-level `template_key`, `name`, and `fund_uuid` are separate.
- Signature objects need `name` and `email` fields.
- Enum values must match exactly (case-sensitive).
- The `depends_on` field uses `values` (array) to specify which parent
  values activate the dependent field.
- Do NOT include optional fields with null/empty values — omit them entirely.
