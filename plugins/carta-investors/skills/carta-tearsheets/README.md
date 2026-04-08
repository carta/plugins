# Tearsheets (MCP)

Claude Code skill for generating tearsheet PDFs via the Carta MCP server.

## Prerequisites

- Carta MCP server connected (`https://mcp.app.carta.com/mcp`)
- Active firm context (call `set_context` if needed)

## Skills

### `carta-download-tearsheet`

Generate tearsheet PDFs for one or more portfolio companies.

- **Single portco** — generates an immediate PDF preview returned as an embedded resource in the MCP response.
- **Multiple portcos** — starts a bulk job, polls until complete, and presents a ZIP download link.

The skill walks you through selecting a template and portfolio companies interactively.

**Trigger phrases:** "generate tearsheet", "download tearsheet", "tearsheet for portco",
"bulk tearsheets", "tearsheets for all portcos", "preview tearsheet", "Investment Summary",
"Fund Summary", "Tear Sheet", "generate reports for portcos"
