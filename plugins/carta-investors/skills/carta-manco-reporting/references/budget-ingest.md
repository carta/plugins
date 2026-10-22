# Budget state: the cache check and the workbook gate

Steps 2.5 and 2.75's gate — the two that run on **every** invocation. The
detail behind each branch lives in a sibling file, read only when that branch
is actually taken:

| Read this | When |
|---|---|
| [budget-workbook.md](budget-workbook.md) | 2.75 needs to resolve, parse or re-map a workbook — a firm never asked before, or one changing its answers |
| [budget-vendors.md](budget-vendors.md) | Steps 4.5/4.6, both opt-in: inferring vendors, and accounts that pay people rather than suppliers |
| [budget-unresolved.md](budget-unresolved.md) | Step 4.7 — the build left budget lines with no actuals to resolve against |

Splitting them is deliberate. Steps 2.5 and 2.75 are marked *always*, so
whatever sits beside them is re-read on every warm reopen too — and the
workbook, vendor and unresolved-line machinery is far larger than the gate
that decides whether any of it applies.

> Steps referenced here that are documented elsewhere: **Step 3** → [data-fetch.md](data-fetch.md); **Step 4** → [serve-and-update.md](serve-and-update.md).

## Step 2.5 — Cache check

**SILENT** — no user-facing output in this step.

By this point `<FIRM_NAME>` and `<MANCO_NAME>` are resolved on every path —
cache hit or BUILD. Name the session after the entity now, so the session
list reads "Carta ManCo Microapp | `<MANCO_NAME>`" instead of this skill's own
name: if `mcp__ccd_session_mgmt__set_session_title` is available (load it
with `ToolSearch` if deferred), call it once with that title, silently, and
never mention it in the output. If the tool is unavailable, skip it — don't
ask the user about it or substitute another mechanism. Harmless to call
again on a later reopen of the same firm.

Run:
```bash
<UV_BIN> run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" resolve "<FIRM_NAME>" "<MANCO_NAME>"
```

The output JSON gives you `raw_dir`, `dashboard_dir`, `raw_age_days`,
`raw_inventory` (each file's age and whether it is stale), `needs_fetch` —
the filenames Step 3 should actually request, or `all` on a first run — and
`year` / `max_mo` / `as_of`, the window Step 3 scopes its queries to. Carry
all three forward as `<YEAR>`, `<MAX_MO>` and `<AS_OF>`; Step 3 must not
work them out for itself.

**Step 3 runs on every invocation, warm cache or cold, and requests only
what `needs_fetch` names.** The actuals — the journal entries, fee income
and cash balance — are always in it, so the dashboard's "Data as of" line
is the day the operator opened it, never the day of some earlier pull. A
reopen after `serve.py`'s idle shutdown, a day later, must not show
yesterday's numbers as current. Everything else keeps its own life
(`manco_paths.py`'s `max_age_days`): a closed budget month, the chart of
accounts, the fee schedules and the currency come back only once they
expire, so a warm reopen costs the handful of actuals queries, not the
full fetch. A null `raw_age_days` (never fetched, or an interrupted run)
is no different — `needs_fetch` already names whatever is missing. When the
pull can't run, Step 3 falls back to the cached actuals,
dated `raw_as_of` ([data-fetch.md](data-fetch.md)).

**Step 3 refreshes the actuals, never skips the budget resolution or the
rebuild.** Step 2.75 is a local check costing nothing, and Step 4 rebuilds
the snapshot from `raw/` in seconds.

Skipping those two is what made a previously ingested workbook
un-droppable: the budget prompt never ran, the build never ran, and the
cached `snapshot.json` was served with its budgets already baked in — so
neither declining at the prompt nor removing the source workbook had any
effect until the cache aged out. Budget *state* has to be re-checked on
every invocation — is there still a ref, does the operator's decline
still stand, is the workbook still where the ref says, does the cached
parse still read — even though none of that implies re-parsing the
workbook itself; see [budget-workbook.md](budget-workbook.md)'s 2.75a for
what actually triggers a re-parse.


## Step 2.75 — Optional Excel budget ingest (SILENT unless first-time)

A firm's own Excel workbook is the source of truth for the Budget vs
Actuals dashboard page whenever their ManCo budget lives outside Carta —
common enough that Carta's stored budget is frequently empty or stale for
these firms. A typical tag-crosstab tab carries one Actual/Budget/Variance
block per value of whatever the firm breaks its budget out by — departments
on one firm, cost centres or funds on another — keyed on GL account, plus a
Comments column
recording why each budget line was set where it was. Carta's
`fa__list__budgets` remains the fallback for firms without a workbook.

This step's outcome also decides Step 3's scope: when it ends with a
workbook in play, Step 3 skips the 12 monthly `fa__list__budgets` calls
entirely — see [data-fetch.md](data-fetch.md)'s "Budget fetches" section
for the exact condition.
