---
name: carta-form-adv
description: Fetch Form ADV Part 1A filing data — regulatory AUM, Schedule D §7.B.(1) per-fund detail, beneficial owner breakdown, asset class composition, and annual capital activity. Use when asked about Form ADV, regulatory AUM, Schedule D, Form PF Section 1, SEC filing data, or private fund disclosures.
version: 1.0.0
model: sonnet
allowed-tools:
  - mcp__carta__fetch
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__Claude_Preview__preview_start
  - mcp__Claude_Preview__preview_list
  - mcp__Claude_Preview__preview_eval
  - AskUserQuestion
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/*)
  - Bash(python3 -c *)
  - Write
  - Read
---

<!-- Part of the official Carta AI Agent Plugin -->

# Form ADV Part 1A — Comprehensive Filing Data

Fetch data to populate SEC Form ADV Part 1A for investment advisers managing private funds (LP structures, SPVs). Covers Items 5.D, 5.F, 5.H, 7.B, Schedule D §7.B.(1) per-fund detail, and Schedule D §5.K.(1) SMA asset categories — at the level of detail needed for an IARD filing.

---

## When to Use

- "Pull our Form ADV data for 2025"
- "What's our regulatory AUM as of December 2024?"
- "Show me Schedule D §7.B.(1) data for our annual filing"
- "What's our total discretionary AUM and account count?"
- "What percentage of our investors are non-US persons?"
- "What's the beneficial owner breakdown across our funds?"
- "What do I need for Form PF Section 1?"
- "What's our total AUM / investor count across all funds?"
- "Give me the asset class composition of our portfolio"
- "What's our annual subscription and distribution activity?"

---

## Form ADV Coverage

### Data Carta Can Provide

| Form ADV Item | What Is Reported | Source Table(s) |
|---|---|---|
| **Item 5.D** | Client type = Pooled Investment Vehicles; AUM per fund + firm total | JOURNAL_ENTRIES |
| **Item 5.F(1)** | Discretionary regulatory AUM (dollar amount) | JOURNAL_ENTRIES |
| **Item 5.F(2)** | Non-discretionary AUM (typically $0 for pure fund managers) | Computed |
| **Item 5.F(3)** | Total regulatory AUM + number of accounts | JOURNAL_ENTRIES + FUNDS |
| **Item 5.H** | Approximate % of regulatory AUM from non-US clients | PARTNER_DATA |
| **Item 7.B** | Firm advises private funds (YES) | FUNDS |
| **Sched D §7.B.(1)** | Per-fund: legal structure, formation date, entity type, fund type classification | FUNDS |
| **Sched D §7.B.(1)** | Per-fund: gross assets, NAV, unfunded commitments, LOC/borrowings | JOURNAL_ENTRIES + MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: total # beneficial owners (LP + GP count) | AGGREGATE_FUND_METRICS |
| **Sched D §7.B.(1)** | Per-fund: % beneficial owners who are US vs. non-US persons | PARTNER_DATA |
| **Sched D §7.B.(1)** | Per-fund: beneficial owner type breakdown (individuals vs. entities) | PARTNER_DATA |
| **Sched D §7.B.(1)** | Per-fund: annual subscriptions + annual distributions | MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: inception-to-date contributions + distributions (LP/GP split) | MONTHLY_NAV_CALCULATIONS |
| **Sched D §7.B.(1)** | Per-fund: total committed capital, LP vs. GP split | MONTHLY_NAV_CALCULATIONS + PARTNER_DATA |
| **Sched D §5.K.(1)** | SMA asset category breakdown (public equity, private equity, pooled vehicles, crypto, options, other) | AGGREGATE_INVESTMENTS |

### Items NOT Available from Carta DW — Must Be Entered Manually in IARD

The following must be completed directly in the IARD filing system. Carta cannot populate these:

**Item 5 (Employees & Services):**
- 5.A: Total number of employees (full-time + part-time)
- 5.B: Employees performing investment advisory functions
- 5.C: Types of compensation arrangements (checkboxes)
- 5.E: % of regulatory AUM using performance-based fees
- 5.G: Types of advisory services provided (checkboxes)
- 5.J: Whether you sponsor wrap fee programs

**Schedule D §7.B.(1) Per-Fund Manual Fields:**
- Legal name of fund (confirm vs. display name; may differ)
- Private Fund Identification Number (from IARD generator)
- Whether adviser is primary adviser for the fund
- Other advisers / sub-advisers (if applicable)
- Fiscal year end month
- Whether fund is currently open to new investors (Y/N)
- Minimum investment amount
- Auditor name, city, country, PCAOB registration number
- Frequency of asset valuation
- Who performs the valuation (internal / third-party administrator)
- Whether custodian is a related person
- Whether fund relies on 3(c)(1) or 3(c)(7) exemption
- Form D file number (021 number from SEC EDGAR)
- Side pocket arrangement (Y/N)
- Gate on investor redemptions (Y/N)
- Fund-of-funds (Y/N) / whether fund invests in other hedge funds

**Items 6–12 (Other Disclosures):**
- Item 6: Other business activities
- Item 7.A: Affiliated advisers and broker-dealers
- Item 8: Participation or interest in client transactions
- Item 9: Custody details (custodian name, address, sweep arrangements)
- Item 10: Control persons
- Item 11: Disclosure information (regulatory/criminal history)
- Schedules A & B: Direct and indirect ownership of the adviser

---

## Prerequisites

- The user must have the Carta MCP server connected
- A `reporting_date` is required (YYYY-MM-DD) — **ask the user if not provided** (use YYYY-12-31 for annual filings)
- If this is the first query, call `list_contexts` then `set_context` to establish the firm context before running any query

---

## Data Retrieval

**Before running any query**, read `${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/references/form-adv-queries.md`. That file contains the source table definitions, field mappings, date field rule, and the full SQL for both queries.

Run **two queries** using `fetch("dwh:execute:query", {"sql": "..."})`. Execute Query 1 (Regulatory AUM, Fund Detail, and Capital Activity) first, then Query 2 (Investor Demographics).

---

## How to Present

Organize results into **six sections**. The section headers map directly to Form ADV Part 1A items.

---

### Section A — Item 5.F: Regulatory AUM Summary (sum all per-fund rows from Query 1)

Compute the firm-level totals by summing the per-fund rows from Query 1. All fund manager AUM is classified as **discretionary**.

| Item 5.F | Amount | # Accounts |
|---|---|---|
| Discretionary regulatory AUM | `[SUM of regulatory_aum across all funds]` | `[count of fund rows]` |
| Non-discretionary regulatory AUM | $0 | 0 |
| **Total Regulatory AUM** | **`[SUM of regulatory_aum]`** | **`[total funds]`** |

- Client type (Item 5.D): 100% Pooled Investment Vehicles (other than registered investment companies or BDCs)
- Number of clients (Item 5.D): `[total funds]` private funds

---

### Section B — Item 5.H: Non-US Client AUM (use Query 2 results)

Aggregate across all funds:

| | Count | % of LP Investors | Approx. % of LP NAV |
|---|---|---|---|
| US persons | `[us_lp_investors summed]` | X% | X% |
| Non-US persons | `[non_us_lp_investors summed]` | `[pct_non_us_lp_investors]`% | `[pct_non_us_lp_nav]`% |
| Country not on file | `[lp_investors_no_country_on_file summed]` | — | — |

> Tell the user: "The % of regulatory AUM attributable to non-US clients for Item 5.H is approximately **X%** based on LP NAV. You should verify this against subscription agreements if precision is needed for your filing."

---

### Section C — Schedule D §7.B.(1): Per-Fund Detail

One table row per fund (exclude the Firm Rollup row). Present two sub-tables:

**C1 — Balance Sheet & Regulatory AUM**

| Fund | Type | Legal Structure | Formation Date | FMV | Cash | Other Assets | Gross Assets | Borrowings | Unfunded Commitments | **Regulatory AUM** | NAV |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [fund_name] | [fund_type_classification] | [legal_structure] | [formation_date] | $X | $X | $X | $X | $X | $X | **$X** | $X |

**C2 — Beneficial Owners & Capital Activity**

| Fund | # LP Investors | # GP Investors | Total Beneficial Owners | Annual Subscriptions | Annual Distributions | Committed Capital | Contributions (ITD) | Distributions (ITD) |
|---|---|---|---|---|---|---|---|---|
| [fund_name] | X | X | X | $X | $X | $X | $X | $X |

---

### Section D — Schedule D §7.B.(1): Per-Fund Beneficial Owner Demographics (use Query 2)

Per fund, present the owner breakdown needed for Questions 14–16 of §7.B.(1):

| Fund | US LP Investors | Non-US LP Investors | Unknown Country | % Non-US (by count) | % Non-US (by NAV) | Individual Investors | Corporate/LLC | Trust/Foundation | Pension/Retirement | Fund Investors |
|---|---|---|---|---|---|---|---|---|---|---|
| [fund_name] | X | X | X | X% | X% | X | X | X | X | X |

For each fund, compute the owner type percentages:
- **% owned by individuals/HNW** = `individual_investors / total_active_investors * 100`
- **% owned by funds** = `fund_investors / total_active_investors * 100`
- **% owned by pension plans** = `pension_plan_investors / total_active_investors * 100`
- Remaining categories: present as headcount for the user to convert to % using total_beneficial_owners

---

### Section E — Schedule D §5.K.(1): SMA Asset Category Breakdown

> **Note:** Schedule D §5.K relates to separately managed accounts, not private funds. For advisers whose entire AUM is in private funds (no separately managed accounts), this section is N/A — tell the user. If the firm also manages SMAs, use the portfolio data below as a reference for the types of assets held.

Sum across all per-fund rows from Query 1 to get firm-level asset composition:

| Asset Category (Form ADV §5.K.(1)) | FMV | % of Total Active FMV |
|---|---|---|
| Exchange-Traded Equity (U.S. and non-U.S.) | `[fmv_exchange_traded_equity]` | X% |
| Private Equity (non-public ownership interests) | `[fmv_private_equity]` | X% |
| Securities issued by other pooled investment vehicles | `[fmv_pooled_investment_vehicles]` | X% |
| Options and warrants | `[fmv_options_and_warrants]` | X% |
| Digital assets / cryptocurrency | `[fmv_digital_assets]` | X% |
| Other alternatives | `[fmv_other_alternatives]` | X% |
| **Total Active Investment FMV** | **`[total_active_fmv]`** | **100%** |

---

### Section F — Item 5.F / NAV: Performance & Form PF Reference

| Fund | NAV | LP NAV | GP NAV | Net AUM (Form PF) | DPI | TVPI | LP TVPI |
|---|---|---|---|---|---|---|---|

---

## Interactive Filing Guide

Read `${CLAUDE_PLUGIN_ROOT}/skills/carta-form-adv/references/filing-guide.md` for the full step-by-step instructions: building the JSON data file, generating the HTML artifact and Excel filing reference, and opening the preview panel in Claude Desktop.

---

## Formatting Rules

- Currency: `$X,XXX,XXX` with no decimal places (e.g., `$48,250,000`)
- Percentages: `X.X%` (one decimal)
- Multiples: `X.XXx` (e.g., `1.85x`)
- Dates: `YYYY-MM-DD`
- Use `—` for null values
- For each fund, note whether `investor_count_is_point_in_time` is TRUE or FALSE. If TRUE, say "as of {reporting_date}". If FALSE, say "current snapshot (NAV not calculated for {reporting_date} — verify against subscription register)".
- Show `investment_strategy_code` alongside `fund_type_classification` so users can see exactly what Carta has on file.
- End every response with: *Data as of {reporting_date} · Balance sheet uses effective_date (accounting date) · Verify legal names, fiscal year ends, and IARD fund IDs before filing*

---

## Data Caveats — Communicate These to the User

1. **Investor counts** — when `investor_count_is_point_in_time = TRUE`, counts are as of the exact reporting date (from `PARTNER_MONTHLY_NAV_CALCULATIONS`). When FALSE, the NAV calculation for that month hasn't been run and counts are a current snapshot from `AGGREGATE_FUND_METRICS` — tell the user to verify against their subscription register for those funds only.

2. **Non-US determination is approximate.** It is based on the `partner_country` field in Carta, which relies on data entry. Partners with no country on file are excluded from the US/non-US calculation. Confirm completeness before using for Item 5.H.

3. **Fund type classification** — show both `investment_strategy_code` (what Carta has on file) and `fund_type_classification` (the mapped SEC label). The final SEC classification is a legal determination that must be confirmed against fund documents — a fund labeled `DIRECT_VENTURE` in Carta may not qualify for the VC exemption under the Advisers Act.

4. **Formation date is the GL-based vintage date**, calculated from first journal entry activity. Verify against your fund's actual formation documents (certificate of formation, LP agreement).

5. **NAV data requires a calculation to exist** for the exact reporting date month-end. If a fund's NAV has not been calculated for that date, those fields will show null (`—`). This is not an error — the fund's NAV simply hasn't been run yet.

6. **Regulatory AUM uses the balance sheet method** (gross assets + unfunded commitments). This follows the SEC's instructions for private fund advisers. It is not the same as NAV, which is the preferred method for Form PF Net AUM.

7. **Borrowings cover all account types 2000–2999**, which is broader than the prior skill's 2000–2001 range. This provides a more complete picture of fund liabilities for gross asset disclosure.

8. **Legal names of funds** may differ from the display names in Carta. Always verify the exact legal entity name against the fund's certificate of formation before entering in IARD.

---

## Voice Guidelines

- Say "your regulatory AUM" or "Form ADV data" — not "query results" or "database output"
- Frame data gaps as "I wasn't able to retrieve that for [fund name]" — not technical details
- FMV ≠ NAV: explain proactively: "FMV reflects only the investment portfolio (cost + unrealized G/L). NAV is broader and includes cash, other assets, and liabilities."
- Regulatory AUM ≠ NAV: "For Form ADV, regulatory AUM adds unfunded commitments to gross assets — it will always exceed NAV."
- Always remind users that the manual fields listed above must be completed directly in IARD before submitting

---

## Best Effort

- **Computed from Carta data:** all financial figures, investor counts, ownership percentages, annual activity, asset class composition
- **Authoritative sources:** all per-fund data values come directly from the Carta fund administration data warehouse
- **Not available from Carta:** employee counts, compensation arrangements, legal/regulatory history, affiliated person details, auditor information, custody arrangements, ownership of the adviser (Schedules A/B)
