---
name: carta-field-definitions
description: >-
  Explain what a column in a Carta report means. For users already working with a
  specific Carta cap-table report. Trigger ONLY when the user (a) names a Carta report
  (e.g. "securities ledger", "cap table report", "stakeholder ownership details",
  "exercised and settled", "equity plan", "vesting details") AND asks about one of its
  columns/fields, OR (b) the conversation has already invoked the carta-reporting skill
  or shown report data and the user follows up asking what a column means. Do NOT
  trigger for bare "what does [term] mean?" questions, general cap-table concept
  questions, or any prompt that does not place the question inside a specific report
  context.
allowed-tools:
  - Read(${CLAUDE_PLUGIN_ROOT}/skills/carta-field-definitions/glossary.md)
  - AskUserQuestion
---

<!-- carta:plugin-version -->
<carta-plugin>carta-cap-table:6.114.12</carta-plugin>

<!-- Part of the official Carta AI Agent Plugin -->

# Field Definitions

Clarify column and field definitions for users already working with a specific Carta cap-table report — name, response type, where it appears across tabs.

## Trigger context (read this FIRST)

This skill is only useful when the question is anchored to a specific Carta report. Before doing anything else, confirm at least one of these is true. If none are, **do not invoke this skill** — let another skill handle the request or answer it conversationally.

1. **User explicitly names a Carta report** in the current prompt — e.g. "securities ledger", "cap table report", "stakeholder ownership details", "exercised and settled", "equity plan", "vesting details", or another report name from `reporting:search:report_types`. The user is asking what a column on that report means.
2. **A previous turn established a reporting context** — the conversation has already invoked the `carta-reporting` skill, fetched report data, or the user is currently iterating on a report (filters, columns, exports). The user follows up with "what does [column/field] mean here?" / "what's [column]?" — implicitly about the report on screen.
3. **User uses report-shaped vocabulary** — words like "column", "report tab", "field on the report", "this column", "the [name] column" tied to a Carta cap-table report.

If the user just asks "what does X mean?" with no report context — for example, a bare conceptual question about cap-table terminology — **decline this skill**. Concept-only questions are out of scope; another skill or a plain-text answer is more appropriate.

## When to Use (examples — note all carry report context)

- "What does the **Quantity Outstanding** column on the securities ledger show?"
- "I'm running the cap table report — what does **Fully Diluted Ownership** mean here?"
- "What's the difference between **Outstanding Shares** and **Fully Diluted Shares** on this report?"
- "On the stakeholder ownership details report, what is **Cash Paid** in the Convertibles tab?"
- "Which report has the **Vesting Start Date** column?"
- "What does the **Reserved Shares in Plan** column on the equity plan report show?"
- "I'm looking at the vesting details report — what does **Total vested during the period** mean?"

## When NOT to Use

