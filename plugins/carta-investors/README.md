# Carta Investors

Claude Code plugin that gives Claude access to Carta Investors data.

## How it works

This plugin provides **skills** that teach Claude how to query fund metrics, regulatory reporting, performance benchmarks, and more via the Carta MCP server at `https://mcp.app.carta.com/mcp`.

## Installation

Install from the marketplace via `/plugin`, or add the Carta MCP server manually:

```bash
claude mcp add --transport http carta https://mcp.app.carta.com/mcp
claude plugin marketplace add carta/plugins
claude plugin install carta-investors
```

After installing, restart Claude Code and run `/mcp` to complete OAuth authentication.

### Try it out

- "What datasets are available in Carta?"
- "Show me NAV and TVPI for all my funds"
- "Pull our Form ADV data for 2025"
- "How does Fund I compare to its benchmark?"
- "What journal entries were posted last quarter?"

## Skills

| Skill | Description |
|-------|-------------|
| `carta-explore-data` | Query and explore investors data — NAV, partners, investments, accounting |
| `carta-form-adv` | Form ADV Schedule D regulatory data and firm rollup |
| `carta-performance-benchmarks` | Compare fund performance against peer benchmark cohorts |
| `carta-download-tearsheet` | Generate tearsheet PDFs for one or more portcos — single PDF preview or bulk ZIP download |

## MCP Tools

The Carta MCP server exposes these data warehouse tools:

| Tool | Description |
|------|-------------|
| `list_tables` | Browse available datasets with descriptions and record counts |
| `describe_table` | Get column names, types, and descriptions for a specific table |
| `execute_query` | Run a read-only SELECT query against the data warehouse |
| `list_contexts` | See which firms you have access to |
| `set_context` | Switch to a different firm |

## Troubleshooting

### "Contact an organization owner to install connectors" in Claude.ai

If you see this message when trying to install the Carta connector in the Claude.ai web app, it means your account does not have org-owner permissions in Claude.ai. Connectors can only be installed by organization owners.

**Option 1 — Use Claude Code CLI (individual workaround, no approval needed)**

Install the Carta MCP server directly from the terminal:

```bash
claude mcp add --transport http carta https://mcp.app.carta.com/mcp
claude plugin marketplace add carta/plugins
claude plugin install carta-investors
```

Restart Claude Code and run `/mcp` to complete OAuth authentication. This bypasses the Claude.ai org permission model entirely.

**Option 2 — Org-wide install via Claude.ai org owner**

If you need the connector available to all members of your Claude.ai organization:

1. Identify who manages your Claude.ai organization (typically whoever set up your team's Claude.ai account).
2. Ask them to go to **Customize → Connectors** in Claude.ai and install the **carta** connector.
3. Once installed at the org level, all members will have access without needing individual approval.

> **Note:** If your Claude.ai plan does not support custom connectors, org-wide access requires the org owner to install from the available connector list. The Claude Code CLI option (Option 1) is always available regardless of plan.
