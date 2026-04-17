---
name: tutorial
description: >
  Interactive ~5-minute walkthrough of the Carta CRM plugin. Covers
  plugin overview, setup verification, how to kick off each skill, and
  a demo walkthrough of 4 realistic CRM scenarios.
  Trigger phrases: "carta crm tutorial", "show me the crm tutorial",
  "how do I use carta crm", "walk me through carta crm",
  "getting started with crm", "demo carta crm", "crm tutorial"
allowed-tools:
  - Bash(curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $LISTALPHA_API_KEY" "https://api.listalpha.com/v1/investors?limit=1")
  - Bash(mkdir -p ~/.claude/plugins/cache/carta-development-tools/carta-crm)
  - Bash(touch ~/.claude/plugins/cache/carta-development-tools/carta-crm/.tutorial-seen)
args: []
model: haiku
---

# Carta CRM Tutorial

You are leading an interactive ~5-minute tutorial for a user of the
Carta CRM plugin. Present each section clearly, then **pause and wait
for the user to confirm before advancing**. A simple "ready", "next", or
"yes" is all they need to type. Be warm and practical — a colleague
learning a new tool, not a certification exam.

Do NOT run any real Carta CRM data commands. All entity data in the demo
section is fictional and hardcoded. Only run the commands listed in
`allowed-tools` (the API connectivity check and the completion marker touch).

**UX rules:**
- Gate-based: pause after every section, wait for confirmation
- All demo data is fictional — no real CRM records are read or written during demos
- Show real natural-language phrases so the user knows what to say
- Write `.tutorial-seen` marker at wrap-up

---

## Section 0 — Welcome

Present this to the user:

---

**Welcome to the Carta CRM plugin tutorial.**

This takes about 5 minutes. Here's what we'll cover:

1. What this plugin does and when to use it
2. Verifying your setup
3. How to kick off each skill — what to say
4. A demo walkthrough — 4 scenarios, 4 different CRM workflows

**First — are you a Carta CRM customer?**

Type **yes** to continue, or **no** if you're not sure.

---

Wait for the user to respond.

**If they say yes**, continue to Section 1.

**If they say no or they're not sure**, present:

---

The Carta CRM plugin requires an active Carta CRM subscription. Here's where to learn more and get access:

- **Deal CRM** (track portfolio companies and deal flow): https://carta.com/fund-management/deal-crm/
- **LP CRM** (manage LP relationships and fundraising): https://carta.com/fund-management/fund-administration/lp-crm/
- **Questions?** Chat with your Carta AE, or reach out to [crm@carta.com](mailto:crm@carta.com)

Once you have access, come back and say **"carta crm tutorial"** to start this walkthrough.

---

Stop here if the user is not a CRM customer.

---

## Section 1 — What This Plugin Does

Present this to the user:

---

The Carta CRM plugin lets you manage your CRM data conversationally — no
need to open the Carta web app for routine lookups and data entry.

It covers 6 types of records, with the ability to search, add, and update each:

| Record type | What it tracks |
|-------------|----------------|
| **Investors** | LPs, fund investors, and prospect relationships |
| **Companies** | Portfolio companies and prospects |
| **Contacts** | Individual people at companies or funds |
| **Deals** | Deal flow across your pipelines and stages |
| **Notes** | Meeting notes, call summaries, follow-ups |
| **Fundraisings** | Active and closed fundraises |

Companies also support **enrichment** — paste in a domain and Claude
automatically fills in description, industry, headcount, location, and tags
from public data.

**In normal use**, just describe what you want in plain English — "find
investors named Sequoia", "add a deal for Acme Corp Series A", "show me
notes about last week's meeting". Claude picks the right action automatically.

**What the plugin won't do on its own:**
- Bulk import records from a spreadsheet
- Delete records (use the Carta web app for that)
- Access cap table data — this is CRM data only

**The key shortcut:** Claude holds context across a conversation — once
you've found a record, you can act on it immediately without re-specifying
it. Search for an investor, then say "add a note for the second one" and
Claude knows exactly which record you mean.

---

Wait for the user to confirm before continuing.

---

## Section 2 — Verify Setup

Run the API connectivity check silently:

```bash
curl -s -o /dev/null -w "%{http_code}" -H "X-API-Key: $LISTALPHA_API_KEY" "https://api.listalpha.com/v1/investors?limit=1"
```

If the response is `200`, present this to the user:

---

Your API key is configured and working. You're ready to go.

---

Then move on. If the response is anything other than `200`, present this to the user:

---

Your API key doesn't appear to be set up yet. To use this plugin, you'll
need an API key from Carta and a one-time step to configure it.

**Step 1 — Get your API key**

- **Already a Carta CRM customer?** Contact [crm@carta.com](mailto:crm@carta.com) — they'll provide your key.
- **Not yet a customer?**
  - Deal CRM: https://carta.com/fund-management/deal-crm/
  - LP CRM: https://carta.com/fund-management/fund-administration/lp-crm/
  - Or chat with your Carta AE to get access.

**Step 2 — Configure it**

Once you have the key, just say:

> "Set my LISTALPHA_API_KEY to [your-key-here]"

Claude will add it to your Claude Code settings automatically. Then start a new conversation and come back to this tutorial.

---

If the check passed, confirm that and move on. If there are issues, help
them work through the steps above before continuing.

---

Wait for the user to confirm before continuing.

---

## Section 3 — How to Kick It Off

Present this to the user:

---

**You never need to name a specific skill.** Just describe what you want:

**Finding records:**

Say "find investors named [name]" or "search for companies in [industry]".
Claude will search and show you a table of matches. You can ask for more
("show next 20") or narrow the results ("only show ones tagged fintech").

**Adding records:**

Say "add a new investor [name]" or "create a deal for [company]".
Claude will ask for anything it needs — like which pipeline and stage for a
deal, or any custom fields your team tracks — then confirm before saving.

**Updating records:**

Say "update the deal for [company]" or "move Apex Analytics to Due Diligence".
Claude will show you what's there now, apply your changes, and confirm.

---

Wait for the user to confirm before continuing.

---

## Section 4 — Demo Walkthrough

Tell the user:

---

Now we'll work through **4 scenarios** for a fictional fund:
**Meridian Capital Partners**

This is demo data — nothing here is real. For each scenario I'll show what
the interaction looks like, then ask what you'd like to do — just like the
real plugin. Here's what's in the queue:

| # | Scenario | Outcome pattern |
|---|----------|-----------------|
| 1 | Search for an investor | Two matches found — you pick one |
| 2 | Add a new deal | Claude proposes defaults — you confirm |
| 3 | Add a meeting note | Plain language in — structured note out |
| 4 | Enrich a company by domain | Preview before saving — you approve |

Type **next** to start with scenario 1.

---

Wait for the user to say "next" before presenting Scenario 1.

---

### Demo Scenario 1 of 4 — Two matches found, you pick one

Present this scenario, then ask the user what they'd like to do:

---

**Scenario 1 of 4**

**You say:** "find investors named Redwood"

**Claude searches and finds 2 matches:**

| Name | Website | Location | Tags | Added |
|------|---------|----------|------|-------|
| Redwood Capital | redwoodcap.com | San Francisco, CA | fintech, B2B | Mar 12, 2024 |
| Redwood Ventures | redwoodvc.com | New York, NY | SaaS, enterprise | Jan 5, 2025 |

**Claude asks:** "Found 2 investors matching 'Redwood'. Want to see the
full profile for one of these, or narrow the search — say, by location
or tag?"

What would you like to do?
1. **Got it, move on** — I understand how search works
2. **What if there are 0 results?** — I want to know that case

---

Wait for the user to respond. Accept any reasonable phrasing.

**If they choose option 1**, confirm:

> **Why this matters:** Search is usually the starting point for any action —
> once you've found the right record, you can update it, add a note about it,
> or use it as context for a deal. Results include enough detail to tell records
> apart at a glance without having to open each one.
>
> Ready for scenario 2?

**If they ask about 0 results**, explain:

> Claude will say no matches were found and suggest trying a broader term or
> a different spelling. You can also just say "list recent investors" to browse
> what's been added recently without filtering.
>
> Ready for scenario 2?

---

### Demo Scenario 2 of 4 — Claude proposes defaults, you confirm

Present this scenario, then ask the user what they'd like to do:

---

**Scenario 2 of 4**

**You say:** "add a deal for Apex Analytics — raising a $12M Series A, just had first call on April 14"

Claude checks what pipelines Meridian has configured, then confirms before
saving anything:

> "I'll add Apex Analytics ($12M Series A) to your Deal Flow pipeline at
> the Intro stage — that's the default entry point. Want to start there,
> or set a different stage?"

You confirm: "go ahead"

**Claude tells you:** "Done — Apex Analytics is now in Deal Flow → Intro
(added April 17, 2026). Say 'move Apex Analytics to Due Diligence' when
you're ready to advance it."

What would you like to do?
1. **Got it, move on** — I see how deals work
2. **What if I want to set custom fields?** — I want to know more

---

Wait for the user to respond.

**If they choose option 1**, confirm:

> **Why this matters:** Claude always confirms the pipeline and stage before
> creating anything, so a deal never ends up in the wrong place. If you mention
> a stage that doesn't exist, Claude shows you your available stages and asks
> you to pick — no guessing.
>
> Ready for scenario 3?

**If they ask about custom fields**, explain:

> After the core fields, Claude will ask about any custom fields your team
> tracks — things like lead partner, source, or investment thesis. You can
> fill them in conversationally ("set the lead partner to Jane Smith") or
> skip them and update later.
>
> Ready for scenario 3?

---

### Demo Scenario 3 of 4 — Plain language in, structured note out

Present this scenario, then ask the user what they'd like to do:

---

**Scenario 3 of 4**

**You say:** "add a note from my meeting with Sarah Chen at Apex Analytics
— we discussed Q2 metrics, ARR is $4.2M growing 15% QoQ"

Claude pulls the title and content straight from your message — no
formatting needed:

> "I'll save this as 'Meeting with Sarah Chen — Apex Analytics' with your
> metrics in the body. Want to put it in a specific folder, or save it now?"

You confirm: "save it"

**Claude tells you:** "Note saved. Find it later with 'search notes about
Apex Analytics' or 'find my notes from today'."

What would you like to do?
1. **Got it, move on** — makes sense
2. **Can I edit the note later?** — I want to know more

---

Wait for the user to respond.

**If they choose option 1**, confirm:

> **Why this matters:** You don't need to structure your notes before saving —
> just describe the meeting in plain language and Claude figures out the title
> and body. That means you can capture notes right after a call, while the
> details are fresh, without any extra formatting steps.
>
> Ready for scenario 4?

**If they ask about editing**, explain:

> Just say "update my note about Sarah Chen at Apex Analytics" — Claude will
> find the note, show you what's there, and apply whatever changes you describe.
> If you have multiple notes that match, Claude will ask which one you mean.
>
> Ready for scenario 4?

---

### Demo Scenario 4 of 4 — Preview before saving, you approve

Present this scenario, then ask the user what they'd like to do:

---

**Scenario 4 of 4**

**You say:** "enrich the company record for apexanalytics.com"

Claude finds the Apex Analytics record and pulls in public data for that domain.
Before saving anything, it shows you what it found:

> "Here's what I found for Apex Analytics:
> - **Description:** AI-powered analytics platform for mid-market B2B SaaS companies
> - **Industry:** Software / Analytics
> - **Employees:** ~47
> - **Location:** Austin, TX
> - **Tags:** B2B, SaaS, AI/ML, analytics
>
> Shall I apply these to the company record?"

You confirm: "yes"

**Claude tells you:** "Done — company record updated with description,
industry, headcount, location, and tags."

What would you like to do?
1. **Got it, wrap up** — that covers everything
2. **What if the domain returns no data?** — I want to know that case

---

Wait for the user to respond.

**If they choose option 1**, confirm:

> **Why this matters:** Enrichment saves the manual work of looking up and
> typing company details. Claude shows you the preview before writing anything,
> so if the data looks wrong — wrong company, outdated headcount — you can
> cancel and fill in the fields yourself.
>
> That's all 4 scenarios. Type **next** to wrap up.

**If they ask about no data**, explain:

> Claude will tell you nothing was found and won't touch the record. Try the
> company's primary domain (`apexanalytics.com` not `blog.apexanalytics.com`).
> If enrichment consistently returns nothing, just fill in the fields yourself
> with "update company Apex Analytics".
>
> Type **next** to wrap up.

---

Wait for the user to indicate they are ready before moving to Section 5.

---

## Section 5 — Wrap-Up

Run the completion marker:

```bash
mkdir -p ~/.claude/plugins/cache/carta-development-tools/carta-crm
touch ~/.claude/plugins/cache/carta-development-tools/carta-crm/.tutorial-seen
```

Then present the wrap-up:

---

**You're all set.** Here's a quick reference for the 4 scenarios:

| Scenario | What to say | What happens |
|----------|-------------|--------------|
| Search investors | "find investors named [name]" | Table of matches |
| Add a deal | "add a deal for [company], [stage]" | Deal created in your pipeline |
| Add a note | "add a note from my meeting with [name]..." | Note saved and searchable |
| Enrich a company | "enrich [company] using [domain]" | Company record auto-populated |

**Common phrases:**

| What you want | What to say |
|---------------|-------------|
| Find any record | "find [investors / companies / contacts / deals] named [name]" |
| Add a record | "add a new [investor / company / contact / deal]" |
| Update a record | "update the deal for [company]" or "move [company] to [stage]" |
| Enrich a company | "enrich [company] using [domain]" |
| Browse fund LPs | "show fund portfolio for [fund name]" |

**To start using the Carta CRM plugin for real:**

Just describe what you need — "find the deal for Acme Corp", "add Sarah
Chen as a contact at Apex Analytics". Claude handles the rest.

**To re-run this tutorial any time:**

Say "carta crm tutorial" or "how do I use carta crm"

**Need help?** → [crm@carta.com](mailto:crm@carta.com)

---

Confirm to the user that their tutorial progress has been saved and they
won't be prompted to take it again (though they can re-run it on demand
at any time).
