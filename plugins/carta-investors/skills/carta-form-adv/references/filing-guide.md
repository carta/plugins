# Form ADV — Interactive Filing Guide

<!-- Design note: output format evolution
     v1: PDF (reportlab) + Excel (openpyxl) generators. Both required runtime `pip install`
     fallbacks that silently fail on Windows (sys.executable points to a uv-managed shim
     without a writable pip environment) and required users to navigate to a /tmp file path.

     v2 (current): HTML artifact as the primary output — zero Python dependencies, saved
     to the temp dir with its path surfaced so the user opens it in a browser, works identically on
     macOS and Windows.
     Blue/orange badge system (Carta-filled vs. must-enter-in-IARD) is interactive in HTML.

     Excel is back (v2.1): form_adv_excel_generator.py uses PEP 723 inline metadata so
     `uv run` resolves openpyxl automatically — no pip fallback needed. Generated alongside
     the HTML artifact for users who prefer a spreadsheet they can annotate offline.
-->

After running Query 1, Query 2, Query 3, **and Query 4**, generate both artifacts. This is mandatory — the artifacts are the skill's deliverable, not a supplementary export.

Tell the user once at the start: *"Building your Form ADV interactive filing guide and Excel reference..."*

### Step 1 — Build the data file

Extract values from Query 1, Query 2, Query 3, and Query 4. Use the `Write` tool to create `~/.cache/carta-form-adv/form_adv_data.json`:

```json
{
  "firm_name": "<firm display name>",
  "reporting_date": "<YYYY-MM-DD>",
  "funds": [
    { "<all columns from each row returned by Query 1>" }
  ],
  "investor_demographics": {
    "<fund_uuid>": { "<all columns from Query 2 for that fund>" }
  },
  "firm_aggregates": {
    "<the single row returned by Query 3 — all columns>"
  },
  "lp_nav_by_currency": [
    { "<one object per row returned by Query 4 — reporting_currency, total_lp_nav, us_lp_nav, non_us_lp_nav, pct_non_us_lp_nav>" }
  ]
}
```

Use actual query result values — no placeholders. *Lowercase all JSON keys* — the data warehouse returns column names in UPPERCASE (`FUND_NAME`, `FAIR_MARKET_VALUE`, etc.) but the artifact generators read lowercase snake_case (`fund_name`, `fair_market_value`). If you copy the column names as-is, every field renders as `undefined`.

> **Currency.** Query 1 returns a `reporting_currency` column on every fund row; keep it in the `funds` array (it comes through automatically when you copy all columns). Carta does not convert currencies, so both generators handle it the same way:
>
> - Every fund's amounts use that fund's own `reporting_currency`. The HTML guide formats them with the currency symbol; the Excel file prefixes the ISO code (`EUR 1,234,567`). A fund with no currency set shows a plain number.
> - Firm-level amounts (Item 5.F, balance sheet components, asset composition) are subtotals per currency. When every fund shares one currency there is one set. When funds report in more than one currency (a fund with no currency set counts as its own group), there is no grand total: each currency gets its own subtotal, with the mixed-currency note both artifacts show.
> - Fund counts and distinct LP counts are not amounts and stay firm-wide.
> - Item 5.H LP NAV comes from `lp_nav_by_currency` (Query 4), one row set per currency. `lp_nav_by_currency` is an array of `{reporting_currency, total_lp_nav, us_lp_nav, non_us_lp_nav, pct_non_us_lp_nav}`; a NULL `reporting_currency` stays NULL. `us_lp_nav`, `non_us_lp_nav` and the share count only LPs with a country on file, so the two shares add to 100%; when none has a country the share is NULL and both artifacts show `—`, never 0%. If the key is missing, the NAV cells show `—` with a warning, and per-fund NAV is never summed across currencies. The non-US share of LP NAV is one percentage per currency, and shares in different currencies cannot be combined without converting the amounts behind them. When the firm has more than one NAV row or more than one fund currency, both artifacts label each NAV share with its currency, and the HTML checklist step for Item 5.H tells the user to convert before filing. The Excel Item 5.H table shows a single labelled share when there is one NAV row and points to the per-currency NAV table when there are several.

> **Why `firm_aggregates` is required:** The artifact generators read firm-level distinct-LP counts (Items 5.D, 5.H) directly from this block. Without it, both generators fall back to summing per-fund counts, which double-counts any LP committed to multiple funds. If `firm_aggregates` is missing, the artifacts will emit a visible "⚠ Counts may be inflated (LPs committed to multiple funds are double-counted)" banner.

### Step 2 — Generate the artifact

```bash
TMPDIR=$(uv run python -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py \
  --data ~/.cache/carta-form-adv/form_adv_data.json \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.html"
```

### Step 3 — Generate Excel filing reference

Run immediately after Step 2 (reuses the same JSON data file):

```bash
TMPDIR=$(uv run python -c "import tempfile; print(tempfile.gettempdir())")
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py \
  --data ~/.cache/carta-form-adv/form_adv_data.json \
  --title "<FirmName> — Form ADV <Year>" \
  --out "${TMPDIR}/FormADV_<FirmName>_<Year>.xlsx"
```

Tell the user the file path, substituting the resolved `$TMPDIR` value from the shell command above (e.g. `/tmp/FormADV_…` on macOS/Linux, `C:\Users\…\AppData\Local\Temp\FormADV_…` on Windows):
> *"Your Form ADV Excel filing reference has been saved to `<resolved-tmpdir>/FormADV_<FirmName>_<Year>.xlsx`. Open it in Excel or Google Sheets. Blue cells are pre-filled from Carta — orange cells must be entered manually in IARD. The **Manual Fields** sheet lists every field requiring manual entry, organized by ADV item."*

### Step 4 — Surface the HTML file

Tell the user the file path, substituting the resolved `$TMPDIR` value:
> *"Your filing guide has been saved to `<resolved-tmpdir>/FormADV_<FirmName>_<Year>.html`. Open this file in your browser to view it. It has three tabs: Firm Overview (Items 5.D, 5.F, 5.H), Per-Fund Detail (Schedule D §7.B.(1) for each fund, expandable), and an IARD Checklist. Blue badges are pre-filled from Carta — orange badges need to be entered manually in IARD. Use File → Print → Save as PDF to export."*
