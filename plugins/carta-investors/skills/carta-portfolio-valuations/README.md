# Portfolio Valuations Skill

AI-assisted workflow for running and reviewing portfolio company valuations in Carta, paired with Carta's in-app **valuations dashboard**. The chat does the work; the dashboard shows it.

- **Bulk mode** — the bulk runner creates draft valuations across one company or many in a single pass via `create:bulk` (new drafts, and copy-from-previous for GPC), through the text runner in `references/md-table-runner.md`.
- **Dive into one** — open a single candidate, show a recap of where it stands plus a summary checklist (company value and holdings value, an Inputs section listing financials and comparables with the required ones marked, and a Next steps section with a Calculate item per valuation method and allocation) that re-renders on every response and, once allocation completes, a pointer to export the draft for review before finalizing, then route the user's free-text request directly to the relevant ability flow (cap table, financials, approaches, comps, GPC, allocation, finalize). No rigid wizard.
- **Page navigation** — the skill opens the portfolio valuations dashboard as an MCP App beside the chat as soon as the firm is settled, and moves it with the app's own tools only when the user asks to see a page (the firm page, a company's page with its valuation history, or a valuation); after a write on a valuation it offers to open the updated valuation page instead of moving there (SKILL.md **Page navigation**). After every change it makes in Carta (any save, create or delete, and each finished allocation or Backsolve run) it calls the app's `refresh_page` tool, so the data re-fetches in place. All of these app tools need the dashboard's widget id, which the skill gets on the user's next prompt: until it has one (the turn that opened the dashboard, or a host without widget tools such as the Code tab) it offers no page, answers a page request by saying where the page is, and refreshes a write made in that turn as soon as the id arrives. It never links the valuations dashboard's pages, since the MCP App is that page; where the MCP App can't be shown (e.g. a terminal), it asks whether to show the dashboard in chat or go straight into an existing valuation. It never builds an artifact or starts a local preview server.

Entry point: `SKILL.md`. Steps 3–7 drive the bulk runner; Step 2.5 drives dive-in.

## Reference guides

Reference guides are loaded inline at well-defined points in the workflow. They are not separate skills — Claude reads them directly and follows their instructions within the skill's execution context.

### Bulk runner (Steps 3–7 inline reads)

- **`references/bulk/bulk-runner.md`** — the bulk orchestration: company selection, valuation date, per-company approach, `create:bulk` submission, poll, and end-of-run summary.
- **`references/bulk/bulk-results.md`** — the end-of-run **Bulk run results** view shared by both runners: per-company EV, holdings value, selected methodology, required inputs missing and allocation status, as a markdown table. "Dive into {company}" hands off into Step 2.5.

### Dive-in ability flows (Step 2.5 routing table)

These individual single-valuation flows are reachable directly on dive-in.

- **`references/dive-in/create-val.md`** — collects valuation date, optional copy-from-prior, and a name; calls `create:project` or `create:project_from_copy`.
- **`references/dive-in/add-candidate.md`** — adds a new scenario/version to an existing project via `create:candidate`.
- **`references/dive-in/methodology-edit-view.md`** — opens the `portfolio_valuations:view:methodology_edit` methods table when the user wants to enter method values (GPC, Post-money, Custom value, …) or weights by hand; the view saves the changes itself.
- **`references/dive-in/set-approaches.md`** — configures the valuation approach (GPC, M&A, post-money, backsolve, or Custom Value) for a candidate via `mutate:approaches`.
- **`references/dive-in/cap-table-review.md`** — renders the cap table, branching on target kind: c-corps show the candidate's stored snapshot (scenario-bound), LLCs show the issuer's live cap table (no candidate required). Read-only; edits go through Carta UI.
- **`references/dive-in/financials-review.md`** — pulls financials DWH-first with scenario fallback; renders as a table; edits redirect to Carta.
- **`references/dive-in/comps.md`** — three sub-flows: browse by industry, search by ticker/name, review what's saved.
- **`references/dive-in/gpc-analysis.md`** — full picker with rationales for methodology, per-comp multiples, and quartile statistics.
- **`references/dive-in/allocation.md`** — full picker for methodology, time-to-exit, volatility, DLOM method and scope.
- **`references/dive-in/edit-financials-view.md`** — opens the `portfolio_valuations:view:edit_financials` financials view when the user wants to enter the financials by hand (option 3 of the financials entry options): current cash and debt, then historical and forecast revenue and EBITDA; the view saves the changes itself.
- **`references/dive-in/audit-notes.md`** — drafts narrative rationales for the user to copy into audit workpapers.
- **`references/dive-in/ship.md`** — verifies prerequisites and marks the single candidate as FINAL via `mutate:candidate`.

### Shared

- **`references/dashboard-view.md`** — opens the `portfolio_valuations:view:dashboard` MCP App in the chat on entry (Step 1), once the firm is settled; carries on in chat, with no dashboard link, when the MCP App can't be used.
- **`references/deep-link.md`** — URL construction for the Carta pages outside the valuations dashboard (cap-table access, firm investments, investment overview), and the ids `open_company` and `open_valuation` take. Single source for every URL pattern the skill uses.
- **`references/md-table-runner.md`** — the text-based bulk runner: numbered run plan, overrides in prose, confirm, `create:bulk`.
- **`references/bulk/bulk-runner-view.md`** — opens the `portfolio_valuations:view:edit_bulk_val` picker view: tick companies, pick an approach per company (pre-filled from its latest event, Post-money at the round's value after a financing round), a value and optional Waterfall or Common Stock Equivalent allocation (run after the value is set) for Post-money or Custom Company Value, and one valuation date; its message is the confirmation. Falls back to the table when the MCP App can't be used.

