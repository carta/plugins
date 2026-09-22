# Phase 1.5 — Save + validate before review (or save-only) detail

Full mechanics for [engine.md § Phase
1.5](engine.md#phase-15--save--validate-before-review-or-save-only). Read this file once
you've reached Phase 1.5 — i.e. immediately after Phase 1 resolves every row. Phase 1 runs
identically whichever of the two branches below fires.

`cap_table:mutate:validate_drafts` runs nearly the same field/integration-level checks
`issue_securities` does — option-pool headroom, share-class headroom, custom-label uniqueness,
vesting-template/share-class validity, issue-date/FMV checks, quantity precision, document-set
requirement — everything except the corp-level missing-signatory check that only
`issue_securities` itself can catch. It needs an existing `draft_set_id`, so validating early
means saving early too. The incident that put this before the review rather than after is in
[incidents.md § Silent data loss](incidents.md#silent-data-loss).

## The assertion is not advisory

[Engine rule 4](engine.md#engine-hard-rules)'s pre-save assertion runs before **both** branches below,
and it either passes or it stops the call. `save_drafts` persisting a row is not evidence the
row is complete — it accepts a missing `email` or `stakeholder_id` without complaint, and the
gap surfaces later as a validation failure or, worse, as a stakeholder record created with
nothing in it.

So when an `always` field is missing and recovery (a) → (b) → (c) hasn't filled it, **fix it,
don't route around it**: ask for the value with `AskUserQuestion` and send the row once it is
complete. **Never present the server's tolerance as a choice** — *"Carta will accept these rows
but they'll fail validation"* is not an option to offer; a real run said exactly that about
missing addresses and the user reasonably read it as permission to continue.

`email` bites most often, because a name given for a new stakeholder carries no address with
it — but the rule is the whole `always` set, not one field.

## Branch A — save without validating

The user asked to save and stop, rather than to review and issue.

1. Build the `drafts` array from the Phase-1-resolved rows ([Row
   templates](engine.md#row-templates) keys only — same construction as [Build the mutate
   payload](engine.md#build-the-mutate-payload-from-your-phase-1-resolved-rows), used again
   one phase later for the issue).
2. Thread `draft_set_id` + each row's `draft_pk` from your [draft
   state](#draft-state-bookkeeping) if present ([hard rule 3](../SKILL.md#hard-rules)).
3. Call `cap_table:mutate:save_drafts` (wire `cap_table__mutate__save_drafts`) exactly as in
   [Save as draft
   (escape hatch)](engine.md#save-as-draft-escape-hatch) — **no `validate_drafts`**, by design.
4. Record the returned `draft_set_id` + each row's `draft_pk` into your tracked state.
5. Report it. All rows saved → the *Saved as draft*
   [closing](issue-and-close.md#closing); any row errored →
   [Error recovery](mutate-recovery.md#error-recovery).

## Branch B — save + validate, before the review

1. Build the `drafts` array (same construction as above).
2. Thread `draft_set_id` + `draft_pk`s from your tracked state ([hard rule
   3](../SKILL.md#hard-rules)).
3. Call `save_drafts`, then, with the `draft_set_id` it returns (or already had):
   ```
   mcp__carta__call_tool({"name": "cap_table__mutate__validate_drafts", "arguments": {
     "corporation_id": <id>, "security_type": "<certificate|option_grant|piu>",
     "draft_set_id": <id>}})
   ```
4. Update your tracked state (same as Branch A's step 4).
5. **Clean or not:**
   - A `save_drafts` row whose `status` isn't a success value is a row-level error too —
     fold it into the same per-row bucket as `validate_drafts`'s errors (below).
   - **Clean is `validation.success === true`, never an empty `validation.errors`.** Three
     kinds of refusal never appear in that map: `banner_errors` (a refused or vanished
     draft set), `corporation_errors` (`{field: [msgs]}` — the missing-signatory refusal
     `issue_securities` raises and `validate_drafts` does not), and `issuance_errors`
     (flat strings). A failed workflow reports only a `success` that is not `true` and
     names nothing at all. Reading the map alone called every one of these clean.
   - `validate_drafts`'s `duplicates` is **intentionally not checked here** — duplicate
     resolution stays at `issue_securities` time (Phase 3), unchanged; folding a 3-way
     `AskUserQuestion` triage into this retry loop, on top of the error reporting below, is
     scope this phase doesn't need.
   - **Clean** → proceed to [Phase
     2](issue-and-close.md#phase-2--the-review-gate).
   - **Not clean** → [Re-ask with the server's errors](#re-ask-with-the-servers-errors).

## Translating server errors into something sayable

Use [engine.md § Voice & defaults](engine.md#voice--defaults)'s translation rule — never a
raw snake_case field name in customer-facing text:

- **Per-row errors** — for each numeric `draft_pk` key in `validation.errors` (or a
  failed `save_drafts` row), match it to the row currently holding that `draft_pk`, and say one
  `"<Translated field label>: <message, verbatim>"` line per `{field: [msgs]}` entry against
  that person. **Replace, never accumulate across retries** — a fixed error must actually
  disappear next time round.
- **Batch-level errors** — `validation.banner_errors`, `validation.corporation_errors`
  (`{field: [msgs]}`, same translate rule) and `validation.issuance_errors` (flat strings,
  verbatim). All three sit **beside** `validation.errors`, not inside it. They belong to
  the batch, not to a person: say them once, above the per-row lines. A caller that hands
  the strategy's own errors through unmerged nests them as `errors.corporation` /
  `errors.issuance` instead — read both places.
- **A `draft_pk` your tracked state doesn't recognize** — report it as a batch-level
  `"Unresolved row: <field>: <message>"` instead of silently dropping it.
- **`cleared_fields` on a `save_drafts` row** — the columns that save emptied, present only
  when it emptied something. `save_drafts` patches, so this should be absent; a populated list
  means the row lost data the payload did not mean to clear. Treat it as a batch-level error
  naming the fields, not a silent pass — `success: true` is reported either way, which is what
  made the original loss invisible.
- **A `save_drafts` failure with only a coarse error code, no message** — translate:

  | Code | Message |
  |---|---|
  | `ERROR_DRAFT_NOT_FOUND` | "This row no longer exists on the draft set — it may have been removed elsewhere. Re-save to create it fresh." |
  | `ERROR_DJANGO_INTEGRITY` | "A database conflict prevented saving this row — try again." |
  | any other / unrecognized code | "This row couldn't be saved — try again." |

  Never invent a more specific explanation than the code actually supports — if a future
  `save_drafts` response carries a code not in this table, use the generic fallback rather
  than guessing at its meaning.

## Re-ask with the server's errors

1. Print the translated errors: the batch-level ones once, then the per-row ones named against
   the person they belong to.
2. Ask for the corrected values in **one** `AskUserQuestion` — only the fields the server
   actually refused, never a re-run of the whole collect
   ([chat-surface.md § 1](chat-surface.md#1-collect--one-batch-and-only-what-is-genuinely-open)).
   A recovery question is not charged against the 2-wait budget.
3. Re-run Phase 1's mapping on the changed rows, then come back to Branch B with the same
   `draft_set_id` and each row's `draft_pk` attached.

## Draft-state bookkeeping

**Your context is the state.** There is no file: track `draft_set_id` and each row's
`draft_pk`, keyed by the row's own `row_key` — **not** array position — from the first mutate
response onward ([hard rule 3](../SKILL.md#hard-rules)):

| Track | From | Goes on |
|---|---|---|
| `draft_set_id` | the first mutate response | every subsequent `issue_securities`, `save_drafts`, `load_drafts`, `validate_drafts`, `resolve_duplicate_stakeholder` |
| each row's `draft_pk` | that row's first save | that row on every retry, alongside *every* required field |
| each row's `row_key` | the key you assigned the row when you collected it | the key you match `draft_pk` back by |

Both omissions fail silently — you get a success response either way.

- **Why not array position:** a user fixing a validation error can add or drop a recipient
  before re-submitting, which desyncs position-based matching and threads the wrong `draft_pk`
  onto the wrong person. `row_key` is tied to the row's identity, not its place in the array,
  so it survives adds and removes.
  - **A row the user dropped** — remove its `row_key` from your tracking. Do **not** shift the
    remaining `draft_pk`s up to fill the gap; that is precisely the corruption `row_key`
    matching prevents. It surfaces at Phase 3 via [Cleanup unexpected draft
    rows](issue-and-close.md#cleanup-unexpected-draft-rows), not a second competing cleanup
    path.
  - **A row the user added** — new `row_key`, **no** `draft_pk`. Send it without one; the
    server inserts it and returns its `draft_pk`. Never hand it a `draft_pk` borrowed from
    another row.
  - **Every surviving row** — keeps the `row_key` it had, and therefore the `draft_pk` already
    threaded to it, wherever it now sits.
- **Drop it on a genuinely new batch.** Within one conversation, if the user pivots to a
  different corporation, a different `security_type`, or plainly a new request rather than a
  retry of the one in flight, discard the tracked `draft_set_id` and every `draft_pk` and start
  clean. Carrying them forward re-saves the new batch into the old set, and for a first-ever
  grant save it also wrongly skips `equity_plan_id` because the run looks like a retry.
- `equity_plan_id` (option grant): include only on the true first save; omit on every retry
  (locked server-side after).
