# Cap table (share-class reader) — Waterfall Modeling

Step 6a.5 detail for the cap table read by the `cap_table_by_share_class` noun — matched for
a corporation or deal-group target. It doesn't assume which results shape follows: after the
cap table it hands off to the generic results step (`SKILL.md` §Step 6), which dispatches on
the `get_command` noun. Column/row layout is the command-matched render doc
([`references/rendering.cap_table_by_share_class.md`](rendering.cap_table_by_share_class.md));
number formatting is `SKILL.md` §Formatting rules.

## Commands available via this doc

These are the only cap-table-family commands in scope while this doc is active (noun
`cap_table_by_share_class`). **Call only the commands listed here** — never one owned by another detail
doc. The list grows as new corp readers ship.

- `cap_table_by_share_class` — the share-class summary reader (this doc).
- `cap_table:get:note_blocks` — round-grouped convertibles, auto-printed beneath the summary when the corp has notes (§Convertibles).
- `cap_table:get:rights_and_preferences` — the rights & preferences companion, rendered on request (§Rights & preferences).
- `cap_table_by_stakeholder` — the by-stakeholder ownership view + single-holder drill (§Ownership by stakeholder, §Holder drill).
- `cap_table:get:grant_vesting` / `cap_table:get:certificate_vesting` — a drilled security's vesting schedule, rendered on request after a holder drill (§Vesting schedule).

## Fetch once per batch, not per scenario

Keyed by `corporation_id` + `as_of_date` — equity value never enters it, so a batch of same-date
runs (`SKILL.md` §Step 5) shares **one** cap table: fetch and show it once, then print only each
scenario's results. A different `as_of_date` is its own fetch; a separately initiated run
re-fetches. The convertibles fetch (§Convertibles) shares the same batch.

## Fetch

Show the cap table for the root issuer **as of the waterfall date, before any allocations table**.
Independent of the run — fetched by corporation + date:

```
call_tool({"name": "<cap_table_command with all ':' replaced by '__'>", "arguments": {
  "corporation_id": "<root.issuer_id from Step 3>",
  "as_of_date":     "<WATERFALL_DATE from Step 4, as YYYY-MM-DD>"
}})
→ { share_classes[], option_plans[], warrant_blocks[], totals }
```

`as_of_date` is a bare date (`YYYY-MM-DD`) — no time component. `corporation_id` is the root
(`root.issuer_id` from Step 3). Response shape + column mapping:
[`references/rendering.cap_table_by_share_class.md`](rendering.cap_table_by_share_class.md).

## Convertibles (auto-printed when the corp has notes)

Alongside the share-class summary (same `corporation_id` + `as_of_date`, once per batch), fetch the
round-grouped convertibles:

```
call_tool({"name": "cap_table__get__note_blocks", "arguments": {
  "corporation_id": "<root.issuer_id>",
  "as_of_date":     "<WATERFALL_DATE, YYYY-MM-DD>"
}})
→ { note_blocks[], totals }
```

If `note_blocks` is **non-empty**, render it beneath the share-class summary — in chat, and in
`excel` as a block beneath the Cap Table block (§Excel) — per
[`references/rendering.note_blocks.md`](rendering.note_blocks.md). If empty (most corps have no
notes), **print nothing and never mention it**, on either surface.

## Excel

**If `<SURFACE>` is `excel`:** the summary goes to the **"Cap Table"** tab — no inline table —
per the command's results doc §Excel — fetch & write order and
[`references/excel-output.md`](excel-output.md) (one consolidated `execute_office_js`, Cap Table
block before the Waterfall block). **When the corp has notes, the convertibles table is written under
the Cap Table block on the Cap Table tab** (default write) — see `references/excel-output.md`
§"Cap Table" tab. The by-stakeholder view, the vesting schedule, and rights & preferences are **not**
written to the sheet.

## Chat rendering

**Chat** (default) — render inline. **Phrase the lead in past tense** — the run already happened
(Step 5). Render one short line, then the table:

> Here's the cap table for **{root display name}** as of **{WATERFALL_DATE}**:

