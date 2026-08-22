
<!-- Part of the official Carta AI Agent Plugin -->

# Schedule of Investments (SOI) Live Artifact

Render a firm's Schedule of Investments as a persistent, refreshable Live Artifact in the Cowork sidebar. There is one artifact per firm; the dropdown in the header lets users switch between every fund they have access to in that firm. The artifact queries the Carta data warehouse on load and on each fund switch, so the data is always current. Re-invoking the skill for the same firm rebuilds the artifact with the freshly-enumerated fund list — newly-added funds appear automatically.

## When to Use

- "Show me the SOI for [Fund Name]"
- "What is [Fund Name] invested in?"
- "Give me [Fund Name]'s schedule of investments"
- "Show me [Fund Name]'s portfolio breakdown"
- "What are [Fund Name]'s holdings?"
- "Show me the SOIs for [Firm Name]" (no specific fund named)

## Prerequisites

- The user must have the Carta MCP server connected
- The user must be in Cowork — Live Artifacts only render there
- The user must have access to the firm and at least one fund within it

## User-facing output

Customer-facing narration should sound like a person, not an implementer. The customer asked to see a fund's Schedule of Investments — they don't care about step numbers, UUIDs, MCP discovery, "templates", or "render scripts". Quiet implementation; loud delivery.

**Phase-by-phase guidance:**

- **On invocation** — One short sentence by fund name or firm name, e.g. *"Pulling the Schedule of Investments for Acme Ventures Fund III…"* or *"Pulling Acme Capital's funds…"*
- **During Steps 1–5 (the mechanical middle)** — Say *"Building your view…"* once after the opening acknowledgment. Nothing else.
- **On disambiguation** — Use `AskUserQuestion` with a clean prompt naming the candidate funds. Don't explain *why* you're asking.
- **On the final delivery (Step 6)** — One friendly delivery sentence (see Step 6) plus a 3–5 bullet summary of what the artifact shows.

**Do NOT:**

- Number the steps in user-visible text ("Step 1 — checking firm context", "Step 2 & 3 — finding funds and MCP tool").
- Surface internals: fund UUIDs, MCP tool prefixes, "the render script", "the artifact template", "inject placeholders", "set firm context", "discover the Carta MCP", "writing the fund list file".
- Print "Perfect!" / "Excellent!" / "Great!" / "Done!" between every tool call. One natural confirmation at the end is enough.

## Workflow

### Step 1 — Set firm context if needed

If the user's accessible firms are already in your conversation context (e.g. from a prior `welcome` Carta MCP tool call), use that list. Otherwise, call `list_contexts` to enumerate them.

With the firm list in hand:
- If only one firm is accessible, call `set_context` with it.
- If multiple are accessible, try to infer which firm the user means from their request (firm name, fund name, or any other hint). If you can't pick confidently, ask via `AskUserQuestion`. Then call `set_context`.

**Capture both the firm name and firm UUID** — you'll pass the name to the render script in Step 4 (eyebrow display) and the UUID twice: once to the render script and again as the `firm_id` the artifact uses to pin context on every load.

### Step 2 — Enumerate the firm's funds

> **Run in parallel with Step 3.** Fund enumeration (this step) and MCP UUID discovery (Step 3) are fully independent — issue both tool batches concurrently in the same response, not sequentially. 

Call `call_tool({"name": "fa__list__entities", "arguments": { entity_types: "fund,spv" }})`. The filter excludes entity types that can't hold investments so it is critical. Capture the full `[{uuid, name, currency, fund_family_id, fund_family_name}, ...]` list from the response — the `currency` field is the fund's reporting currency (e.g. `"USD"`, `"EUR"`) and is needed for correct amount formatting in the artifact. `fund_family_name` is non-null for funds that belong to a fund family (e.g. side-by-side vehicles of the same strategy) and null/absent for standalone funds — carry it through verbatim to Step 4a so the artifact can group the fund dropdown by family.

**Pick the initial fund** for the dropdown and capture two variables — `initial_fund_uuid` and `name_status` — that Step 6 will read by name.

| Situation | `initial_fund_uuid` | `name_status` | Also capture |
|---|---|---|---|
| User named a fund, **one** match | the matched fund's uuid | `named_and_found` | — |
| User named a fund, **multiple** matches | the user-chosen uuid (via `AskUserQuestion`) | `named_and_found` | — |
| User named a fund, **no** match | alphabetically-first fund's uuid | `named_but_missing` | `named_term` = the term the user used |
| User did not name a fund | alphabetically-first fund's uuid | `unnamed` | — |

`named_but_missing` is **not** a blocker — render the artifact with the full firm fund list anyway. The user can pick their intended fund from the dropdown; Step 6 surfaces the miss in the confirmation message.

### Step 3 — Checks before building

> **Run in parallel with Step 2** — see note in Step 2.

Run both checks before building, and stay quiet about them when they pass:

