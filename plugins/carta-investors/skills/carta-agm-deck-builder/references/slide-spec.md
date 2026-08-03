# AGM Deck — Slide Specification & Validation Guide

This file is a companion to `template.html`. For each slide it defines:
- **Data source** — which MCP query populates it
- **Required content** — what must be present for the slide to be included
- **Headline guidance** — how to write the `{{HEADLINE_PLAIN}}` + `{{HEADLINE_EM}}` tokens
- **Checksums** — cross-field consistency rules to verify before outputting
- **Common errors** — failure patterns seen in past runs

Skip a slide only when its **Required content** is completely absent from the query result. Partial data → still render the slide (omit the specific missing value).

---

## Slide 01 — Cover

**Data source:** No query — uses global inputs (firm name, period, as-of date).

**Required content:** Always render. Never skip.

**Headline guidance:**
- `{{COVER_HERO_LINE1}}` — one line that names what the firm does or invests in, without specifics
- `{{COVER_HERO_EMPHASIS}}` — a punchy phrase completing the thought (goes in `<em>`)
- Pattern: "Investing in the / _future of [sector]._" or "Building the / _financial infrastructure of [region]._"
- `{{COVER_STANDFIRST}}` — 1-2 sentences: number of funds reviewed, total period, as-of date. Pull from fund count + period inputs.

**Checksums:** None (no query data).

---

## Slide 02 — Agenda

**Data source:** Auto-generated from the set of active slides after Step 3a.

**Required content:** Always render. Never skip.

**Guidance:**
- List every active slide by number and title in the order they appear in the deck.
- Split 50/50 across two columns: left = first half, right = second half.
- `{{AGENDA_HEADLINE_PLAIN}}` + `{{AGENDA_HEADLINE_EM}}` — write a 1-line description of the deck's theme (e.g. "Performance, portfolio, and the _path ahead._")

---

## Slide 03 — Fund Performance Summary

**Data source:** `Fund Performance Summary` query (AGGREGATE_FUND_METRICS).

**Required content:** At least `total_nav`, `fund_count`, and at least 2 rows for the TVPI chart.

**Headline guidance:**
- `{{PERF_HEADLINE_PLAIN}}` — "N funds." (N = active fund count from query)
- `{{PERF_HEADLINE_EM}}` — "$X.XXB in total value created." (total_value from query)
- `{{PERF_PERIOD_EYEBROW}}` — "Fund performance · [period label]"

**KPI mapping:**
| Token | Field | Format |
|---|---|---|
| `{{TOTAL_NAV}}` | `total_nav` | `$X.XXB` or `$XXXM` |
| `{{TOTAL_VALUE}}` | `total_value` (NAV + cumulative distributions) | `$X.XXB` |
| `{{DISTRIBUTIONS}}` | `total_distributions` | `$X.XXB` or `$XXXM` |
| `{{ACTIVE_FUND_COUNT}}` | COUNT of funds with NAV > 0 | integer |

**Chart (TVPI hbar):**
- One row per fund, sorted by TVPI descending
- `"valueLabel"`: format as `"X.XX×"`
- `"series"`: 1 if TVPI ≥ 5×, 2 if 2–5×, 3 if 1–2×, 4 if < 1×
- `"max"`: highest TVPI value in the set

**Checksums:**
- `total_value` ≈ `total_nav` + `total_distributions` (±5% tolerance for rounding)
- Sum of per-fund TVPI chart values should plausibly correspond to the headline figure

---

## Slide 04 — Fund Net IRR

**Data source:** `Fund Performance Summary` query (AGGREGATE_FUND_METRICS).

**Required content:** At least 3 funds with non-null net IRR.

**Headline guidance:**
- `{{IRR_HEADLINE_PLAIN}}` — describe which vintages are leading (e.g. "Early vintages delivering")
- `{{IRR_HEADLINE_EM}}` — outcome phrase (e.g. "exceptional net returns.")
- `{{IRR_STANDFIRST}}` — 2-3 sentences: explain that older funds are mature/fully deployed, newer ones are in early J-curve. Always mention the lifecycle context.
- `{{HIGHEST_IRR_FUND}}` + `{{LOWEST_IRR_FUND}}` — actual fund names from query

