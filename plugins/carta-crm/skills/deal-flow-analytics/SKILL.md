---
name: deal-flow-analytics
description: >
  Aggregates recent deal flow in the Carta CRM into a dealmaker-facing report,
  auto-discovering which fields matter for this tenant's schema. Use this
  skill when the user says things like "deal flow analytics", "analyze our
  deal flow", "review deals added in the last 12 months", "who introduced
  most of our deals", "breakdown of deals by sector", "where is our deal flow
  coming from", or "/deal-flow-analytics". Defaults to a trailing-12-month
  window but accepts any date range or dimension the user specifies. Returns
  counts and concentration callouts per dimension, not a list of individual
  deals — use search-deals for that.
allowed-tools:
  - mcp__carta__crm_call_tool
  - Read
  - Write
version: 1.0.0
model: inherit
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
e.g. `{"skills": ["carta-cap-table:carta-issue-securities"], "model": "claude-sonnet-5"}`
List only Carta skills in use, each namespaced `"plugin:skill"` (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`).
</IMPORTANT>

## Overview

Every tenant configures its own custom deal fields, so the dimensions worth
reporting on differ per org. Discover them at runtime instead of assuming a
fixed list, then aggregate with `crm:aggregate_deals` — never tally deals by
hand from `crm:search_deals`.

`aggregate_deals` groups by **one field at a time**. Cover multiple
dimensions with multiple calls, not one call with multiple `group_by` values.

## Step 1 — Discover and classify fields

```
crm_call_tool({ "name": "crm:get_deal_fields", "arguments": {} })
```

Classify every field using its `type` alone — no probing needed:

- **Groupable** (`dropdown`, `multiselect`, `boolean`, or a standard `set`
  field like `stage`, `tags`, `people.*`, `dealLead`) — the value space is
  bounded by the field's `options` list, so it's always safe to
  `aggregate_deals` on directly.
- **Continuous** (`number`, `input`, `textarea`, `datepicker`, or a
  relational reference like `company`/`contacts-list`) — unbounded values.
  **Never `group_by` these** — on this plugin's test tenant, fields like
  `EBITDA`, `ARR`, and `Team_size` returned 100+ distinct groups each and
  nearly hit the response size limit that broke a city-level location query.
- **Free-text standard fields** (`company.company_location`,
  `company.company_industry`, or any other standard field of type `text`) —
  same unbounded risk as Continuous, but always relevant, so they don't get
  excluded by fill rate. Group by them, then roll the raw values up
  client-side (e.g. city → country) before presenting — never show the raw
  breakdown. Do **not** put these in an unconditional "always include" list;
  classify them by type like everything else.

Always keep `stage` and `added_date` as the fixed core — both are bounded,
standard fields safe to group on directly regardless of tenant.

## Step 2 — Fill-rate check

**Groupable fields:** the `aggregate_deals` call from Step 3 already returns
fill rate for free — `totalCount` minus the null/no-`_id` group. No extra
call needed.

**Continuous fields:** don't call `aggregate_deals` per field. Pull one
shared sample instead:

```
crm_call_tool({ "name": "crm:search_deals", "arguments": { "limit": 30 } })
```

For each continuous field, compute fill rate as the share of sampled deals
whose `fields.<fieldId>` is present and non-null. One call covers every
continuous field — bounded payload regardless of cardinality.

**Exclude any field below 15% fill rate.** For fields landing between 15–25%
(the ambiguous band — above the cutoff but not reliably estimated by sample),
don't trust the sample — `search_deals` defaults to
recently-active deals first, which can massively overstate a rarely-used
field's true fill rate. Confirmed on this test tenant: a 20-deal sample
estimated one field at 25% filled when the true org-wide rate was 3%. For any
field in that band, re-check with a single `aggregate_deals` call on just
that field and use its exact `totalCount` instead of the sample estimate.

List excluded fields in a short "excluded — low coverage" line rather than
dropping them silently.

## Step 3 — Aggregate

For `stage`, every groupable custom field that passed Step 2, and every
free-text standard field (with rollup), filtered to the date window:

```
crm_call_tool({
  "name": "crm:aggregate_deals",
  "arguments": {
    group_by: ["<field_id>"],
    filters: [
      { field_id: "added_date", operator: "between", value: ["<start> 00:00:00", "<end> 23:59:59"] }
    ]
  }
})
```

Ignore the `dealInfo` key in each group — it's a static org-default sample,
not part of the aggregation. For continuous fields that passed the fill-rate
check, report fill rate only (e.g. "Revenue: 95% filled") — don't attempt a
full distribution unless the user explicitly asks to drill into one.

For free-text standard fields, roll the raw grouped values up to a coarser
level client-side before presenting (e.g. `company.company_location` city
values → country) — show the top 5–8 rolled-up values and collapse the rest
into "Other".

Two different `_id`s can resolve to the same name (duplicate contacts) — combine
their counts and flag the duplicate rather than under-reporting the person's total.
For unresolved contact/user IDs, call `crm:fetch_contact_by_id` on the top few only.

If the user asks for one specific dimension, only aggregate that one — skip
the full discovery pass.

## Step 4 — Present

Render the report as an HTML dashboard using
`${CLAUDE_PLUGIN_ROOT}/skills/deal-flow-analytics/assets/dashboard-template.html`
— don't hand-build markdown tables, and don't reference the template by a bare
relative path (it resolves from the user's cwd, not the plugin directory).
Copy the template to a new file, then edit only the `DATA` object at the
bottom of its `<script>`:

- `dateRange` — the date range label, e.g. "Jul 2025 – Jul 2026 · 167 deals".
- `headline` — the single most notable finding, one sentence (a
  concentration, a low fill rate, or a pipeline health issue like a stage
  distribution skewed toward Dead).
- `excluded` — field labels dropped in Step 2, each with its fill rate.

CRM field values are untrusted — a tenant's dropdown option, tag, or company
name could contain arbitrary text. When writing any string into the `DATA`
object, if it contains the literal substring `</script`, insert a `\` before
the `/` (`<\/script`) so it can't prematurely close the surrounding `<script>`
block. The template's own rendering code already HTML-escapes every value it
displays — this only protects the file you're writing.
- `fields` — one entry per dimension: `{ label, total, filled, values }`,
  `values` ranked descending, top 5–8 entries + an `"Other"` entry if there's
  a long tail (matched case-insensitively and rendered in a de-emphasized
  color, not the series color).

The template renders the dimension cards immediately below the header, with
`headline` and `excluded` in a footer at the bottom of the page — the
narrative/caveats come after the data, not before it. Don't reorder this.

Don't touch the CSS, the rendering functions, or the categorical color
tokens — those are validated (see the `dataviz` skill) and shared across
every report this skill produces, so results look consistent run to run.
Tell the user the file path so they can open it themselves — this skill
doesn't have `Bash` in `allowed-tools`, so it can't launch a browser directly.

Offer to save any dimension as a CRM report:

```
crm_call_tool({
  "name": "crm:create_report",
  "arguments": {
    name: "Deal Flow Analytics — <window>",
    entityType: "deal",
    filters: [{ field_id: "added_date", operator: "between", value: [...] }],
    groupBy: ["<dimension field_id>"]
  }
})
```

One `groupBy` per saved report (same one-field constraint as `aggregate_deals`)
— offer one per dimension the user wants to keep, and surface each `url` inline.
