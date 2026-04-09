---
name: tutorial
description: >
  Interactive 5-minute walkthrough of the carta-investors plugin. Covers plugin overview,
  setup verification, and demo of 3 real-world scenarios: fundraising benchmarks, LP reporting
  tear sheets, and LP meeting prep. Trigger with: "investors tutorial", "show me the tutorial",
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

---

## Section 0: Welcome

Welcome to the **carta-investors plugin** — your AI-powered assistant for fund data, portfolio
reporting, and LP insights, all connected directly to Carta's data warehouse.

In the next 5 minutes you'll see how to:
- Benchmark your fund's performance against peers for fundraising conversations
- Generate and download portfolio company tear sheets for LP reporting
- Pull a complete LP snapshot to prep for an investor call — in seconds

Say **"next"** to start.

---

## Section 1: What This Plugin Does

The carta-investors plugin gives you five capabilities:

| Skill | What it does |
|---|---|
| **Performance Benchmarks** | Compare fund IRR, TVPI, DPI, and MOIC against peer cohort percentiles |
| **Tear Sheets** | Generate and download PDF tear sheets for one portco or your entire portfolio |
| **Explore Data** | Query fund metrics, NAV, LP data, investments, and journal entries |
| **Fund Properties** | View and update fund terms, fees, KYC, and distribution settings |
| **Form ADV** | Pull regulatory AUM data for annual Form ADV and Form PF filings |

All data comes live from Carta's data warehouse — no spreadsheets, no exports.

Say **"next"** to verify your setup.

---

## Section 2: Verify Setup

Let me quickly check that everything is configured correctly.

[Run `carta auth-status`]

[Run `carta plugins`]

If you see `carta-investors` in the plugin list and your environment shows as authenticated,
you're good to go.

> If your connection authorization has expired, run `carta login` to re-authenticate and try again.
> If something else looks off, visit #help-claude-code in Slack.

Say **"next"** to start the demo.

---

## Section 3: Demo — Scenario 1: Fundraising Benchmarks

**The situation:** You're raising Fund IV and have an LP intro call next week. They'll ask how
Fund III performed. Let's see how it stacks up.

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
with on the LP call.

To run this for real, just say: *"How does [your fund name] compare to peers?"*

Say **"next"** for Scenario 2.

---

## Section 4: Demo — Scenario 2: LP Reporting — Tear Sheets

**The situation:** You're putting together your Q1 LP update and need tear sheets for all
active portfolio companies.

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

Open **carta-sample-tearsheet.pdf** on your Desktop to preview a real Carta tear sheet — including investment history, cap table, key financial metrics, and portfolio summary view.

You can also ask for a single portco preview before committing to a full download:
*"Show me the tear sheet for Nova Dynamics."*

Say **"next"** for Scenario 3.

---

## Section 5: Demo — Scenario 3: LP Meeting Prep

**The situation:** You have a call with Sequoia Pension Trust in an hour. They're your largest
LP. You want the full picture before you dial in.

> *Imagine you just asked: "I have a call with Sequoia Pension Trust in an hour. Get me ready."*

The plugin pulls from three data sources at once:

**LP account summary (PARTNER_DATA):**
```
LP: Sequoia Pension Trust
Commitment:           $25,000,000
Contributed to Date:  $18,750,000  (75%)
Distributions:         $4,200,000
Current NAV:          $31,100,000
Net Multiple:              1.66x
```

**Fund snapshot (MONTHLY_NAV_CALCULATIONS + AGGREGATE_INVESTMENTS):**
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

## Section 6: Wrap-Up

You've seen the three core workflows:

| Workflow | How to trigger |
|---|---|
| **Fundraising benchmarks** | "How does [fund name] compare to peers?" |
| **LP reporting tear sheets** | "Download tear sheets for [fund name]" |
| **LP meeting prep** | "I have a call with [LP name], get me ready" |

**Coming soon:** You'll be able to build and save custom reports directly in your Carta Data
Explorer firm folder and design custom tear sheets from scratch, right here.

To re-run this tutorial anytime: *"show me the investors tutorial"*

[Run `touch ~/.claude/plugins/cache/carta-plugins/carta-investors/.tutorial-seen`]

You're all set. What would you like to explore first?