**Chart (Net IRR hbar):**
- Sorted by IRR descending
- `"valueLabel"`: `"XX.X%"`
- `"series"`: 1 if IRR ≥ 30%, 2 if 20–30%, 3 if 5–20%, 4 if < 5%

**Checksums:**
- `{{HIGHEST_IRR_VALUE}}` must equal the first row's value in `{{IRR_CHART_ROWS}}`
- `{{LOWEST_IRR_VALUE}}` must equal the last row's value in `{{IRR_CHART_ROWS}}`

---

## Slide 05 — NAV by Fund

**Data source:** `Fund Performance Summary` query (AGGREGATE_FUND_METRICS).

**Required content:** At least 2 funds with NAV > 0.

**Headline guidance:**
- `{{NAV_HEADLINE_EM}}` — total NAV formatted (e.g. "$2.91B")
- `{{FUND_COUNT_LABEL}}` — spelled out: "nine funds", "five funds" (not a number)

**Donut + legend:**
- Segments sorted by NAV descending; top 8 individually, rest grouped as "Other funds"
- Legend: top 5 individually, then one grouped row for the remainder
- `"centerNumber"` = same as `{{NAV_HEADLINE_EM}}`
- Series colors 1–5 rotate across top 5 legend rows

**Checksums:**
- Sum of donut segment values ≈ `total_nav` from Slide 03 (same query)
- `{{NAV_DONUT_CENTER_NUMBER}}` must exactly match `{{NAV_HEADLINE_EM}}`

---

## Slide 05b — NAV Trend

**Data source:** `NAV Trend` query (MONTHLY_NAV_CALCULATIONS — year-end snapshots).

**Required content:** At least 3 year-end data points.

**Milestone layout (4 KPIs):**
- M1 (plain): earliest year-end in the dataset
- M2 (`ds-kpi-highlight`): peak year-end NAV
- M3 (`ds-kpi-highlight--2`): intermediate year that shows transition
- M4 (plain): most recent year-end (= as-of date year)

**Line chart:**
- Use only year-end snapshots, not monthly data
- `"yDomain"`: `[0, peak_nav_in_M * 1.15]` (15% headroom above peak)
- `"endLabel"`: same as M4 value

**Checksums:**
- M4 value must match `{{TOTAL_NAV}}` from Slide 03 (same underlying data)
- `{{NAV_TREND_VALUES}}` array length must match `{{NAV_TREND_XLABELS}}` array length

---

## Slide 06 — Multi-Fund Performance Table

**Data source:** `Fund Performance Summary` query (AGGREGATE_FUND_METRICS).

**Required content:** At least 3 funds with Committed, Called, NAV, TVPI, and IRR data.

**Headline guidance:**
- `{{MULTI_FUND_HEADLINE_PLAIN}}` — "N flagship funds."
- `{{MULTI_FUND_HEADLINE_EM}}` — "N years of [focus area] investing." (years = current year − earliest vintage year)

**Table rules:**
- Sorted by vintage ascending (oldest first)
- `.hi` class: apply when TVPI ≥ 2×, DPI ≥ 1×, or IRR ≥ 20%
- `.mute` class: apply to Vintage, Committed, Called, and DPI when DPI = 0.00×
- Missing Distributions → `<td class="mute">—</td>`

**Checksums:**
- Fund count in table must equal `{{ACTIVE_FUND_COUNT}}` from Slide 03
- Each fund's NAV in the table must match the corresponding donut segment in Slide 05

---

## Slide 07 — Capital Deployment

**Data source:** `Capital Deployment / Dry Powder` query (AGGREGATE_FUND_METRICS deployment fields).

**Required content:** At least 2 funds with called capital data.

**KPI layout (3 tiles):**
- KPI 1 (`ds-kpi-highlight--2`): newest fund dry powder = committed − called
- KPI 2 (plain): second-newest fund dry powder
- KPI 3 (`ds-kpi-highlight`): older funds status (e.g. "100%" if fully deployed)

