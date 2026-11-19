# Resolving the engagement — firm, fund, audit year

Every audit skill needs the same three things before it can do anything: which
firm, which fund, which audit year. This is how all of them resolve it, so the caller
answers once.

**Never ask the caller for a fund's UUID.** An auditor knows their funds by name. The
UUID is an argument value you look up, not a question you ask.

## If the engagement is already resolved

If firm, fund and audit year were established earlier in this conversation — by
`carta-audit` or by another audit skill — reuse them. Don't re-run the lookups
and don't re-prompt. Say which fund and year you're working from in one short line so
the caller can correct you, then continue.

## Step 1 — Firm

**A fund UUID or an audit-portal URL** (`.../audit-portal/?auditable_fund=<uuid>`)
identifies the fund directly — use it and skip to Step 3.

Otherwise call:

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__member-firms",
  "arguments": {},
  "_instrumentation_v2": {"skills": ["carta-investors:<skill-name>"]}
})
```

This is genuinely permission-filtered, so it's the safe default source for "which
firms can this caller work on" — not a global search.

**Non-empty result:**

- **No firm named, exactly one result** → that's the caller's only option. Activate it
  with `mcp__<SERVER>__set_context(firm_id="<firm_uuid>")` and continue. Don't ask
  them to confirm what was never a choice.
- **No firm named, multiple results** → `AskUserQuestion` listing each firm by name,
  then `set_context`.
- **Caller named a firm** → apply the clean-match rule below.
  - **One clean match** → `set_context`, continue.
  - **Multiple clean matches** → `AskUserQuestion` to disambiguate, then `set_context`.
  - **Zero clean matches** → terminal. Tell them no firm matched the access they hold
    and ask them to retype the name, unless the staff rules below apply.

**Empty result** — no grant on any firm. For an auditor this is a genuine, terminal
"no access": say so and stop, unless the staff rules below apply. Nothing further can
find an auditor access that `set_context` would not refuse anyway.

**Carta staff.** When the caller is Carta staff, read
`${CLAUDE_PLUGIN_ROOT}/references/audit/staff-access.md` (the plugin's own
`references/`, not a skill's) before either terminal answer above, and follow it.
That file ships only in Carta's internal install. When it can't be read, treat the
caller as an auditor. Do not search for it; read it at that path.

### Clean-match rule

Normalize both the caller's input and each candidate name — strip whitespace,
lowercase, drop `-`, `,` and `.` — and treat a candidate as a **clean match** only if
one normalized string contains the other. Anything looser guesses.

## Step 2 — Fund

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__auditable-funds",
  "arguments": {"firm_uuid": "<firm_uuid>", "report_year": <year, if the caller gave one>},
  "_instrumentation_v2": {"skills": ["carta-investors:<skill-name>"]}
})
```

The parameter here is **`report_year`**, not `audit_year` — that's the backend's own
name for it on this command, and it differs from the `audit_year` the
`fa__*__*-audit-documents` commands take. Carry the resolved year forward under
whichever name the receiving command uses.

This is filtered to funds the caller actually holds a permission grant on, not every
fund in the firm.

- **Zero funds** → tell the caller this firm has no funds they can audit, and stop.
- **Exactly one fund, or one that clean-matches a name the caller gave** → confirm it
  and continue.
- **Multiple funds** → `AskUserQuestion` listing each fund by name, linked via its
  `_links.web_url` when present. Never show a raw UUID as the option label.

Take `fund_uuid` from the picked fund's `uuid` field.

## Step 3 — Audit year

If the caller gave a year, use it.

Otherwise **default to 2026** — the 2026 audit is the one everyone is working toward
right now. Don't derive the default from today's date.

This is a default for the caller to correct, not a claim about which year has
documents. Don't spend a lookup checking. A funds picker is the exception: its year
dropdown offers only the years the ticked funds have documents for, per "Years with
documents" below.

If the caller wants more than one year, collect every year up front; each skill runs
its own per-year loop.

## Several funds at once

An auditor often audits several funds, sometimes for more than one firm, and wants
to work them together. Use this section instead of Steps 1–2 whenever the caller
names more than one fund, asks for "all my funds" or "every fund I audit", or picks
more than one fund in a picker.

1. Call `fa__list__member-firms` (Step 1).
   - **Empty result** → the single-firm flow above applies. Never sweep firms from
     `list_contexts`.
2. Call `fa__list__auditable-funds` once per firm and year, all together, as "Years
   with documents" below says. Keep each fund's firm name next to it. Every later
   step and every output needs it.
