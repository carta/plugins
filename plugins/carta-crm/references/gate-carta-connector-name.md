# Gate — the connector's name

Run this when the **published page** calls a connector at runtime — the same condition as
passing `capabilities` at publish. A page with its data baked in does not need it.

Written for Carta; substitute whichever connector you are granting.

The page addresses the connector by **name**, the exact string from `list_connectors`. That
is the only stable handle: a page runs for many viewers, and connector ids are per-viewer.

## Step 1 — `list_connectors` is the only source

Take `name` from the entry that is `connected: true` and matches `carta` case-insensitively,
or whose `url` is a Carta domain:

```json
{ "name": "carta",
  "url": "https://mcp.app.carta.com/mcp",
  "directoryUuid": "aaaaaaaa-…",
  "connected": true }
```

Match on `name` or `url`, **never `description`** — it is empty on every connector but the
standard one. `directoryUuid` is the registry id, not what the page calls.

Two things not to do:

- **Don't read the name off your own tool prefixes.** Outside claude.ai web chat they are
  opaque session UUIDs (`mcp__aaaaaaaa-…__welcome`) and carry no name.
- **Don't guess.** `"carta"` and `"Carta"` are both common, and a guess cannot be tested from
  here — the string is validated only when a viewer opens the page, where a wrong one fails
  every card with `server_not_connected`.

## Step 2 — with more than one match, ask

| `name` | Points at |
|---|---|
| `carta` / `Carta` | the standard Carta MCP endpoint |
| anything parenthesised, e.g. `Carta (Acme Capital)` | a separate deployment — firm-specific or non-production |

Ask the user which one this artifact is for; `url` disambiguates. The page hard-codes what
you pass, so an artifact published against `Carta (Acme Capital)` works **only** for viewers
who have a connector by that exact name. When in doubt, the standard endpoint is production.

## Step 3 — confirm it answers

Being listed is not proof. Make **one successful call to that connector** before publishing,
through your own prefixed tool name:

```
mcp__<the connector's session prefix>__<a read the connector exposes>
```

Which call depends on the connector: the Carta gateway takes `welcome`; the CRM surface has
none and reads `crm_call_tool({"name": "crm:get_current_user"})` instead. Don't hard-code
`welcome` for a connector that doesn't expose it.

Grant it prefix-agnostically — `mcp__*carta*__welcome`, plus `mcp__*Carta*__welcome`, since
glob matching is case-sensitive.

> **Two namespaces, don't mix them.** You call tools by the prefixed name your tool list
> shows (`mcp__<uuid>__<tool>`). The page calls them by connector name and bare verb
> (`callTool("<the name>", "<tool>", …)`). This call belongs to the authoring session — the
> page itself branches on `claude.use("mcp")` resolving and never tests with a call.

**PASS:** store the name, publish, and say nothing about any of this.

**FAIL — no connector:**

> I can't find your Carta connection. Add Carta in Settings → Connectors and ask me again —
> without it, the dashboard I publish would come up empty for everyone who opens it.

**FAIL — listed but not answering:** say Carta isn't responding, include what came back if it
helps, and stop. Do not publish; it breaks the same way for every viewer.

Never publish a guessed name. The call is also what the platform's *"published against an
unobserved interface"* warning asks for.

## Keeping the cost down

`list_connectors` renders a connector card — every connector the user owns, each with a
Reconnect button.

- **Once per session.** Resolve on the first publish and reuse the name.
- **Only for live pages.** Baked-in data never needs this gate.
- **One short line first** — "checking which Carta connection to use".

## Don't narrate this gate

"Gate", "probe", "display name", `CARTA_MCP_SERVER` — our vocabulary, not the user's. A line
like *"Gates clear — J. Smith at Acme, connector display name `carta`"* is what not to write.
Pass quietly; on failure use the copy above.

## Not covered here

Passing proves the connector answers *your* session, not the viewer's: a chat viewer's page
has no `claude.use` and renders its degraded state. For which surfaces resolve MCP, the grant
shape, and the error codes the page branches on, see `skill-dev:build-cowork-live-artifact`.