**Chart (hbar, % deployed):**
- `"value"`: called ÷ committed × 100
- Sorted descending by deployment %
- `"series"`: 1 if ≥ 95%, 2 if 75–95%, 3 if 50–75%, 4 if < 50%

**Checksums:**
- Sum of called capital across all funds should roughly match sum of "Called" column in Slide 06 table (same query, different fields)

---

## Slide 11 — Portfolio Overview

**Data source:** `Portfolio Overview` query (AGGREGATE_INVESTMENTS — top holdings by FMV).

**Required content:** At least 4 companies with FMV data.

**Headline guidance:**
- `{{PORTFOLIO_HEADLINE_PLAIN}}` — "[Company with highest FMV] leads at"
- `{{PORTFOLIO_HEADLINE_EM}}` — "[FMV] — [Company with 2nd highest FMV] at [FMV]."
- Include currency indicator in the em phrase when FMV is not in USD (e.g. "£128.6M FMV")

**Chart (hbar):**
- Sorted by FMV descending; max 10 rows
- `"valueLabel"`: include currency prefix (e.g. "£128.6M", "$112.8M")
- Label format: "Company · Fund" (keep fund name for context)
- Use mixed series colors (1–4) to vary bar colors

**Checksums:**
- Sum of chart rows ≠ `total_nav` (these are investment-level FMV, not fund NAV) — do NOT assert equality
- Top company FMV in chart must match the value cited in `{{PORTFOLIO_HEADLINE_PLAIN}}`/`{{PORTFOLIO_HEADLINE_EM}}`

---

## Slide 11b — Investment Detail & Performance

**Data source:** `Investment Detail & Performance` query (AGGREGATE_INVESTMENTS — MOIC by investment).

**Required content:** At least 3 realized investments OR at least 3 unrealized investments with MOIC data.

**Left panel (Realized):** investments where proceeds > 0 and position is fully exited
**Right panel (Unrealized):** investments with current FMV > 0 and not fully exited

**Headline guidance:**
- `{{INVEST_HEADLINE}}` — pre-rendered HTML sentence. 1 realized exit: `"[Company] returned <em>[MOIC]</em>."` · 2+ realized exits: `"[Company A] returned <em>[MOIC]</em> &amp; [Company B] returned <em>[MOIC]</em>. Both fully realized."`

**KPIs below realized chart:**
- KPI 1 (`ds-kpi-highlight`): top realized investment — label = company name, value = total proceeds, note = "on $X.XM invested"
- KPI 2 (`ds-kpi-highlight--2`): second realized investment — same pattern

**Checksums:**
- `{{REALIZED_CHART_MAX}}` is derived from realized positions only; `{{UNREALIZED_CHART_MAX}}` is derived from unrealized positions only — the two panels use independent scales
- All "realized" companies must have proceeds > 0 in the query data

---

## Slide 12 — Portfolio Company Logo Grid

**Data source:** `Portfolio Company Logo Grid` query (AGGREGATE_INVESTMENTS — company logos and metrics).

**Required content:** At least 5 companies with name data (logos are optional; initials fallback always works).

**Column reference (access by name, never by index):**

| Field | Type | Use |
|---|---|---|
| `corporation_name` | string | Card label + `{{INITIALS}}` fallback |
| `logo_url` | string | `<img src>` — see validation rules below |
| `total_fmv` | number (**raw dollars**) | Divide by 1,000,000 for display → `$183.2M` |
| `total_invested` | number (**raw dollars**) | Divide by 1,000,000; MOIC = (fmv + proceeds) / invested |
| `entity_link_id` | string (UUID) | Ignore |
| `corporation_id` | string (UUID) | Ignore |
| `website_url` | string | Ignore — may be literal `"None"` string |

**`logo_url` validation — always check before using:**
A logo URL is usable only when it starts with `https://`. Treat all other values as missing and show the initials fallback:
- Valid: `"https://storage.example.com/..."`
- Missing (use initials): `""` (empty string), `"None"` (Python None serialised), `"static_files/..."` (internal server path)

