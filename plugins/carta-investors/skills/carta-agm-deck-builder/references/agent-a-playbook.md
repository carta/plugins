# Agent A: Fund Data Fetcher — Playbook

**Your job**: fetch fund data from the Carta MCP via a single precompute call and return assembled `fund_data` JSON.

## Rules (read first)

- **Do NOT call `discover` or `list_accounts`.** Every command you need is named below.
- **Do NOT guess command names.**
- **Call `welcome`, `list_contexts`, `set_context` exactly once each.** After `set_context` succeeds, do NOT re-call them.
- **Total MCP tool calls: 4.** 3 connect calls + 1 fetch. Do NOT fall back to the old multi-call pattern (`fa:list:saved_queries` → `fa:get:saved_query` → `dwh:execute:queries`) unless explicitly told to.

## Exact command names

| Tool | Command string | Use |
|---|---|---|
| `fetch` | `fa:get:agm_deck_data` | Fetch all AGM query results in one call — no parameters needed |

## Step-by-step sequence

### Phase 1 — Connect (3 calls)

1. `mcp__claude_ai_carta__welcome()` → if it fails, skip to Fallback below
2. `mcp__claude_ai_carta__list_contexts()` → find the target firm, note its UUID
3. `mcp__claude_ai_carta__set_context(firm_id="<firm_uuid>")` → done, never call these again

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-agm-deck-builder", checkpoint_label="data_retrieval_started")` before proceeding.

### Phase 2 — Precompute all AGM data (1 call)

4. Call `fa:get:agm_deck_data` with no parameters — the firm context set above is sufficient:

```
fetch(command="fa:get:agm_deck_data")
```

The MCP returns a two-block response:
- **Block 1 (text, you read this)**: a compact ack JSON: `{query_count, succeeded, failed, execution_time_ms, bytes}`. Use this to check how many queries succeeded.
- **Block 2 (blob, auto-saved to disk)**: the full dataset as a JSON file. Claude Code auto-persists it; you receive the file path.

### Phase 3 — Extract the blob into per-query files

The blob is a single-line JSON file (3–5 MB). The `Read` tool rejects files this large. Use the bundled extraction script to split it into one small JSON file per query that you can `Read` individually.

**Which Bash to use — pick the first one that works:**

**Option A — local `Bash` tool** (preferred; has access to Mac paths):
```bash
python3 "${CLAUDE_PLUGIN_ROOT}/skills/carta-agm-deck-builder/scripts/extract_agm_blob.py" <blob_path>
```

**Option B — `mcp__workspace__bash`** (Linux container; use when local Bash is unavailable):

`$CLAUDE_PLUGIN_ROOT` and the blob path are Mac paths the container can't see. Resolve both with these two commands — **run them first, before anything else**:

```bash
# 1. Find the plugin mount (one call — no exploratory loop needed)
PLUGIN_DIR=$(ls /sessions/$(hostname)/mnt/ | grep "^plugin" | head -1)
SCRIPT="/sessions/$(hostname)/mnt/${PLUGIN_DIR}/skills/carta-agm-deck-builder/scripts/extract_agm_blob.py"
echo "Script: $SCRIPT"

# 2. Find the blob in the session tool-results mount
#    The blob_path from the MCP result is a Mac path like /var/folders/hz/.../tool-results/<file>
#    Strip the filename and look for it under the session mount:
BLOB_FILE=$(basename "<blob_path>")
BLOB_WS=$(find /sessions/$(hostname)/ -name "$BLOB_FILE" 2>/dev/null | head -1)
echo "Blob: $BLOB_WS"

# 3. Run the script
python3 "$SCRIPT" "$BLOB_WS"
```

The script prints one line per query and a final index path:

```
OK   | Fund Performance Summary     |  1 rows | /tmp/agm-queries/fund_performance_summary.json
OK   | NAV Trend                    | 24 rows | /tmp/agm-queries/nav_trend.json
FAIL | Asset Type Breakdown         | error: <message>
DONE | 20/21 succeeded | dir=/tmp/agm-queries | time=4200ms
INDEX: /tmp/agm-queries/_index.json
```

**Read the index file first** (`_index.json`) — it maps every query name to its file path and row count. Then `Read` individual query files as needed when building each slide.