Render the summary per the share-class render doc, then the convertibles table (§Convertibles) if any.
After the tables, a **light prompt** via `AskUserQuestion` — default is to proceed to results:

> "Explore the cap table, or show the allocation results?"
> Options:
>
> - "Show the allocation results" ← recommended
> - "Explore the cap table" — look deeper into this cap table (§Explore the cap table)
> - "Cap table as of a different date" — re-fetch without re-running (below)

On **"Show the allocation results"** → the results fetch (`SKILL.md` §Step 6). On **"Explore the cap
table"** → the **Explore the cap table** sub-menu below, then repeat this prompt. On **"Cap table as
of a different date"** → ask for the date, re-fetch with the same `corporation_id` and the new
`as_of_date` (share-class + convertibles), render again, and repeat this prompt. This changes only the
cap table, so also **suggest** in one line: _"Want me to re-run the waterfall as of that date too, with
the same options?"_ — on yes, restart from Step 5 with the new date.

## Explore the cap table

**"Explore the cap table"** opens a second `AskUserQuestion` — its leaves + `Back`:

> - "Show ownership by stakeholder" — the full by-stakeholder ownership table (§Ownership by stakeholder)
> - "Drill into a holder" — the holder list + single-holder drill (§Holder drill)
> - "Show rights & preferences" — the rights & preferences companion (§Rights & preferences)
> - "Back"

On **"Show ownership by stakeholder"** → the **Ownership by stakeholder** view below. On **"Drill into
a holder"** → the **Holder drill** flow below. On **"Show rights & preferences"** → the **Rights &
preferences** flow below. On **"Back"** → the light prompt. After any leaf renders, return to the
light prompt.

## Ownership by stakeholder (chat only)

On a **direct ask** — or when the user picks **"Show ownership by stakeholder"** from the **Explore the
cap table** sub-menu — render the full by-stakeholder ownership breakdown. **Never auto-shown**, **never
written to Excel**. Same `corporation_id` + `as_of_date`, paginated:

```
call_tool({"name": "cap_table__get__cap_table_by_stakeholder", "arguments": {
  "corporation_id": "<root.issuer_id>",
  "as_of_date":     "<WATERFALL_DATE, YYYY-MM-DD>",
  "detail":         "full",
  "page":           1,
  "page_size":      25
}})
→ { count, total, stakeholders[] }
```

Render the flat table per
[`references/rendering.cap_table_by_stakeholder.md`](rendering.cap_table_by_stakeholder.md) §Columns /
§Rows (top-N, paged — see §Rows for the page-count + top-N + oversize rules). **Never auto-fetch all
pages**; fetch page 1, then the next `page` only on request.

## Holder drill (chat by default; never written to Excel)

The corp per-holder view is a **drill** — and, unlike the LLC cap table, the corp default share-class
table carries **no holder list**, so every holder view costs a `cap_table_by_stakeholder` fetch
(`references/rendering.cap_table_by_stakeholder.md` §Discovery list / §Holder drill). Users drill by
**name**, never an id. **Keep fetches to a minimum:** every fetch below already carries securities, so
render the drill straight from the response in hand — **never re-fetch a holder you've already pulled.**

1. **Ask which holder** (no fetch) — free text: _"Which holder? Name one, or ask to see the full list."_
   A name is the single-fetch path (step 2); the full list (step 3) is only for browsing.
2. **Named a holder → fetch scoped to them** — one call, `search` + `include_securities`:

   ```
   call_tool({"name": "cap_table__get__cap_table_by_stakeholder", "arguments": {
     "corporation_id":     "<root.issuer_id>",
     "as_of_date":         "<WATERFALL_DATE, YYYY-MM-DD>",
     "search":             "<holder name>",
     "detail":             "full",
     "include_securities": true,
     "page":               1,
     "page_size":          25
   }})
   → { count, total, stakeholders[] }
   ```

   Render the holder drill table (↳ / ↳↳) per the render doc §Holder drill **straight from this
   response** — no second call. If `search` comes back **empty** or **ambiguous** (many matches), fall
   back to the list (step 3).
