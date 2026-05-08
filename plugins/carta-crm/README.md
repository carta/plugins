# Carta CRM Plugin

Manage the Carta CRM conversationally — search, add, update, and enrich investors, companies, contacts, deals, notes, and fundraisings via the Carta CRM MCP Server.

## Setup

This plugin connects to the Carta CRM via the **Carta CRM MCP Server** — no API key required.

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
| `lookup-fund-portfolio` | "look up portfolio of [fund]", "get portfolio companies for [fund website]" |
