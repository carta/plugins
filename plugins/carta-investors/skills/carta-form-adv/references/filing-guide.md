# Form ADV — Interactive Filing Guide

After running Query 1, Query 2, Query 3, **and Query 4**, build both files. This is mandatory — the guide and the Excel file are the skill's deliverable, not a supplementary export.

Tell the user once at the start: *"Building your Form ADV interactive filing guide and Excel reference..."*

### Step 1 — Resolve the folder for the files

Both files go in `<WORKDIR>`, a folder the user can open. Never a temp directory: a Cowork host cannot see one, and its path differs per platform. Run each command below as its own Bash call, exactly as written:

1. `test -d "$HOME/mnt/outputs"` — succeeds in Cowork, where `mnt/outputs/` is the session's outputs folder, readable by the host too. `<WORKDIR>` is `$HOME/mnt/outputs/carta-form-adv`.
2. Otherwise `pwd`. `<WORKDIR>` is that directory plus `/carta-form-adv` — the user's working folder.

Write `<WORKDIR>` literally into the commands below (for the first case, `$HOME/mnt/outputs/carta-form-adv`, inside the double quotes so the shell expands it). The generators create the folder.

### Step 2 — Build the data file

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

Use actual query result values — no placeholders. *Lowercase all JSON keys* — the data warehouse returns column names in UPPERCASE (`FUND_NAME`, `FAIR_MARKET_VALUE`, etc.) but the generators read lowercase snake_case (`fund_name`, `fair_market_value`). If you copy the column names as-is, every field renders as `undefined`.

> **Currency.** Query 1 returns a `reporting_currency` column on every fund row; keep it in the `funds` array (it comes through automatically when you copy all columns). Carta does not convert currencies, so both generators handle it the same way:
>
> - Every fund's amounts use that fund's own `reporting_currency`. The HTML guide formats them with the currency symbol; the Excel file prefixes the ISO code (`EUR 1,234,567`). A fund with no currency set shows a plain number.
> - Firm-level amounts (Item 5.F, balance sheet components, asset composition) are subtotals per currency. When every fund shares one currency there is one set. When funds report in more than one currency (a fund with no currency set counts as its own group), there is no grand total: each currency gets its own subtotal, with the mixed-currency note both files show.
> - Fund counts and distinct LP counts are not amounts and stay firm-wide.
> - Item 5.H LP NAV comes from `lp_nav_by_currency` (Query 4), one row set per currency. `lp_nav_by_currency` is an array of `{reporting_currency, total_lp_nav, us_lp_nav, non_us_lp_nav, pct_non_us_lp_nav}`; a NULL `reporting_currency` stays NULL. `us_lp_nav`, `non_us_lp_nav` and the share count only LPs with a country on file, so the two shares add to 100%; when none has a country the share is NULL and both files show `—`, never 0%. If the key is missing, the NAV cells show `—` with a warning, and per-fund NAV is never summed across currencies. The non-US share of LP NAV is one percentage per currency, and shares in different currencies cannot be combined without converting the amounts behind them. When the firm has more than one NAV row or more than one fund currency, both files label each NAV share with its currency, and the HTML checklist step for Item 5.H tells the user to convert before filing. The Excel Item 5.H table shows a single labelled share when there is one NAV row and points to the per-currency NAV table when there are several.

> **Why `firm_aggregates` is required:** The generators read firm-level distinct-LP counts (Items 5.D, 5.H) directly from this block. Without it, both generators fall back to summing per-fund counts, which double-counts any LP committed to multiple funds. If `firm_aggregates` is missing, both files emit a visible "⚠ Counts may be inflated (LPs committed to multiple funds are double-counted)" banner.

### Step 3 — Generate the filing guide

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/generate_form_adv_artifact.py --data ~/.cache/carta-form-adv/form_adv_data.json --title "<FirmName> — Form ADV <Year>" --out "<WORKDIR>/FormADV_<FirmName>_<Year>.html"
```

In `<FirmName>` for the file name, replace spaces with underscores and drop other punctuation. The script prints the HTML file's absolute path; use that path from here on.

The HTML is one self-contained file: the data, styles and script are inline and it loads nothing from the network. Never edit it by hand; re-run the script.

### Step 4 — Generate the Excel filing reference

Run immediately after Step 3 (reuses the same JSON data file):

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/scripts/form_adv_excel_generator.py --data ~/.cache/carta-form-adv/form_adv_data.json --title "<FirmName> — Form ADV <Year>" --out "<WORKDIR>/FormADV_<FirmName>_<Year>.xlsx"
```

It prints the Excel file's absolute path. An Excel workbook cannot be an artifact, so it is always delivered as this saved file.

### Step 5 — Deliver the filing guide

**With the `Artifact` tool** (loaded, or loaded with `ToolSearch` `select:Artifact` as `SKILL.md` Step 4 says): publish the HTML from Step 3 as an artifact. First look for an existing one:

```
Artifact({action: "list", scope: "mine"})
```

If an artifact titled `<FirmName> — Form ADV <Year>` is already published, keep its `url`. Then publish — one call either way, `url` being the only difference:

```
Artifact({
  file_path: "<absolute path Step 3 printed>",
  url: "<url from the list — omit entirely on a first publish>",
  title: "<FirmName> — Form ADV <Year>",
  description: "<FirmName> — Form ADV Part 1A filing guide as of <reporting_date>",
  favicon: "📋"
})
```

The data is baked into the page and it makes no calls to Carta, so the call carries no `capabilities`. Keep `title` and `favicon` the same on every re-run so the same artifact updates in place. Keep the `url` the publish returned for the acknowledgment.

If the publish fails, deliver the saved file as below and say so (see the `Artifact` publish row of Error Handling in `SKILL.md`).

**Without the `Artifact` tool**: the HTML saved in Step 3 is the deliverable. Keep its full path for the acknowledgment, and tell the user to open it in a browser and that File → Print → Save as PDF exports it.

### Step 6 — Keep the Excel path

Keep the full path Step 4 printed for the acknowledgment.

`SKILL.md` Step 5 sends the one acknowledgment, with the artifact link or the HTML path and the Excel path. Do not send a separate message for each file.
