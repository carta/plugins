---
name: carta-nda-dashboard
description: >-
  Interactive NDA insights dashboard from the firm's NDAs in Carta: provision frequency,
  governing law, NDAs expiring in the next two years, counterparties under an active
  non-solicit, no-contact or non-circumvention restriction, and every counterparty, in
  sortable, filterable tabs. Use when asked for an NDA dashboard or NDA insights, which NDAs
  expire soon, who we can't solicit or contact right now, our most common NDA counterparties,
  what law governs our NDAs, or how often non-solicit, standstill or other provisions appear.
  Do NOT use to review or redline a single NDA.
version: 1.0.0
model: inherit
allowed-tools:
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork)
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - Artifact
  - ToolSearch
  - AskUserQuestion
  - Read
  - Write
  - Bash(carta workspace cache *)
  - Bash(command -v *)
  - Bash(jq *)
  - Bash(mkdir -p *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-nda-dashboard/scripts/process.py" *)
  - Bash(uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" *)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:6.121.1</carta-plugin>

> **If this plugin's files can't be found:** a path that still shows an unreplaced `${…}` variable, or a "not found" when you read or run one of this skill's files, means the skill loaded before this session's computer link was ready. Invoke this skill once more with the Skill tool and use the paths that copy gives. If they're still unreplaced, tell the user Carta's plugin files aren't available in this session yet (link your computer, then ask again) and stop. Don't search the disk for them.

# NDA insights dashboard

One self-contained page with four tabs, built from the NDAs Carta has read for the firm:

- **Overview** — KPI tiles, provision frequency, and governing law (top 8 + "Other").
- **Expiring** — NDAs whose term ends in the next two years.
- **Restrictions** — counterparties under an active non-solicit, no-contact or
  non-circumvention provision, with a Restriction filter.
- **Counterparties** — every counterparty with its NDA count and governing law, filterable by
  governing law and deal.

Deal columns appear only for firms that track NDAs as work items in Carta.

When the user asks one specific question ("which NDAs expire soon?", "who can't we
solicit?"), build the dashboard and answer that question in one or two lines of chat from the
same data, naming the tab that holds the detail.

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-nda-dashboard/references/nda_data_model.md` before
querying, and take the SQL from
`${CLAUDE_PLUGIN_ROOT}/skills/carta-nda-dashboard/references/queries.md`. Both are this skill's
own `references/`; read them by those paths and do not search for them.

## Steps

### 1. Firm context and workspace

- **Set firm context first, every invocation, before any query.** Call `list_contexts`, then
  `set_context` to the firm. Context is dropped when a conversation is compacted or resumed,
  so never assume it carried over.
- Keep the firm name and its Carta id, and derive the firm token (`nda_data_model.md` →
  Counterparty).
- Locate the workspace (one Bash block; use the printed path as `<WORKDIR>` from here on,
  since shell variables do not survive between Bash calls):
  ```bash
  if [ -d "$HOME/mnt/outputs" ] && [ -w "$HOME/mnt/outputs" ]; then WORKDIR="$HOME/mnt/outputs/carta-nda-dashboard"
  elif command -v carta >/dev/null 2>&1; then WORKDIR="$(carta workspace cache carta-nda-dashboard | jq -r .)"
  else WORKDIR="${TMPDIR:-/tmp}/carta-nda-dashboard"; fi
  mkdir -p "$WORKDIR" && echo "$WORKDIR"
  ```

### 2. Pre-flight, then the six datasets

Run the pre-flight from `nda_data_model.md` rule 3 to pick Path A or Path B, then run the six
queries in `queries.md` — **kpi**, **provisions**, **jurisdictions**, **expiring**,
**restrictions**, **counterparties** — in parallel, in one turn. Each is the shared `WITH` block
plus that dataset's `SELECT`. If `kpi` reports zero NDAs, wait a few seconds and run all six
queries once more in one turn (`nda_data_model.md` rule 6); use only the second set of results.

A result comes back either inline or spilled to a file. Use a spilled file's path as is;
`Write` an inline result to `<WORKDIR>/<dataset>.ndjson`.

### 3. Assemble the data

Run this as one line, with each `<…>` replaced by a literal path or value. `allowed-tools`
matches the command text, so keep the quotes and the script path as written:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-nda-dashboard/scripts/process.py" --kpi "<kpi file>" --provisions "<provisions file>" --jurisdictions "<jurisdictions file>" --expiring "<expiring file>" --restrictions "<restrictions file>" --counterparties "<counterparties file>" --firm-name "<firm name>" --firm-carta-id "<firm Carta id>" --out "<WORKDIR>/nda-dashboard-data.json"
```

### 4. Render

The template is large; the shared renderer reads it, escapes the data safely for the page and
writes the finished HTML, so neither enters your context. Never load, edit or hand-write the
template.

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/scripts/render_artifact.py" --workdir "<WORKDIR>" --template "${CLAUDE_PLUGIN_ROOT}/skills/carta-nda-dashboard/references/artifact_template.html" --in nda-dashboard-data.json --out nda-dashboard.html
```

It prints the absolute path of the HTML. Branch on the exit code:

| Exit | Meaning | Next |
|---|---|---|
| 0 | HTML written | Step 5 |
| 1 | Data file missing or not valid JSON | Re-run Step 3 once; if it fails again, stop and say the dashboard data couldn't be assembled |
| 4 or 14 | Template missing or out of sync | Stop; say the dashboard template needs a fix from Carta and offer to send feedback. Don't retry |

### 5. Deliver

Check for the `Artifact` tool; if it is deferred, load it once with `ToolSearch`
`select:Artifact`.

**With `Artifact`** (Cowork): call `Artifact({action: "list", scope: "mine"})`. If an artifact
titled exactly **`<firm name> — NDA insights`** is already published, keep its `url` and say
you're refreshing it in place. The page's own `<title>` carries that name and always wins over
the `title` parameter, so match on nothing else. Then publish:

```
Artifact({
  file_path: "<path printed in Step 4>",
  url: "<url from the list — omit on a first publish>",
  title: "<firm name> — NDA insights",
  description: "NDA insights — provisions, governing law, expiring NDAs, active restrictions and counterparties.",
  icon: "file-text",
  label: "Refreshed for <firm name>"
})
```

**Without `Artifact`** (Claude Code, Claude Desktop): give the user the HTML path from Step 4
to open in a browser.

Either way, close with two or three lines: total NDAs, how many expire in the next two years,
how many counterparties are under an active restriction, and the answer to any specific
question the user asked. The page is a snapshot; ask again to refresh it.

## Notes

- Never show SQL, ids, table names, or the words "Snowflake", "DWH" or "warehouse" in chat.
- Expiry is best effort: only NDAs with both an executed date and a term have one. Say so when
  you quote an expiry count, and never call an "Unknown / perpetual" restriction lapsed.
- Aggregate in SQL; every dataset is already small. Never pull raw NDA rows.
