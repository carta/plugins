---
name: carta-audit-download
version: 0.1.0
description: >-
  Pull a fund's audit documents — every audit area, or just the areas picked, one zip
  per area (General, Cash, Investments, Partners' Equity, Income & Expenses, Financial
  Packages, Supplemental). The equivalent of the investor-portal Audit Documents
  page's "Download All" button, or a per-tab download. Use when someone asks to
  download, export, pull, or zip audit documents, get the audit package, or get the
  financial packages for an audit. For an auditor working their own engagement, or
  Carta staff assisting one. Also use for "run the audit plugin as an auditor" requests
  for a firm and reporting year, even when the fund or year isn't named yet; the steps
  below find them. Not for a firm's own Documents page (use carta-download-firm-document)
  or documents a GP shares with LPs.
allowed-tools:
  - mcp__carta__call_tool
  - mcp__carta__read_tool
  - mcp__carta__welcome
  - mcp__carta__list_contexts
  - mcp__carta__set_context
  - mcp__claude_ai_Carta__call_tool
  - mcp__claude_ai_Carta__read_tool
  - mcp__claude_ai_Carta__welcome
  - mcp__claude_ai_Carta__list_contexts
  - mcp__claude_ai_Carta__set_context
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__call_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__read_tool
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__welcome
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__list_contexts
  - mcp__2827383e-1775-4df3-b6ff-04d5392f6d18__set_context
  - AskUserQuestion
  - Read
  - Write(/${CLAUDE_PLUGIN_DATA}/manifests/**)
  - Write(~/.claude/plugins/data/carta-investors-*/manifests/**)
  - Write(//tmp/carta-audit-documents/**)
  - Bash(cat /tmp/carta-audit-documents/index-*)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py *)
  - Bash(mkdir -p *)
  - Bash(sleep *)
  - Bash(uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/build_contents_page.py *)
  - mcp__visualize__read_me
  - mcp__visualize__show_widget
  - SendUserFile
model: inherit
trigger-phrases:
  - "download all audit documents"
  - "get the audit documents for this fund"
  - "pull the audit package"
  - "zip the audit documents"
  - "download audit documents"
  - "audit download all"
  - "download the financial packages for audit"
  - "get the partner equity audit documents"
---

<!-- carta:plugin-version -->
<carta-plugin>carta-investors:7.65.0</carta-plugin>

# Download audit documents

Pull audit documents for a fund — every document across all audit areas
(the same set the investor-portal Audit Documents page's "Download All" button
produces), or just the areas the caller wants, one zip per area.

## Voice

Write for an external auditor, not a Carta employee. Never show the caller a fund
UUID, a task id, an `fa__*` command name, the words "MCP" or "audit_area", or a raw
`lifecycle_status` value, or an internal system name such as carta-web or fund-admin.
Funds go by name, areas by their labels.

## If the caller only wants to know what's there

This skill exports. If the request is really about **readiness** — "is this fund
ready", "what's missing", "what's still processing" — hand off to
`carta-investors:carta-audit-readiness` instead of running an export nobody asked for. That
includes a persona-framed request whose actual subject is readiness rather than
files.

## Impersonation

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/impersonation.md` (the plugin's own
`references/`, not this skill's) and follow it. Do not search for the file — read it
at that path.

---

## Step 0 — Connect

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/mcp-setup.md` (the plugin's own `references/`,
not this skill's) and follow it to identify the Carta MCP server and attach
`_instrumentation_v2` to every call. Do not search for the file — read it at that
path.

---

## Step 1 — Resolve the engagement

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/resolve-engagement.md` for the firm, fund and
audit year rules. If an earlier audit skill already established them in this
conversation, reuse them rather than re-asking. Otherwise Step 2's picker resolves
the funds and year, and Step 3b's picker the areas and document types. Step 2 is built
on that reference's "Several funds at once" section, so the caller can tick one fund
or many without having to ask for several funds in words.

Read `${CLAUDE_PLUGIN_ROOT}/references/audit/audit-areas.md` for the seven areas, their
`audit_area` values, and the readiness translation table.

---

## Step 2 — Funds and audit year

The investor-portal Audit Documents page picks a fund and a year with two dropdowns
(a fund dropdown and a year dropdown), one fund at a time. Mirror it with one `show_widget`
picker, but let the caller tick several funds at once. Auditors often audit several
funds, and downloading them one by one is the back-and-forth this picker removes. The
areas and document types come next, in Step 3b's picker, once Step 3 has listed what
each fund actually holds.

**Skip the widget entirely** when the prompt already gives its two fields — one or
more funds (UUID, audit-portal URL, or an unambiguous name) and an audit year. A UUID
or audit-portal URL can be used directly; an unambiguous fund name still needs
`fa__list__auditable-funds` to resolve to a UUID, but skip straight to that lookup and
on to Step 3 — no widget, no `AskUserQuestion`. This path shows no year dropdown, so
make one lookup call per firm with `report_year` set to the year the caller gave, not
the 2022–2026 sweep that "Years with documents" in `resolve-engagement.md` runs to fill
the picker's dropdown. When the caller gives **more than one** fund by UUID or URL, make
that same one call per firm to learn each fund's name, since Step 5 needs a name to keep
the funds' zips apart; one fund by UUID or URL needs no lookup. For several named funds, "Several
funds at once" step 3's skip rule decides; skip straight to Step 3 only when the audit
year is given too. When the prompt also names the areas (or "download all") and no
document types, there is no Step 3b picker either; named document types go through
"Document types named in words" under Step 3b. The fast path stays fast.

**"Unambiguous" is an assumption, not a guarantee — verify it before skipping the
widget.** Resolve each named fund with the clean-match rule in
`resolve-engagement.md`. Only proceed straight to Step 3 when every named fund has
**exactly one** clean match. If any lookup comes back with **zero** or **multiple**
clean matches, the name wasn't actually unambiguous — fall through to the widget below
(or, past its fund cap, to its `AskUserQuestion` fallback) rather than guessing. Don't
silently default to the first result here the way the widget's own pre-tick does — the
point of this fast path is skipping confirmation, so a wrong silent guess has no widget
for the caller to catch before Step 3 runs.

**This picker replaces "Several funds at once" step 3's `audit_funds_picker` for this
skill — never show both, and never show a funds checklist twice in one run.** When the
funds and year are already set — by an earlier audit skill, or by a funds picker
the caller already submitted — skip this widget and go straight to Step 3, then Step
3b's picker for the areas and types.

**Otherwise, show the widget** — with the funds pre-ticked from the prompt and the
year pre-selected per "Years with documents" in `resolve-engagement.md`:

1. Gather the funds as steps 1–2 of "Several funds at once" in
   `resolve-engagement.md` say, including step 1's fallback when
   `fa__list__member-firms` is empty (resolve the one firm, then show this picker
   with that firm's funds only — never a single-fund `AskUserQuestion` first). Call
   `fa__list__auditable-funds` once per firm and year, as "Years with documents" in
   `resolve-engagement.md` says, with `carta-investors:carta-audit-download` as the
   skill. Send all of one firm's year calls as separate tool calls in one message, not
   one call per turn.
   - **Zero funds across every firm** → tell the caller they have no funds they can
     audit, and stop.
2. Call `mcp__visualize__read_me` once (module: `mockup`) if this is the first
   `show_widget` call this conversation, then `show_widget` with a `title` (required —
   `audit_documents_picker`) and:
   - **Funds** — "Several funds at once" step 3's checklist, with these differences:
     when its pre-tick rule leaves nothing ticked, pre-tick the first fund in the
     order `fa__list__auditable-funds` returned them (mirroring
     that page's fund dropdown); with a single firm, drop the firm heading but
     keep "Select all".
   - **Audit year dropdown** — only the years the ticked funds have documents for,
     updating as funds are ticked, and pre-selected, per "Years with documents" in
     `resolve-engagement.md`.
   - **A live count** beside the button — "3 funds selected" — so the caller sees the
     size of the request before going on.
   - **A Next button** that fires:
     ```js
     sendPrompt("Use funds <fund_uuid>,<fund_uuid>,… audit year <year> for the audit documents download")
     ```
     **Validate before firing it.** Per the visualize design system's "Validate input
     in interactive widgets" rule, check the funds in the click handler: if no fund
     is ticked, show "Choose at least one fund" next to the funds list, styled per
     "Widget limits" in `resolve-engagement.md`, and stop; do not call `sendPrompt`.
     Clear the error as soon as the caller ticks a fund. If the caller gave no year
     and the ticked funds offer none, show that reference's no-year error by the
     dropdown instead, and stop; do not call `sendPrompt`.
3. On re-entry, parse the submitted funds and year from the prompt and continue at
   Step 3 directly — do not re-run Step 1 or re-show the widget.

**Cap the picker at 60 funds and 10 firms in total.** This picker sets its own cap
against the size ceiling in "Widget limits" in `resolve-engagement.md` (rendered HTML
past it hangs silently): 60 fund rows with their years at about 190 bytes is 11.4KB;
the select-all, live-count, year-filter, validation and button script and the inline
errors about 2.5KB; the year dropdown and frame about 0.8KB; 10 firm headings with
their "Select all" toggles at about 200 bytes each, 2KB. That is about 16.7KB, leaving
margin for long fund names, since every figure is an estimate.

**Asking the funds without the picker.** Past either limit, or on a surface with no
`show_widget`, skip the widget and ask as "Several funds at once" step 3 in
`resolve-engagement.md` says for that case (still resolved against
`fa__list__auditable-funds`, same clean-match rule) — don't truncate the fund list
silently.

`audit_year` is **required** for the export in Step 4 even though the widget/lookup
above may have used `report_year` to get here — carry the resolved year forward under
the export call's own `audit_year` name.

**Several funds or years:** when the caller wants more than one fund or more than one
`audit_year`, read `${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/references/several-funds-or-years.md` now, before Step 3.
Its "Order of work" sets how Steps 3–5 run for the batch.

---

## Step 3 — List the fund's audit documents

```
mcp__<SERVER>__read_tool({
  "name": "fa__list__audit-documents",
  "arguments": {"fund_uuid": "<fund_uuid>", "audit_year": <audit_year>, "audit_area": "<audit_area>"},
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-download"]}
})
```

Rows are under `results`; a zero-row match is an envelope with `count: 0`. That
envelope, from the area's own listing, is the only evidence of "no documents filed". An
area that was never listed, or whose listing failed, is not empty.

Pass exactly one `audit_area` on every call, whatever the fund's size and however few
documents you expect — the backend filters server-side, so you're not pulling the whole
fund's documents just to throw most of them away. A run over several areas, or "All",
is the "Download all" loop below: one call per area. Several funds or years follow
the "Order of work" in `several-funds-or-years.md` (this skill's own `references/`, read in Step 2).

**Send the list calls in parallel.** Every (fund, year, area) listing is independent of
the others, so issue all of them as separate tool calls in ONE message — all seven areas
for every fund and year — not one call per turn. A firm's calls need that firm's context
(`resolve-engagement.md`), so the unit is one message per firm, never one per fund or
per area. When some answers say `has_next`, send the next page of every one of them
together in one message, and repeat until none does.

When the areas aren't set yet, or the caller named document types, Step 3b needs the
rows before anything is exported: list the named areas, or all seven when none were
named, for every fund, all together, with every page. Keep the rows; Step 3b and Step
4 reuse them, and the "Download all" loop below doesn't list them again. In this
listing a fund-level failure (see "Download all"'s "First, check whether the error is
fund-level") stops that fund's listing only; with several funds the rest continue, as
"Multiple funds" in `several-funds-or-years.md` (this skill's own `references/`, read in Step 2) says, and Step 3b names the skipped funds in one line. When no fund
listed at all, report it per the access guidance in `resolve-engagement.md` and stop;
show no picker. An empty or
denied area is that area's problem, and Step 3b shows it as empty or unavailable.

Each row in `results` carries `id`, `name`, `audit_area`, `document_type`, `year`,
`month`, `state`, `lifecycle_status`, `updated_at`. As each response arrives, add its
rows to the document index (see Step 5), so no row has to be typed out twice — except
when the rows are listed before Step 3b, or reused from carta-audit: then write no
index parts yet. Keep the rows, and once the choice is made write parts for exactly
the rows Step 4 exports (see "Rows listed before a choice" in `document-index.md`). `count` is this page's row count, not the
fund-year's total — if `has_next` is true, re-run with `after` set to `next` and add
`count` across pages before summarising totals by area (e.g. "1,090 documents: 640
partner documents, 310 entity documents, 140 capital activity notices, no financial
packages"); if you stop before `has_next` is false, say the totals are partial rather
than presenting them as complete. Translate any `lifecycle_status` you mention per
`audit-areas.md`; never print the raw value.

**For `partner-equity`, a null or out-of-range `year` on some rows is expected** —
see `audit-areas.md`'s periodic-vs-one-time-signing split before flagging one as
miscategorised.

**Oversize answers are handled here, with no step for the caller.** A list answer that
is a stub (`document_returned`, `document_url`) instead of rows can come back even with
one `audit_area` set. It is neither an empty area nor a failure. Fetch the real rows
yourself, as "Oversize responses" in `mcp-setup.md` says: save them with
`uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py "<document_url>" /tmp/carta-audit-documents/listing-<n>.json`, `Read` that file, and carry on with
those rows as if they had come back inline, every page included. Send the fetches for
several stubs together in one message. Each stub gets one fetch, plus one fresh list
call for that area if its URL has expired. Do not ask the caller to fetch anything.

If the rows still can't be had (no shell access, a failed fetch, a second dead URL),
stop there and treat only that (fund, year, area) as **too many to list**. It still has
documents, so it is never "no documents filed" and never "Unavailable". Step 3b offers
it as a whole area, with "Too many to list" where the count would be, no document types
under it and no new badge; ticking it takes all of it, and document types named in
words can't pick from it, which you say in one line. Step 4 exports it by `audit_area`,
which needs no ids. Its rows stay out of the document index, so name it in the one line
`document-index.md` asks for when the index is partial, and, as its rows were never
listed, count it as not listed for the whole-fund record in `check-record.md`.

**Zero documents or a permission error on a single named area is terminal** — report
it per the access guidance in `resolve-engagement.md` and stop. (Listing several areas
follows the fund-level/area-level rule above instead.) Do not retry with a different fund or a
wider scope.

For a whole area, Step 4 doesn't need the ids: pass the same `audit_area` into the
export rather than enumerating every `id`, and the export endpoint resolves
membership from `audit_area` itself server-side. Only a document-type subset picked in
Step 3b needs the ids, taken from these rows.

---

## Step 3b — Areas and document types

Skip the picker when the areas are already set and the caller named no document
types: the caller named the areas (or said "all", "all areas", "everything") in the
prompt, or a submitted Step 3b picker already gave them. Never show a picker to confirm
a choice the caller already made. A skipped picker also means no check-record read: the
record only feeds the picker's new badges. Named document types always go through
"Document types named in words" below, whether or not an area was named. Otherwise show one
`show_widget` picker (`title`: `audit_areas_picker`) built from Step 3's listing, so the
caller picks from what the funds actually hold, with what's new marked where they choose.

**Before building it, work out what's new** (only now, since this picker is the only
place the badges show). Read
`${CLAUDE_PLUGIN_ROOT}/references/audit/check-record.md` (the plugin's own `references/`, not
this skill's; do not search for it) and follow its "Reading it" section for each fund and year's whole-fund record (`all`), with every fund and year's `Read` in one message, then its "What counts as new" section, which decides the
first check and gives the first-check line to put under the heading.
If `carta-investors:carta-audit` ran earlier in this conversation for the same fund and year,
use the record as carta-audit read it, before it saved over it, and its listing too
rather than listing again: comparing against the record carta-audit just saved would
show nothing new.

Then save each fund and year's record per "Writing it" in `check-record.md`, with every
document across the seven areas, all the `Write` calls in one message; that section says
when a whole-fund record may be written.

**The picker:**

- **One row per audit area**, in `audit-areas.md` order, with a checkbox, the area
  label, its document count and a new badge: "3 new" when the area has new documents,
  "Nothing new" otherwise, no badge on a first check. An empty area shows "Nothing
  filed" (Financial Packages: "Not published yet") and an area that failed or was
  denied shows "Unavailable"; either way its checkbox is disabled.
- **Each area opens into its document types** — one checkbox per distinct
  `document_type` in that area's rows, with its count and, when it has any, its new
  count. Take the names from the rows exactly as Carta returns them; never rename,
  merge or invent a type. Rows with a null or empty `document_type` group under "No
  document type", and ticking it selects exactly those rows (Step 4). Areas start
  closed; the button that opens one reads "View Details". Ticking an area ticks every type in it; ticking some types leaves the area
  partly ticked. An area that was too many to list (Step 3) shows "Too many to list"
  instead of a count, with no types or new badge, and its checkbox ticks the whole area.
- **Starting state:** pre-tick the caller-named areas and types if any; leave every
  box unticked otherwise. Which documents the caller wants is a real choice worth a
  click rather than a guess.
- **Partners' Equity** carries one line inside it: "Carta exports Partners' Equity as
  a whole area, so the download includes every type below even if you pick only
  some." Step 4 explains why.
- With several funds, or several years, add each type's counts across them. Counts
  are documents, never amounts, so adding them is safe.
- **Two shortcuts** above the list: "All areas" ticks every non-empty area; "Only
  areas with new documents" hides the areas with nothing new. Leave the shortcut out
  on a first check.
- **A live count** beside Submit — "106 documents selected · 2 new" (no new count on
  a first check, or for the records still on theirs).
- **Submit** fires:
  ```js
  sendPrompt("Use documents <area value>=all; <area value>=<type>|<type>; … for the audit documents download")
  ```
  One `<area value>=…` item per area with anything ticked: `all` when every type in
  it is ticked, otherwise the ticked type names joined with `|`.
  **Validate before firing it:** if nothing is ticked, show "Choose at least one
  audit area or document type" next to the list, styled per "Widget limits" in
  `resolve-engagement.md`, and stop; do not call `sendPrompt`.

On re-entry, parse the areas and types from the prompt and continue at Step 4,
reusing Step 3's listing. Step 3 already listed every area, so don't list again. Now
write the document index parts, for exactly the rows Step 4 exports.

**Cap the picker at 60 document-type rows in total.** Seven area rows with their
badges run about 2.5KB, each type row about 170 bytes (60 rows is 10.2KB), and the
shortcuts, live count, validation and submit script about 3.5KB: about 16.2KB, under
the size ceiling in "Widget limits" in `resolve-engagement.md`. Past 60 type rows,
show the areas without their types, and say in one line under the list that the
caller can name document types in words ("only the bank statements"). Never drop
type rows silently.

**Asking the areas without the picker.** On a surface with no `show_widget`, ask the
areas in one `AskUserQuestion` call with two `multiSelect: true` questions, since one
question holds at most four options and there are seven areas: the first lists
General, Cash, Investments and Partners' Equity; the second lists Income & Expenses,
Financial Packages and Supplemental. Put each area's document count and new count in
its option description. Offer no "All" option here. The areas are every tick across
both questions, and all seven ticked means "all". If nothing is ticked, ask again.

**Document types named in words.** When the caller names document types ("just the
bank statements from Cash", "the K-1s and bank statements"), this runs after Step 3
lists the named areas, or all seven when none were named, whether or not the picker
is skipped. Match each name against the `document_type` values Step 3 listed, with the
clean-match rule in `resolve-engagement.md`. One clean match each → treat those types
as ticked in their areas, exactly as if submitted from the picker, and skip the
picker: Step 4 exports a partly-ticked area by `document_ids`. Zero or several → list
the areas Step 3 skipped (same rules, index still deferred), so the picker is built
from all seven areas, then show the picker with the matches pre-ticked rather than
guessing.

---

## Step 4 — Export the selected documents

```
mcp__<SERVER>__call_tool({
  "name": "fa__mutate__export-audit-documents",
  "arguments": {
    "fund_uuid": "<fund_uuid>",
    "audit_area": "<audit_area>",
    "audit_year": <audit_year>
  },
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-download"]}
})
```

`document_ids` and `audit_area` are mutually exclusive — provide exactly one. Prefer
`audit_area` whenever you know it (a named area, or one iteration of the "Download
all" loop): it exports every document in that area without re-transmitting ids, so it
scales to any document count. Fall back to an explicit `document_ids` array only for a
specific, caller-picked subset that doesn't correspond to a whole area. **Partners'
Equity always exports by `audit_area`, whatever subset was picked**: only that export
returns the `partners_equity_report_pk` below, so a `document_ids` export silently
drops the carta-web-delivered documents.

**Document types picked in Step 3b** (or named in words). An area with every type
ticked exports by `audit_area`. An area with only some types ticked exports by
`document_ids`: the `id` of every Step 3 row in that area whose `document_type` was
ticked — and, when "No document type" was ticked, every row whose `document_type` is
null or empty — one export per fund, year and area. Partners' Equity follows the
exception above. Step 5 names these zips and "Final summary" says how its table
states their scope.

Returns `{"id": "<task_id>", "name": null}` — a queued job, not a finished zip.
`audit_year` is required by the backend even though the documents already carry a
year.

**Send every export in one message.** The exports are independent jobs, so issue all of
them — every (fund, year, area) the run exports — as separate `call_tool` calls in ONE
message, before any poll. The wait that follows is then the slowest job's, not the sum
of them. A firm's exports need that firm's context, so with several firms send one
message per firm, switching context between them (the "Order of work" in `several-funds-or-years.md` (this skill's own `references/`, read in Step 2)).

**When `audit_area` is `partner-equity`** (a named Partners' Equity export, or that
one iteration of the "Download all" loop), the response also carries
`partners_equity_report_pk` — a **second, carta-web-side download id**. Carry it
forward into Step 5 alongside `task_id`. Fund-admin's own zip for this area only ever
contains its own documents; the carta-web-delivered ones (Capital Account Statements,
annual/quarterly reports, LP tax documents) are a completely separate download that
this second id resolves. Skipping it silently drops the majority of this area's
documents — the fund-admin zip alone is not the complete Partners' Equity export.
Every other `audit_area` value returns no such field; don't look for it there.

---

## Step 5 — Poll for completion

```
mcp__<SERVER>__read_tool({
  "name": "fa__get__audit-export-status",
  "arguments": {
    "task_id": "<task_id>",
    "partners_equity_report_pk": "<only if Step 4 returned one>"
  },
  "_instrumentation_v2": {"skills": ["carta-investors:carta-audit-download"]}
})
```

- **Not ready yet** raises an error (the job hasn't produced a result document).
  Actually wait between attempts — run `sleep 5` (a plain Bash call) before each poll,
  the first included: a job queued seconds ago is almost never ready, so polling at once
  only burns an attempt. Re-calling the tool immediately isn't a real wait and just burns
  the whole attempt budget in under a second on a job that genuinely takes tens of
  seconds. Cap at **6 poll rounds, a `sleep 5` before each**. Past the cap, stop polling,
  report each unfinished export as failed with the reason "still being prepared when I
  stopped waiting" (see "Final summary") and offer to check again later; do not loop
  indefinitely. With several exports, a round is one message holding one
  `fa__get__audit-export-status` call per still-pending task, never one task per turn.
  An error that says the job failed or access was denied, rather than not ready, ends
  that export: drop it from the pending set and report it as failed with that reason.
- **Ready** returns `{"id", "title", "url", "ext"}` — `url` is a presigned,
  time-limited S3 download link, fetchable directly with no Carta login. This feeds the
  final summary rather than being announced on its own.

**If `partners_equity_report_pk` was passed, also read the CW-side fields** on the
same response:
- `partners_equity_pending: true` — the carta-web job is still queued. Treat this the
  same as the fund-admin job not being ready yet: it counts against the same 6-attempt,
  `sleep 5` poll budget above, not a separate one — keep polling both together with one
  `fa__get__audit-export-status` call per attempt until both sides are resolved or the
  cap is hit.
- `partners_equity_error: true` — the second leg failed. Don't fail the whole step
  over it: deliver the first zip as usual and report the shortfall in Partners' Equity's
  row, as "Final summary" says. Never leave it out.
- `partners_equity_url` — the CW-side zip is ready. Fetch and deliver it **alongside**
  `url`, not instead of it — the two are disjoint document sets for this area, and the
  caller needs both to get the complete export.

**Deliver the zip inline, not just as a link:** whenever shell access is available,
fetch the zip yourself and hand it back as a file the caller can open directly from the
conversation, instead of leaving them to click a raw signed S3 URL or dig through a
Downloads folder. Fetch each zip as soon as its poll comes back ready, one fetch per
Bash call, never chained into one command. Send every ready zip's calls in one message,
together with the next round's `sleep 5` when anything is still pending, so downloading
overlaps the wait.

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/fetch_file.py "<url>" "/tmp/carta-audit-documents/<area label> - <audit_year> - <fund_name> - <firm_name>.zip"
```

The script makes the folder, follows only https links, and writes only inside it; if it
prints `error:`, treat that file as not delivered and say so on its card.

Name every zip `<area label> - <audit_year> - <fund_name> - <firm_name>.zip` (e.g.
`Partners' Equity - 2026 - Growth Fund II, LP - Acme Capital.zip`), so a folder of zips
from several funds and firms still says where each one came from. The area and year
lead because the chat's file card cuts a long name to one line: what differs between
a run's zips stays visible, and the cut falls on the fund and firm. When the fund name
already starts with the firm name, leave off ` - <firm_name>` (e.g.
`Cash - 2026 - Acme Capital Fund II, LP.zip`).

Keep each legal entity name exactly as Carta has it, commas, ampersands, apostrophes
and parentheses included. Firm and fund names come from Carta, not from the caller, and
this path goes into a shell command, so always write the whole path inside double
quotes as above, and replace only these with `-` before building it: `\ / : * ? " < > |`
(not allowed in a file name on Windows or macOS), `$` and the backtick (the shell
expands them even inside double quotes), control characters, and any dots or spaces at
the very end of the name before `.zip`. Keep the whole unzipped path short, since
Windows stops at 260 characters.

A partly-ticked area's zip (exported by `document_ids`, Step 4) adds ` - selected
types` after the area label, e.g.
`Cash - selected types - 2026 - Growth Fund II, LP - Acme Capital.zip`, so it never looks
like the whole area.

When `partners_equity_url` is also present, fetch it the same way into a second file —
suffix its filename ` - investor reports` so the two are distinguishable (e.g.
`Partners' Equity - 2026 - Growth Fund II, LP - Acme Capital - investor reports.zip`) —
and include both in the same `SendUserFile` call below.

Use the firm and fund names only if the engagement actually resolved them (the
picker path, or a `fa__list__auditable-funds` lookup from Step 2's fast path). A single
fund given by UUID or audit-portal URL is never looked up, so there's no name to
substitute: name its zip `<area label> - <audit_year>.zip` rather than guessing a name,
showing the `fund_uuid`, or blocking delivery on an extra lookup. Several funds given by
UUID or URL always get the lookup (Step 2), because two nameless zips would share one
path and the second would overwrite the first. If that lookup still can't name a fund,
say so and ask which fund it is rather than delivering two zips under one name.

**Contents page.** Once every zip this run produces is saved, build one page that
lists what is inside them: a flat, searchable table with one row per document (fund,
year, area, document type, name, date or period, status, the zip it is in and the
folder inside that zip, plus the reason when a document is not in a zip). The page
has no links; its first paragraph says how to find a file (open the zip named in "In
zip", then the folder). A script builds it from the zips themselves, so never write
the page or its rows by hand. `Write` this run's zips to
`/tmp/carta-audit-documents/contents-spec.json`, one entry per saved zip, the
investor reports Partners' Equity zip included:

```json
{"zips": [{"zip": "/tmp/carta-audit-documents/<zip filename>", "firm": "<firm_name>", "fund": "<fund_name>", "audit_year": <audit_year>, "area": "<area label>"}]}
```

Use the same firm and fund names as the zip's filename. Only a single fund given by
UUID or URL has no names: use `"firm": ""` and `"fund": "This fund"` for it. Then run:

```bash
uv run ${CLAUDE_PLUGIN_ROOT}/skills/carta-audit-download/scripts/build_contents_page.py /tmp/carta-audit-documents/contents-spec.json /tmp/carta-audit-documents/audit-documents-contents.html
```

Run it once. If it fails, skip the page and say in one line that it wasn't produced;
don't retry it or build the page another way. With no shell access there are no zips
on disk, so there is no page either.

Collect every zip this run produces (one per fund/year/area processed), plus the
contents page, plus the document index (read `${CLAUDE_PLUGIN_ROOT}/references/audit/document-index.md`, the
plugin's own `references/`, not this skill's, and follow it; do not search for the
file), and send them all in a single `SendUserFile` call at the end, alongside the final summary —
`status: "normal"`, `display: "attach"` (a zip isn't something to render inline).
Don't call `SendUserFile` once per zip; batch the whole run's files into the one call.

If shell access isn't available (e.g. a surface with no Bash tool), fall back to the
raw `url` beside each zip's filename in the final summary — don't block the summary on a delivery
mechanism that doesn't exist there.

---

## Final summary — one outcome table

Whenever Steps 4–5 actually run a real export — once for a single area/fund/year, or
repeated across "Download all" / multiple funds / multiple years — end with exactly
**one** markdown table of outcomes, not prose "one line per X" summaries and not a
`show_widget` card grid. The zips arrive as file cards right beside it, so the table
only has to say how each fund came out. A markdown table renders on every surface, Cowork included.

This doesn't apply when a download request stops at Step 3 with zero documents (single
area/fund/year, terminal per Step 3's own rule) — no export ever ran, so there's
nothing to put in a table. Report that outcome in prose instead.

**Every fund × area the caller chose ends in exactly one of three outcomes**, stated in
its fund's row, so a missing zip is never left unexplained. "Chosen" means named,
ticked, or every area for "all"; add each year when there are several. Count the
outcomes against that list before you write the table: a combination with no outcome
in any row is a gap.

- **Zip delivered** — the zip is among the files sent below (or its link, on a surface
  with no shell access).
- **No documents filed** — only when that area's own listing in this run came back with
  zero documents (Step 3). An area that was never listed — its listing failed, was
  denied, or never ran because the fund couldn't be opened — is never "no documents
  filed"; it is "export failed".
- **Export failed** — every other case where no zip came back: the export was refused,
  the job failed, the area couldn't be opened for lack of access, or the export was
  still being prepared when the wait ended. Give the reason in one plain sentence an
  auditor can act on — "You don't have access to this area — ask the fund's general
  partner or administrator", "Still being prepared when I stopped waiting — ask me to
  check again", "Carta couldn't produce this export" — never a raw error, a task id, a
  command name or an internal system name.

**The table.** One row per fund, and per year when there are several, ordered firm by
firm, then fund by fund:

| Fund | Delivered | Not delivered |
| --- | --- | --- |
| Growth Fund II, LP | 6 of 7 areas | Financial Packages: no documents filed |

- **Fund** — the fund's name, as **Firm — Fund** when more than one fund ran (same names
  and fallback as Step 5's filename); add the year when more than one was processed.
- **Delivered** — "N of M areas", where M is the number of areas chosen for that fund
  and N the ones whose zip was delivered. Add a scope note here when one applies (see
  below).
- **Not delivered** — each area that didn't deliver, as "<area label>: no documents
  filed" or "<area label>: failed. <reason>", plus "Partners' Equity: incomplete" when
  its second zip failed (see below), separated by "; ". "—" only when none of these
  apply.

A fund that Step 3 couldn't open at all gets one row with "Not delivered" giving the
reason ("Export failed" for the whole fund) and "Delivered" as "—", since no areas were
chosen for it.

**Every row states each export's scope**, in its Delivered cell:

- **An area exported by `document_ids`** (Step 4) is labelled `<area label> — selected
  types`, e.g. "3 of 3 areas (Cash — selected types)".
- **Partners' Equity after a partial pick** carries the note "Whole area delivered —
  Carta exports Partners' Equity whole".

**Partners' Equity's second zip.** When a `partners_equity_url` was also resolved, the
area counts as delivered and both zips are in the zip list below. If
`partners_equity_error` came back instead, the area still counts as delivered, but add
"Partners' Equity: incomplete" to that row's Not delivered cell, and under the table
name the fund, even when only one fund ran (or "this fund" for the one fund given by
UUID or URL that was never named), and say plainly that the zip delivered is not the
complete area, e.g. "Partners' Equity for <Firm — Fund> is incomplete: the investor
reports (capital account statements, annual and quarterly reports, LP tax documents)
could not be retrieved, so the zip below holds only the main documents."

A row per fund keeps the table readable at twenty funds, where a row per area would
not.

Send the `SendUserFile` call (batching every zip this run produced) right alongside the
table — the table is the record of what ran, the file delivery is how the caller
actually gets the documents. In the reply text just before the file cards, list
every delivered zip's full filename, one bullet each, so a name the card cuts off can
still be read in full. On a surface with no shell access, put each zip's `url` beside
its filename in that list. When the contents page was built, add one line: it is a
table of every document with its zip and folder, and a filter box to search it.

Close with one line saying the caller can ask "anything new?" on a later visit to see
what's been added since this pull. Then ask what's next per the "Next-step question"
section of `${CLAUDE_PLUGIN_ROOT}/references/audit/next-step.md` (the plugin's own
`references/`, not this skill's; do not search for it), with these choices:

- **Download other areas** — "Areas you didn't pick this time"
- **Check readiness** — "Which of this fund's documents aren't ready yet"
- **Open Audit Home** — "See every fund's areas and download from one page"
- **Done for now** — "Nothing else for this audit today"

Offer **Open Audit Home** only when this run had shell access — the same test that
picks the `url` fallback above. Audit Home can't be built on a surface without it, so
the choice would end in a refusal there.

When this run has listed every area and every area with documents was downloaded,
there are no other areas to offer: leave out **Download other areas**. With fewer than
two choices left, skip the question as the "Next-step question" section says and end
on the line above.

Route a "download other areas" answer to the Step 3b picker, and show it even though
areas were already chosen. First list any area Step 3 hasn't listed in this run (same
listing rules, index parts still deferred), and leave this run's downloaded areas out.
Run Step 3b's record read and save only if this run hasn't already. Route a "readiness"
answer to `carta-investors:carta-audit-readiness`, passing the funds and year through
so it doesn't re-ask. Route an "Open
Audit Home" answer to `carta-investors:carta-audit-home`, which opens the
caller's page or builds it. A later "anything new?" routes to
`carta-investors:carta-audit-whats-new`.

---

## Download all — export every area first, then poll them together

When the caller wants "All", don't run Steps 3–5 to completion one area at a time — a
full list→export→poll cycle per area, done serially for all 7 areas, makes the caller
wait for the *sum* of every area's turnaround instead of just the slowest one. One zip
per area (never one merged zip for the whole fund), but export and poll across areas
concurrently. When the caller picked several areas but not all, run this same loop
over just the picked areas.

1. **List every area first** (Step 3, once per `audit_area` — 7 calls, or one per
   picked area, all in one message) for each area's
   count, and to drop any area with zero documents — nothing to export there. When
   Step 3 already listed the areas for Step 3b, use those rows instead.
2. **Export every non-empty area next, all in one message, before checking on any of
   them** (Step 4, once per non-empty area) — collect each area's `task_id` as it comes
   back, and for the Partners' Equity area specifically, also collect its
   `partners_equity_report_pk` if returned. Fire every export before your first poll;
   do not poll area N before exporting area N+1.
3. **Poll every pending `task_id` in rounds, not one task per whole poll cycle.** Each
   round, check every still-pending `task_id` once, all in one message (Step 5) — passing
   `partners_equity_report_pk` alongside `task_id` for the Partners' Equity area — drop
   any that come back ready from the pending set (for Partners' Equity, that means both
   `url` and, if a `partners_equity_report_pk` was collected, its CW-side result too —
   see Step 5's handling of `partners_equity_pending`/`partners_equity_url`/
   `partners_equity_error`), fetch each zip that came ready in the same message as the
   next round's `sleep 5` (a plain Bash call — not optional, and run before the first
   round too, as Step 5 says), then start the next round with whatever remains. Cap at
   **6 rounds total** (not 6 per area) — past the cap, report which areas are still
   being prepared as export failed with that reason (see "Final summary") and offer to
   check again later.

This is what makes "download all" tractable for a fund with a large document count:
each area's export is scoped server-side, so nothing ever requires enumerating every
document id across the whole fund — and firing every export up front turns the
wall-clock cost from *the sum of every area's export+poll time* into roughly *the
slowest single area's*, the same way the investor-portal's own "Download All" button
fires every area's export concurrently.

**First, check whether the error is fund-level, not area-level.** The seven list calls
go out together, so read all the answers before acting. If every one fails because the
fund itself doesn't exist or you lack access to it at all ("No Fund matches the given
query", a 404, or a fund-wide permission denial), the failure is fund-level: send no
page-2 calls and no exports for that fund, and give it one "Export failed" row with
the reason.

Once any area has listed, the fund is reachable and each other area's error is
area-scoped: no access to that specific area while others succeeded is terminal **for
that area only** — it ends as "Export failed" with that reason; continue with the rest.
Zero documents in an area is "No documents filed" for that area only, never an error.
Every area's outcome goes in the final summary's table rather than a prose line.