**🚨 Copy the ENTIRE logo URL verbatim — including all query string parameters.**
These are pre-signed AWS S3 URLs containing embedded auth credentials (`AWSAccessKeyId`, `Signature`, `x-amz-security-token`, `Expires`). Truncating, summarising, or reconstructing the URL produces a 403 Forbidden error. Copy the full URL exactly as it appears in the JSON, character for character.

```html
<!-- Only set src when url starts with https://, otherwise skip the img tag entirely -->
<img src="{{LOGO_URL}}" alt="{{CORP_NAME}}"
     style="max-width:80px;max-height:36px;object-fit:contain;"
     onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
<div style="display:none;...">{{INITIALS}}</div>
```

**Grid rules:**
- 5-column × 5-row grid = max 25 companies
- Sorted by `total_fmv` descending
- Each card: logo (or initials fallback) + `corporation_name` + "$XXM · X.Xx" metric line
- `{{INITIALS}}`: first letter of each word, max 2 characters. Examples: "Acme Corp" → "AC", "Nu Holdings" → "N"
- Fallback circle background: rotate `var(--ds-accent-1)`, `var(--ds-accent-2)`, `var(--ds-accent-3)` across cards
- Logo `onerror`: always include the fallback div in the HTML (display:none becomes display:flex on error)

**Checksums:**
- Card count ≤ 25
- Each company shown here should also appear in Slide 11 (Portfolio Overview) if it's in the top 10

---

## Slide 13 — Asset Type Breakdown

**Data source:** `Asset Type Breakdown` query (AGGREGATE_INVESTMENTS grouped by security type).

**Required content:** At least 2 distinct asset types with FMV > 0.

**Headline guidance:**
- `{{ASSET_HEADLINE_EM}}` — "XX.X% of portfolio FMV in [top asset type]."

**Donut segment order** (always this order, omit if 0 value):
1. Preferred Equity
2. Common Equity
3. Fund Investment
4. Warrants
5. SAFE
6. Convertible Debt

**Legend rows:** same order as donut; include company count badge (`ds-pill`) for each type.

**Checksums:**
- Sum of donut segment percentages = 100% (±0.5% for rounding)
- `{{ASSET_DONUT_CENTER_NUMBER}}` = sum of all asset type FMV amounts

---

## Slide 14 — Investment Performance Buckets

**Data source:** `Investment Performance Buckets` query (AGGREGATE_INVESTMENTS bucketed by MOIC).

**Required content:** At least 3 non-empty buckets.

**Bucket definitions (MOIC thresholds applied to total MOIC = (FMV + proceeds) / cost):**
| Bucket | MOIC range |
|---|---|
| 10×+ | ≥ 10.0 |
| 3–10× | ≥ 3.0 and < 10.0 |
| 1–3× | ≥ 1.0 and < 3.0 |
| < 1× | > 0 and < 1.0 |
| 0× (written off) | FMV = 0 and proceeds = 0 |

**Card colors:** 10×+ → `ds-kpi-highlight`, 3–10× → `ds-kpi-highlight--2`, 1–3× → plain, < 1× → plain, 0× → plain.

**Headline guidance:**
- `{{BUCKETS_HEADLINE_EM}}` — "N companies returning 10× or more — from just $XXM invested." (focus on the highest-performing bucket)

**Checksums:**
- Sum of all bucket counts = `{{BUCKETS_TOTAL_COUNT}}`
- `{{BUCKETS_OUTPERFORM_COUNT}}` = count(10×+) + count(3–10×)
- `{{BUCKETS_CHART_MAX}}` = the largest single bucket count

---

## Slide 15 — Top Performing Investments

**Data source:** `Top Performing Investments` query (AGGREGATE_INVESTMENTS — highest MOIC positions).

**Required content:** At least 3 investments with MOIC ≥ 5×.

