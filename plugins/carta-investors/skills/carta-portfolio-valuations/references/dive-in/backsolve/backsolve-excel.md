# Backsolve — Excel Output

Two paths depending on environment. Detect first, then follow the matching path.

---

## Environment detection

Run at the start of this reference — do not skip:

```
ToolSearch({ query: "excel worksheet workbook", max_results: 3 })
```

- **If results include tools with "excel", "worksheet", or "workbook" in their name**:
  → **In-sheet mode** — write inputs and live formulas directly into the user's current
  sheet. Do NOT generate a file.
- **Otherwise** → **File mode** — use the Python script to produce a `.xlsx` file.

Store the result as `excel_mode = "insheet" | "file"` for the rest of this flow.

---

## In-sheet mode (Claude for Excel detected)

### Step 1 — Ask where to insert

Ask inline as plain text:

> "Where should I insert the backsolve model in your current sheet?
> 1. **Starting at cell A1** of the active sheet (or tell me a different cell, e.g. D5)"

Wait for the reply. Capture the starting cell — call it **BASE** (e.g. `A1`, `D5`).
From BASE derive:
- **BASE_COL** = column letter of BASE (e.g. `A`)
- **BASE_ROW** = row number of BASE (e.g. `1`)
- **VAL_COL** = column one step right of BASE_COL (e.g. `B` if BASE_COL is `A`)

All cell references below are concrete addresses substituting BASE_ROW and the derived columns.

### Step 2 — Write the inputs block

Write the following cells to the current sheet:

| Cell | Content | Format |
|---|---|---|
| `BASE_COL & BASE_ROW` | `"Backsolve Calculator — {company name}"` | Bold |
| `BASE_COL & BASE_ROW+2` | `"INPUTS"` | Bold, underline |
| `BASE_COL & BASE_ROW+3` | `"Computed Backsolve Equity Value  S  (OPM goal-seek result)"` | — |
| `VAL_COL & BASE_ROW+3` | `{currentBacksolve.backsolveEquityValue as a number}` | Number `#,##0.00` — **not approachEquityValue** |
| `BASE_COL & BASE_ROW+4` | `"Volatility  σ"` | — |
| `VAL_COL & BASE_ROW+4` | `{equityVolatilityManualEntry as a number, e.g. 0.10}` | Number `0.00%` |
| `BASE_COL & BASE_ROW+5` | `"Risk-Free Rate  r"` | — |
| `VAL_COL & BASE_ROW+5` | `{riskFreeRateWeightedTte as a number}` | Number `0.00%` |
| `BASE_COL & BASE_ROW+6` | `"Time to Exit  T  (years)"` | — |
| `VAL_COL & BASE_ROW+6` | `{weightedTimeToExit as a number}` | Number `0.00` |

After writing, note the **absolute cell addresses** for the four inputs — these are
referenced in all formula cells. Use `$` for absolute references:

```
S_CELL   = $VAL_COL$ROW+3    (e.g. $B$4 if BASE is A1, so S is at B3+1=B4... adjust for actual rows)
VOL_CELL = $VAL_COL$ROW+4
R_CELL   = $VAL_COL$ROW+5
T_CELL   = $VAL_COL$ROW+6
```

### Step 3 — Write the breakpoints block

Write a section header at `BASE_COL & BASE_ROW+8`: `"BREAKPOINTS"` (bold).

Write column headers at `BASE_ROW+9`:

| Offset from BASE_COL | Header |
|---|---|
| +0 | Band |
| +1 | From |
| +2 | To (Strike K) |
| +3 | d1 |
| +4 | d2 |
| +5 | C(K) |
| +6 | Prev C(K) |
| +7 | ΔV (Incremental) |
| +8 | Description |

Write one row per breakpoint from `allocation.breakpoints`, starting at `BASE_ROW+10`.
For breakpoint band `n` (1-indexed), at data row `DR = BASE_ROW+9+n`:

| Column offset | Content |
|---|---|
| +0 | `"Band {n}"` |
| +1 | `{from value}` — the lower boundary (0 for Band 1) |
| +2 | `{to value}` — the upper boundary, or `"∞"` (text) for the last band |
| +3 | **d1 formula** (see below; `"—"` text if last band / K=∞) |
| +4 | **d2 formula** (see below; `"—"` text if last band / K=∞) |
| +5 | **C(K) formula** (see below; literal `0` if last band / K=∞) |
| +6 | **Prev C(K)** — `=S_CELL` for Band 1; `={C(K) cell of previous row}` for Band n>1 |
| +7 | **ΔV formula** — `={PrevC cell} - {C(K) cell}` |
| +8 | `{description}` — the band's waterfall description text |

