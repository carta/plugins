# Carta MCP connection

Mechanics every audit skill needs before its first Carta call. None of this is
auditor-facing — don't narrate any of it to the caller.

## Identify the Carta MCP server

Scan the tools available in the conversation for any matching `mcp__*__call_tool`.
Each match with a corresponding `mcp__*__welcome` represents a connected Carta MCP
server.

Extract the **server identifier** — the middle segment between the first and last
`__`. Example: `mcp__carta-test__call_tool` → server = `carta-test`.

**If no Carta MCP found:** tell the caller they aren't connected to Carta yet and
stop. **If exactly one found:** use it. **If multiple found:** first drop any
candidate that clearly can't be a real choice — a server whose
`read_tool`/`call_tool`/`welcome`/`list_contexts`/`set_context` all declare empty,
parameter-less schemas is a stub, not a second live connection; don't ask the caller
to pick between a real server and one that can't take arguments. If more than one
non-stub candidate remains, ask which.

Call `mcp__<SERVER>__welcome` (no parameters) to verify the connection.

## Every Carta MCP call carries `_instrumentation_v2`

Pass it on **every** `welcome`, `read_tool` and `call_tool` call, as a bare JSON object — a nested
structure, never a quoted string — naming the skill that is running:

```
_instrumentation_v2={"skills": ["carta-investors:<skill-name>"]}
```

In Claude Code a hook normally injects this automatically. If a call still comes back
rejected for missing `_instrumentation_v2` even though you attached it, work through
this fixed sequence — do not skip ahead to "the hook/plugin/session is broken" before
you've tried all three:

1. **First rejection:** you likely sent `_instrumentation_v2` as a JSON-encoded
   *string* (`"{\"skills\": [...]}"`) instead of a bare object — the single most
   common mistake, especially right after sending `arguments` as a string (that field
   tolerates either shape; this one only accepts an object). Re-send the *same* call
   with `_instrumentation_v2` as a literal nested object, unquoted, the same way you'd
   write `arguments` before stringifying it.
2. **Still rejected:** call `ToolSearch` with
   `select:mcp__<SERVER>__welcome,mcp__<SERVER>__read_tool,mcp__<SERVER>__call_tool` to fetch those tools'
   actual declared schema. **Checking the schema is not itself a fix** — you must then
   make one more call with `_instrumentation_v2` shaped exactly as that schema shows.
   Before you do, re-read your own two prior tool-call inputs character by character:
   if either one starts with a `"` and has `\"` anywhere inside it, that one was a
   string, not an object, no matter what you now believe you intended — trust what's
   on the page over your memory of what you meant to send.
3. **Still rejected after an attempt using the schema-verified shape:** only now say
   so and stop; don't keep retrying past this point, and don't tell the caller to
   restart Claude Code, run `carta update`/`carta configure-cli-mcp`, or check plugin
   installation — from inside a skill you cannot tell whether the hook is genuinely
   absent or you're still misformatting the field, and the second is far more common
   than the first.

This is a formatting bug in your own last call, not evidence the connection itself is
broken. Concluding "the shape I already sent must have been correct" without a fresh,
verified-against-schema attempt is exactly the failure mode this sequence exists to
prevent — step 2 isn't complete until you've actually sent that corrected call, not
merely looked up what it should look like. Sending `_instrumentation_v2` twice (once
via the hook, once explicitly) is harmless.

## Oversize responses

A large list call (e.g. hundreds of Partners' Equity documents) can exceed the MCP
gateway's inline size cap. Instead of the row list, the call returns a stub:

```json
{"document_returned": true, "document_url": "...", "command": "...", "size_bytes": 000000}
```

Detect this shape and fetch the real JSON array with `uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py "<document_url>" /tmp/carta-audit-documents/listing-<n>.json` and `Read` the file, before continuing — don't treat the stub itself as an empty or
malformed result. If `document_url` has expired, re-call the original list command
for a fresh one rather than retrying the dead URL.
