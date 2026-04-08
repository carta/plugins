# Carta CRM Plugin

Manage the Carta CRM conversationally — search, add, update, and enrich investors, companies, contacts, deals, notes, and fundraisings via the public API.

## Setup

Set the following environment variable before using this plugin:

```bash
export LISTALPHA_API_KEY="your-api-key-here"
```

You can find your API key in the Carta CRM app under Settings → API Keys.

## Usage

Just tell Claude what investor you want to add:

> "Add Sequoia Capital to the CRM — their website is sequoiacap.com and they focus on early-stage tech."

> "Upload these three investors: a16z, Benchmark, and Founders Fund."

> "Create an investor record for Accel Partners with location Palo Alto, CA."

Claude will collect any missing required information, then create the record(s) via the API and confirm the result.

## Skills

### Add records
| Skill | Trigger phrases |
|-------|----------------|
| `add-investor` | "add investor", "add investor to Carta CRM", "create investor record", "add VC fund to CRM" |
| `add-company` | "add a company", "create company record", "add company to CRM" |
| `add-contact` | "add a contact", "create contact record", "add contact to CRM", "save a contact" |
| `add-deal` | "add a deal", "create a deal", "log a deal", "add deal to CRM" |
| `add-note` | "add a note", "create a note", "log a note", "add note to CRM" |
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
