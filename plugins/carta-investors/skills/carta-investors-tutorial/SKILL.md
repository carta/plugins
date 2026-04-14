---
name: carta-investors-tutorial
description: >
  Interactive 5-minute walkthrough of the carta-investors plugin. Covers what's possible with
  your firm's data, a live snapshot of your firm, and 3 real-world scenarios personalized to
  your role. Trigger with: "investors tutorial", "show me the tutorial",
  "getting started with investors plugin", "how do I use the investors plugin", "demo",
  "walk me through the investors plugin", "what can I do with carta", "how does this work".
allowed-tools:
  - Bash(carta auth-status)
  - Bash(carta plugins)
  - Bash(cp ~/.claude/plugins/cache/carta-plugins/carta-investors/*/assets/sample-tearsheet.pdf ~/Desktop/carta-sample-tearsheet.pdf)
  - Bash(touch ~/.claude/plugins/cache/carta-plugins/carta-investors/.tutorial-seen)
args: []
model: haiku
---

# carta-investors Tutorial

You are running the **carta-investors plugin tutorial**. This is an interactive, gate-based
walkthrough — pause after each section and wait for the user to say "next", "continue", or
press Enter before proceeding.

**Important:** Track the user's role selection from Section 1 — use it to personalize
Section 4 (the demo scenario) and Section 7 (the wrap-up cheat sheet).

---

## Section 0: Welcome

Welcome to **carta-investors** — your AI-powered data layer, connected directly to your firm's
complete data in Carta's data warehouse.

This isn't a dashboard or a report template. It's a live connection to your fund financials,
portfolio companies, LP capital accounts, benchmarks, and more. Whatever question you'd normally
take to a spreadsheet or a finance team, you can ask here.

In the next 5 minutes you'll see what's possible for your specific role, get a live snapshot of
your firm's data, and walk through three real scenarios.

Say **"next"** to start.

---

## Section 1: What Can I Do? (Role Picker)

The data warehouse covers a lot of ground — fund financials, portfolio companies, LP accounts,
benchmarks, regulatory data. The most useful starting point depends on who you are.

**Which best describes your role?**

```
  1 — GP / Managing Partner
  2 — CFO / Controller / Fund Finance
  3 — Deal Team / Investment Team
```

Type a number (or just describe your role) and I'll show you what's most relevant for you.

---

### Path 1A — GP / Managing Partner

Fund managers use carta-investors most for three things: understanding how their funds are
performing relative to peers, getting a real-time portfolio view before LP conversations, and
tracking deployment and returns over time.

**What you can do:**

| Use Case | Example Prompt |
|---|---|
| **Fund performance vs. peers** | "How does Fund III compare to 2019 vintage VCs on IRR, TVPI, and DPI? Show me percentiles." |
| **Portfolio snapshot for an LP call** | "I have a call with [LP name] in an hour — show me their account, the fund NAV, and our benchmark standing." |
| **Top performers and laggards** | "Rank all active investments by MOIC. Which are in the top and bottom quartile?" |
| **NAV trend over time** | "Show me quarterly NAV for each fund from 2022 to today." |
| **Deployment pace** | "How much capital have we called vs. total commitment by fund? How much is left to deploy?" |
| **Unrealized value by company** | "What's our total unrealized FMV broken down by portfolio company?" |
| **Concentration analysis** | "What's our portfolio breakdown by stage and geography?" |
| **Fundraising deck data** | "Pull IRR, TVPI, and DPI for Fund II and III vs. peer percentiles — formatted for a deck." |

**Key tables you'll use most:**
- `TEMPORAL_FUND_COHORT_BENCHMARKS` — IRR/TVPI/DPI percentiles by vintage year and AUM bucket
- `AGGREGATE_INVESTMENTS` — active portfolio, cost basis, FMV, MOIC
- `MONTHLY_NAV_CALCULATIONS` — NAV, contributions, distributions, DPI, TVPI over time
- `PARTNER_DATA` — LP account details for investor call prep

**Early adopter patterns:** GPs are using this to pull benchmarking data minutes before an LP
meeting, build full portfolio MOIC rankings before board meetings, and track NAV and DPI trends
across all funds in a single query. The benchmarking table (`TEMPORAL_FUND_COHORT_BENCHMARKS`)
is the most valuable discovery — most people don't know it exists until they find it here.

**Start here:**
- *"How does [fund name] compare to peers?"*
- *"Show me all active investments ranked by MOIC."*
- *"What's the NAV trend for all our funds over the last 8 quarters?"*

Say **"next"** to see your firm's data.

---

### Path 1B — CFO / Controller / Fund Finance

Fund finance teams use carta-investors most for year-end reporting, LP capital account
management, and pulling audit-ready data without waiting on Carta exports or support tickets.

**What you can do:**

| Use Case | Example Prompt |
|---|---|
| **Year-end financial reporting** | "Pull NAV, contributions, distributions, and total expenses by account for all funds — 2025 year-end." |
| **LP capital account statements** | "Show me contributions, distributions, and ending NAV per LP for Fund II as of December 31, 2025." |
| **Capital call reconciliation** | "For the Q1 2025 capital call — show me amount called vs. contributed per LP and flag any outstanding." |
| **Expenses by account** | "What were total management fees, admin expenses, and fund expenses for 2025, by fund?" |
| **Journal entry review** | "Show me all journal entries posted to Fund III in Q4 2025, grouped by account type." |
| **Outstanding receivables** | "Which LPs have outstanding receivables? Show amounts and aging." |
| **Regulatory AUM (Form ADV)** | "What's our total AUM as of December 31, 2025 across all funds and SPVs?" |
| **K-1 prep** | "Pull total contributions, distributions, and income allocations per LP across all funds for 2025." |

**Key tables you'll use most:**
- `JOURNAL_ENTRIES` — all GL activity; cash, cost of investment, income, liabilities
- `MONTHLY_NAV_CALCULATIONS` — NAV, contributions, distributions per fund per month
- `PARTNER_DATA` — LP commitment, contributed capital, distributions, NAV
- `STATEMENT_OF_OPS` — P&L / income statement data
- `ALLOCATIONS` — capital call detail; called vs. contributed per LP

**Early adopter patterns:** Finance controllers are using this to pull year-end fund financials
across all funds in one session — NAV, contributions, distributions, and expenses by account —
work that used to take hours of export-and-stitch. Capital call reconciliation (called vs.
contributed per LP) is one of the most-used queries; most teams hadn't thought to query
`ALLOCATIONS` directly before.

**Start here:**
- *"Pull year-end 2025 financials for all our funds — NAV, contributions, distributions, expenses."*
- *"Show me capital called vs. contributed per LP for the most recent capital call."*
- *"What are our outstanding LP receivables?"*

Say **"next"** to see your firm's data.

---

### Path 1C — Deal Team / Investment Team

Investment teams use carta-investors most for portfolio company financial analysis, sector and
geography breakdowns, and building the kind of data views that usually require custom exports or
waiting on the finance team.

**What you can do:**

| Use Case | Example Prompt |
|---|---|
| **Portfolio company KPIs** | "Show me trailing revenue, gross margin, and EBITDA for all active portfolio companies as of Q4 2025." |
| **Geography-based analysis** | "Which of our portfolio companies are based in Brazil? What's their combined revenue?" |
| **Sector and stage breakdown** | "Break down our active portfolio by sector and stage — count and total FMV for each." |
| **Entry vs. current valuation** | "Compare entry post-money valuation vs. current valuation for all active investments." |
| **Best and worst performers** | "Rank all active investments by MOIC. Which are at write-off risk?" |
| **New investments this year** | "What investments did we make in 2025? Show company, amount, fund, and first close date." |
| **Follow-on tracking** | "Which portfolio companies have received follow-on from us? Show total invested by round." |
| **Revenue by region** | "What's the most recent annual revenue for all our companies headquartered in Latin America?" |

**Key tables you'll use most:**
- `COMPANY_FINANCIALS` — revenue, EBITDA, gross margin, headcount per portfolio company per period
- `AGGREGATE_INVESTMENTS` — investment details, FMV, MOIC, entry valuation, geography, sector
- `AGGREGATE_INVESTMENTS_HISTORY` — point-in-time portfolio data for any historical date
- `JOURNAL_ENTRIES` — cost basis, unrealized gains, investment-level GL activity

**Early adopter patterns:** Deal teams are using this to build full portfolio summaries before
board meetings — cost basis, FMV, and first wire date per company — work that used to require
requesting a data export. Geography and sector queries are a standout: you can ask "show me all
portfolio companies in Southeast Asia with revenue over $10M" and get an answer in seconds.

**Start here:**
- *"Show me trailing revenue and gross margin for all active portfolio companies — Q4 2025."*
- *"Which of our active investments are headquartered in [region]?"*
- *"Rank all investments by MOIC and show entry valuation vs. current."*

Say **"next"** to see your firm's data.

---

## Section 2: Your Firm at a Glance

Let me pull a few quick stats from your firm's data to show you what's in there.

First, set up the data warehouse connection:

1. Call `list_contexts` to see which firms are accessible
2. Call `set_context` with your firm's `firm_id`

Then run these three queries:

**Funds and entities:**
```sql
SELECT entity_type_name, COUNT(*) AS count
FROM FUND_ADMIN.ALLOCATIONS
GROUP BY entity_type_name
ORDER BY count DESC
LIMIT 10
```

**Active portfolio investments:**
```sql
SELECT COUNT(DISTINCT corporation_id) AS active_portfolio_companies
FROM FUND_ADMIN.AGGREGATE_INVESTMENTS
WHERE is_active_investment = TRUE
LIMIT 1
```

**Limited partners:**
```sql
SELECT COUNT(DISTINCT partner_id) AS limited_partners
FROM FUND_ADMIN.PARTNER_DATA
LIMIT 1
```

**Most recent total NAV:**
```sql
SELECT SUM(ending_total_nav) AS total_firm_nav
FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
WHERE month_end_date = (
  SELECT MAX(month_end_date) FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS
)
LIMIT 1
```

Present the results in a clean summary. For example:

```
Your Firm on Carta
──────────────────────────────────────
  Funds:                      4
  SPVs:                       8
  Active portfolio companies: 47
  Limited partners:          134
  Total firm NAV:         $142M
```

If anything notable surfaces — a large number of entities, a mix of fund types, a particularly
large NAV — mention it briefly. Then invite them to continue.

> That's your firm's footprint on Carta. All of it is queryable. Say **"next"** to verify your
> setup and start the demo.

---

## Section 3: Verify Setup

Let me quickly confirm that everything is configured correctly.

[Run `carta auth-status`]

[Run `carta plugins`]

If you see `carta-investors` in the plugin list and your environment shows as authenticated,
you're ready to go.

> If your connection authorization has expired, run `carta login` to re-authenticate and try again.
> If something else looks off, visit #help-claude-code in Slack.

Say **"next"** to start the demo.

---

## Section 4: Demo — Scenario 1 (Role-Adaptive)

Show the scenario that matches the role the user picked in Section 1. If uncertain, use 4A.

---

### Scenario 1A — GP: Fundraising Benchmarks

**The situation:** You're raising Fund IV and have an LP intro call next week. They'll ask how
Fund III performed. Let's see how it stacks up against peers.

> *Imagine you just asked: "How does Redwood Growth Fund III compare to peers?"*

```
Redwood Growth Fund III — Performance vs. Peers
Vintage Year: 2019  |  AUM Bucket: $100M–$500M  |  Entity Type: VC

Metric        Your Fund    10th     25th     50th     75th     90th
──────────────────────────────────────────────────────────────────
Net IRR        24.3%       4.2%    10.1%    16.8%    22.4%    31.7%
TVPI            2.1x       1.1x     1.4x     1.7x     2.0x     2.6x
DPI             0.6x       0.0x     0.1x     0.3x     0.6x     1.1x

Standing: Net IRR — 78th percentile  (Top Quartile)
```

Fund III is in the **top quartile** for its vintage — that's your headline number for the LP
call and your fundraising deck.

To run this for real: *"How does [your fund name] compare to peers?"*

Say **"next"** for Scenario 2.

---

### Scenario 1B — CFO: Year-End Financial Reporting

**The situation:** It's early January. You need year-end 2025 fund financials for your
accountants and LP annual reports. Instead of pulling reports from the UI and stitching
together spreadsheets, you ask.

> *Imagine you asked: "Pull year-end 2025 financials for all our funds."*

```
Year-End 2025 — Fund Summary (3 funds)

                        Redwood I    Redwood II   Redwood III
──────────────────────────────────────────────────────────────
NAV (Dec 31)            $42.3M       $89.1M        $31.7M
Contributions (YTD)      $4.1M       $12.0M         $8.4M
Distributions (YTD)      $6.2M        $0.0M         $0.0M
Mgmt Fee Expense         $0.4M        $0.9M         $0.3M
```

Then Claude asks: *"Want me to break this down by LP, or pull the journal entries for audit?"*

To run this for real: *"Pull year-end [year] financials for all our funds."*

Say **"next"** for Scenario 2.

---

### Scenario 1C — Deal Team: Portfolio Company KPI Query

**The situation:** Your GP is preparing for a board meeting and needs a current snapshot of all
portfolio companies — revenue trend, gross margin, and FMV. You pull it in one ask.

> *Imagine you asked: "Show me trailing revenue, gross margin, and FMV for all active portfolio
> companies as of Q4 2025."*

```
Active Portfolio — Q4 2025

Company               Revenue (TTM)  Gross Margin  FMV
────────────────────────────────────────────────────────────
Nova Dynamics           $14.2M          68%       $18.4M
Maple Street Health      $8.7M          55%        $9.1M
ClearPath Logistics     $22.1M          41%       $11.3M
Ridgewater AI            $3.4M          74%        $7.8M
...
```

Then Claude asks: *"Want me to add entry valuation and MOIC, or filter to a specific sector?"*

To run this for real: *"Show me revenue and gross margin for all active portfolio companies."*

Say **"next"** for Scenario 2.

---

## Section 5: Demo — Scenario 2: LP Reporting — Tear Sheets

**The situation:** You're putting together your Q1 LP update and need tear sheets for all active
portfolio companies.

> *Imagine you just asked: "Download tear sheets for all active portcos in Redwood Growth Fund III."*

Here's what happens:

1. The plugin lists your available tear sheet templates — you pick one
2. It shows all active portfolio companies grouped by fund
3. It kicks off bulk PDF generation and polls until ready
4. Returns a download link for your ZIP file

```
Found 3 active portfolio companies in Redwood Growth Fund III:
  1. Nova Dynamics
  2. Maple Street Health
  3. ClearPath Logistics

Generating tear sheets using "Standard VC Template"...
Status: Complete (3/3)

Your tear sheets are ready — click the link above to download.
```

Want to see what a finished tear sheet looks like? Here's a sample:

[Run `cp ~/.claude/plugins/cache/carta-plugins/carta-investors/*/assets/sample-tearsheet.pdf ~/Desktop/carta-sample-tearsheet.pdf`]

Open **carta-sample-tearsheet.pdf** on your Desktop to preview a real Carta tear sheet —
including investment history, cap table, key financial metrics, and portfolio summary.

You can also ask for a single portco preview before committing to a full download:
*"Show me the tear sheet for Nova Dynamics."*

Say **"next"** for Scenario 3.

---

## Section 6: Demo — Scenario 3: LP Meeting Prep

**The situation:** You have a call with your largest LP in an hour. You want the full picture
before you dial in.

> *Imagine you just asked: "I have a call with Sequoia Pension Trust in an hour. Get me ready."*

The plugin pulls from three data sources at once:

**LP account summary:**
```
LP: Sequoia Pension Trust
Commitment:           $25,000,000
Contributed to Date:  $18,750,000  (75%)
Distributions:         $4,200,000
Current NAV:          $31,100,000
Net Multiple:              1.66x
```

**Fund snapshot:**
```
Fund NAV (Q4 2024):    $142,300,000
Active Positions:      12
Top Holding:           Nova Dynamics  ($18.4M FMV)
```

**Benchmark standing:**
Net IRR 24.3% — 78th percentile for 2019 vintage VC

Then Claude asks: *"Want me to generate the tear sheet for Nova Dynamics to share on the call?"*

One prompt. Three data sources. Ready in seconds.

Say **"next"** to wrap up.

---

## Section 7: Wrap-Up (Role-Adaptive)

Show the cheat sheet that matches the user's role from Section 1. If uncertain, show all three.

---

### Wrap-Up 7A — GP

| What you want | How to ask |
|---|---|
| Fund performance vs. peers | "How does [fund] compare to peers on IRR, TVPI, DPI?" |
| Portfolio MOIC ranking | "Rank all active investments by MOIC" |
| NAV trend over time | "Show quarterly NAV for all funds from [year] to today" |
| Deployment pace | "How much capital has been called vs. total commitment by fund?" |
| LP call prep | "I have a call with [LP name], get me ready" |
| Fundraising benchmarks | "Show IRR/TVPI/DPI percentiles for [fund] vs. [vintage] peers" |
| Portfolio snapshot | "Show all active investments — cost, FMV, MOIC, unrealized gain" |
| Concentration analysis | "Break down the portfolio by stage and geography" |

---

### Wrap-Up 7B — CFO / Controller

| What you want | How to ask |
|---|---|
| Year-end fund financials | "Pull year-end [year] NAV, contributions, distributions, and expenses for all funds" |
| LP capital account statements | "Show contributions, distributions, and ending NAV per LP for [fund] as of [date]" |
| Capital call reconciliation | "Show called vs. contributed per LP for the [date] capital call" |
| Journal entry review | "Show all journal entries for [fund] in Q4 [year] grouped by account" |
| Outstanding receivables | "Which LPs have outstanding receivables?" |
| Regulatory AUM | "What's our total AUM as of December 31, [year]?" |
| Expense breakdown | "What were total management fees and expenses by fund for [year]?" |
| K-1 prep | "Pull contributions, distributions, and income allocations per LP for [year]" |

---

### Wrap-Up 7C — Deal Team

| What you want | How to ask |
|---|---|
| Portfolio company KPIs | "Show trailing revenue, gross margin, and EBITDA for all active portcos as of Q4 [year]" |
| Geography filter | "Which portfolio companies are headquartered in [region/country]?" |
| Best/worst performers | "Rank all investments by MOIC — show entry valuation vs. current" |
| Sector breakdown | "Break down the portfolio by sector and stage — count and total FMV" |
| New investments | "What investments did we make in [year]? Show amount, fund, and close date" |
| Revenue by region | "What's the most recent annual revenue for our companies in [region]?" |
| Point-in-time snapshot | "What did the portfolio look like at December 31, [year]? Cost, FMV, gain/loss." |
| Follow-on tracking | "Which portfolio companies have received follow-on? Show total invested by round." |

---

The more specific you are — fund name, date range, LP or company name — the sharper the output.

**Coming soon:** Build and save custom reports directly in your Carta Data Explorer firm folder
and design custom tear sheets from scratch, right here.

To re-run this tutorial anytime: *"show me the investors tutorial"*

[Run `touch ~/.claude/plugins/cache/carta-plugins/carta-investors/.tutorial-seen`]

You're all set. What would you like to explore first?
