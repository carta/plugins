# Errors, edge cases, and what is deliberately not built


> Steps referenced here that are documented elsewhere: **Step 3** → [data-fetch.md](data-fetch.md).

## Errors + edge cases

- **Any script call (`manco_paths.py`, `build_manco_datadir.py`,
  `parse_budget_workbook.py`, `inspect_workbook.py`, `parse_coa_mapping.py`,
  `serve.py`) fails for an environment reason rather than a data reason** —
  a spawn error on the path (the install is stale or `${CLAUDE_PLUGIN_ROOT}`
  didn't resolve), a `uv` cache directory that isn't writable, a missing
  interpreter, anything that is about *where this is running*, not about the
  firm's data. **Retry once, silently — no text before or after the retry,
  whatever the fix turns out to be** (a corrected path, a writable cache
  directory, anything else) — but retry the *identical* command. Do not
  invent a workaround to try instead of a plain retry: no hardcoding a
  resolved or guessed absolute path in place of `${CLAUDE_PLUGIN_ROOT}`, no
  prefixing the command with your own `CLAUDE_PLUGIN_ROOT=<value>` (a bash
  prefix assignment like that doesn't even feed the `${CLAUDE_PLUGIN_ROOT}`
  expansion later in the same command — it only reaches the child process's
  environment — so it silently fails to fix anything while looking like it
  might), and no trying a second candidate path "just in case." Each of
  those is a fresh guess dressed up as a retry, not the one retry this
  contract allows. A retry that then succeeds is handled exactly as if it
  had succeeded the first time: same silence, same next step.

  If it fails the identical way twice, one narrow, non-guessed fallback
  applies before you give up — see [firm-resolution.md](firm-resolution.md)'s
  Gate 0 for the full mechanism (deriving `PLUGIN_ROOT` from the harness's
  own `Base directory for this skill:` line, never from anything else). If
  Gate 0 already resolved a `PLUGIN_ROOT` earlier in this session, reuse that
  same value here directly instead of retrying `${CLAUDE_PLUGIN_ROOT}` from
  scratch — don't repeat the whole retry-then-fallback sequence at every
  later script call. If a script call somehow hits this failure before Gate 0
  ever ran (it shouldn't — `detect-surface` always runs first), apply the
  identical procedure Gate 0 uses, in place, right there.

  Only once the fallback has also been tried (or the `Base directory for
  this skill:` line was never printed this invocation) is it worth a word,
  and even then say only what's actually wrong, in plain English, **and
  nothing else** — never the path it tried, the cache directory, the session
  or plugin-install directory, or the fact that a retry happened, never a
  list of possible fixes to pick from, and never `AskUserQuestion` to ask
  the user which workaround to try:
  *"This dashboard can't run one of its own scripts right now — try
  reinstalling or updating the carta-investors plugin, or re-running this
  skill."* That single line is the entire response. The reader can act on
  that; a plugin path or a cache-directory name is not theirs to fix, and
  which remediation to attempt is not a decision to hand them mid-run.
- **Empty JE rows** — every ManCo has SOME journal entries by definition, so zero rows is a claim worth checking before making. Step 3 already verifies context via `list_contexts` right before issuing its queries and fails fast on a mismatch (see `data-fetch.md`), so this shouldn't reach here on a normal run — but if it does anyway (Step 3 finished cleanly and the build still shows zero income/expenses), the same check applies again: confirm the MCP session's firm context is still the one Step 1 resolved before concluding anything. `dwh__execute__query` returns an empty result, with no error, when the session's active firm is not the firm whose UUID is in the SQL; `fa__list__budgets` takes `fund_uuid` as a parameter and keeps working, so a run can show budgets alongside zero journal entries and look like a data problem. Only once the context checks out: the ManCo probably isn't onboarded to Fund Admin. Surface that in plain English.
- **Query A or Query C hits its pagination cap (5 pages) with `total_rows` still uncovered** — see `data-fetch.md`. Don't fetch a 6th page. Tell the user the ledger is larger than the cap covers and stop; don't hand the partial pages to `build_manco_datadir.py` and let it fail — the honest failure happens here, before the build step.
- **`build_manco_datadir.py` fails** — read the stderr, quote the first line to the user, stop. Do not fabricate a datadir. (This also catches a truncated `je-expense-page*.txt` pull that snuck past the cap above — its own `total_rows` guard raises with the row counts and page filename — and a `je-income.txt`/`fund-fees.txt` that `.fetched-at` says should exist but doesn't: Step 3's save call for it never ran, so the build refuses rather than show $0 as if it were a genuine result. Re-run Step 3 for the named file(s), don't retry the build as-is.)
- **Port range exhausted** — tell the user which processes hold 8787–8797, stop. Do not kill anything.
- **Cache is fresh but the user asked to see a different firm** — cache dirs are per-(firm, manco) so this shouldn't happen. If it somehow does, always trust the freshly resolved firm/manco.
- **`.token` missing after serve.py launches** — read `<dashboard_dir>/serve.log` and surface the first error line in plain English.
- **`parse_budget_workbook.py` can't read the sheet** (exit 4, `error: adapter <shape> failed: <reason>` — bad sheet name, wrong shape) — quote the first line to the user, stop. Do NOT fabricate a `budget.json` or fall through to `fa:list:budgets` silently — a stale/wrong workbook would produce wrong numbers the user can't tell are wrong.
- **`parse_budget_workbook.py` refuses its own output** (exit 5, `error: parse-credibility gate refused this parse:`) — a different failure and a different response. The sheet was read; the result doesn't hold together (all-zero lines, a stated total that doesn't tie to the rows beneath it, or implausibly few rows read). Nothing was written. Do not stop and do not carry on to the next tab: the operator usually holds the missing piece — which year is real, where their budget ends — and one answer fixes it. Work it through per [budget-workbook.md](budget-workbook.md)'s 2.75b-iii, quoting the figures rather than the check name, and record the answer in `.workbook-ref.json` so the same refusal doesn't return next run. Never pass `--skip-validation` on the user's behalf.
- **`.workbook-ref.json` points at a file that no longer exists, and a re-parse was actually needed** (an explicit ask, or the cached parse itself is broken — see [budget-workbook.md](budget-workbook.md)'s 2.75a) — try 2.75a-0's rename search first. Only when that finds nothing: remove the stale ref, one-line note to the user (*"Prior workbook not found at `<path>`; falling back to Carta budget. Pass `--budget-workbook <new_path>` next time."*), continue with no `budget.json`. **A workbook merely missing from disk, with a valid parsed budget already sitting in `<dashboard_dir>`, is not this case** — resurfacing a dashboard reuses that cached parse silently and never checks whether the source file is still there; only an actual re-parse does.


## Not clickable in the beta (deferred)

- In-app firm/ManCo switcher — for now, users close the tab and re-invoke `/carta-manco-reporting` for a different firm.
- Refresh button in-dashboard — for now, re-invoke `/carta-manco-reporting <firm> refresh` to force a fresh fetch.
- In-app workbook upload button (POST to serve.py) — Phase 3. For now the workbook is supplied in the chat: dragged in, pasted as a path, or passed as `--budget-workbook <path>`.
- Further shape adapters — multi-year quarterly time-series, and monthly sheets with per-fund or per-portfolio-company row groups (the single-entity, no-department-axis monthly case is now handled by `monthly-crosstab` — see `shapes/monthly_crosstab.py`, not yet validated against a real customer workbook).
- Category-level Carta-GL rollup for combined workbook categories (e.g. "Payroll Taxes (Employer) + Workers Comp" as a single mapped bucket). v1 handles the dept-alias + multi-GL cases; combined-category rollup is a follow-up.
- Deriving the COA mapping from the firm's own Carta data instead of a supplied mapping file. The chart of accounts and the live `Department` tag values are both in hand after Step 3, so budget lines could be matched to GL accounts by name. Department names are the harder half — a workbook heading and its Carta tag often share nothing lexically — so the design is to match what is matchable and ask about the rest, offering the firm's actual tag values as the choices.
- Scenario modeling — Phase 2.
- A post-build window-adjustment control on the `by-line-item` (outline) Budget vs Actuals view. `by-account` and `by-tag-crosstab` both have one — `BudgetPeriodControls`'s live range picker, and the "Compare through today instead" toggle, respectively (see [budget-workbook.md](budget-workbook.md)'s 2.75b-i) — the outline view still has neither.
- Formula-derived mapping evidence (`scripts/shapes/formula_infer.py`) resolves a `SUM`/plain-reference formula (same-sheet or cross-sheet) against a referenced row's GL identity, and a `SUMIF`/`SUMIFS` against a literal GL code, but only once the referenced row's own identity has settled — `tag_crosstab.py` and `pnl_outline.py` capture the raw formula at parse time (`source_formula`/`row_ix`); `build_manco_datadir.py`'s `resolve_formula_gl_evidence()` does the actual resolution afterward, once autolink/native-code/mapping-file passes have run. A referenced row that never resolves (no autolink, no mapping, no native code) drops out of the union rather than blocking it — the same "propose what's real, ask about the rest" rule as everywhere else in Step 4.7. `monthly_crosstab.py` doesn't capture `source_formula` at all yet. A `SUMIF`/`SUMIFS` criteria that is itself a cell reference (rather than a literal) stays unresolved — this pass reads already-parsed budget JSON, not the live workbook, so there's no cell to read a criteria value from. A `SUMIF`/`SUMIFS` whose criteria matches on a row's own *label* rather than a GL code (common in the wild — a workbook computing its own Actual by summing a ledger export filtered on the row's own category name) is not mapping evidence at all and is correctly left alone: the label is exactly what name-matching already tries, and the formula adds no signal beyond it.
