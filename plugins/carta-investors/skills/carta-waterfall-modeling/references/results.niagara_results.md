# Results — `niagara_results` (fetch loop, BLUF, cuts)

Step 6 orchestration for the `…:get:niagara_results` command: the multi-entity
fetch loop, the BLUF lead, and the follow-up cuts. Table specs are in
`rendering.niagara_results.md`; the shared shell (surface fork, cap table,
formatting rules, follow-up menu) stays in `SKILL.md`.

The flow is two nested loops: **outer across entities** (in `nodes_summary`
order, root first), **inner across pages** of the active entity. Always start
with grouping `BY_HOLDER`.

## Excel — fetch & write order (`excel` only)

`chat` ignores this — it renders inline as the steps below describe. In `excel`, the
three steps below fetch in order and write **once**; mechanics + tab layouts in
`excel-output.md`.

1. **Bootstrap alone, first (Step 6a)** — one breakpoints-only fetch (root page 1,
   `include_breakpoints: true`, `include_allocations: false`, no `node_id`) that waits
   out the engine compute and returns the root's breakpoints. **Never pass `raw`** — it
   returns the unformatted payload, far larger, and blows the size cap. **The tier count
   picks the path and page size — decide by tier count, not row count** (few rows at 25
   still oversize when each holder has many interest sub-rows): ≤ 50 tiers and bootstrap
   fit → *small* (hold in context, `page_size: 25`); else *large* (`page_size: 10`, and
   stash the **full** breakpoints array to a blob **this same turn, before snipping** any
   tool result — **never a placeholder or partial stub to fill later**; archived results
   return only capped slices, so a stub or a snip-first both force a re-fetch). Fetch
   nothing else this wave — parallel calls just hit "still computing".
2. **Then fetch everything else in parallel** — compute is done. The **root** cap table
   (if present and not already written for this `(target, date)` — reuse rule in the cap-table detail doc)
   **+** the root's lean pages `1…ceil(total_count/page_size)` (`include_breakpoints:
   false`) **+** each non-root's bootstrap, then the non-roots' lean pages once their
   `total_count` is known. **Fetch pages concurrently, never one at a time** — small: all
   at once, hold; large: waves of ~3–4 pages, batch-stashing each wave before the next.
   Use the page size from step 1 and just start — don't re-deliberate sizes.
3. **Write once.** One final `execute_office_js` builds each block programmatically and
   writes with one writer helper — **Cap Table block first, then the Waterfall block**
   (skip cap table when `cap_table_command` is absent or an unrecognized noun) — from the held pages (small)
   or the blobs (large). Atomic: nothing written until every page is in hand. **Never**
   read the workbook back to verify, and never write per tab in separate calls.

Announce _"pulling the cap table"_ then _"pulling the allocations"_ as data is
gathered; don't narrate individual fetches. Write mechanics and both tab layouts —
the single-call build, USD currency, column widths, metadata band, and the
existing-tab classify → Carta-standard/Adapt decision — live in
`excel-output.md` §Write mechanics.

## Step 6a — Bootstrap nodes_summary

Fetch page 1 first, omitting `node_id`. Backend defaults to the root entity
and returns `nodes_summary` — the graph-wide table of contents — which
decides what to fetch next.

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
  "include_allocations": false
}})
→ response: { grouping, page, page_size, total_pages, total_count,
             allocations: [], breakpoints, grand_totals,
             node_id: "<root node_id>", nodes_summary: [...] }
```

The results call always sends `owner_kind`, `owner_id`, `target_kind`,
`target_id`, and `execution_id`. `grouping` is only ever `BY_HOLDER` or
`BY_TYPE` — never send another value.

