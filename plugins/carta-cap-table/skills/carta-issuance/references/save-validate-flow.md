# Phase 1.5 — Save + validate before review (or save-only) detail

Full mechanics for [SKILL.md § Phase
1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only). Read this file once
you've reached Phase 1.5 — i.e. immediately after Phase 1 resolves every row, for **both**
config-panel footer buttons; Phase 1 itself runs identically regardless of which one fired.

This phase exists because of a real incident: a user set an absurd quantity, clicked Review,
reviewed an unvalidated summary, then only found out at the final **Confirm & Issue** that the
server rejected it ("Not enough shares in the option plan") — after a draft row had already
been silently created. `cap_table:mutate:validate_drafts` runs nearly the same
field/integration-level checks `issue_securities` does (option-pool headroom, share-class
headroom, custom-label uniqueness, vesting-template/share-class validity, issue-date/FMV
checks, quantity precision, document-set requirement) — everything except one corp-level
check (missing signatory) that only `issue_securities` itself can catch. It needs an
existing `draft_set_id`, so validating early means saving early too.

Branch on the action from Phase 0.5:

## `action: "save_only"` (the **Save** button)

1. Build the `drafts` array from the Phase-1-resolved rows ([Row
   templates](../SKILL.md#row-templates) keys only — same construction as [Build the mutate
   payload](../SKILL.md#build-the-mutate-payload-from-your-phase-1-resolved-rows), used again
   one phase later for Confirm & Issue).
2. Thread `draft_set_id` + each row's `draft_pk` from [`_draft_state.json`](#draft-state-bookkeeping)
   if present ([Hard rule 4](../SKILL.md#hard-rules)).
3. Call `cap_table:mutate:save_drafts` exactly as in [Save as draft
   (escape hatch)](../SKILL.md#save-as-draft-escape-hatch) — **no `validate_drafts`**, by design.
4. Update `_draft_state.json` with the returned `draft_set_id` + each row's `draft_pk`.
5. Report in **chat only** — no panel re-render. All rows saved → the existing success
   message; any row errored → [Error recovery](mutate-recovery.md#error-recovery)'s chat flow. The
   config panel stays open and untouched; the user can click **Save** or **Review** again at
   any time.

## `action: "config_submit"` (the **Review** button) — save + validate

1. Build the `drafts` array (same construction as above).
2. Thread `draft_set_id` + `draft_pk`s from `_draft_state.json` ([Hard rule
   4](../SKILL.md#hard-rules)).
3. Call `save_drafts`, then, with the `draft_set_id` it returns (or already had):
   ```
   mcp__carta__mutate({"command": "cap_table:mutate:validate_drafts", "params": {
     "corporation_id": <id>, "security_type": "<certificate|option_grant>",
     "draft_set_id": <id>}})
   ```
4. Update `_draft_state.json` (same as `save_only`'s step 4).
5. **Clean or not:**
   - A `save_drafts` row whose `status` isn't a success value is a row-level error too —
     fold it into the same per-row bucket as `validate_drafts`'s errors (below).
   - `validate_drafts`'s `validation.errors` — empty/absent → clean.
   - `validate_drafts`'s `duplicates` is **intentionally not checked here** — duplicate
     resolution stays at `issue_securities` time (Phase 3), unchanged; folding a 3-way
     `AskUserQuestion` triage into this retry loop, on top of the new error-banner
     mechanism, is scope this phase doesn't need.
   - **Clean** → proceed to [Phase
     2](../SKILL.md#phase-2--render-the-review-surface-mandatory-pre-save-gate).
     `DRAFT_SET_ID` is now always this real, just-returned id, never the literal `"new"`.
   - **Not clean** → [Re-render the config panel with server errors](#re-render-the-config-panel-with-server-errors).

## Translating server errors into `knowns`

Use [SKILL.md § Voice & defaults](../SKILL.md#voice--defaults)'s translation table — never a
raw snake_case field name in customer-facing text:

- **Per-row `server_errors`** — for each numeric `draft_pk` key in `validation.errors` (or a
  failed `save_drafts` row), match it to the row currently holding that `draft_pk` in
  `_draft_state.json`; append one `"<Translated field label>: <message, verbatim>"` string
  per `{field: [msgs]}` entry. Stamp onto `knowns.rows[i].server_errors` — **replace**, never
  accumulate across retries (a fixed error must actually disappear on the next render).
- **`knowns.batch_errors`** — `validation.errors.corporation` (`{field: [msgs]}`, same
  translate rule) and `validation.errors.issuance` (flat strings, verbatim) both land here.
- **A `draft_pk` your `_draft_state.json` doesn't recognize** — fold into `batch_errors` as
  `"Unresolved row: <field>: <message>"` instead of silently dropping it.
- **A `save_drafts` failure with only a coarse error code, no message** — translate:

  | Code | Message |
  |---|---|
  | `ERROR_DRAFT_NOT_FOUND` | "This row no longer exists on the draft set — it may have been removed elsewhere. Re-save to create it fresh." |
  | `ERROR_DJANGO_INTEGRITY` | "A database conflict prevented saving this row — try again." |
  | any other / unrecognized code | "This row couldn't be saved — try again." |

  Never invent a more specific explanation than the code actually supports — if a future
  `save_drafts` response carries a code not in this table, use the generic fallback rather
  than guessing at its meaning.

## Re-render the config panel with server errors

Unlike [Back to edit](code-adapter.md#back-to-edit) (which retargets a *different*, already-open
Review tab back to config), this retry never left the config tab — the click came from there.
This is a plain re-open of the **same** artifact, not a cross-tab navigation:

1. Reconstruct `knowns.rows` from this turn's own Phase-1-resolved rows using the same
   field-by-field mapping [back-to-edit.md](back-to-edit.md) documents — the
   transform is identical; only the source differs (this turn's freshly-resolved rows, not
   a persisted `_review_rows.json`, since Phase 2 was never reached).
2. Attach `server_errors` per row and `batch_errors` at the top level (above).
3. Re-run `build_config.py` against the same `$OUT_DIR/_data.json` — no new MCP fetches.
4. Re-invoke `artifact-manager:render-panel` with the **identical** `ARTIFACT_YAML`,
   `ARTIFACT_NAME`, `ARTIFACT_FILENAME`, `OUT_DIR` as the original Phase 0.5 open — this
   reuses the already-open tab/server in place (Step 4 navigates the same tab the user is
   already looking at); Step 5 restarts the submit-watcher (required — the previous one
   already fired, one-shot).
5. Tell the user one line and stop (no `AskUserQuestion` — the panel's open again):
   > *"A few things need fixing before this can be saved — see the highlighted
   > stakeholder(s) in the side panel. If the panel doesn't appear, open
   > http://localhost:\<port\>/\<file\>.html directly."*

## Draft-state bookkeeping

`$OUT_DIR/_draft_state.json` (new, alongside `_data.json`/`_knowns.json`) persists
`draft_set_id` + each row's `draft_pk`, keyed by `row_key` (stamped by `build_config.py`
into `data-row-key`, carried through `config_submit`/`save_only`'s `rows[].row_key`) —
**not** array position:

```json
{"draft_set_id": "8842", "security_type": "option_grant",
 "rows": [{"row_key": "r0", "draft_pk": 3928}, {"row_key": "r1", "draft_pk": 3929}]}
```

- **Why not array position:** a user fixing a validation error can add or remove a
  stakeholder block before re-clicking Review/Save — an ordinary use of an editable panel —
  which desyncs position-based matching and threads the wrong `draft_pk` onto the wrong
  person. `row_key` is tied to the block's identity, not its position, so it survives
  adds/removes.
- **Discard on a genuinely fresh batch.** `OUT_DIR` is keyed only by `corporation_id` and
  persists indefinitely — a `_draft_state.json` already sitting there when Phase 0.5 renders
  the config panel for a **new** user request (not a Phase 1.5 error-retry re-render, which
  reuses the same in-progress batch) is a leftover from an unrelated earlier session on this
  same corp, not this batch's own state. Delete it (or simply never read it) the moment Phase
  0.5 opens a fresh config panel; only start trusting it once THIS batch's own Phase 1.5 has
  written it at least once. Reading a stale file here would thread a stranger's already-saved
  `draft_pk` onto this batch's rows (the positional `row_key`s `build_config.py` assigns —
  `r0`, `r1`, … — repeat identically across unrelated batches) and, for a first-ever grant
  save, wrongly skip sending `equity_plan_id` because the stale file's mere existence looks
  like a retry.
- Check `security_type` in the file against the current run's before trusting it — a
  mismatch means start fresh, same discipline as the point above, for the narrower case where
  the file exists but is for the other security type.
- A `row_key` present in the file but absent from this submission (the user removed that
  block) — leave its `draft_pk` alone here; it surfaces at Phase 3 via [Cleanup unexpected
  draft rows](../SKILL.md#cleanup-unexpected-draft-rows), not a second competing cleanup path.
- `equity_plan_id` (option grant): include only when `_draft_state.json` doesn't exist yet
  (the true first save); omit on every retry (locked server-side after).
