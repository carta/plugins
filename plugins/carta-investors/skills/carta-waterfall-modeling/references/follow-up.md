# Follow-up prompt & cuts (Waterfall Modeling)

The post-results menu and the handlers for each cut. `SKILL.md` §Follow-up prompt
points here once the holder table is rendered (chat) or the **Waterfall** tab is
written (excel). Table specs live in `references/rendering.<get_command noun>.md`
(the results shape — e.g. `rendering.niagara_results.md`); formatting in
`SKILL.md` §Formatting rules.

## Follow-up prompt

After rendering the holder table (or, in `excel`, after writing the **Waterfall** tab), present the
"What next?" menu with `AskUserQuestion` — **always**, every surface, regardless of how earlier inputs
were collected. Offer **every** in-scope option via `AskUserQuestion` — never in prose, never dropped,
never a "want X, or all set?" sentence. In `excel`, the "Group results by security type" and "Show only
my firm's holdings" cuts render **inline in chat — not written to the tab unless the user asks** (same
render-then-write-on-request pattern as the holder drill).

> "What next?"

### The menu (2 levels)

A **top menu** (what you show first, capped at 4) plus **groupings** that open a second
`AskUserQuestion`. Attach a description as subtext to any entry whose label is vague (marked below); if
the surface can't render subtext, append it bracketed in the label. Self-explanatory entries need none.

**Top menu** — priority order:

- **Explore the cap table** — opens the Explore sub-menu. Present **when the cap table offers an
  exploration**: an **LLC** cap table (non-empty `holders` → holder drill, plus liquidation preferences),
  or **any corp** cap table. Subtext: _"Look deeper into this cap table."_
