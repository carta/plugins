# First prompts by role

Pick the row from `sections.access` of `cap_table:get:company`. Each prompt is a published
Skill Directory prompt (`.claude-plugin/skill-directory.json`), so it routes to a skill the
user has. Put the company name in place of `{{COMPANY}}`.

| Role | Plain words | What you can do here |
|---|---|---|
| `admin` or `editor` | an admin | Look up and export the cap table, check vesting and conversions, track valuations, rounds and deadlines, and issue or draft new equity. |
| `limited_admin`, or `is_limited_admin` is true | a limited admin for some share classes | Look up and export the share classes you manage, and check vesting. Totals cover only those share classes. |
| `viewer` or `hr_admin` | a viewer | Look up grants, vesting and signatures. Ask an admin of the company to issue or change equity. |

## Full admin (`admin`, `editor`)

1. "Issue a 10,000-share NSO grant to [employee name] at {{COMPANY}}"
2. "Show me every option grant at {{COMPANY}} with its holder, quantity, and status"
3. "Is the option pool running low at {{COMPANY}}?"

## Limited admin (`limited_admin`)

1. "List every outstanding security for {{COMPANY}} with its share class and quantity"
2. "Export the cap table report for {{COMPANY}} to Excel"
3. "Show me the vesting schedule for [employee name]'s RSUs at {{COMPANY}}"

## Default (`viewer`, `hr_admin`)

1. "How much has [employee name]'s option grant vested so far?"
2. "Which grants at {{COMPANY}} are still waiting on a witness signature?"
3. "Show me every option grant at {{COMPANY}} with its holder, quantity, and status"

## An empty company

When `sections.share_classes.count` is 0 or `sections.equity_plans.count` is 0, put the
setup steps that apply before "Try one of these", as numbered steps without quotes. Then
give the role's 3 prompts as usual. A null section is not empty: it means the role cannot
see it, so give no setup step for it.

1. No share classes: Add your share classes on the **Manage share classes** page in Carta.
2. No equity plan: Create your equity plan on the **Equity plans** page in Carta.
