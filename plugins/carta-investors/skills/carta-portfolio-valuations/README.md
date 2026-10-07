# Portfolio Valuations Skill

AI-assisted workflow for running and reviewing portfolio company valuations in Carta. Focused on the **bulk** experience:

- **Bulk mode** — the bulk runner creates draft valuations across one company or many in a single pass via `create:bulk` (new drafts, and copy-from-previous for GPC). The interactive (`artifact` or `preview-server` mode) runner opens with a **plan card** — a one-glance summary of the suggested method per company that the user can bulk-create in one click, or open the full editable list to customize.
- **Dive into one** — open a single candidate, show a recap of where it stands plus a summary checklist (company value and holdings value, an Inputs section listing financials and comparables with the required ones marked, and a Next steps section with a Calculate item per valuation method and allocation) that re-renders on every response and, once allocation completes, a pointer to export the draft for review before finalizing, then route the user's free-text request directly to the relevant ability flow (cap table, financials, approaches, comps, GPC, allocation, finalize). No rigid wizard.

Entry point: `SKILL.md`. Steps 3–7 drive the bulk runner; Step 2.5 drives dive-in.

## Reference guides

Reference guides are loaded inline at well-defined points in the workflow. They are not separate skills — Claude reads them directly and follows their instructions within the skill's execution context.

### Bulk runner (Steps 3–7 inline reads)

- **`references/bulk/bulk-runner.md`** — the bulk orchestration: company selection, valuation date, per-company approach, `create:bulk` submission, poll, and end-of-run summary.
- **`references/bulk/bulk-results.md`** — the end-of-run **Bulk run results** view shared by both runners: per-company EV, holdings value, selected methodology, required inputs missing, allocation status and a Carta link, with a per-row **next step** button (e.g. *Add comparables*, *Run allocation*) that hands off into Step 2.5 and starts on that step. Widget via `templates/bulk-results.html`, markdown table otherwise.
- **`references/bulk/create-val.md`** — creates a single project via `create:project` from a date and a generated name (used by the inline/terminal runner's per-company loop).

### Dive-in ability flows (Step 2.5 routing table)

These individual single-valuation flows are reachable directly on dive-in.

- **`references/dive-in/create-val.md`** — collects valuation date, optional copy-from-prior, and a name; calls `create:project` or `create:project_from_copy`.
- **`references/dive-in/add-candidate.md`** — adds a new scenario/version to an existing project via `create:candidate`.
- **`references/dive-in/set-approaches.md`** — configures the valuation approach (GPC, M&A, post-money, backsolve, or Custom Value) for a candidate via `mutate:approaches`.
- **`references/dive-in/cap-table-review.md`** — renders the cap table, branching on target kind: c-corps show the candidate's stored snapshot (scenario-bound), LLCs show the issuer's live cap table (no candidate required). Read-only; edits go through Carta UI.
- **`references/dive-in/financials-review.md`** — pulls financials DWH-first with scenario fallback; renders as a table; edits redirect to Carta.
- **`references/dive-in/comps.md`** — three sub-flows: browse by industry, search by ticker/name, review what's saved.
- **`references/dive-in/gpc-analysis.md`** — full picker with rationales for methodology, per-comp multiples, and quartile statistics.
- **`references/dive-in/allocation.md`** — full picker for methodology, time-to-exit, volatility, DLOM method and scope.
- **`references/dive-in/audit-notes.md`** — drafts narrative rationales for the user to copy into audit workpapers.
- **`references/dive-in/ship.md`** — verifies prerequisites and marks the single candidate as FINAL via `mutate:candidate`.
- **`references/dive-in/tutorial.md`** — user-facing guide on how the workflow works.

### Shared

- **`references/deep-link.md`** — URL construction for Carta deep links. Single source for all URL patterns used by every other reference and SKILL.md.

