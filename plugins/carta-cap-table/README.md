# Carta Cap Table

Claude Code plugin that gives Claude access to Carta cap table data.

## How it works

This plugin provides **skills** that teach Claude how to use the Carta MCP server effectively — querying cap tables, modeling rounds, detecting portfolio alerts, and more.

The MCP server handles authentication via OAuth:
1. On first use, Claude opens a browser to the Carta login page
2. You log in with your Carta credentials
3. Carta issues an access token that Claude uses for all subsequent requests

## Installation

Install from the `carta/plugins` marketplace:

```
/plugin install carta-cap-table@carta-plugins
```

This registers the Carta MCP server (`https://mcp.app.carta.com/mcp`) and loads all skills automatically.

After installing, restart Claude Code and run `/mcp` to complete OAuth authentication.

## Try it out

- "What Carta cap table data do I have access to?"
- "Show me the ownership breakdown for [company]"
- "Who are the stakeholders in [company]?"
- "What SAFEs are outstanding for [company]?"
- "When does the 409A expire for [company]?"
- "Model a Series B at $80M pre-money with a $20M raise"

## Skills

| Skill | Description |
|-------|-------------|
| `client-triggers` | Surface time-based BD triggers across the portfolio. Use when asked about client outreach, which clients closed a round recently, stale cap tables, pending grants, tombstones, weekly deals, or BD triggers. |
| `conversion-calculator` | Calculate SAFE and convertible note conversion into equity. Use when asked about SAFE conversion, note conversion, conversion shares, or how instruments convert in a round. |
| `discover-commands` | Find the right carta-cap-table command when no other skill matches. Use when unsure which command to call, exploring available data, or when the user's request doesn't match a specific skill. |
| `grant-vesting` | Fetch vesting schedule for a specific option grant. Use when asked about vesting details, cliff dates, vesting progress, or unvested shares for a particular grant. |
| `list-convertible-notes` | Fetch all convertible instruments (SAFEs and convertible debt) for a company. Use when asked about convertible notes, SAFEs, convertible debt, note terms, caps, discounts, or maturity dates. |
| `list-safes` | Fetch all SAFEs for a company. Use when asked about SAFEs, simple agreements for future equity, SAFE terms, valuation caps, or discounts. |
| `market-benchmarks` | Analyze cap structure patterns across the portfolio as market benchmarks. Use when asked about market benchmarks, typical option pool sizes, average SAFE terms, what's normal for a Series A, cap structure patterns, or portfolio-wide statistics. |
| `ownership` | Ownership structure by share class, voting rights, and liquidation seniority. Use when asked about ownership breakdown, preferred vs common holders, voting power, protective provisions, or consent requirements. |
| `portfolio-alerts` | Detect red flags and time-sensitive issues across portfolio companies. Use when asked to flag problems, find expiring items, or audit portfolio health. |
| `portfolio-query` | Query cap table data for one or more companies. Use when asked about cap tables, ownership breakdown, share classes, stakeholder holdings, portfolio-wide analysis, comparing companies, or finding patterns across multiple entities. |
| `pro-forma-model` | Model a pro-forma financing round to show dilution impact. Use when asked to model a Series A/B/C, new round, or show how a round would affect ownership. |
| `round-history` | Fetch financing round history for a company. Use when asked about funding rounds, capital raised, or financing history. |
| `stakeholders` | List stakeholders for a company. Use when asked who the stakeholders are, stakeholder list, shareholders, investors, or holders. |
| `valuation-history` | Fetch 409A valuation history for a company. Use when asked about 409A valuations, FMV, exercise prices, or valuation expiration dates. |
| `waterfall-scenarios` | Fetch saved waterfall / exit scenario models for a company. Use when asked about liquidation preferences, exit payouts, return multiples, or waterfall analysis. |
<!-- test -->