**Track the blob path** — record the blob file path returned by the MCP as `BLOB_PATH`. Pass it back to the orchestrator alongside `fund_data` so Step 4 can delete it during cleanup.

### Phase 4 — Build `fund_data` and return results

The per-query JSON files written by `extract_agm_blob.py` have this shape:

```json
{
  "query_name": "Fund Performance Summary",
  "columns": ["col1", "col2"],
  "rows": [
    {"col1": "val1", "col2": "val2"},
    "..."
  ],
  "total_rows": 42
}
```

**🚨 Always access row fields by name, never by index.**
`row["corporation_name"]` ✅ — `row[2]` ❌
The MCP column order is not guaranteed and will silently produce wrong values if accessed positionally.

The raw blob (before extraction) has this shape:
  "metadata": {
    "firm_uuid": "...",
    "query_count": 21,
    "succeeded": 20,
    "failed": 1,
    "execution_time_ms": 4200
  }
}
```

**Canonical query names and their slides** (all results are keyed by these exact names):

| Query name | Slide |
|---|---|
| `Annual Markups / Markdowns` | Slide 16 |
| `Asset Type Breakdown` | Slide 13 |
| `Capital Deployment / Dry Powder` | Slide 7 |
| `Deal-Level IRR` | Slide 17 |
| `Financing Round History` | Slide 22 |
| `Fund Expenses Breakdown` | Slide 27 |
| `Fund IRR vs. Benchmarks` | Slide 4 |
| `Fund Performance Summary` | Slides 1, 3, 6 |
| `Geographic Portfolio Mix` | Slide 18 |
| `Investment Detail & Performance` | Slide 11b |
| `Investment Performance Buckets` | Slide 14 |
| `Logo Leaderboard` | Slide 12b |
| `LP Geography` | Slide 10 |
| `NAV Trend` | Slide 5 |
| `Portfolio Company Deep Dives` | Slide 25 |
| `Portfolio Company Logo Grid` | Slide 12 |
| `Portfolio KPI Highlights` | Slide 20 |
| `Portfolio Overview` | Slide 11 |
| `Profitability Milestone Tracker` | Slide 21 |
| `SPV Performance Table` | Slide 19 |
| `Top Performing Investments` | Slide 15 |

Build `fund_data` keyed by slide name from the blob's `queries` dict. Note any failed queries (non-null `error`) for the user at the end. Logo URLs in "Portfolio Company Logo Grid" are already resolved — use them directly in Slide 12.

**`firm_logo_url`**: the blob metadata also includes a `firm_logo_url` field — a pre-signed S3 URL for the firm's own logo (same format as portfolio company logos). Always extract and pass this back alongside `fund_data`. It takes priority over website extraction in Step 3b.

> **Checkpoint**: Call `mcp__<SERVER>__skill_checkpoint(skill_name="carta-investors:carta-agm-deck-builder", checkpoint_label="data_retrieval_finished")` before proceeding.

Pass `fund_data`, `firm_logo_url` (or `null` if absent), and the blob path to the deck generation agent.

## Fallback (no MCP or precompute fails)

If `welcome()` fails, show the user:

> *Carta MCP is not connected, so I'll need you to provide the fund data manually.*
>
> *Tip: connecting the Carta MCP lets this skill pull live fund performance data automatically. To set it up, run `/carta-mcp:setup-mcp`.*

If `fa:get:agm_deck_data` returns an error or `succeeded == 0`, fall back to the old multi-call pattern:

1. `fetch(command="fa:list:saved_queries")` → get verified queries
2. `fetch(command="fa:get:saved_query", params={"names": [<all 21 names above>]})` — one call with all names
3. Execute all matched SQLs via `dwh:execute:queries` — batches of ≤10, all batches issued in one response turn simultaneously

Accept fund data in any format (pasted tables, JSON, conversational) only if the above fallback also fails. **Do NOT generate fictional or sample data for real deck requests — only use data the user explicitly provides.** If the user explicitly says "demo mode" or "use sample data for testing", you may generate realistic fictional data, but prepend every slide's title with "[DEMO DATA — NOT REAL]" so it cannot be mistakenly shared with LPs.
