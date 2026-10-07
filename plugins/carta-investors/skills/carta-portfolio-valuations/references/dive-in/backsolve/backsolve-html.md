# Backsolve — Interactive HTML Calculator

Generates a self-contained interactive HTML calculator with live Black-Scholes
computation in the browser. Entered when the user asks for an artifact, an
interactive calculator, an HTML file, or wants to open the backsolve in a browser.

Requires `get:backsolve` data in context. If not already fetched, call both in
parallel (see `backsolve-explained.md` § "Data to fetch").

---

## What the HTML file contains

A single self-contained file (no external dependencies, works offline):

- **Inputs** — editable fields for Computed Backsolve Equity Value S, Volatility σ,
  Risk-Free Rate r, Time to Exit T. All breakpoints and allocations recalculate
  in real time as the user types.
- **Black-Scholes formula** — rendered formula block for reference.
- **Breakpoints table** — live d1, d2, C(K), and ΔV columns per band.
- **Per-Class Allocation table** — distributes incremental band values to each
  share class, showing total class value and value per share.
- **Equity Adjustment section** — separate inputs for Override Base Value,
  Percentage Adjustment (%), and New Capital Raised. Live formula display and
  Approach Equity Value result box. Override defaults to S and tracks it unless
  the user edits it manually.

---

## How to generate

**Step 1 — Save the API response to a temp file:**

```bash
BACKSOLVE_JSON=$(mktemp /tmp/backsolve_XXXXXX.json)
printf '%s' '<the raw get:backsolve JSON string>' > "$BACKSOLVE_JSON"
```

**Step 2 (optional) — Save the equity adjustment response:**

```bash
ADJ_JSON=$(mktemp /tmp/backsolve_adj_XXXXXX.json)
printf '%s' '<the raw get:equity_adjustment JSON string>' > "$ADJ_JSON"
```

**Step 3 — Run the script:**

```bash
COMPANY_SLUG="${COMPANY_NAME// /_}"
OUTPUT_PATH="/tmp/backsolve_${COMPANY_SLUG}.html"

# Without equity adjustment data:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/backsolve_calculator.py" \
  --html "$OUTPUT_PATH" \
  --input "$BACKSOLVE_JSON"

# With equity adjustment data (pre-fills the Equity Adjustment section):
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/backsolve_calculator.py" \
  --html "$OUTPUT_PATH" \
  --input "$BACKSOLVE_JSON" \
  --equity-adjustment-input "$ADJ_JSON"

echo "Saved to: $OUTPUT_PATH"
```

---

## After generating

Render with `view_static` if it's available in this session, regardless
of `env_mode` — check tool availability directly rather than branching on
the rendering mode:

```
view_static path="$OUTPUT_PATH"
```

If `view_static` is unavailable, give the file path directly instead:

> "Your interactive backsolve calculator is at `{OUTPUT_PATH}`. Open it in any
> browser — edit the inputs and everything recalculates instantly. The
> **Equity Adjustment** section at the bottom lets you model overrides and
> percentage markups on top of the computed value."

Do not proactively offer further changes. Return control.