- **The cuts** — `Group results by security type` · `Show only my firm's holdings` · `Show breakpoints`
  (**chat only** — the **Waterfall** tab already prints each entity's breakpoints). Shown individually
  when they fit, else collapsed into a single **See a different cut** (subtext: _"Group by security
  type, filter to firm holdings, or show breakpoints for this same waterfall."_) — see **4-option cap**.
- **Update holding values** — conditional: only when Step 3 returned `save_command` AND this run isn't
  saved yet (never show one the backend didn't offer; never re-offer once saved). Subtext: _"Update
  your firm's current holdings values using these waterfall results."_
- **No, I'm done** — always.

**Sub-menus** — each is a second `AskUserQuestion` = its leaves + `Back` (→ top menu); after any
sub-menu action renders, return to the top menu.

- **Explore the cap table** → leaves depend on the cap table: **LLC** → `Drill into a holder` ·
  `Show liquidation preferences` · `Back`; **corp** → `Show ownership by stakeholder` · `Drill into a
  holder` · `Show rights & preferences` · `Back`.
- **See a different cut** → the surface's cuts + `Back` — chat: `Group results by security type` ·
  `Show only my firm's holdings` · `Show breakpoints` · `Back`; excel drops `Show breakpoints`.

**4-option cap.** `AskUserQuestion` accepts at most 4 options. Count what's in scope: `Explore the cap
table` + the cuts (3 chat / 2 excel) + `Update holding values` + `No, I'm done`. **If the total exceeds
4, collapse the cuts into `See a different cut`**; the other entries stay. Never collapse a list that
already fits (≤4). The resulting top menus (all 8 surface × cap-table × `save_command` permutations,
each ≤4):

| Surface | Cap table | `save_command` | Top menu |
|---|---|---|---|
| chat | LLC | yes | `Explore the cap table` · `See a different cut` · `Update holding values` · `No, I'm done` |
| chat | LLC | no | `Explore the cap table` · `See a different cut` · `No, I'm done` |
| excel | LLC | yes | `Explore the cap table` · `See a different cut` · `Update holding values` · `No, I'm done` |
| excel | LLC | no | `Explore the cap table` · `Group results by security type` · `Show only my firm's holdings` · `No, I'm done` |
| chat | Corp | yes | `Explore the cap table` · `See a different cut` · `Update holding values` · `No, I'm done` |
| chat | Corp | no | `Explore the cap table` · `See a different cut` · `No, I'm done` |
| excel | Corp | yes | `Explore the cap table` · `See a different cut` · `Update holding values` · `No, I'm done` |
| excel | Corp | no | `Explore the cap table` · `Group results by security type` · `Show only my firm's holdings` · `No, I'm done` |

### Handlers

The three results cuts — `"Group results by security type"`, `"Show only my firm's
holdings"`, `"Show breakpoints"` — are shape-specific: run each per the command's results
doc §Follow-up cuts (`references/results.<get_command noun>.md`). The cap-table and save
handlers below are shared.

- `"Show ownership by stakeholder"` (corp; reached via **Explore the cap table** → `Show ownership by
  stakeholder`) → run the **Ownership by stakeholder** view in `references/cap-table.corp.md`
  §Ownership by stakeholder. Return to the top menu after.

- `"Drill into a holder"` (reached via **Explore the cap table** → `Drill into a holder`) → run the
  **Holder drill** flow for the shown cap table: **LLC** → `references/cap-table.llc.md` §Holder drill
  (only reachable when the response has a non-empty `holders` list); **corp** →
  `references/cap-table.corp.md` §Holder drill. Return to the top menu after.

- `"Show liquidation preferences"` (LLC) / `"Show rights & preferences"` (corp), reached via
  **Explore the cap table** → run the companion flow for the shown cap table: **LLC** →
  `references/cap-table.llc.md` §Liquidation preferences; **corp** → `references/cap-table.corp.md`
  §Rights & preferences. **In `excel`, the LLC flow's Cap Table write offer comes first** — then return
  to the top menu.

- `"Update holding values"` → write the **full run** into the Carta database as
  the firm's holding values. See "Update holding values" below. (Only present when
  `save_command` was returned.)

After each follow-up render, repeat the top-level "What next?" prompt until the
user picks "No, I'm done".

## Update holding values (only when offered)

Shown in the follow-up menu only when Step 3 returned `save_command` **and the
current run hasn't been updated yet**. Writes the **entire waterfall run** (the
locked `execution_id`) into the Carta database as the firm's holding values —
**not** the cut currently on screen. The numbers are identical; the update is the
full, ungrouped distribution.

**Offer it at most once per run.** A second update of the *same* run would write
the identical numbers, so once this run is saved, drop the option for the rest of
its follow-up loop (the success message says so — the disappearance isn't a bug).
It returns only after a **new** waterfall run (a new `execution_id`).

Menu option — label **"Update holding values"**; helper _"Update your firm's
current holdings values using these waterfall results."_

### Confirm first (echo the config, then one question)

Do **not** reprint the results table. First **echo the run config** as a short
bulleted block — the same shape as the `SKILL.md` §Step 5 pre-run review — so the
user re-reads exactly what gets written:

- **Company:** {company name}{when `is_multi_entity`: ` (via top-level entity {root display name})`}
- **Equity value:** {`EQUITY_VALUE` as **full** currency — e.g. `$99,000,000.00`,
  the `$X,XXX.XX` table style per `SKILL.md` §Formatting rules, not the compact BLUF style}
- **Waterfall date:** {`WATERFALL_DATE` as ISO}
- {one line per input option: `**{label}:** {choices[].label}`, appending
  ` (default)` when the chosen value is that option's default}

Source every value from the Step 4 inputs cached this session (the results
responses don't carry them).

Then ask **one** consolidated `AskUserQuestion` — options "Update holding values"
/ "Cancel" (Cancel returns to the follow-up menu). Question text (only the
`{where}` clause varies by surface — `chat` → "the results above"; `excel` → "the
**Waterfall** tab"):

> Update your firm's holding values for **{company}** from this waterfall run?
> This writes the proceeds shown in {where} into the Carta database. To overwrite
> later, run a new waterfall and update again.

**If a filtered or regrouped cut is currently displayed** (the user ran "Group by
security type" or "Show only my firm's holdings" since the full BY_HOLDER
results), add one clarifying line to the question: _"This updates from the full
waterfall run, not the current cut."_

### Post

On "Update holding values", call `save_command` (colon → `__`, opaque — never
type the engine name):

```
call_tool({"name": "<save_command with all ':' replaced by '__'>", "arguments": {
  "owner_kind":      "FIRM",
  "owner_id":        <locked from Step 1>,
  "target_kind":     "<locked from Step 2>",
  "target_id":       "<locked from Step 2>",
  "execution_id":    "<locked from Step 5>",
  "context":         "PORTFOLIO_VALUATION_MARK"
}})
→ response: { status, redirect_url }
```

### Render the result, then re-show the menu

Lead line by `status`:

- `status == "CREATED"` → _"Done — your firm's holding values for **{company}**
  now reflect this waterfall's proceeds."_
- `status == "UPDATED"` → _"Done — your firm's holding values for **{company}**
  have been updated with this waterfall's proceeds."_

Then, **only if `redirect_url` is a non-null absolute URL**, append the export
line — the URL **verbatim, exactly as returned**, after the colon; do **not**
wrap it in markdown, shorten it, or prepend a base URL:

> Export this data via the multi-entity waterfall report in the Carta Firm
> Reports Page: {redirect_url}

If `redirect_url` is `null`, **omit the export line entirely** — the lead line
stands alone. The update still succeeded; the user simply lacks the all-funds
view permission the report requires. Do **not** imply it was saved anywhere else.

**Mark this run as updated** — drop "Update holding values" from the follow-up
menu for the rest of its loop, and append one line so the change is clear (not a
bug): _"This waterfall run is saved. Run another waterfall scenario to update
again."_

Then repeat the follow-up menu (now minus the update option). Updating is not
"done".

### Error handling (never auto-retry)

- `409 execution_pending` → "The run is still finalizing — want me to try the
  update again?" Retry the same call.
- `403` → "You don't have permission to update holding values for this firm."
  Return to the menu.
- `404 target_not_found` → "That target couldn't be found or reached." Return to
  the menu.
- `501 save_context_not_supported` → "Updating holding values isn't supported for
  this run." Return to the menu.
- `502 target_lookup_failed` → "Couldn't look up the issuer just now — want me to
  retry?" Retry the same call.
- `500 waterfall_save_failed` → "Something went wrong updating — want me to
  retry?" Retry the same call.

403 / 404 / 501 stop; 409 / 502 / 500 prompt first, then retry the same call.
