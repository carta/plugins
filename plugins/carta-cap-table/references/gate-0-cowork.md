# Gate 0 — Cowork Live Artifact Preflight

Shared preflight for skills that create or update Cowork artifacts. Run once at the top of the workflow before doing any real work. Each skill declares which gates it needs.

## Gate A — Cowork surface

Use `ToolSearch` with query `"create_artifact"` and check whether `mcp__cowork__create_artifact` exists.

**PASS:** Found — this is a Cowork session. Continue.

**FAIL:** Not found — the user is on a chat surface (Claude Desktop, claude.ai web, or Claude Code) where Cowork artifacts can't render. Tell the user:

> This feature uses a Live Artifact, which requires Cowork. You're in a chat session where artifacts aren't available. I can still pull the data — would you like a text summary instead?

If the user declines, stop. If they accept, switch to a markdown/text output path (skill-specific).

## Gate B — UUID-form Carta MCP tool

**Required only for live artifacts that call Carta at runtime via `window.cowork.callMcpTool`.** Skills that bake data into a static artifact at create time (no runtime MCP calls) can skip this gate.

The Cowork artifact bridge only resolves UUID-form tool prefixes (e.g. `mcp__33b9b857-8443-4b2d-b191-2d9b6c50eb86__call_tool`). Name-form prefixes (`mcp__carta__call_tool`, `mcp__Carta__call_tool`) fail with a 400 at runtime.

Scan the available tools for any matching `mcp__<UUID>__call_tool` (or `mcp__<UUID>__list_accounts`, `mcp__<UUID>__list_contexts` — whichever the skill uses for MCP discovery) where `<UUID>` is the 8-4-4-4-12 hex format.

**PASS:** At least one UUID-form Carta tool found. Use it as `CARTA_MCP_ID`.

**FAIL:** Only name-form tools found (`mcp__carta__*`, `mcp__Carta__*`, etc.). Tell the user:

> The Carta connector in this session uses a name-form prefix that Live Artifacts can't resolve at runtime. This is unexpected in Cowork — try disconnecting and reconnecting the Carta connector.

Stop. Do not render the artifact with a name-form ID — it will silently fail when the user opens it.

## Gate combinations

| Skill type | Gates needed | On Gate A fail | On Gate B fail |
|---|---|---|---|
| **Live artifact** (runtime MCP calls via `window.cowork.callMcpTool`) | A + B | Offer text fallback | Stop with reconnect suggestion |
| **Static artifact** (data baked at create time, no runtime MCP) | A only | Offer text fallback | n/a |

## Background

Three session surfaces exist, each with different tool naming:

| Surface | `mcp__cowork__*` tools | Carta prefix | Artifacts work? |
|---|---|---|---|
| Cowork | present | UUID-form | yes |
| Claude Desktop chat | absent | name-form (`mcp__Carta__*`) | no |
| claude.ai web | absent | name-form (`Carta (Preproduction):*`) | no |

UUIDs are per-connection (not per-user) and change on reconnect. Always discover fresh — never cache across invocations.
