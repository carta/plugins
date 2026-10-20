# Publish the LP Dashboard page

The LP Dashboard is one artifact with a Portfolio tab and a Documents tab. Every skill that builds it publishes it this way, so an LP has one LP Dashboard whichever skill built it.

Take the path `render_artifact.py` printed, then look for an existing page:

```
Artifact({action: "list", scope: "mine"})
```

If an **LP Dashboard** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<path printed by render_artifact.py>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "LP Dashboard",
  description: "LP Dashboard — your portfolio's numbers and your documents, in two tabs, loaded live from Carta.",
  icon: "dashboard",
  capabilities: {
    mcp: { servers: [{ server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "welcome"] }] }
  }
})
```

The title must match the page's own `<title>`, which always wins in the gallery — a different one makes the lookup above miss and publishes a duplicate. Both tools must be in the grant, or every fetch rejects with `not_in_manifest`. Restate the whole `capabilities` object every time: a non-empty object replaces the stored grant.
