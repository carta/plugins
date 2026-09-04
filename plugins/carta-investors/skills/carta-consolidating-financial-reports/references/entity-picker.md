# Reference: pick the entities to consolidate

A consolidating report spans more than one entity, so the user has to be able to
say which ones. Asking only "which firm?" and then rolling up everything
underneath is the single most common surprise on these reports — the customer
reads "firm" as the management company and does not expect fund-level numbers to
be silently folded in (or a specific fund's numbers to be unavailable on their
own).

This reference defines the picker. It runs in Gate 0 of
`carta-consolidating-financial-reports`, after the firm is resolved and before the
period question.

## Workflow

### 1. List entities under the active firm

```
call_tool({"name": "fa__list__entities", "arguments": {}, "_instrumentation_v2": {"skills": ["carta-investors:carta-consolidating-financial-reports"]}})
```

The response is a list of `{id, name, type, ...}` records. Entity-type labels
vary by firm and change over time, so do **not** hard-code an exact match on
`type`. Treat the data defensively and fall back to the name heuristics below.

**If the call returns exactly one entity:** don't show a picker. Tell the user
the firm has a single entity, so a consolidating report is just that entity's
statement, and offer `carta-investors:carta-explore-data` instead. Stop.

**If the call returns zero entities:** the firm resolved but has no Fund Admin
entities. Say so plainly and stop — do not fall back to a firm-wide query.

### 2. Classify each entity

Apply these rules **in order — first match wins** — to label each entity:

| Label | Heuristic |
|---|---|
| `ManCo` | name contains any of `Management`, `Mgmt`, `ManCo`, OR ends in `Capital, LLC` / `Partners Management`, AND does **not** contain `Fund`, `SPV`, `LP`, `Co-Invest`, `Bridge` |
| `Fund` | name contains `Fund` |
| `SPV` | name contains `SPV`, `Co-Invest`, `Bridge` |
| `Other` | anything else — don't guess, leave as `Other` |

Prefer the API's own `type` when it is present and unambiguous; use the name
heuristics only to fill gaps.

### 3. Build the picker

Use `AskUserQuestion`. **The cap is 4 options per question and options beyond
the fourth are silently dropped**, so the shape depends on how many entities the
firm has.

Recommended question phrasing:

> Which funds and entities should I include in this report?

**Never phrase this as "which firm?"** The firm is already resolved; this
question is about scope within it.

#### Case A — 3 or fewer entities

One question, one option per entity, plus a final **"All of them"** option.
Mark **"All of them"** as `← recommended` in its *description* (not the label).

#### Case B — 4 or more entities

Two steps, because the per-entity list won't fit.

**Step 1 — scope shape** (one `AskUserQuestion`, 4 options):

| # | Label | Description |
|---|---|---|
| 1 | All entities under the firm | Every entity Carta has for this firm — N in total. Recommended. |
| 2 | Just the management company | Only the ManCo, excluding funds and SPVs. |
| 3 | Just the funds | Every entity classified as a fund — M in total. |
| 4 | Let me pick specific entities | I'll list them and you choose. |

Substitute the real counts for N and M. Omit option 2 if no entity classified as
`ManCo`, and omit option 3 if none classified as `Fund` — then backfill with
option 4 so the user always has a way to choose precisely.

**Step 2 — only if the user picked "Let me pick specific entities":** list the
entities in plain text as a numbered list (this is the one place a text list is
correct — it is a reference the user reads, not a chooser), then ask them to
reply with the numbers they want:

> Here are the entities under [FIRM_NAME]. Reply with the numbers you'd like
> included — for example "1, 3, 4".
>
> 1. Acme Capital Management, LLC — management company
> 2. Acme Ventures Fund I, LP — fund
> 3. Acme Ventures Fund II, LP — fund
> 4. Acme Opportunities SPV — SPV

Group management companies first, then funds, then SPVs, then `Other`, and label
each with its classification in plain English. Never show entity UUIDs.

Parse the reply into the selected set. If a number is out of range or the reply
can't be parsed, re-ask once, echoing the valid range. After a second failure,
default to all entities and say so in one sentence.

### 4. Handle the picks

| User picks | `<ENTITY_SCOPE>` |
|---|---|
| "All of them" / "All entities under the firm" | `all` |
| "Just the management company" | the explicit list of entities classified `ManCo` |
| "Just the funds" | the explicit list of entities classified `Fund` |
| Specific entities | the explicit list they chose |

Store `<ENTITY_SCOPE>` as either the literal string `all` or a list of
`{name, uuid}` records. Keep both: the name is what the journal-entries table
filters on, and the UUID is what disambiguates two entities that share a display
name. Never show the UUID to the user.

### 5. Confirm the scope in plain English

State the resolved scope once, in the pre-build review the report shows — not as
a separate message here. Name the entities when there are 5 or fewer; otherwise
give a count and the classification mix:

- 5 or fewer: *"Consolidating across Acme Capital Management, Acme Ventures Fund I, and Acme Ventures Fund II."*
- More than 5: *"Consolidating across 12 entities — 1 management company, 9 funds, 2 SPVs."*

## How the report applies the scope

`<ENTITY_SCOPE>` is passed down at Dispatch. The reports aggregate by account
across entities, so scoping is a `WHERE` clause on the entity dimension, not a
change to the grouping:

- `all` → no entity filter, exactly the existing firm-wide behaviour.
- an explicit list → add `AND FUND_NAME IN (<names>)` alongside the existing
  `FIRM_ID` predicate. `FUND_NAME` is the journal-entries table's entity display
  name (see each report's `references/schema.md`). The
  `GROUP BY ACCOUNT_TYPE, ACCOUNT_NAME` still rolls the same account up across
  every entity that survived the filter, so the output shape is unchanged — only
  the population it sums over narrows.

Two cautions:

- **Quote and escape the names.** Entity legal names routinely contain commas,
  periods, and apostrophes (`Acme Ventures Fund I, L.P.`). An unescaped
  apostrophe breaks the query.
- **Verify the column against the schema file before writing the clause.** The
  DWH contract drifts and `references/schema.md` is the source of truth. If a
  report's schema documents a distinct entity-UUID column, prefer that over
  matching on a display name.
