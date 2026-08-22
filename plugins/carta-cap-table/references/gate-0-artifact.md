# Gate 0 — Live Artifact Preflight

Shared preflight for skills that publish a live artifact — a page that calls Carta at
runtime from browser JS. Run once at the top of the workflow before doing any real work.
Each skill declares which gates it needs.

## Gate A — Artifact publishing surface

Check that the `Artifact` tool is available in this session. It is the single tool for
every artifact operation; the mode is picked with `action`:

| Need | Call |
|---|---|
| List what's already published | `Artifact({action: "list", scope: "mine"})` |
| Publish a new page | `Artifact({file_path, title, description, favicon, capabilities})` — `action` defaults to `"publish"` |
| Update a published page in place | same publish call, plus `url` of the existing artifact |
| Read a published page back | `Artifact({action: "read", url})` |

**PASS:** `Artifact` is present. Continue.

**FAIL:** Not present — this session cannot publish artifacts. Tell the user:

> This feature publishes a Live Artifact, and this session has no artifact tool. I can
> still pull the data — would you like a text summary instead?

If the user declines, stop. If they accept, switch to a markdown/text output path
(skill-specific).

## Gate B — Carta connector display name

**Required only for live artifacts that call Carta at runtime via `claude.use("mcp")`.**
Skills that bake data into a static artifact at publish time (no runtime MCP calls) can
skip this gate.

The published page reaches Carta through the artifact's `mcp` capability, and that
capability addresses a connector by its **display name** — never by a UUID or a
`mcp__…__` tool name. A published page runs for many viewers, and connector ids are
per-viewer facts, so the display name is the only stable handle.

Resolve it from the session's tool list: claude.ai connectors appear as
`mcp__claude_ai_<connector>__<tool>`. Find the one exposing the Carta gateway tools
(`list_contexts`, `fetch`, `call_tool`) and take its display name as `CARTA_MCP_SERVER`.

**Then prove it answers. Do not publish on a name scan alone.** Call the server-mandated
bootstrap through *your own* prefixed tool names — `welcome`, then `get_current_user`:

```
mcp__<the connector's tool prefix>__welcome
mcp__<the connector's tool prefix>__get_current_user
```

> **Two namespaces, don't mix them.** You call tools by the prefixed name your tool list
> shows (`mcp__<uuid>__welcome`). The published page calls them by display name and bare
> verb (`callTool("<CARTA_MCP_SERVER>", "welcome", …)`). The prefix is for you; the display
> name is for the page.

**PASS:** Both calls succeed. Store the display name as `CARTA_MCP_SERVER` and publish.

**FAIL — no Carta connector in the session:**

> I can't find a Carta connector in this session, so a published page would have nothing
> to call. Add the Carta connector in Settings → Connectors, then ask me again.

**FAIL — the connector is there but the bootstrap errors:** say what the call returned and
stop. Do not publish. Whatever broke here breaks identically for every viewer, except they
get an empty dashboard with no explanation.

Stop in both cases. Never publish with a guessed name — `callTool` rejects
`server_not_connected` at runtime and every data card renders empty.

`WHY the probe, not just the scan.` Two reasons, and the first is enforced:

1. A page declaring `capabilities.mcp` is a viewer-consented grant against an interface you
   claimed works. Publishing without one observed call gets you the platform's own warning —
   *"declares connector 'carta' but no successful call to it was observed in this session…
   published against an unobserved interface"* — and it is right to complain.
2. A wrong or stale display name is otherwise invisible until the first viewer opens the page
   and every card fails `server_not_connected`. The probe moves that failure from their
   screen to your terminal.

## Gate combinations

| Skill type | Gates needed | On Gate A fail | On Gate B fail |
|---|---|---|---|
| **Live artifact** (runtime MCP calls via `claude.use("mcp")`) | A + B | Offer text fallback | Stop; ask the user to add the connector |
| **Static artifact** (data baked in at publish time, no runtime MCP) | A only | Offer text fallback | n/a |

## Granting the page its tools

A live artifact declares what it may call in `capabilities.mcp` at publish time. Keep the
list minimal — it is a viewer-consented grant, and a page that declares one cannot be
shared publicly:

```
capabilities: {
  mcp: {
    servers: [
      { server: "<CARTA_MCP_SERVER>", tools: ["welcome", "list_contexts", "set_context", "fetch", "get_current_user", "mutate", "call_tool"] }
    ]
  }
}
```

Anything the page calls that is not in `tools` rejects with `not_in_manifest`. On a
redeploy, **omitting** `capabilities` carries the stored grant forward unchanged; passing
a non-empty object replaces the whole set, so restate every server and tool you still
need.

## Calling Carta from the page

```js
const mcp = await claude.use("mcp");   // null when this view can't run it — design for absence
const res = await mcp.callTool("<CARTA_MCP_SERVER>", "fetch", { ...args });
const data = res.payload;              // the JSON answer
```

Two arms, one decision: `watchTool(server, tool, input, handler, opts)` for data the page
displays and should keep current (it replays cache, refreshes when stale, polls only via
`refetchInterval`), `callTool` for a one-shot action. Tool failures reject with
`tool_error`; branch the UI on `err.code`, retry only errors stamped `retryable`, and drop
rendered data on `needs_reauth` / `server_not_connected` rather than leaving stale numbers
on screen.

## Background

`claude.use("mcp")` resolving `null` and a rejection code of `not_granted` or
`capability_disabled` all mean the same thing to the page: no live data in this view.
That is one branch, not three — render the static experience and say so.
