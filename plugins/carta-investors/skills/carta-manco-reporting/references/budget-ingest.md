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

**SILENT** apart from the one cached-data line below.

Run:
```bash
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-manco-reporting/scripts/manco_paths.py" resolve "<FIRM_NAME>" "<MANCO_NAME>"
```

The output JSON gives you `raw_dir`, `dashboard_dir`, `raw_age_days`,
`raw_inventory` (each file's age and whether it is stale), `needs_fetch` —
the filenames Step 3 should actually request, or `all` on a first run — and
`year` / `max_mo` / `as_of`, the window Step 3 scopes its queries to. Carry
all three forward as `<YEAR>`, `<MAX_MO>` and `<AS_OF>`; Step 3 must not
work them out for itself.

**Gate on `raw_age_days`, not `snapshot_age_days`.** `snapshot_age_days`
tracks Step 4's rebuild, which runs on *every* invocation — including one
that's about to skip Step 3 — so it is always ~0 and can never signal that
a refetch is due. `raw_age_days` comes from the `raw_dir/.fetched-at`
marker Step 3 writes only when it actually runs (see
[data-fetch.md](data-fetch.md)'s "Mark the fetch complete"), so it's the
one field that answers "how old is the underlying journal-entry data?"

- **`raw_age_days` is not null** → skip **Step 3 only** (the DWH fetch),
  no matter how old. Tell the user in one line: *"Using cached data from
  `<age>`."* Then **continue to Step 2.75 and carry on through 4, 5 and
  6 as normal.** Do not jump to launching. A warm cache is a statement
  about journal entries, nothing else. The operator already has a local
  app for this firm — re-running tens of DWH queries on every
  re-invocation just to restate data that may not have moved is the wrong
  default. Step 6 already offers "Refresh the Carta data" once the
  dashboard is up, so a real re-fetch is one answer away whenever it's
  actually wanted; Step 2.5 itself never re-fetches on age alone.
- **`raw_age_days` is null (never fetched)** → proceed to Step 3 and hand
  it `needs_fetch`. A null marker does not mean the directory is empty —
  it is also what an interrupted run leaves behind. Step 3 requests what
  `needs_fetch` names, not all 17. There is no cache to launch from yet,
  so this is the one case Step 3 cannot be deferred.

If the user's original invocation included the word "refresh" or "fetch fresh", always proceed to Step 3 regardless of cache age.

**A warm cache skips the fetch, never the budget resolution or the
rebuild.** Step 3 is the expensive part — tens of DWH queries — and once
a firm has been fetched at least once, re-paying that cost is the
operator's call, not something every re-invocation does for them. Step
2.75 is a local check costing nothing, and Step 4 rebuilds the snapshot
from `raw/` in seconds.

Skipping those two is what made a previously ingested workbook
un-droppable: the budget prompt never ran, the build never ran, and the
cached `snapshot.json` was served with its budgets already baked in — so
neither declining at the prompt nor removing the source workbook had any
effect until the cache aged out. Budget state has to be re-resolved on
every invocation, because it is the thing the operator is most likely to
be changing.


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