**Headline guidance:**
- `{{TOP_PERF_HEADLINE_PLAIN}}` — "N investments" where N = number of investments with MOIC ≥ threshold
- `{{TOP_PERF_HEADLINE_EM}}` — "returning XX× or better." (threshold = lowest MOIC shown in the chart)

**Callout blocks (right column):**
- Callout 1 (`ds-accent-1` border): #1 or #2 company by MOIC — label = "Fund N standout", title = company name, body = "$XXXM remaining value · XX.XX× MOIC on $X.XM invested"
- Callout 2 (`ds-accent-2` border): another top company from a different fund
- Callout 3 (rgba border): disclosure note if any investments are labeled "Undisclosed"

**Checksums:**
- `{{TOP_PERF_CHART_MAX}}` must equal the value of the first row in `{{TOP_PERF_CHART_ROWS}}`
- Callout body figures must match the corresponding chart row data

---

## Slide 18 — Geographic Portfolio Mix

**Data source:** `Geographic Portfolio Mix` query (AGGREGATE_INVESTMENTS grouped by country).

**Required content:** At least 1 geography with FMV data.

**🚨 Surface: paper (default) — never ds-dark for this slide.**

**🚨 Donut size is FIXED — do not change these values:**
```
"size": 380, "radius": 140, "thickness": 58
```
The grid column is `420px` wide. A larger donut will overflow and clip content.

**Headline guidance:**
- If one geography > 90% of FMV: "Predominantly [Geography]-focused with _selective international exposure._"
- If two geographies each > 20%: "Balanced exposure between _[Geo A] and [Geo B]._"

**Donut center:** dominant geography name + its % (e.g. "US by FMV" / "96%").

**Right panel:** use the `GEO_TABLE_ROWS` pattern from template.html (table rows with swatch + label + company count + FMV). Do NOT substitute bordered cards or any other layout.

**Table rows:** sorted by FMV descending; apply `ds-kpi-highlight` to largest region's company count, `ds-kpi-highlight--2` to second.

**Checksums:**
- Sum of donut segment percentages = 100% (±0.5%)
- Sum of FMV values across geography rows ≈ `{{ASSET_DONUT_CENTER_NUMBER}}` from Slide 13

---

## Slide 19 — SPV Performance

**Data source:** `SPV Performance Table` query (SPV-level fund metrics).

**Required content:** At least 2 SPVs with TVPI data.

**Headline guidance:**
- `{{SPV_HEADLINE_PLAIN}}` — "[Top SPV name] at"
- `{{SPV_HEADLINE_EM}}` — "X.XX× TVPI leads SPV returns."

**Checksums:**
- `{{SPV_TOP_TVPI}}` must equal the first row's value in `{{SPV_CHART_ROWS}}`
- `{{SPV_TOTAL_COUNT}}` must equal the number of rows in `{{SPV_CHART_ROWS}}`

---

## Slide 21 — Profitability Milestone Tracker

**Data source:** `Profitability Milestone Tracker` query (COMPANY_FINANCIALS — net income).

**Required content:** At least 3 companies with positive net income.

**Headline guidance:**
- `{{PROFIT_HEADLINE_EM}}` — "N portfolio companies"
- `{{PROFIT_HEADLINE_SUFFIX}}` — "reporting positive net income — led by [Co A], [Co B], and [Co C]." (first 3 in grid by FMV)

**Company grid:** 3 columns × N rows. Sort companies by FMV descending within the profitable set.

**Checksums:**
- `{{PROFIT_PROFITABLE_COUNT}}` = number of cells in `{{PROFIT_COMPANY_GRID}}`
- `{{PROFIT_REPORTING_COUNT}}` comes from a separate count in the query (total companies submitting P&L) — it should be ≥ `{{PROFIT_PROFITABLE_COUNT}}`

---

## Slide 22 — Financing Round History

**Data source:** `Financing Round History` query (AGGREGATE_INVESTMENTS — recent investments sorted by close date).

**Required content:** At least 4 recent investments (within the past 12 months relative to as-of date).

