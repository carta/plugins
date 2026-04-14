---
name: carta-investors-tutorial
description: >
  Interactive 5-minute walkthrough of the carta-investors plugin. Covers what's possible with
  your firm's data, a live snapshot of your firm, and 3 real-world scenarios: year-end reporting,
  fundraising benchmarks, and LP meeting prep. Trigger with: "investors tutorial", "show me the
  tutorial", "getting started with investors plugin", "how do I use the investors plugin", "demo",
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

---

## Section 0: Welcome

Welcome to **carta-investors** — your AI-powered data layer, connected directly to your firm's
complete data in Carta's data warehouse.

In the next 5 minutes you'll see what's possible, get a live snapshot of your firm's data, and
walk through three scenarios fund managers use every day.

Say **"next"** to start.

---

## Section 1: What's Possible

This isn't a dashboard or a report template — it's a direct connection to everything your firm
has on Carta. Whatever question you'd normally take to a spreadsheet, a finance team, or a Carta
support ticket, you can ask here instead.

Here's what fund managers are doing with it:

| Use Case | Example Prompt |
|---|---|
| **Year-end financial reporting** | "Pull NAV, contributions, distributions, and expenses by account for all funds — 2025 year-end" |
| **Portfolio company KPI dashboard** | "Show me revenue, gross margin, and headcount for all active portfolio companies as of Q4 2025" |
| **Fundraising deck data** | "How does Fund III compare to peers on IRR, TVPI, and DPI? Show me percentiles by vintage year" |
| **LP meeting prep** | "I have a call with [LP name] in an hour — pull their commitment, contributions, distributions, and current NAV" |
| **Capital call reconciliation** | "For the Q1 2025 capital call — show me called vs. contributed per LP and flag any gaps" |
| **Year-end portfolio snapshot** | "What did our portfolio look like at December 31, 2025? Cost basis, FMV, and unrealized gain/loss per company" |
| **LP geography and segmentation** | "Which of our LPs are based in California? What's their total commitment across all funds?" |
| **New investment tracking** | "What investments did we make in 2025? Show first close date, invested amount, and fund" |
| **K-1 and tax prep** | "Pull total contributions, distributions, and income allocations per LP across all funds for 2025" |
| **Tear sheets for LP reporting** | "Download tear sheets for all active portfolio companies in Fund II" |

Every one of these pulls live data from your firm's Carta account — fund financials, investment
history, LP capital accounts, portfolio company metrics, and peer benchmarks. No exports, no
spreadsheets. Just ask.

Real patterns from early adopters: teams have used this to tackle year-end financial reporting
across multiple funds in a single session, build full portfolio summaries ahead of board meetings,
run capital call reconciliation for the first time without a spreadsheet, and pull LP account
snapshots minutes before an investor call. The most common starting point across every firm:
exploring what tables are available and then going deep on one fund.

Say **"next"** to see a live snapshot of your firm.

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

## Section 4: Demo — Scenario 1: Fundraising Benchmarks

**The situation:** You're raising Fund IV and have an LP intro call next week. They'll ask how
Fund III performed. Let's see how it stacks up against peers.

> *Imagine you just asked: "How does Redwood Growth Fund III compare to peers?"*

Here's what the plugin would return:

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

Fund III is in the **top quartile** for its vintage. That's a headline number you can lead
with on the LP call — or drop straight into a fundraising deck.

To run this for real, just ask: *"How does [your fund name] compare to peers?"*

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

## Section 7: Wrap-Up

Here's a quick reference for the most common workflows:

| What you want | How to ask |
|---|---|
| Year-end fund financials | "Pull year-end [year] financials for all our funds" |
| Portfolio snapshot | "Show me all active investments — cost, FMV, IRR" |
| Fundraising benchmarks | "How does [fund] compare to peers?" |
| LP account summary | "I have a call with [LP name], get me ready" |
| Capital call reconciliation | "Show called vs contributed per LP for the [date] call" |
| Point-in-time portfolio | "What did our portfolio look like at December 31, 2025?" |
| LP geography | "Which of our LPs are based in [state/country]?" |
| Tear sheets | "Download tear sheets for all active portcos in [fund name]" |

The more specific you are — fund name, date range, LP name — the sharper the output.

**Coming soon:** Build and save custom reports directly in your Carta Data Explorer firm folder
and design custom tear sheets from scratch, right here.

To re-run this tutorial anytime: *"show me the investors tutorial"*

[Run `touch ~/.claude/plugins/cache/carta-plugins/carta-investors/.tutorial-seen`]

You're all set. What would you like to explore first?