**Formula patterns** (substitute actual cell addresses; K is the hardcoded `to` value in col +2):

```excel
d1   = (LN(S_CELL / K_CELL) + (R_CELL + VOL_CELL^2/2) * T_CELL) / (VOL_CELL * SQRT(T_CELL))
d2   = {d1_cell} - VOL_CELL * SQRT(T_CELL)
C(K) = S_CELL * NORM.S.DIST({d1_cell}, TRUE) - K_CELL * EXP(-R_CELL * T_CELL) * NORM.S.DIST({d2_cell}, TRUE)
```

`K_CELL` = the cell in col +2 of that row (the hardcoded strike).
`S_CELL`, `VOL_CELL`, `R_CELL`, `T_CELL` = absolute input cell addresses from Step 2.

**Last band (K=∞):** write `"—"` in d1/d2, `0` in C(K). ΔV = `={PrevC cell}`.

### Step 4 — Write the allocation block

After the breakpoints block (leave one blank row), write `"ALLOCATION"` header (bold).

Write column headers: Class | Shares | OIP | [Band 1 ΔV%] | [Band 2 ΔV%] | … | Total Class Value | Value per Share

For each entry in `allocation.totals`, write one data row:
- **Class**: the share class name
- **Shares**: hardcoded quantity
- **OIP**: hardcoded original issue price
- **Band n column**: `={ΔV cell for band n} * {sc_percentage for this class in band n}` — the percentage is hardcoded from `allocation.breakpoints[n].scPercentages[classKey]`; if the class has no participation in that band (0%), write `0`
- **Total Class Value**: `=SUM({band columns for this row})`
- **Value per Share**: `={Total Class Value cell} / {Shares}` (or `0` if Shares is 0)

### Step 5 — Write the equity adjustment block (if applicable)

If `get:equity_adjustment` data is in context (fetch it if not), write a final
`"EQUITY ADJUSTMENT"` section below the allocation block.

Inputs:
- Override Base Value — hardcoded from `backsolveEquityValueOverride` (or `backsolveEquityValue` if no override is set)
- Percentage Adjustment — hardcoded from `equityAdjustment` (as a decimal, e.g. 0.15)
- New Capital Raised — hardcoded from `newCapitalRaised`

Result formula:
```excel
= Override_cell * (1 + PctAdj_cell) + NewCapital_cell
```

### Step 6 — Confirm

After writing all cells:

> "Done — the backsolve model is in your sheet starting at {BASE}. Edit the yellow
> **Inputs** cells (S, σ, r, T) and the breakpoints and allocation recalculate
> automatically."

---

## File mode (no Excel tools detected)

Use the Python script to generate a standalone `.xlsx` file.

### Step 1 — Save API responses

```bash
BACKSOLVE_JSON=$(mktemp /tmp/backsolve_XXXXXX.json)
printf '%s' '<the raw get:backsolve JSON string>' > "$BACKSOLVE_JSON"

# Optional — pre-fills Equity Adjustment tab:
ADJ_JSON=$(mktemp /tmp/backsolve_adj_XXXXXX.json)
printf '%s' '<the raw get:equity_adjustment JSON string>' > "$ADJ_JSON"
```

### Step 2 — Run the script

```bash
COMPANY_SLUG="${COMPANY_NAME// /_}"
OUTPUT_PATH="/tmp/backsolve_${COMPANY_SLUG}.xlsx"

# Without equity adjustment:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/backsolve_calculator.py" \
  --excel "$OUTPUT_PATH" \
  --input "$BACKSOLVE_JSON"

# With equity adjustment:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-portfolio-valuations/scripts/backsolve_calculator.py" \
  --excel "$OUTPUT_PATH" \
  --input "$BACKSOLVE_JSON" \
  --equity-adjustment-input "$ADJ_JSON"
```

### Step 3 — Tell the user

> "Your backsolve workbook is ready at `{OUTPUT_PATH}`. Open it in Excel — edit the
> yellow input cells and all formulas recalculate automatically. The
> **Equity Adjustment** tab lets you model overrides and percentage markups."

The workbook has four sheets: **Inputs** (yellow editable cells), **Breakpoints**
(live `NORM.S.DIST` formulas), **Allocation** (per-class distribution), and
**Equity Adjustment** (override/markup/new capital formula).

**Note on the equity value:** the **Inputs** sheet shows `currentBacksolve.backsolveEquityValue`
— the raw OPM goal-seek result before any override or percentage adjustment. The adjusted
value lives in the **Equity Adjustment** tab.