This is a **breakpoints-only bootstrap** (`include_allocations: false`) — it returns
`breakpoints`, `total_count`, `grand_totals`, and `nodes_summary` with no
`allocations` (Step 6b's lean loop owns those). **Cache** its `breakpoints` for the
node+execution — static per node, so they ride on this mandatory compute-waiting
call with no separate fetch. Plan the Step 6b loop off `total_count`, not
`total_pages`.

`nodes_summary[i]` shape: `{ node_id, name, is_root, total_holders }`.
Backend does NOT sort. Find the root by `is_root`; fall back to
`nodes_summary[0]` if no entry is flagged.

```
root      = first n in nodes_summary where n.is_root, else nodes_summary[0]
non_roots = [n in nodes_summary if n is not root]
ordered   = [root, *non_roots]
```

The cap table (`SKILL.md` §Step 6a.5) is shown after this bootstrap, before Step 6b.

## Step 6b — Loop entities × pages

Bootstrap each entity in `ordered` once, then page its allocations **lean** (per
the loop below). The root's bootstrap is Step 6a; each non-root gets its own.

**Fetch concurrently** once the root bootstrap (Step 6a) returns and compute is
done: batch 1 = the root's lean pages + each non-root's bootstrap; batch 2 = the
non-roots' lean pages (once their `total_count` is known). Accumulate by `node_id`
regardless of arrival order; render/write order still follows `ordered`.

```
per_entity = {}  // node_id -> { display_name, is_root, allocations, breakpoints, grand_totals }

for entity in ordered:
  if entity is root:
    bootstrap = Step 6a response            // already in hand — don't re-fetch
  else:
    bootstrap = call get_command with page=1, include_breakpoints=true,
                include_allocations=false, node_id=entity.node_id
  cache bootstrap.breakpoints + bootstrap.grand_totals + bootstrap.total_count

  // lean pages own every allocation; breakpoints already cached; plan off total_count.
  // page_size from Step 6a (25 small / 10 large); no `raw`.
  for page in 1 .. ceil(bootstrap.total_count / page_size):
    call get_command with page=page, page_size=<25 small | 10 large>,
         include_breakpoints=false, node_id=entity.node_id
    accumulate response.allocations
```

**Display name** for each entity: prefer `entity.name`. If `null`, fall back
to the order-positional label `"Entity 1"`, `"Entity 2"`, … (root is
`"Entity 1"`, non-roots increment in natural order). Never invent names from
issuer ids or other fields.

Single-entity structures (`nodes_summary.length == 1`) take this loop
exactly once — same shape.

**Error handling** (per-call):

- `504 waterfall_still_computing` **or** the literal `Upstream request timed out, please retry`
  → the engine is still computing (the first call waits it out). "The waterfall is still
  computing. Want me to retry?" Retry the **same** call (same entity, same page).
- `502 waterfall_execution_failed` → "The compute failed. Want me to try again?" Retry is the same as 504.
- `400 invalid_request` (e.g. entity index out of range) → stop and surface the message. Do not retry.
- `response too large` on a **lean allocation page** → a signal, not truncation (no rows
  lost): halve `page_size` and re-page that entity from page 1, discarding partials;
  stop at `page_size: 1`; `log()` each drop. **Never drop data to fit** — no group-level
  only, no omitting sub-rows/holders/tiers; shrinking `page_size` is the only answer.
- `response too large` on the **breakpoints-only bootstrap** (too many tiers) → skip breakpoints:
  run the lean loop from page 1 as usual (`include_breakpoints: false`) — its first page still
  carries `total_count`, `grand_totals`, and `nodes_summary` — and tell the user breakpoints are
  unavailable this run.
- Shared: `403`, `404 target_not_found`, `502 target_lookup_failed` — see `SKILL.md` §Error handling.

## BLUF lead — multi-entity (`chat`)

`is_multi_entity` is false → use the shared single-entity BLUF in `SKILL.md`. When
`is_multi_entity`:

> Running against **{root display name}** (the top-level entity for this
> deal) at **$1.00B** on **2025-06-15**, grouped by holder. Per-entity
> breakdown below.

Never name a top recipient, cite %, or call out MOIC/IRR.

## Allocations table

Render per `rendering.niagara_results.md` §Allocations table — one BY_HOLDER
table per entity in `ordered`, group rows + interest sub-rows + per-entity Total.

## Follow-up cuts

The shared follow-up menu is in `follow-up.md`; these are the `niagara_results`
cut handlers it dispatches to.

- `"Group results by security type"` → re-run the **same entity × page** loop above with
  `grouping: "BY_TYPE"`. Multi-entity: one BY_TYPE table per entity, in the same
  root-first order. Reuse the group row + total row + formatting rules from the BY_HOLDER
  table (`rendering.niagara_results.md` §Allocations table) — only the **sub-row** changes
  (see below). The group row's first column is `group_name`, which is the security-type
  name in this grouping.

  **Sub-row (BY_TYPE)** — first column = `"{holder_name} — {interest_label}"`
  (e.g. "Acme Holdings LP — A-1"), built from
  `interest_allocations[j].holder_name` and
  `interest_allocations[j].interest_label`. Prefix with `↳ ` or indent.
  All other sub-row columns are identical to the BY_HOLDER sub-row.

- `"Show only my firm's holdings"` → fetch firm holders, filter the
  cached allocations per-node, and re-render. See "Firm-holders filter" below.

- `"Show breakpoints"` → no fetch needed. `breakpoints` is cached per node from its
  bootstrap (Step 6a/6b); the lean allocation pages return none. Render per
  `rendering.niagara_results.md` §Breakpoints table. **Multi-entity**: one
  breakpoints table per entity, in the same root-first order as the allocations
  tables, under a `### {entity name}` subheader. Accept free-text targeting like
  `"Show breakpoints for Acme Holdings LLC"` — match `nodes_summary[i].name`
  case-insensitively (substring match is fine for fuzzy disambiguation). If the
  match is ambiguous, ask via `AskUserQuestion` with the candidate entities. If
  unmatched, list the entities and ask again. **Single-entity**: render the one
  breakpoints table without a subheader.

## Firm-holders filter (only on request)

Lazy — only fetch when the user picks "Show only my firm's holdings".
Cache the result so repeat selections don't refetch.

```
call_tool({"name": "waterfall_modeling__list__firm_holders", "arguments": {
  "owner_kind":      "FIRM",
  "owner_id":        <locked from Step 1>,
  "target_kind":     "<locked from Step 2>",
  "target_id":       "<locked from Step 2>"
}})
→ response: { holders: [{holder_id, legal_name, issuer_id}, ...] }
```

Build a set `firm_holder_ids = { h.holder_id for h in response.holders }`.

Filter each cached **per-node** `allocations` (whichever grouping is currently
active — BY_HOLDER or BY_TYPE). The single firm_holder_ids set applies across
all nodes — backend returns the same firm-holder set regardless of which
issuer in the ME structure was used for the firm-holders fetch.

- **BY_HOLDER**: keep group `g` if any
  `g.interest_allocations[j].holder_id` is in `firm_holder_ids`. Within
  a kept group, drop sub-rows whose `holder_id` is not in the set. If
  every sub-row is dropped, drop the group.
- **BY_TYPE**: same rule applied at the sub-row level — drop
  `interest_allocations[j]` entries whose `holder_id` is not in
  `firm_holder_ids`. Drop the type group if no sub-rows remain.

The `"other-holders"` rollup never matches a `firm_holder_id`, so it's already dropped from
the firm cut; it stays in the full table.

Per-node, re-sum proceeds + units across the kept rows for a "Firm subtotal"
row, appended after the filtered group rows but before that node's
unfiltered "Total" row. Each node's unfiltered Total row stays put and is
labeled "Total (full waterfall)" so the firm vs. full delta is visible
**per entity**.

If `firm_holder_ids` is empty, render once (not per-node):

> "No firm-scoped holdings on this waterfall — your portfolios don't
> hold any of the targets in this waterfall."

and return to the follow-up prompt without altering the tables.

If `firm_holder_ids` is non-empty but no entity has a matching sub-row,
render the entity sections as empty under their headers with a single line:

> "No firm-scoped holdings in **{entity name}**."

**Error handling**:

- `404 target_not_found` → tell the user the issuer couldn't be resolved
  for firm scoping; offer to keep the unfiltered table.
- `501 firm_holders_route_not_supported` → tell the user firm filtering
  isn't supported for this issuer kind yet. Keep the unfiltered table.
- `403` → permission denied. Stop the filter; keep the unfiltered table.
