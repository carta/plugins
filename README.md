![Banner](assets/banner.png)

# Carta Plugins

Carta plugins for [Claude Code](https://code.claude.com/docs/en/plugins).

## Installation

### Claude Code

Add the Carta marketplace to Claude Code:

```
claude plugin marketplace add carta/plugins
```

Then install a plugin by name:

```
claude plugin install carta-cap-table
```

Or browse available plugins:

```
/plugin > Discover
```

### Claude Desktop

1. Open **Cowork** and go to **Manage connectors**
2. Select **Personal plugins**
3. Click **Create plugin**
4. Select **Add marketplace**
5. Enter `carta/plugins` and confirm
6. Authorize the MCP when prompted
7. Select and add the plugins you want to use

## Plugins

| Plugin | Description |
|--------|-------------|
| [carta-cap-table](plugins/carta-cap-table) | Skills and MCP server for querying Carta cap tables, grants, SAFEs, 409A valuations, waterfall scenarios, and more |
| [carta-fund-admin](plugins/carta-fund-admin) | Skills and MCP server for querying Carta fund admin data, including NAV, performance, allocations, and regulatory reporting |

## Documentation

For more on Carta's developer ecosystem, see the [Carta MCP documentation](https://docs.carta.com/api-platform/docs/carta-mcp).
