# Carta CRM Plugin

Manage the Carta CRM conversationally — search, add, update, and enrich investors, companies, contacts, deals, notes, and fundraisings via the Carta CRM MCP Server.

## Setup

This plugin talks to the Carta CRM through the **Carta CRM MCP Server**. You sign in with your
normal Carta CRM account.

On first use, Claude will prompt you to authenticate:

1. Claude will display an authorization URL — open it in your browser
2. Log in with your Carta CRM credentials
3. After authorizing, the browser redirects to a `localhost` URL (the page may fail to load — that's expected)
4. Copy the full URL from the browser address bar and paste it back into Claude
5. Done — your session is authenticated and you can start using the plugin

Authentication persists across sessions so you only need to do this once.

## Usage

Just describe what you want in plain English:

> "Add Sequoia Capital to the CRM — their website is sequoiacap.com and they focus on early-stage tech."

> "Find all deals in the Due Diligence stage."

> "Move the Apex Analytics deal to Tracking."

> "Add a note to the Stripe deal — met with Sarah Chen, ARR is $4.2M growing 15% QoQ."

Claude will collect any missing required information, call the right MCP tools, and confirm the result.

## Skills

### Add records
| Skill | Trigger phrases |
|-------|----------------|
| `add-investor` | "add investor", "add investor to Carta CRM", "create investor record", "add VC fund to CRM" |
| `add-company` | "add a company", "create company record", "add company to CRM" |
| `add-contact` | "add a contact", "create contact record", "add contact to CRM", "save a contact" |
| `add-deal` | "add a deal", "create a deal", "log a deal", "add deal to CRM" |
| `add-note` | "add a note", "log a note", "add note to a deal" |
| `add-fundraising` | "add a fundraising", "create a fundraising", "log a fundraising round" |

### Search & retrieve
| Skill | Trigger phrases |
|-------|----------------|
| `search-investors` | "find an investor", "search investors", "look up an investor" |
| `search-companies` | "find a company", "search companies", "look up a company" |
| `search-contacts` | "find a contact", "search contacts", "look up a person" |
| `search-deals` | "find a deal", "search deals", "show me deals for [company]" |
| `search-notes` | "find a note", "search notes", "look up a note" |
| `search-fundraisings` | "find a fundraising", "search fundraisings", "show fundraising pipeline" |

### Update records
| Skill | Trigger phrases |
|-------|----------------|
| `update-investor` | "update an investor", "edit investor", "update investor details" |
| `update-company` | "update a company", "edit company", "update company details" |
| `update-contact` | "update a contact", "edit contact", "update contact details" |
| `update-deal` | "update a deal", "move deal to [stage]", "change deal stage" |
| `update-note` | "update a note", "edit note", "update note content" |
| `update-fundraising` | "update a fundraising", "edit fundraising", "update fundraising details" |

### Research & enrichment
| Skill | Trigger phrases |
|-------|----------------|
| `enrich-company` | "enrich this company", "look up company info", "research this company" |

### Analytics & reporting
| Skill | Trigger phrases |
|-------|----------------|
| `deal-flow-analytics` | "deal flow analytics", "analyze our deal flow", "who introduced most of our deals", "breakdown of deals by sector", "deal flow by geography" |

### Meeting prep
| Skill | Trigger phrases |
|-------|----------------|
| `prepare-for-meeting` | "prepare me for my meeting", "meeting brief", "brief me for this meeting", "prep for upcoming meeting", "what do I need to know before my call with [company]" |

Builds a one-page tear sheet for **the next upcoming meeting** with a counterparty, from CRM
data only:

> "Prepare me for my meeting with Meridian Growth Partners."

It resolves the meeting from whichever handle you give it — a deal, investor, fundraising,
company, person, or just an email domain — reading that entity's `futureInteractions` for the
next event. It then compiles the invitees and their history, the organization's notes and
relationship status, related CRM objects, warm paths, and suggested questions into a rendered
brief.

**Where the brief appears.** In Cowork it renders inline as an artifact. Everywhere else you
get a PDF link, and in Claude Code an HTML file on disk. Re-running it for the same meeting
updates the existing artifact rather than creating a second one.

**Scope.** One meeting — the next one. This is not an agenda view and there is no date-range
mode. Fields the CRM does not hold (RSVP status, meeting duration) are omitted rather than
guessed at.

### Warm introductions
| Skill | Trigger phrases |
|-------|----------------|
| `get-angles` | "how can I get introduced to [company]", "who do I know at [company]", "find intro angles into [company]", "warm intro to [company]", "any connections at [domain]" |

Finds your best way into a company you have no relationship with, and then sets it up:

> "How can I get introduced to Tunic Pay?"

It resolves the company's domain, reads your network overlap alongside your own firm's history
with that domain, and ranks the routes by whether they can actually be walked — a contact you
know who overlapped in tenure with a Director beats a stranger who shared an employer with the
CEO but never at the same time. You get an interactive route map, a drafted introduction
request to the connector, and the option to have Claude create the email draft, log the request
on the deal, and add the target to the CRM.

**Two things it deliberately does.** It tells you when a colleague is already in conversation
with the company, so you don't ask a near-stranger for an intro into an account your own firm
is working. And it stops rather than padding the list when no genuinely warm route exists.

**Where the map appears.** As an interactive artifact wherever your host renders one; in Claude
Code, as an HTML file you can open in a browser. The follow-through actions run as buttons in
the panel where the host supports it, and in the conversation everywhere else.

## Data & Privacy

This plugin collects telemetry to improve reliability and performance. Data collected includes session context, model configuration, and plugin activity. See [Carta's Privacy Policy](https://carta.com/legal/privacy/privacy-policy/) for details.