1. `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md` — can this session publish at all?
2. `${CLAUDE_PLUGIN_ROOT}/references/gate-carta-connector-name.md` — the connector name the page will call.

Both sit in the **plugin's** `references/` directory — `${CLAUDE_PLUGIN_ROOT}/references/`,
alongside the other plugin-wide references. They are *not* under this skill's own
`references/`. Read them by that exact path; don't search for them.

This is a live artifact: the rendered HTML calls Carta at runtime through `claude.use("mcp")`, so it needs both.
If the `Artifact` tool is missing, offer to pull the SOI data as a text summary instead.

Store the `name` the connector gate resolves as `CARTA_MCP_SERVER` — Step 4 passes it to
the render script as positional argument 3, and Step 5 puts it in the `capabilities.mcp`
grant. It is one string; there is nothing to derive and nothing to keep in sync.

### Step 4 — Write the funds file, then render the template

> **You must NEVER write the artifact HTML manually.** Every render goes through `render-artifact.py`. Manual edits — `Read` + `Edit` / `Write` against the rendered HTML or the template — bypass the placeholder substitution and validation logic. If the script fails, surface the error and stop. Do not fall back to manual edits.

Three sub-steps:

**4a.** Use the `Write` tool to drop the firm's fund list to a JSON file inside the session's current working directory. Filename should be `<firm-slug>-funds.json`. Contents must be a JSON array of `{"uuid", "name", "currency"}` objects — all three keys required; `currency` is the fund's own code from Step 2, not a default. Add `"fund_family_name"` on any entry whose Step 2 `fund_family_name` was non-null — omit the key entirely (don't set it to `null`) for standalone funds:

```json
[
  {"uuid": "<fund_uuid_1>", "name": "<fund_name_1>", "currency": "<currency_code_1>", "fund_family_name": "<family_name>"},
  {"uuid": "<fund_uuid_2>", "name": "<fund_name_2>", "currency": "<currency_code_2>", "fund_family_name": "<family_name>"},
  {"uuid": "<fund_uuid_3>", "name": "<fund_name_3>", "currency": "<currency_code_3>"}
]
```

The fund list comes straight from Step 2's `fa:list:entities` response. Preserve the entity name verbatim — including apostrophes, ampersands, commas, and any punctuation. The script JSON-escapes hostile characters at substitution time.

If any fund in the firm has a `fund_family_name`, the artifact automatically groups the fund dropdown by family: the family name is a bold, selectable row that pools every fund beneath it — same pooling behavior as "All Entities", including the "Held By" column — with its member funds indented under it. Families of one fund and standalone funds render as plain rows. No extra step or render argument is needed; this is driven entirely by whether `fund_family_name` is present in the funds file.

**4b.** Locate the script:

```bash
find /sessions "$HOME/mnt" -type f -path '*/carta-portfolio-analytics-routing/references/soi/scripts/render-artifact.py' 2>/dev/null | head -1
```

**An empty result is the expected case in Cowork, not an error** — bash cannot reach the
plugin mount there. When it prints nothing, go straight to the copy fallback at the end of
this step; do not spend a `uv run` on
`${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-analytics-routing/references/soi/scripts/render-artifact.py`
first, because that path is exactly what bash can't see. Use that path directly only where
the plugin lives on the local filesystem (a repo checkout), where the `find` roots don't
exist and the plugin root does.

**4c.** Render, substituting the path from 4b **literally**. `allowed-tools`
matches the command text, so a shell variable in place of the path fails the
allowlist and the call has to be approved by hand each time:

```bash
uv run "<SCRIPT_PATH>" \
    "<CWD>/<firm-slug>-fund-soi-collection.html" \
    "<firm-slug>-fund-soi-collection" \
    "<CARTA_MCP_SERVER>" \
    "<FIRM_UUID>" \
    "<FIRM_NAME>" \
    "<CWD>/<firm-slug>-funds.json" \
    "<INITIAL_FUND_UUID>"
```

Keep the `find` scoped to those two roots — the remote plugin mounts, the only
place bash can reach this script, since it cannot reach the path
`${CLAUDE_PLUGIN_ROOT}` expands to there. Locally neither exists, the `find` is
empty, and the plugin-root path is the correct one. Do not broaden to `$HOME` or
`/`: it takes tens of seconds and can resolve a stale cached copy.

**The copy fallback.** Use it when the `find` came back empty on a host where the plugin
root isn't a local path, or when `uv run` fails because the script file does not exist (not
on a validation error). Bash cannot reach the plugin mount, but `Read` can: copy both files
into `<CWD>/soi-render/` as `scripts/render-artifact.py` and `references/artifact.html`, run
that copy, and report that the fallback fired so the mount path gets fixed. One attempt — if
it fails too, stop rather than hand-writing the HTML.

Positional arguments:

