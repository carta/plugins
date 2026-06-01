# Smart Document Template Registry

Quick reference for available templates and their schema files.

## Supported Templates

| Template Key | Display Name | Category | Schema File |
|---|---|---|---|
| `co_invest_gp_lp_spv_investment_management_agreement` | Investment Management Agreement | UK Co-Investment SPV | `schemas/co_invest_gp_lp_spv_investment_management_agreement.json` |
| `coinvest_gplp_lp_agreement` | LP Agreement | UK Co-Investment SPV | `schemas/coinvest_gplp_lp_agreement.json` |

## Categories

- **UK Co-Investment SPV** — Documents for UK-domiciled co-investment SPVs with GP/LP structure

## Adding a New Template

1. Create a JSON schema file in `schemas/<template_key>.json`
2. Follow the schema format defined in the existing files
3. Add the template to this registry table
4. The generate skill will automatically pick it up

## CLI Commands

```bash
# List available templates from the drafting service
carta fa list smart-document-template

# Generate a document
carta fa generate smart-document --data-file payload.json

# Check document status
carta fa get smart-document <id>
```
