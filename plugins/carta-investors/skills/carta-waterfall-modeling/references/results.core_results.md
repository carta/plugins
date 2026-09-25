# Results — `core_results` (fetch loop, BLUF, cuts)

Step 6 orchestration for the `…:get:core_results` command: the single-node fetch
loop, the BLUF lead, and the follow-up cuts. Table specs are in
`rendering.core_results.md`; the shared shell (surface fork, cap table, formatting
rules, follow-up menu) stays in `SKILL.md`.

Core results are single-node — one corporation, no entity graph, no `node_id` to
narrow by. The flow is a single loop **across pages**. Always start with grouping
`BY_HOLDER`.

## Excel — fetch & write order (`excel` only)

`chat` ignores this — it renders inline as the steps below describe. In `excel`, the
three steps below fetch in order and write **once**; mechanics + tab layouts in
`excel-output.md`.

1. **Page 1 alone, first (Step 6a)** — one fetch (page 1, `include_breakpoints:
   true`, `include_allocations: true`) that waits out the engine compute and returns
   the breakpoints, `total_count`, `grand_totals`, and the first allocations page.
   **Never pass `raw`** — it returns the unformatted payload, far larger, and blows
   the size cap. Fetch nothing else this wave — parallel calls just hit "still
   computing".
2. **Then fetch everything else in parallel** — compute is done. The cap table (if
   present and not already written for this `(target, date)` — reuse rule in the
   cap-table detail doc) **+** the remaining lean pages `2…ceil(total_count/page_size)`
   (`include_breakpoints: false`). **Fetch pages concurrently, never one at a time.**
3. **Write once.** One final `execute_office_js` builds each block programmatically
   and writes with one writer helper — **Cap Table block first, then the Waterfall
   block** (skip cap table when `cap_table_command` is absent or an unrecognized
   noun) — from the held pages. Atomic: nothing written until every page is in hand.
   **Never** read the workbook back to verify, and never write per tab in separate
   calls.

Announce _"pulling the cap table"_ then _"pulling the allocations"_ as data is
gathered; don't narrate individual fetches.

## Step 6a — Fetch results

Core is single-node — nothing to bootstrap from, no `node_id` to narrow by. The
response carries `node_id` and a 1-element `nodes_summary`; both are inert here —
ignore them. Fetch page 1 with **both** breakpoints and allocations; the backend
polls the engine on this first call, waiting out the compute. Breakpoints ride
this page; later pages page the allocations **lean**.

```
call_tool({"name": "<get_command with all ':' replaced by '__'>", "arguments": {
  "owner_kind":   "FIRM",
  "owner_id":     "<org_pk from Step 1>",
  "target_kind":  "<locked from Step 2>",
  "target_id":    "<locked from Step 2>",
  "execution_id": "<locked from Step 5>",
  "grouping":     "BY_HOLDER",
  "page":         1,
  "include_breakpoints": true,
  "include_allocations": true
}})
→ response: { grouping, page, page_size, total_pages, total_count,
             allocations, breakpoints, grand_totals,
             node_id, nodes_summary: [<1 entry>] }
```

The results call always sends `owner_kind`, `owner_id`, `target_kind`, `target_id`,
and `execution_id`. `grouping` is only ever `BY_HOLDER` or `BY_TYPE` — never send
another value. **Cache** page 1's `breakpoints` + `grand_totals` for this execution
— static per run, so they ride this mandatory compute-waiting call with no separate
fetch. Plan the page loop off `total_count`, not `total_pages`.

The cap table (`SKILL.md` §Step 6a.5) is shown after page 1, before the remaining
pages.

Page the rest **lean** — breakpoints already cached:

```
for page in 2 .. ceil(total_count / page_size):
  call get_command with page=page, page_size=25, grouping="BY_HOLDER",
       include_breakpoints=false, include_allocations=true
  accumulate response.allocations
```

`page_size` is 25; no `raw`. Single-node — one pass; `node_id` / `nodes_summary`
ride each page but stay inert.

**Error handling** (per-call):

- `504 waterfall_still_computing` **or** the literal `Upstream request timed out, please retry`
  → the engine is still computing (the first call waits it out). "The waterfall is still
  computing. Want me to retry?" Retry the **same** call (same page).
- `502 waterfall_execution_failed` → "The compute failed. Want me to try again?" Retry is the same as 504.
- `400 invalid_request` → stop and surface the message. Do not retry.
- `response too large` on a **lean allocation page** → a signal, not truncation (no rows
  lost): halve `page_size` and re-page from page 1, discarding partials; stop at
  `page_size: 1`; `log()` each drop. **Never drop data to fit** — shrinking `page_size` is
  the only answer.
- `response too large` on **page 1** (a very large breakpoint tier list) → retry page 1 with
  `include_breakpoints: false`, run the loop lean, and tell the user breakpoints are
  unavailable this run.
- Shared: `403`, `404 target_not_found`, `502 target_lookup_failed` — see `SKILL.md` §Error handling.

## BLUF lead

Core is always single-node → use the shared single-entity BLUF in `SKILL.md`
§BLUF lead — single-entity.

## Allocations table

Render per `rendering.core_results.md` §Allocations table (always — grouping
`BY_HOLDER`) — one table, one row per stakeholder, plus a per-run Total.

## Follow-up cuts

The shared follow-up menu is in `follow-up.md`; these are the `core_results`
cut handlers it dispatches to.

- `"Group results by security type"` → re-run the page loop above with
  `grouping: "BY_TYPE"`. Render the share-class table per `rendering.core_results.md`
  §Allocations table (grouping `BY_TYPE`).

- `"Show only my firm's holdings"` → no fetch needed. Filter the cached
  allocations by the firm's `org_pk` and re-render. See "Firm-holders filter"
  below.

- `"Show breakpoints"` → no fetch needed. `breakpoints` is cached from page 1
  (Step 6a); the lean allocation pages return none. Render per
  `rendering.core_results.md` §Breakpoints table. Single-node — one table, no
  subheader.

## Firm-holders filter (only on request)

No fetch — the `org_pk` from Step 1 is all the cut needs. The firm's holdings
arrive as the single row keyed `"ORGANIZATION: {org_pk}"`.

The firm cut is a **stakeholder view** — render the BY_HOLDER table (re-page
BY_HOLDER first if the user was in BY_TYPE), keeping rows whose `key` is exactly
`"ORGANIZATION: {org_pk}"`. Match the whole `key`, never the `"ORGANIZATION: "`
prefix — other holders are organization-keyed too. A `"STAKEHOLDER: {id}"` row is
never the firm's, and the `"OTHER_HOLDERS"` aggregate never matches either, so both
are already dropped from the firm cut; they stay in the full table.

Re-sum proceeds across the kept rows for a "Firm subtotal" row, appended after the
filtered rows but before the unfiltered "Total" row. The unfiltered Total row stays
put and is labeled "Total (full waterfall)" so the firm vs. full delta is visible.

If no row matches, render once:

> "No firm-scoped holdings on this waterfall — your portfolios don't hold this company."

and return to the follow-up prompt without altering the table.
