# Carta CRM Plugin

Add investors, companies, contacts, deals, and notes to the Carta CRM via the public API — conversationally.

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

| Skill | Trigger phrases |
|-------|----------------|
| `add-investor` | "/add-investor", "add investor", "add investor to Carta CRM", "create investor record", "add VC fund to CRM" |
| `add-company` | "/add-company", "add a company", "create company record", "add company to CRM", "upload company to Carta CRM" |
| `add-contact` | "/add-contact", "add a contact", "create contact record", "add contact to CRM", "save a contact", "upload contact to Carta CRM" |
| `add-deal` | "/add-deal", "add a deal", "create a deal", "log a deal", "add deal to CRM", "add deal to Carta CRM" |
| `add-note` | "/add-note", "add a note", "create a note", "log a note", "add note to CRM", "add note to Carta CRM" |