**Headline guidance:**
- `{{FINANCING_HEADLINE_PLAIN}}` — "N new investments" (count of rows)
- `{{FINANCING_HEADLINE_EM}}` — "across [Fund A], [Fund B], and [Fund C]." (list the 2–3 most active funds in this period)

**Table layout:**
- Split rows 50/50 between left and right columns
- Each column has its own header row
- Sorted by investment amount descending
- Apply `ds-kpi-highlight` to largest amount, `ds-kpi-highlight--2` to second

**Checksums:**
- Total rows across both columns = N from `{{FINANCING_HEADLINE_PLAIN}}`

---

## Slides 22b & 22c — Vintage IRR Comparisons

**Data source:** `Fund IRR vs. Benchmarks` query (TEMPORAL_FUND_COHORT_BENCHMARKS or AGGREGATE_FUND_METRICS).

**Required content:** At least 4 funds with IRR data across at least 2 vintage cohort groups.

**Cohort split guidance:**
- Slide 22b: earlier vintage cohorts (≤ median vintage year of the fund set)
- Slide 22c: later vintage cohorts (> median vintage year)
- Or split by natural breaks in performance profile (fully deployed vs. still investing)

**Both panels must share the same `max` value** (`{{VINTAGE_GLOBAL_MAX}}` / `{{RECENT_GLOBAL_MAX}}`) for consistent scale.

**Avg IRR:** arithmetic mean of IRR values in each cohort panel.

**Checksums:**
- All funds in 22b + all funds in 22c = the complete fund set (no fund should appear in both or be missing from both)
- `{{VINTAGE_GLOBAL_MAX}}` ≥ max IRR across all funds in both slides

---

## Slide 25 — IRR vs TVPI Cross-Reference

**Data source:** `Fund Performance Summary` query (same as Slides 03–07).

**Required content:** At least 4 funds with both IRR and TVPI data.

**Fund order:** both charts use the same fund order (sorted by vintage ascending within performance tier — same order as Slide 06 table).

**Headline guidance:**
- `{{CROSS_HEADLINE_EM}}` — "early vintages win on both metrics." (or adapt if data shows a different pattern)

**Insight box text:** 2-3 sentences interpreting why high-IRR funds also have high TVPI and what it means for newer funds.

**Checksums:**
- `{{CROSS_IRR_ROWS}}` and `{{CROSS_TVPI_ROWS}}` must have the same number of rows
- Fund labels must match exactly between the two chart arrays
- IRR values must match the Slide 04 chart; TVPI values must match the Slide 03 chart

---

## Slide 25b — Portfolio Company Deep Dives

**Data source:** `Portfolio Company Deep Dives` query (AGGREGATE_INVESTMENTS — top 10 by FMV, with cost basis and proceeds).

**Required content:** At least 5 companies with FMV and cost basis.

**Headline guidance:**
- `{{DEEPDIVE_HEADLINE_PLAIN}}` — "[Company with highest MOIC] leads on MOIC at"
- `{{DEEPDIVE_HEADLINE_EM}}` — "XX× — [Company with highest FMV] at $XXXM FMV."

**Table rules:**
- Sorted by current FMV descending (not by MOIC)
- `.hi` class on MOIC column when MOIC ≥ 5×
- `.mute` on Invested, Fund, and First Investment columns
- Proceeds: show "—" if no proceeds yet

**Checksums:**
- All companies in this table should appear in Slide 11 (Portfolio Overview) chart
- Company FMV values here must match Slide 11 chart values

---

## Slide 27 — Fund Expenses Breakdown

**Data source:** `Fund Expenses Breakdown` query (fund-level expense categories).

**Required content:** At least 2 expense categories with non-zero amounts.

**Headline guidance:**
- `{{EXPENSES_HEADLINE_EM}}` — "$X.XM in total operating expenses"
- `{{EXPENSES_HEADLINE_SUFFIX}}` — "across N funds." (N = number of funds with expense data)

**Donut category order:** always Other Operating → Fund Admin → Legal Fees → Tax Preparation (omit if $0).