3. **Wants to browse, or search missed → fetch the discovery list** — one call, page 1 with securities;
   render the **compact grouped names** per the render doc §Discovery list:

   ```
   call_tool({"name": "cap_table__get__cap_table_by_stakeholder", "arguments": {
     "corporation_id":     "<root.issuer_id>",
     "as_of_date":         "<WATERFALL_DATE, YYYY-MM-DD>",
     "detail":             "full",
     "include_securities": true,
     "page":               1,
     "page_size":          25
   }})
   → { count, total, stakeholders[] }
   ```

   Respect paging: page 1, more on request; if the list is genuinely large, ask which group first. When
   the user picks a holder **already on a fetched page, render the drill from that data — do not
   re-fetch**; page forward (or `search`) only for a holder not yet fetched.
4. **After the drill renders, gate the vesting offer** on each drilled security's type — dispatch by
   `(security_type, id)`: **Option** → `grant_vesting`; **Certificate / RSA / PIU** →
   `certificate_vesting`; **RSU** → no schedule via this drill.
   - **Any drilled security has a schedule** → **offer the vesting schedule** via `AskUserQuestion`
     (`Show vesting schedule` · `Back to menu`) — see **§Vesting schedule** below.
   - **None do** (e.g. Common) → say so in one line (e.g. _"CS-101 is Common — no vesting schedule."_) —
     never skip silently.
   This is the only place vesting is offered (both drill entry points reach it here), then continue as the
   caller directed (repeat the light prompt, or return to the follow-up menu).

## Vesting schedule (on request — after a holder drill)

Normally reached from the **Holder drill** step 4 offer above. If the user asks for a vesting schedule
**directly** without having drilled yet, run the holder drill first (steps 1–3) to get the security —
a named holder is the single-fetch `search` path — then skip step 4's offer.

**Pick the security — only ones with a schedule.** Offer the drilled securities that have one; a Common
certificate has none, so never offer it (note it in one line if that drops any). One security → skip the
picker; **more than 4** → list them compactly and take a **free-text** name matched against the
`↳↳ {label}` rows. **Dispatch by `(security_type, id)`** and read
[`references/rendering.corp_vesting_schedule.md`](rendering.corp_vesting_schedule.md) first, then fetch:

```
// Option
call_tool({"name": "cap_table__get__grant_vesting", "arguments": {
  "corporation_id": "<root.issuer_id>",
  "grant_id":       "<securities[].id for an Option>"
}})
```
```
// Certificate / RSA / PIU
call_tool({"name": "cap_table__get__certificate_vesting", "arguments": {
  "corporation_id": "<root.issuer_id>",
  "certificate_id": "<securities[].id for a Certificate / RSA / PIU>"
}})
```

- The `id` is the **drilled security's** `securities[].id` — ids are unique only within a type, so the
  `(security_type, id)` pair picks the command.
- The caption's security label comes from that same drilled security (`securities[].label`).
- Render the tranche table + caption per the render doc, in chat. Return to the menu after.

Errors: `403` / `404` / any → one line that the vesting schedule isn't available; never block results.

## Rights & preferences (on request)

On a **direct ask** — or when the user picks **"Show rights & preferences"** from the **Explore the
cap table** sub-menu — fetch the per-share-class configuration and render it as a companion beside the cap table.
Never render it unless the user asks. Read
[`references/rendering.rights_and_preferences.md`](rendering.rights_and_preferences.md) first, then:

```
call_tool({"name": "cap_table__get__rights_and_preferences", "arguments": {
  "corporation_id": "<root.issuer_id from Step 3>"
}})
→ { count, by_type, classes[] }
```

- `corporation_id` is the **root** issuer. This command is current-state configuration — it takes
  **no** `as_of_date`.
- Render the two tables per the render doc, in chat, beside the cap table.

Errors: `403` / `404` / any → one line that rights & preferences aren't available; never block results.

## Error handling (never block results on the cap table)

- "still running" / not-ready → offer to retry the same fetch; if declined, proceed to the results fetch.
- `403` → say the user can't view this company's cap table; `404` / any other error → one line
  that the cap table isn't available. Either way, proceed to the results fetch — its failure must not stop
  results.
