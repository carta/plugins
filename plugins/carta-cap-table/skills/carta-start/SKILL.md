---
name: carta-start
description: >
  The entry point for a company's cap table in Carta. Use when the user says "get
  started", "what can you do with Carta", "what can Claude do with my cap table", or
  "show me what you can do": it shows their company, what their role can do and three
  prompts to try, then sets up their Carta Home. Not for a direct build, rebuild or open
  of Carta Home: that is carta-captable-home-build. Not for a fund firm: use the
  carta-investors skills.
model: sonnet
allowed-tools:
  # The plugin's Artifact gate and this skill's prompts.
  - Read
  - ToolSearch
  - mcp__carta__skill_checkpoint
  - mcp__claude_ai_Carta__skill_checkpoint
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__skill_checkpoint
  - mcp__carta__read_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  # Picks between companies.
  - AskUserQuestion
  - Skill(carta-cap-table:carta-captable-home-build)
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.110.1</carta-plugin>

# Carta start

Shows a user what Claude can do with their company's cap table, then sets up their Carta
Home with carta-captable-home-build.

## Step 1: Start

Call `skill_checkpoint` with `skill_name="carta-cap-table:carta-start"` and
`checkpoint_label="skill_started"`. Say nothing about it.

## Step 2: Pick the path

For "get started", first read `${CLAUDE_PLUGIN_ROOT}/references/gate-has-artifact-tool.md`
(the plugin's own `references/`, not this skill's) by that exact path; do not search for
it. Use it only to decide the path: never show its failure message here.

| The user asks to | Do |
|---|---|
| Get started, and the gate passes | Step 3, then Step 4 |
| Get started, and the gate fails | Step 3 only |
| Know what Claude or Carta can do | Step 3 only |

## Step 3: Show the company and what to try

Make one call. Do not call `list_accounts` first. Pass no company unless the user named one:

```
read_tool({"name": "cap_table__get__company", "arguments": {}})
```

When the user named a company: `"arguments": {"company": "<company name>"}`.

- **`ambiguous` error**: the user has more than one company. Ask with `AskUserQuestion`,
  one option per entry in `did_you_mean`, then call again with
  `"arguments": {"company": <id>}`.
- **Error that says the company is missing**: the user has no cap table company on this
  Carta connection. Run Step 5, then say so in one line and ask for the company name as
  Carta shows it. Do not list what Claude can do. That reply is the end of this skill.
- **Any other error**: run Step 5, then say that Carta did not answer. That reply is the
  end of this skill.

Read these fields of the result:

- the company: `meta.company.name`
- the role: `sections.access.role` and `sections.access.is_limited_admin`
- the facts: `sections.share_classes.count`, `sections.equity_plans` (count and
  `available_quantity` per plan), the first row of `sections.valuations` (price and
  `expiration_date`), `sections.health_checks.open_count`, and `blockers`

A section is null when the role cannot see it. Never say a null section is empty, and
never fill in a value that is not in the result.

Read `references/first-prompts.md` in this skill's own directory
(`${CLAUDE_PLUGIN_ROOT}/skills/carta-start/references/first-prompts.md`). It maps the role
to what the user can do and to 3 prompts. Run Step 5 now, unless Step 4 comes next. Then
reply in this shape, and keep it short:

> **<Company>** — you are <role in plain words>.
>
> - <2 to 4 key facts, each with its unit, currency and as-of date>
>
> **What you can do here:** <the role's line from first-prompts.md>
>
> **Try one of these:**
> 1. "<prompt>"
> 2. "<prompt>"
> 3. "<prompt>"

Write each prompt with the company name in place of `{{COMPANY}}`. Keep every
`[square bracket]` blank: the user fills it in. Never tell the user to type a message that
starts with `/`.

When the user asked what Claude or Carta can do, end with one line: "Say 'Build cap table
home' to get a live Carta Home page for <Company>." When Step 3 is the whole path, that
reply is the end of this skill.

## Step 4: Set up Carta Home

Run Step 5, then invoke `Skill('carta-cap-table:carta-captable-home-build')` and follow it to
build Carta Home for the company from Step 3.

## Step 5: Finish

Call `skill_checkpoint` with `skill_name="carta-cap-table:carta-start"` and
`checkpoint_label="skill_finished"` once, before your last reply or the hand-off to
carta-captable-home-build. Say nothing about it, and never add a summary of what you did.