3. **Pick once.** Call `mcp__visualize__read_me` once (module: `mockup`) if this is
   the first `show_widget` call this conversation. Then show one `show_widget` picker
   (`title`: `audit_funds_picker`) with:
   - one heading per firm in `fa__list__member-firms` order, with a "Select all"
     toggle and one checkbox per fund under it, labelled with the fund's name (never
     a UUID). Pre-tick the funds the caller named, or every fund when they asked
     for all of them;
   - one audit year dropdown, filled and pre-selected per "Years with documents"
     below;
   - a Submit that fires
     `sendPrompt("Use funds <fund_uuid>,<fund_uuid>,… audit year <year> for the audit")`.
     If nothing is ticked, show an inline error next to the list ("Choose at least
     one fund", styled per "Widget limits" below) and don't fire. If the caller gave
     no year and the ticked funds offer none, show the no-year error from "Years with
     documents" by the dropdown instead and don't fire.

   On re-entry, parse the funds and year from the prompt and continue without
   showing the picker again.

   Skip the picker when the caller named every fund by name and each one
   clean-matches exactly one fund. Past **60 funds or 10 firms in total**, or on a
   surface with no `show_widget`, skip the picker and ask with `AskUserQuestion`, one
   firm at a time. When the caller asked for all their funds, take every fund
   without asking. If the caller gave no year, take the years the chosen funds have
   documents for, per "Years with documents" below. With none, say "No audit
   documents filed for these funds yet" and stop. With one, use it. Otherwise ask
   with one more `AskUserQuestion` offering the newest four, newest first; the
   caller can type an older year under Other. Against the size
   ceiling in "Widget limits" below: 60 checkbox rows with their years at about 190
   bytes is 11.4KB; the select-all, year-filter, validation and submit script and the
   inline errors about 2.3KB; the year dropdown and frame about 0.8KB; 10 firm
   headings with their "Select all" toggles at about 200 bytes each, 2KB. That is
   about 16.5KB, leaving margin for long fund names.
4. Work through the picked funds **one firm at a time**: `set_context` to that firm,
   then run that firm's funds, all together. Never run a fund's calls while another
   firm's context is active. Each fund runs its own calls exactly as a single-fund
   engagement would.

### Naming funds when there are several

Whenever more than one fund is in play, group every output under firm headings, and
name each fund as **Firm — Fund** wherever it appears on its own (a card title, a
table row). A fund name alone doesn't say which firm a document belongs
to: two firms can each have a "Growth Fund II".

### Years with documents

A funds picker's year is a dropdown of only the years the ticked funds have audit
documents for, so the caller can't pick a year that would come back empty.

1. Call `fa__list__auditable-funds` once for each year from **2022 through 2026** —
   the years the investor portal's year dropdown offers — per firm, all together:
   ```
   mcp__<SERVER>__read_tool({
     "name": "fa__list__auditable-funds",
     "arguments": {"firm_uuid": "<firm_uuid>", "report_year": <report_year>},
     "_instrumentation_v2": {"skills": ["carta-investors:<skill-name>"]}
   })
   ```
   These calls also give the fund list, so make no separate call without a year.
2. Each fund comes back with `has_document` for that year: `true` means Carta has
   audit documents filed for it, `false` means none, and null means Carta hasn't
   worked that year out yet, so it can't say. A fund's years are those where
   `has_document` is `true` or null. Hide only `false`, so a year is never hidden on
   a guess.
3. Put each fund's years on its checkbox (for example `data-years="2026,2025"`). The
   dropdown lists, newest first, every year at least one ticked fund has, and
   updates as funds are ticked and unticked.
4. Pre-select the year the caller gave, and keep it in the list even if no ticked
   fund has it, so the caller's year is always offered. Otherwise pre-select Step 3's
   default year when it is offered, else the newest year offered.
5. When the caller gave no year and funds are ticked but none of them has a year,
   leave the dropdown empty and show "No audit documents filed for these funds yet"
   next to it, styled per "Widget limits" below. This can be the opening state, when the pre-ticked
   funds have no year: never fill in a year to avoid it.

## Widget limits

These apply to every `show_widget` call in this plugin:

- **Size ceiling.** A `show_widget` call whose rendered HTML exceeds roughly 18.5KB
  hangs silently instead of erroring. Each widget sets its own item cap from its
  per-item cost against this ceiling, and falls back to a plain question or a markdown
  table past it. Never truncate a list silently.
- **Inline errors.** Show an invalid input's error next to its control in 13px
  `color: var(--text-danger)`, and don't fire `sendPrompt` until it is fixed.

## When access is the problem

Zero results or a permission error is **terminal** — don't retry, don't widen the
scope, don't try a different fund. But say what the caller can actually do about it:
access to a fund's audit documents is granted by the fund's general partner or its
fund administrator, not by Carta support. Point them there rather than ending on
"you lack access."