- **No report context** — bare "what does [term] mean?" with no mention of a report, column, or active reporting flow. Let it route to general Q&A.
- **Concept questions about cap tables in general** — e.g. "what is a SAFE?", "what does liquidation preference mean conceptually?", "explain ISOs" — these are not column-on-a-report questions.
- **Calculation questions** ("How is [field] calculated?", "What's the formula?") — redirect to [support.carta.com](https://support.carta.com/kb/en/).
- **Blank-value diagnosis** ("Why is [field] empty for this grant?") — redirect to support.
- **Grant- or stakeholder-specific data** — use `carta-cap-table` for a single fact, or `carta-reporting` for a list.
- **Report generation / export** — use `carta-reporting` to generate, filter, or download a report. This skill answers questions *about* report columns; it does not generate reports.

The glossary is Corp-primary; LLC entities are supported via terminology substitution — see **LLC mode** below.

## Workflow

### Step 0 — Screen the question before loading

If the user's question is about **how** a field is computed ("how is X calculated?", "what's the formula for X?", "how does Carta derive X?") or **why** a value is blank/surprising ("why is my X empty?", "why is X zero?"), this is out of scope. **Do not load the glossary.** Redirect directly to [support.carta.com](https://support.carta.com/kb/en/) and stop.

The glossary covers *what* a field represents and *where* it appears — never *how* it's computed. Even if a definition text contains a formula fragment, do not surface it in response to a calculation question; treat the whole question as out of scope.

### Step 1 — Load the glossary

```
Read("${CLAUDE_PLUGIN_ROOT}/skills/carta-field-definitions/glossary.md", offset=1, limit=300)
Read("${CLAUDE_PLUGIN_ROOT}/skills/carta-field-definitions/glossary.md", offset=301, limit=300)
```

The file is larger than one `Read` returns, so read it in parts of 300 lines. Continue with
`offset=601` and up until a part returns fewer than 300 lines. Use only `Read`: never Bash,
`grep` or `Glob`, which cannot reach plugin files in Cowork.

The file contains all field definitions grouped by report in markdown tables. Each row has four columns: **Field** | **Type** | **Tabs** | **Definition**.

### Step 2 — Search the loaded content

Apply any **LLC mode** substitutions to the user's query before searching (see below). Then scan all table rows for rows where the **Field** column contains all whitespace-split tokens of the field name the user asks about (case-insensitive). "Exercise Cost" should match "Total Cost to Exercise" because both tokens appear as substrings.

- **0 matches** → Scan the **Field** column across all reports for the 2–3 closest-spelling field names. Use `AskUserQuestion`: _"I didn't find '[query]' exactly — did you mean one of these?"_ listing the candidates. If the user picks one, re-search with that name and re-enter Step 2. If none fit, redirect to [support.carta.com](https://support.carta.com/kb/en/) and stop. Do not fabricate a definition.
- **1 match** → Use that row directly; go to Step 3.
- **>1 matches** → Before disambiguating, scan the **current prompt and prior conversation** for any report (and tab) context the user has already established (e.g., "I'm looking at the securities ledger", "on the cap table report", "I have the stakeholder ownership details open"). If the report (and tab, if given) context leaves **exactly one** match, **select that row silently** — do not ask the user to disambiguate. Then in Step 3, add a cross-report note: _"This field also appears on the [Other Report] report."_ — one sentence is enough. If no report context exists, none of the matches fit the established report, or two or more matches stay, use `AskUserQuestion` to disambiguate. This includes one field on two or more tabs of the named report when the user did not name the tab. Do not answer with the closest match or with a list of all matches instead. Present each candidate by **Field** name + its **Tabs** column so the user can tell them apart. **Two rows may share the same Field name but appear under different reports or tabs** — always include the report section heading and tabs in the option label. Once the user picks, use that specific row; go to Step 3.

### Step 3 — Render the answer

Use the short template in **Presentation** below. Quote the **Definition** cell verbatim or lightly tightened — do not add calculation formulas, code references, or blank-value diagnosis.

**Cross-report note (required when applicable):** Before rendering, scan all rows in the glossary for any other rows with the same **Field** name in a different report section. If the same field name appears under more than one `## <Report>` heading, append a one-sentence cross-report note after the "where it appears" line: _"This field also appears on the [Other Report] report."_ Include all other reports where the field appears, not just one.

## Gates

**Required inputs**: none — the glossary is not firm-scoped.

**AI computation**: No — the skill returns Carta-curated definitions verbatim from the glossary and does not compute or infer. The one sanctioned exception is **comparison / difference questions across two or more glossary fields** (e.g. _"What's the difference between X and Y?"_): load the glossary, find each field's row, then synthesize a side-by-side comparison from the retrieved rows. Stay grounded in the **Definition** and **Tabs** columns of the rows you found — do not add formulas, external facts, or information beyond what appears in those columns.

## Presentation

Keep it to 3–4 short sentences. Structure:

1. **Definition** — one sentence from the **Definition** column, verbatim or lightly tightened.
2. **Response type** — mention only when non-obvious (e.g. "Displayed as a monetary value", "Shown as a date"). Skip when the field name already makes the type obvious.
3. **Where it appears** — one line. Always use the word "report" after the report name and the word "tab" (or "tabs") after tab names so the reader can tell them apart. The report name comes from the `##` section heading in the glossary (already Title Case). Preferred forms:
   - Single tab: `Shown on the <Report> report under the <Tab> tab.`
   - Multiple tabs (same report): `Shown on the <Report> report under the <Tab A>, <Tab B>, and <Tab C> tabs.`
   - Multiple reports: `Shown on the <Report A> report (<tabs>) and the <Report B> report (<tabs>).`
   - When the **Tabs** cell says "All tabs" or is empty, the "under the … tab" suffix may be omitted.

Do not show internal field structure (raw table rows, keys). Never reveal the exact backing markdown table.

### Example output

> **Total Cost to Exercise (including taxes paid)** — the total amount the stakeholder paid to complete the exercise, including the exercise cost plus all applicable taxes.
>
> Displayed as a monetary value. Shown on the Exercised and Settled report under the Options Exercised and Pending Exercises tabs.

## LLC mode

The glossary is Corp-primary, but the definitions apply equally to LLCs — only the terminology differs. Apply the substitutions below **both directions**: rewrite the user's query before searching (LLC → Corp), and rewrite the rendered answer (Corp → LLC).

**Trigger LLC mode when any of these is true:**

- The user's query uses LLC terminology: `membership unit(s)`, `unit class(es)`, `UAR(s)`, `capital contributed`, `member(s)` (as stakeholder term), `operating agreement`.
- The user explicitly says "LLC" or mentions their entity is an LLC.
- Prior conversation context has established LLC as the entity type.

**Substitution table** (use case-insensitive matching; preserve casing in output):

| Corp (glossary)             | LLC (user-facing)                  |
| --------------------------- | ---------------------------------- |
| Certificate / Certificates  | Membership Unit / Membership Units |
| SAR / SARs                  | UAR / UARs                         |
| share / shares              | unit / units                       |
| stock                       | units                              |
| share class / share classes | unit class / unit classes          |
| cash raised                 | capital contributed                |

**How to apply:**

1. **Before searching**: if the user's query contains LLC terms, substitute them to the Corp form in the query string only (e.g. `"capital contributed per unit class"` → `"cash raised per share class"`, then search for the field name `cash raised`).
2. **Before rendering**: substitute Corp → LLC in the final answer text (the **Definition** column and your surrounding sentences). Field names in the **Field** column stay as-is (they reflect report labels).
3. **Do not add a footer note or disclaimer about the substitution.** The rendered answer should read naturally in LLC terms. The one exception: if the user's query term differs substantially from the field name in the **Field** column, a short parenthetical in the "where it appears" line is useful — e.g. `(labeled "Cash Raised" in the underlying field)`. Keep this inline; no separate "Note:" block.

If the user's query contains LLC terminology that doesn't appear in the substitution table, stop and ask — do not guess a mapping.

## Caveats

- The public glossary is a curated subset of Carta's internal reports glossary. If a field isn't found (even after suggesting close matches), it isn't in the public glossary — do not fabricate a definition.
- The glossary describes **what** a field represents and **where** it shows up. It does not cover **how** values are computed or **why** a value might be blank. For those, point users to [support.carta.com](https://support.carta.com/kb/en/) or a Carta support contact.