**Checksums:**
- `{{EXPENSES_DONUT_CENTER_NUMBER}}` = sum of all `{{EXPENSES_DONUT_SEGMENTS}}` values
- Sum of `{{EXPENSES_CHART_ROWS}}` values ≈ `{{EXPENSES_DONUT_CENTER_NUMBER}}` (same total, split by fund vs. by category)

---

## Slide 29 — Closing

**Data source:** No query — uses global inputs and brand voice.

**Required content:** Always render. Never skip.

**Headline guidance:**
- `{{CLOSING_HERO_LINE1}}` + `{{CLOSING_HERO_EMPHASIS}}` — craft a brief, memorable closing statement about the firm's investment thesis or forward outlook. It should feel personal to the firm, not generic. Examples:
  - "Fintech is still in its / _earliest innings._"
  - "The next decade belongs to / _the builders._"
  - "We invest in the future of / _financial inclusion._"
- `{{CLOSING_THANK_YOU}}` — 1-2 sentences thanking LPs for their partnership and affirming commitment to the strategy.
- `{{CLOSING_FOOTER_LABEL}}` — "Questions & discussion"

---

## Global Formatting Rules

### Number formatting
| Value range | Format |
|---|---|
| ≥ $1B | `$X.XXB` (2 decimal places) |
| $100M–$999M | `$XXXM` (no decimals unless needed for precision) |
| $10M–$99.9M | `$XX.XM` (1 decimal) |
| < $10M | `$X.XM` (1 decimal) |
| MOIC | `X.XX×` (2 decimal places, × suffix) |
| IRR | `XX.X%` (1 decimal, % suffix) |
| Percentages | `XX.X%` |

### Currency
- Always read currency from the query data — never assume USD
- Mixed-currency slides: include currency prefix in each value label (e.g. "£128.6M", "$112.8M")
- Never sum across currencies in a single total

### Series color assignment (hbar / donut)
- `series: 1` = best performers / largest segment
- `series: 2` = second tier
- `series: 3` = third tier
- `series: 4` = fourth tier / below average
- `series: 5` = written off / zero value (use sparingly)
- Rotate series across rows to avoid all bars being the same color on a single-tier chart

---

## Slide Ordering Summary

| # | Slide | Surface | Skip condition |
|---|---|---|---|
| 01 | Cover | ds-dark | Never |
| 02 | Agenda | paper | Never |
| 03 | Fund Performance Summary | ds-alt | < 2 funds with TVPI data |
| 04 | Fund Net IRR | paper | < 3 funds with IRR data |
| 05 | NAV by Fund | ds-alt | < 2 funds with NAV > 0 |
| 05b | NAV Trend | paper | < 3 year-end data points |
| 06 | Multi-Fund Performance Table | ds-dark | < 3 funds with full metrics |
| 07 | Capital Deployment | paper | < 2 funds with called capital |
| 11 | Portfolio Overview | paper | < 4 companies with FMV |
| 11b | Investment Detail & Performance | ds-alt | < 3 investments with MOIC |
| 12 | Portfolio Company Logo Grid | ds-alt | < 5 companies |
| 13 | Asset Type Breakdown | paper | < 2 asset types |
| 14 | Performance Buckets | ds-alt | < 3 non-empty buckets |
| 15 | Top Performing Investments | ds-dark | < 3 investments with MOIC ≥ 5× |
| 18 | Geographic Portfolio Mix | paper | No geography data |
| 19 | SPV Performance | ds-alt | < 2 SPVs with TVPI |
| 21 | Profitability Tracker | paper | < 3 profitable companies |
| 22 | Financing Round History | ds-alt | < 4 investments in past 12 months |
| 22b | Early Vintage IRR | ds-dark | < 2 early-vintage funds |
| 22c | Recent Vintage IRR | paper | < 2 recent-vintage funds |
| 25 | IRR vs TVPI Cross-Reference | ds-alt | < 4 funds with both metrics |
| 25b | Portfolio Deep Dives | ds-dark | < 5 companies with FMV + cost |
| 27 | Fund Expenses | paper | < 2 expense categories |
| 29 | Closing | ds-dark | Never |
