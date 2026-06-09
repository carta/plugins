# Carta Cap Table

Claude Code plugin that gives Claude access to Carta cap table data.

## How it works

This plugin provides **skills** that teach Claude how to use the Carta MCP server effectively — querying cap tables, modeling rounds, detecting portfolio alerts, and more. The MCP server itself lives in the [carta-mcp](https://github.com/carta/carta-mcp) repo.

OAuth uses a two-leg redirect flow:
1. Claude opens a browser to the MCP server's `/authorize` endpoint
2. User logs in via Carta's login page
3. Carta redirects back with an auth code, which is exchanged for an access token
4. Claude sends the token as a bearer token on every MCP tool call

## Installation

Install from the marketplace via `/plugin`, or use the install script in [`cap-table-scaffold`](../cap-table-scaffold/scripts/install/).

After installing, restart Claude Code and run `/mcp` to complete OAuth authentication.

### Try it out

- "What Carta cap table data do I have access to?"
- "Show me the ownership breakdown for [company]"
- "Who are the stakeholders in [company]?"
- "What SAFEs are outstanding for [company]?"
- "When does the 409A expire for [company]?"

## Skills

| Skill | Description |
|-------|-------------|
| `carta-portfolio-alerts` | Detect red flags and time-sensitive issues |
| `carta-reporting` | Display cap table data — grants, stakeholders, preferred holders, liquidation seniority, SAFEs, notes, round history, and more |
| `carta-field-definitions` | Explain a column or field within a specific Carta report |
| `carta-valuation-history` | 409A valuation history |
| `carta-waterfall-scenarios` | Saved exit scenario / waterfall models |
| `carta-voting-rights-optimizer` | Legal tool — minimum stockholder coalition to pass a charter amendment or vote |
| `carta-round-history` | Financing round history |
| `carta-grant-vesting` | Vesting schedule for a specific option grant |
| `carta-witness-signatures` | Status of witness and spousal-consent signature requests on awards |
| `carta-conversion-calculator` | Calculate SAFE/note conversion into equity |
| `carta-client-triggers` | Surface time-based BD triggers across the portfolio |
| `carta-market-benchmarks` | Cap structure patterns as market benchmarks |
| `carta-compensation-benchmarks` | Carta Total Comp market benchmarks (salary, equity, total cash) for a role |
| `carta-compensation-rolematcher` | Classify a job title into the CTC compensation taxonomy |
| `carta-issuance` | Issue certificates and option grants; draft shares or resume from a draft set |
| `carta-modify-issuables` | Amend issued certificates and option grants — dates, legend, notes, quantity, exercise price |
| `carta-interaction-reference` | Behavioral rules for presenting cap table data (voice, tone, precision, provenance) |
| `carta-discover-commands` | Find the right MCP command when unsure |

## MCP Server

The Carta MCP server source code lives in [carta/carta-mcp](https://github.com/carta/carta-mcp). This plugin only contains the skills and hooks needed to use it from Claude.

## Testing

Run the verdict test suite with `/cap-table-scaffold:test`. Requires the `carta-local` MCP server running and authenticated — run `/mcp` first if needed.

```
/cap-table-scaffold:test                    # all suites in parallel
/cap-table-scaffold:test ai-authorization   # single suite
```

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for the playbook on adding new skills, MCP commands, write actions, and when to move logic to Python.
