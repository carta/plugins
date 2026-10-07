# References Index

Maintainer map of the reference files loaded by `SKILL.md`. Each file is read
inline at a specific point in the workflow — they are not standalone skills.

The main skill is **bulk-focused**. Its reference folders:

- `bulk/` — the bulk runner (Steps 3–7): create draft valuations across one or
  many companies via `create:bulk` (new drafts, and copy-from-previous for GPC).
  Contains `bulk-runner.md` (orchestration), `bulk-results.md` (the
  end-of-run results view and Dive in hand-off, shared by both runners) and
  `create-val.md` (per-company project creation used by the inline/terminal
  runner).
- `dive-in/` — the individual single-valuation **ability flows**, reachable on
  "dive into one" (Step 2.5). The user asks for one ("review the cap table",
  "set approaches") and the matching file runs. These are flat, linear
  procedures — not wrapped in a rigid wizard.
  - `dive-in/backsolve/` — backsolve sub-directory:
    - `backsolve.md` — guided backsolve workflow (configure, run, equity adjustment)
    - `backsolve-explained.md` — prose explanation of the math (sections 1–6)
    - `backsolve-excel.md` — Excel workbook generation with live formulas
    - `backsolve-html.md` — interactive HTML calculator generation
- `deep-link.md` — shared; URL construction for Carta deep links.

Solving backwards from a target value — pick a target EV, have multiples and
weights tuned until the valuation lands on it — is **not in this skill**. The
closest it gets is setting the company value directly (`dive-in/set-approaches.md`,
Custom Value) or working the GPC multiples by hand (`dive-in/gpc-analysis.md`).

## Quick map by JTBD

| Job-to-be-done | Bulk runner (this skill) | Dive-in ability (this skill) |
|---|---|---|
| Create valuation project | `bulk/create-val.md` | `dive-in/create-val.md` |
| Review a bulk run's results, dive into one | `bulk/bulk-results.md` | — |
| Add scenario to existing project | — | `dive-in/add-candidate.md` |
| Configure approach (GPC / M&A / etc.) | — | `dive-in/set-approaches.md` |
| Run / configure Backsolve | — | `dive-in/backsolve/backsolve.md` |
| Explain Backsolve math | — | `dive-in/backsolve/backsolve-explained.md` |
| Export Backsolve to Excel | — | `dive-in/backsolve/backsolve-excel.md` |
| Interactive HTML calculator | — | `dive-in/backsolve/backsolve-html.md` |
| Pull / write financials | — | `dive-in/financials-review.md` (read) |
| Manage comps | — | `dive-in/comps.md` (manual edit) |
| GPC multiple selection | — | `dive-in/gpc-analysis.md` (picker) |
| Run allocation / waterfall | — | `dive-in/allocation.md` (full picker) |
| Cap table review | — | `dive-in/cap-table-review.md` |
| Draft audit notes | — | `dive-in/audit-notes.md` |
| Ship (mark FINAL) | — | `dive-in/ship.md` |
| User-facing tutorial | — | `dive-in/tutorial.md` |
| Carta deep-link URLs | `deep-link.md` (shared) | |

## Why the ability files (dive-in/) stay flat and mode-free

Each `dive-in/*.md` file is a flat, linear procedure for one job (review the cap
table, set approaches, run allocation, …). Dive-in reads the one the user asks
for, directly — no wizard.
