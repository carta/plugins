# Input collection — Waterfall Modeling

Step 4 detail: how to collect the run inputs from `available_inputs` (the catalog
`SKILL.md` §Step 3 returned). Walk `available_inputs`. Do not hardcode option names in
your plan; act based on each entry's `input_type` and `required` fields. Collect required
inputs first, then optional.

**One input, one `AskUserQuestion` call.** Never batch several inputs into a single
prose message, and never fold a later input into `EQUITY_VALUE`'s prose ask — a bare
free-text value (a date, a number) is not a reason to skip the widget. `EQUITY_VALUE`
and `NESTED_LIST` rows are the only prose asks; every other input, required or optional,
gets its own widget.

## Order & method

**Required inputs** (`required == true`, no `default`): prompt one at a
time using `AskUserQuestion`. Always phrase the question as a short, full
sentence from the option's `label` — never output a bare field name, and
don't restate the choices in the question (they're already the options).
The widget accepts free-text input, so use it for every `input_type` —
**except `EQUITY_VALUE`** (see special handling below):

- `ENUM` → options are the `choices[].label` values; the question is the
  short sentence from the option's `label`, e.g. `"How should time-based
  vesting be handled?"`.
- `DECIMAL` / `INTEGER` / `ISO_DATE` / `STRING` → phrase the question
  conversationally with a format hint; the user types their answer
  directly into the widget.

**Optional inputs** (`required == false`, has a `default`; a `NESTED_LIST`
defaults to `None`): collect these after all required inputs.

- **2 or fewer optionals, none a `NESTED_LIST`** → ask each directly, one at a time, the same
  way as required inputs. (The ENUM `(default)` marker on the matching
  choice already shows the default — don't add a separate "use defaults?"
  prompt.)
- **3 or more optionals, or any `NESTED_LIST`** → open with one `AskUserQuestion` — "Use
  defaults" vs "Change one or more". On "Change", loop through them one at
  a time. **The resolved default value(s) must appear in the "Use
  defaults" label itself, never only in the description** (option-
  description subtext does not always render): spell each one inline,
  mapping each ENUM `default` to its `choices[].label`, e.g. `"Use
  defaults — Time-based vesting: Accelerate vesting; Performance-based
  vesting: None"`; semicolon-separate when there are several.

## Formatting by `input_type`

| `input_type` | What to collect & how to send                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DECIMAL`    | Free text (e.g. `$123,123,213`). Strip `$`, commas, and whitespace. **Round to at most 6 decimal places.** Send as a plain decimal string (e.g. `"123123213"` or `"123123213.50"`).                                        |
| `INTEGER`    | Free text. Strip formatting. Send as an integer string.                                                                                                                                                                                                         |
| `ISO_DATE`   | ISO `YYYY-MM-DD`. Accept whatever the user types and convert to ISO, using the current session date as the anchor for relative terms. **Only confirm via `AskUserQuestion` when the input was relative or ambiguous** (e.g. `"next Friday"`, `"EoY"`). For unambiguous explicit dates (e.g. `"April 30, 2026"`, `"2026-04-30"`), accept the conversion silently — the Step 5 pre-run review already catches mistakes. |
| `ENUM`       | Render each `choices[i].label` to the user (never the `value`). `AskUserQuestion` with one option per `choices[i].label`. If the input has a `default`, append ` (default)` to the label of the matching choice. Send the matching `choices[i].value` in the body. |
| `STRING`     | Free text. Send as-is.                                                                                                                                                                                                                                          |
| `NESTED_LIST` | See **`NESTED_LIST` — row inputs** below. Send a list with one object per chosen row: `[{"id": "<row id>", "<row_fields[].option>": "<value>", ...}]`, each value formatted by its row field's `input_type`. No rows chosen → omit the option. |

**Never show raw enum values to the user.** Always use `label` /
`description` (option level) and `choices[].label` (choice level). When
displaying a default for an ENUM input, find the `choices` entry whose
`value` matches `default` and show its `label`.

## `EQUITY_VALUE` — special handling

**Never suggest a company / exit / equity value yourself.** For any monetary input (notably `EQUITY_VALUE`),
don't pre-fill, offer dollar amounts as options, or anchor on a placeholder like "$1B" —
the user types the number. Any format hint is illustrative only, not a recommendation.

For `EQUITY_VALUE` specifically, when no prior values are surfaceable
(the common case), do **not** use `AskUserQuestion` at all — it forces
a multi-choice widget with a mandatory option list, which invariably
leads to either invented dollar-amount options ($100M, $500M) or noise
like _"I need help with format"_. Just **ask the question in plain
prose** and stop.

Name the entity the value applies to — **{root display name}**: _"What equity value
should I run the waterfall at for **{root display name}**? Enter the total exit or
liquidity value in USD (e.g. 10,000,000)."_ When `is_multi_entity`, tag it **(the
top-level entity)** so the user enters the top-level exit value, not the picked
sub-entity's — Step 3 already announced the structure, so don't re-explain it.

The user replies in their next message; their reply is the value.

**This plain-prose, no-`AskUserQuestion` treatment is scoped to `EQUITY_VALUE`
and `NESTED_LIST` rows only** — not a session mode. The moment you have the value,
switch back: every other input **and every later prompt, including the Step 6
follow-up menu, uses `AskUserQuestion`**.

The **only** exception: if specific values for this same company surfaced earlier this session —
the user named one, a prior waterfall ran at one, or a valuation / spreadsheet lookup produced
some — surface those exact values as suggestions, and **only** those. Present every such value as
a discrete option and cite its source (e.g. _"Use one from earlier — $800M (low), $1.2B (base),
$1.6B (high) — or type your own?"_). If none exists for this company this session, no
suggestions — period.

## `NESTED_LIST` — row inputs

Render `rows` as a numbered table — `#`, the row `label`, then one column per `facts` key
(Title Case; `*_percentage` facts are fractions — show them ×100 as `X.XX%`, so `"1"` →
`100.00%`). Never show row `id`s. Then ask in plain
prose, phrased from the option's `label` and naming each `row_fields[].label` in the
format hint: _"Which performance conditions should I recognize? Give the number, payout
percentage, and recognition date for each (e.g. 1 at 50% on 2026-12-31)."_

- A percentage (`50%`, or a bare `50` for a percentage field) is sent as a fraction
  (`"0.5"`).
- A row field the user leaves out → the row's `defaults` value; otherwise
  `PAYOUT_PERCENTAGE` → the row's `max_payout_percentage`, `RECOGNITION_DATE` →
  `WATERFALL_DATE`, and any other non-required row field is left out.
- "None" (or no rows) → omit the option.

Build the `options` dict by taking each entry's `option` field as the key
and the collected/mapped value as the value — then continue to `SKILL.md` §Step 5.
