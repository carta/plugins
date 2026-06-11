---
name: carta-soi
description: Display a fund's Schedule of Investments (SOI) as a Live Artifact in Cowork. The artifact is firm-scoped — it loads every fund the user has access to in the firm and presents them in a header dropdown for one-click switching. Use when asked for the SOI, fund holdings, what a fund is invested in, or a portfolio breakdown. Do NOT use for general fund metrics (NAV, IRR, TVPI, DPI) or ad-hoc warehouse queries — use carta-explore-data instead.
version: 1.1.0
model: haiku
allowed-tools:
  # Carta MCP — registration prefix varies by host (Claude Code / Claude.ai / Cowork / public)
  - mcp__carta__call_tool
  - mcp__carta__fetch
  - mcp__carta__discover  # UUID-form disambiguation only (Step 3) — not gateway discovery
  - mcp__carta__set_context
  - mcp__carta__list_contexts
  - mcp__claude_ai_carta__call_tool
  - mcp__claude_ai_carta__fetch
  - mcp__claude_ai_carta__discover  # UUID-form disambiguation only (Step 3) — not gateway discovery
  - mcp__claude_ai_carta__set_context
  - mcp__claude_ai_carta__list_contexts
  # Cowork
  - mcp__cowork__create_artifact
  - mcp__cowork__update_artifact
  # Local execution
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-soi/scripts/render-artifact.py:*)
  - Bash(pwd)
  - Write
  # Interaction
  - AskUserQuestion
  - ToolSearch
---

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

Call `call_tool({"name": "fa__list__entities", "arguments": { entity_types: "fund,spv" }})`. The filter excludes entity types that can't hold investments so it is critical. Capture the full `[{uuid, name}, ...]` list from the response.

**Pick the initial fund** for the dropdown and capture two variables — `initial_fund_uuid` and `name_status` — that Step 6 will read by name.

| Situation | `initial_fund_uuid` | `name_status` | Also capture |
|---|---|---|---|
| User named a fund, **one** match | the matched fund's uuid | `named_and_found` | — |
| User named a fund, **multiple** matches | the user-chosen uuid (via `AskUserQuestion`) | `named_and_found` | — |
| User named a fund, **no** match | alphabetically-first fund's uuid | `named_but_missing` | `named_term` = the term the user used |
| User did not name a fund | alphabetically-first fund's uuid | `unnamed` | — |

`named_but_missing` is **not** a blocker — render the artifact with the full firm fund list anyway. The user can pick their intended fund from the dropdown; Step 6 surfaces the miss in the confirmation message.

### Step 3 — Discover the Carta MCP UUID-form tool prefix

> **Run in parallel with Step 2** — see note in Step 2.

The artifact must call the Carta `fetch` tool by its **UUID-form prefix** (e.g., `mcp__33b9b857-8443-4b2d-b191-2d9b6c50eb86__fetch`) — name-form prefixes like `mcp__carta-test__fetch` fail with a 400 at runtime. The UUID is assigned per-installation by Cowork, so it must be discovered, not hardcoded.

Procedure:

1. **Find the UUID-form Carta `fetch` tool.** Look for a tool matching `mcp__<UUID>__fetch` where `<UUID>` is the 8-4-4-4-12 hex format. `ToolSearch` with query `"fetch"` can help if the deferred-tools list is hard to scan. In most sessions there is exactly one such candidate — capture it.

2. **If multiple UUID-form candidates exist** (e.g., both production and test Carta connectors are connected, or another MCP also uses a UUID prefix), disambiguate by calling `mcp__<UUID>__discover({"search": "dwh"})` on each candidate and picking the one that exposes `dwh:execute:query`. If two still pass (production + test Carta), ask the user via `AskUserQuestion`.

3. **Capture the chosen `mcp__<UUID>__fetch` string in a single local variable.** Reuse it as the fourth argument to the render script in Step 4 AND in `mcp_tools` at Step 5 (artifact allowlist). Step 5 also needs `mcp__<UUID>__set_context` — derive it from the fetch string by swapping the suffix, since both tools live on the same connector UUID. If any of these strings drift, the artifact loads but the corresponding MCP call fails with `"Tool ... is not in this artifact's mcp_tools allowlist."`.

### Step 4 — Write the funds file, then render the template

> **You must NEVER write the artifact HTML manually.** Every render goes through `render-artifact.py`. Manual edits — `Read` + `Edit` / `Write` against the rendered HTML or the template — bypass the placeholder substitution and validation logic. If the script fails, surface the error and stop. Do not fall back to manual edits.

Two sub-steps:

**4a.** Use the `Write` tool to drop the firm's fund list to a JSON file inside the session's current working directory. Filename should be `<firm-slug>-funds.json`. Contents must be a JSON array of `{"uuid", "name"}` objects:

```json
[
  {"uuid": "<fund_uuid_1>", "name": "<fund_name_1>"},
  {"uuid": "<fund_uuid_2>", "name": "<fund_name_2>"}
]
```

The fund list comes straight from Step 2's `fa:list:entities` response. Preserve the entity name verbatim — including apostrophes, ampersands, commas, and any punctuation. The script JSON-escapes hostile characters at substitution time.

**4b.** Run the bundled Python script:

```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-soi/scripts/render-artifact.py" \
    "${CLAUDE_PLUGIN_ROOT}/skills/carta-soi/references/artifact.html" \
    "<CWD>/<firm-slug>-fund-soi-collection.html" \
    "<firm-slug>-fund-soi-collection" \
    "<MCP_TOOL_NAME>" \
    "<FIRM_UUID>" \
    "<FIRM_NAME>" \
    "<CWD>/<firm-slug>-funds.json" \
    "<INITIAL_FUND_UUID>"
```