1. **Output path** — must be **absolute**, under the session's current working directory (`<CWD>`), and **not under `/tmp`**. Use `pwd` to resolve `<CWD>` if needed. Filename is `<firm-slug>-fund-soi-collection.html`.
2. **Artifact ID** — the kebab-case slug that names this artifact. Must equal `<firm-slug>-fund-soi-collection`.
3. **Carta connector display name** — `CARTA_MCP_SERVER` from Step 3.
4. **Firm UUID** — the firm's UUID from Step 1. The artifact calls `set_context` with this on every load to pin the user's MCP firm context, so the dwh query succeeds even if the user switched contexts elsewhere.
5. **Firm name** — the human-readable firm name from Step 1.
6. **Funds file path** — the absolute path to the JSON file you wrote in 4a. Must also be under CWD and not under `/tmp`.
7. **Initial fund UUID** — the `initial_fund_uuid` chosen in Step 2. Must be one of the uuids in the funds file; the script refuses if it isn't.

On success, the script prints one stdout line: the absolute output path. The script exits non-zero on any validation failure (bad UUID, unusable connector name, output or funds file outside CWD, empty funds list, malformed fund entries, initial_fund_uuid not present in the list, template missing, missing placeholders). If it fails, surface the error and abort.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output filename `acme-capital-partners-lp-fund-soi-collection.html`, funds-file `acme-capital-partners-lp-funds.json`, artifact id `acme-capital-partners-lp-fund-soi-collection`.

Re-running the skill for the same firm produces the same artifact id and the same filename, so the artifact is cleanly updated in place by Step 5.

### Step 5 — Publish the Live Artifact

> **Critical: the render script only writes the HTML file. Nothing picks up file changes on its own — you MUST publish after every render, or the reader keeps seeing the prior version.**

First find an existing one:

```
Artifact({action: "list", scope: "mine"})
```

If a **<Firm Name> — Schedule of Investments** artifact is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<absolute path printed by the render script>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "<Firm Name> — Schedule of Investments",
  description: "<Firm Name> — fund Schedule of Investments",
  favicon: "📈",
  capabilities: {
    mcp: {
      servers: [
        { server: "<CARTA_MCP_SERVER>", tools: ["call_tool", "set_context", "welcome"] }
      ]
    }
  }
})
```

All three tools must be in the grant, or the page loads and the matching call rejects with `not_in_manifest`. The artifact only calls `welcome` itself when the MCP reports a "session not initialized" error on the first dwh query or set_context call — see **Session re-initialization** under Caveats.

Keep `title` and `favicon` stable across redeploys, and restate the whole `capabilities` object every time: a non-empty object replaces the stored grant, so a tool left out is revoked.

### Step 6 — Confirm to the user

Pick the branch from the `name_status` value captured in Step 2.

**`name_status == "named_and_found"`** — the user named a fund and we found it:

> The Schedule of Investments for **<Fund Name>** is now loading in your Cowork sidebar. Use the **Fund** dropdown in the header to switch between any of the **<N>** funds in **<Firm Name>** you have access to.

**`name_status == "named_but_missing"`** — the user named a fund we couldn't find; initial selection fell back to alphabetically-first:

> I couldn't find a fund named **<named_term>** in **<Firm Name>**. I've loaded the Schedule of Investments artifact with the **<N>** funds you do have access to — use the **Fund** dropdown in the header to pick the one you meant.

`<named_term>` is the value captured in Step 2.

**`name_status == "unnamed"`** — the user asked for the firm's SOIs without naming a specific fund:

> The Schedule of Investments artifact for **<Firm Name>** is now loading in your Cowork sidebar with all **<N>** funds you have access to. Use the **Fund** dropdown in the header to switch between them.

After the branch sentence, append a 3–5 bullet summary of what the artifact contains (e.g. interactive holdings table, summary metrics, sortable columns, expand/collapse rows, filter by company name, fund switcher across all funds you have access to). Keep it brief — the customer can see the artifact themselves. The bullet summary is optional on re-invocation branches; if you've already shown it earlier in the conversation, skip it.

See **User-facing output** at the top of this skill for the broader narration rules.

## Caveats

- **The connector display name must match what the viewer has.** A published page runs for whoever opens it, and the grant names the connector by display name. If a viewer's Carta connector carries a different display name (a test connector, say), every call rejects with `server_not_connected`. Re-invoke this skill to republish against the right name.
- **Session re-initialization.** The Carta MCP requires `welcome` to have been called once per session to populate identity/account state. When the user's session expires (typically after a few days of inactivity), the first `set_context` or dwh query returns an error string asking us to call `welcome` first. The artifact handles this transparently: it catches the error, briefly shows "Reconnecting to Carta…" above the shimmer, calls `welcome` itself, and retries the original call once.
- **Cowork-only.** Live Artifacts only render in Cowork. If the user is in Claude Code or Claude Desktop, explain that the artifact view requires Cowork. For inline data answers, point them at the `carta-explore-data` skill.