Positional arguments:

1. **Template path** — `${CLAUDE_PLUGIN_ROOT}/skills/carta-soi/references/artifact.html` (verbatim).
2. **Output path** — must be **absolute**, under the session's current working directory (`<CWD>`), and **not under `/tmp`** (`mcp__cowork__create_artifact` rejects `/tmp` paths). Use `pwd` to resolve `<CWD>` if needed. Filename is `<firm-slug>-fund-soi-collection.html`.
3. **Artifact ID** — the kebab-case Cowork artifact id, same string you'll pass as `id` to `create_artifact` / `update_artifact` in Step 5. Must equal `<firm-slug>-fund-soi-collection`.
4. **MCP tool name** — the full `mcp__<UUID>__fetch` string from Step 3.
5. **Firm UUID** — the firm's UUID from Step 1. The artifact calls `set_context` with this on every load to pin the user's MCP firm context, so the dwh query succeeds even if the user switched contexts elsewhere.
6. **Firm name** — the human-readable firm name from Step 1.
7. **Funds file path** — the absolute path to the JSON file you wrote in 4a. Must also be under CWD and not under `/tmp`.
8. **Initial fund UUID** — the `initial_fund_uuid` chosen in Step 2. Must be one of the uuids in the funds file; the script refuses if it isn't.

On success, the script prints one stdout line: the absolute output path. The script exits non-zero on any validation failure (bad UUID, bad MCP tool slug, output or funds file outside CWD, empty funds list, malformed fund entries, initial_fund_uuid not present in the list, template missing, missing placeholders). If it fails, surface the error and abort.

**Slugification rules** (apply to the **firm name**, not any UUID):

1. Lowercase
2. Replace whitespace with hyphens
3. Strip non-alphanumeric characters except hyphens
4. Collapse consecutive hyphens
5. Trim leading and trailing hyphens

Example: `"Acme Capital Partners, L.P."` → slug `"acme-capital-partners-lp"` → output filename `acme-capital-partners-lp-fund-soi-collection.html`, funds-file `acme-capital-partners-lp-funds.json`, artifact id `acme-capital-partners-lp-fund-soi-collection`.

Re-running the skill for the same firm produces the same artifact id and the same filename, so the artifact is cleanly updated in place by Step 5.

### Step 5 — Register or update the Live Artifact

> **Critical: the render script only writes the HTML file. Cowork does NOT auto-pick-up file changes — you MUST call one of `mcp__cowork__create_artifact` or `mcp__cowork__update_artifact` after every render, or the sidebar will keep showing the prior version.**

Attempt **`mcp__cowork__create_artifact`** first. If it returns an "artifact already exists" (or equivalent) error, immediately retry with **`mcp__cowork__update_artifact`** using the same arguments. Re-invocations of the skill for the same firm produce the same artifact id, so the update branch is the common case after the first run.

Same arguments either way:

- `id`: `"<firm-slug>-fund-soi-collection"` (kebab-case slug of the firm name from Step 1, with the `-fund-soi-collection` suffix). Cowork title-cases the id for the sidebar label, so this renders as e.g. "Krakatoa Ventures Fund Soi Collection" — identifies the firm and conveys that the artifact is a collection of per-fund SOIs.
- `html_path`: the absolute path printed on stdout by the render script.
- `description`: `"<Firm Name> — fund Schedule of Investments"`.
- `mcp_tools`: `[<MCP_TOOL_NAME>, <SET_CONTEXT_TOOL_NAME>, <WELCOME_TOOL_NAME>]` — all three must be allowlisted. `<MCP_TOOL_NAME>` is the `mcp__<UUID>__fetch` string from Step 3 (same string passed as the fourth argument to the render script). `<SET_CONTEXT_TOOL_NAME>` and `<WELCOME_TOOL_NAME>` live on the same connector — derive them by replacing the `__fetch` suffix on `<MCP_TOOL_NAME>` with `__set_context` and `__welcome` respectively (i.e. `mcp__<UUID>__set_context`, `mcp__<UUID>__welcome`). All three must be present or the artifact will load but fail at runtime with `"Tool ... is not in this artifact's mcp_tools allowlist."`. The artifact only calls `welcome` itself when the MCP returns a "session not initialized" error on the first dwh query or set_context call — see **Session re-initialization** under Caveats.

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

- **MCP tool UUID is per-user-installation.** The `mcp__<UUID>__fetch` prefix injected as `MCP_TOOL_NAME` is assigned by Cowork to the user's specific Carta MCP connector. If the user disconnects and reconnects their Carta MCP, the UUID changes and existing artifacts stop working with a permission-denied error from the allowlist check. Re-invoke this skill to recreate the artifact with the new UUID.
- **Session re-initialization.** The Carta MCP requires `welcome` to have been called once per session to populate identity/account state. When the user's session expires (typically after a few days of inactivity), the first `set_context` or dwh query returns an error string asking us to call `welcome` first. The artifact handles this transparently: it catches the error, briefly shows "Reconnecting to Carta…" above the shimmer, calls `welcome` itself, and retries the original call once.
- **Cowork-only.** Live Artifacts only render in Cowork. If the user is in Claude Code or Claude Desktop, explain that the artifact view requires Cowork. For inline data answers, point them at the `carta-explore-data` skill.
