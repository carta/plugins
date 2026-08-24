# Cowork adapter — the primary surface

How `carta-issuance` implements its three adapter capabilities (`collectConfig`,
`showReview`, `confirm`) in Cowork, where there is no side panel. Selected by
[Phase 0 Step 1](../SKILL.md#step-1--detect-the-environment-from-the-tool-surface) when
`preview_start` is **absent** from the tool surface. This is ~95% of real usage.

The Code adapter's equivalent lives in [artifact-flow.md](artifact-flow.md) — you only need
one of the two. Everything outside these three capabilities (row resolution, save, validate,
issue, recovery) is the shared engine and is identical on both paths.

**Interactive-wait budget: 2.** One wait on the form (§1), one on the confirm (§3). The
review (§2) is printed markdown and does not block. A single-grant issuance that spends more
than two waits has a bug in it — most often an `AskUserQuestion` asking for something the
form already collects, or a pre-ask for a value that is computable (§4).

---

## 1. `collectConfig` — the `show_widget` form

One form. Every field, per stakeholder, every computable default pre-filled. The user edits
what they want and submits once.

**Before you build it, two prerequisites — in this order:**

1. **Call `read_me` once, with `modules: ["interactive"]`.** `show_widget` refuses to render
   until `read_me` has run, and this form is an interactive one — that module is the one that
   carries the form and input guidance. Ask for it by name in a single call: `read_me` re-emits
   the shared core design system on *every* call, so probing module-by-module to find the right
   one costs ~6k tokens per probe and returns mostly what you already have.
2. **Read [payload-reference.md](payload-reference.md).** It is the authoritative field contract
   ([Hard rule 1](../SKILL.md#hard-rules)) and it governs the fields you are about to build —
   most sharply the per-field date formats, where `grant_expiration_date`, `vesting_start_date`
   and `rule_144_date` take `MM/DD/YYYY` while every other date goes out ISO. SKILL.md names it
   as required-reading-up-front, but on this path SKILL.md's preamble is behind you by the time
   you reach the form, so read it **here** — before constructing the first row, not after the
   server rejects one with `Date is invalid`.

**Use `show_widget`, not `AskUserQuestion`.** `AskUserQuestion` renders option cards — it
cannot take a free-text quantity, price, date, or name. Expressing this form as
`AskUserQuestion`s costs one interactive wait *per field*, which is the serial interrogation
this adapter exists to remove. Same rule the KYC intake skills follow.

### Fields

**This is the authoritative field enumeration for both adapters** — the Code config panel
collects the identical set, so the two stay interchangeable. Structure it as a repeater of
**one full key-value block per stakeholder**: every field lives inside that person's own
block, never in a page-wide shared section, so a single batch can issue genuinely different
terms to different people. (A bulk run is not "N people, one set of terms" — it is N
independently-configured rows. The one exception is [batch mode](#batch-mode--identical-term-bulk-grants)
below, a rendering optimization for the case where the terms really are identical.)

**Every block, both types** — name (select an existing stakeholder or type a new one; picking
an existing match auto-populates email, stakeholder type, and relationship, and locks
relationship, since the cap-table record wins regardless per
[Phase 1](../SKILL.md#phase-1--resolve-each-row--reconcile-share-classes)) · email ·
stakeholder type (Individual / Non-individual) · relationship (the full
`issue_date_relationship` picklist — [payload-reference.md](payload-reference.md#picklists) —
**always required**; collecting it here is what removes a Phase 1 follow-up prompt) ·
quantity · notes (optional).

**Option grant, per block** — option type (gated to the corp's own resolved jurisdiction's 3
`so_type`s — never all 9 across US/UK/AU at once) · exercise price (default = the company's
sole active valuation, whatever its source — 409A, EMI, CSOP or share price; left empty when
two are active, e.g. an HMRC report's AMV and UMV, so the admin picks; ZEPO forces `0`) ·
issue date · board approval (today / other / pending) · vesting
schedule + start date (default 4yr/1yr cliff) · documents · HMRC notified (checkbox + date,
shown only for EMI) · ATO notified (checkbox, shown only for the 3 AU types) · a collapsed
**More fields** accordion, in order: custom label, grant reason (`<select>`, carta-web's own
picklist — [carta-modify-issuables/references/field-contract.md](../../carta-modify-issuables/references/field-contract.md)),
acceleration (optional, shown once vesting is set), early exercise, auto-exercise at vest,
flexible issue date, notes.

**Certificate, per block** — share class · price per share (`0` only for LLC corps) · issue
date · board approval (today / other — **no pending**; certs need a date) · build legend (full
body shown, to attest) · Rule 144 (use issue date / use a different date) · vesting schedule +
start date (opt-in — defaults to **No vesting**, the opposite default from grants) · a
collapsed **More fields** accordion, in order: acceleration (optional, shown once vesting is
set), certificate number, cash paid, debt canceled, returned invested capital (LLC-gated —
omitted entirely for a corp confirmed non-LLC, not merely hidden), notes.

Not on the surface at all — dropped on design feedback, do not add them back: `state_exemption`,
`state_of_residency`, `employee_id`, `cost_center`, `job_title`, `salary`, `convertible_note`.

**Pre-fill and copy-forward.** Pre-fill every block from `knowns`, including the
[computable defaults](#4-trust-computable-defaults--never-pre-ask) below — the Code adapter
does this via `build_config.py`. Blocks are pre-filled one per person named in the prompt. An
"+ Add stakeholder" control appends a block, copying the most-recently-added block's
**non-personal, batch-level** terms forward (option type / price / vesting / acceleration /
dates / documents / HMRC-ATO-notified / early-exercise-style checkboxes, or share class /
price / vesting / acceleration / legend / Rule 144). Name, email, stakeholder type,
relationship, quantity, and every identity/amount field in the **More fields** accordion
(custom label, notes, prefix number, cash paid, debt canceled, returned invested capital)
start blank on a new block.

**This is where the stakeholder and quantity are collected.** A prompt that omits them shows
an empty field here, never a chat question — regardless of which shape the prompt takes. Never
invent a name or quantity, and never ask who the grantees are before rendering the form
([Hard rule 10](../SKILL.md#hard-rules)).

**Row-count rule is the engine's, not the adapter's** — a bare "N \<securities\>" is a
quantity for **one** recipient, not a headcount; only people-language ("100 employees") makes
N a row count. See [Hard rule 10](../SKILL.md#hard-rules).

### Import markers (uploaded-file rows)

Only when [Phase 0.25](../SKILL.md#phase-025--ingest-an-uploaded-file) built the rows from a
spreadsheet or document. Each row may carry `import_notes` —
`[{field, raw_value, reason, confidence?}]`, display-only, and **never** part of any mutate
payload.

Two obligations, and the second is the one that actually protects the cap table:

1. **Render every note next to the field it names**, as a short marker under that input:
   *"Your file said "1/48 monthly 1yr cliff" — no vesting schedule on this company matches it,
   pick one."* A note whose field has no input in this form (`state_of_residency`, say) goes in
   a **From your file** block at the top of that person's block — dropping it is the silent loss
   the import contract forbids. Humanize the field name; never show the raw key
   ([labels.md](labels.md)).
2. **Render a noted field with nothing pre-selected, and refuse to submit until it's set.** A
   marker alone is ignorable. This matters most for the fields with an appealing-looking
   default: vesting schedule (don't fall back to 4yr/1yr cliff), share class (don't fall back to
   the most recent), option type (don't fall back to the jurisdiction's primary — the tax
   treatment differs), stakeholder type (don't default an entity to Individual), document set
   (don't auto-pick the only one). Each of those defaults is right for a prompt that said
   nothing and wrong for a file that said something we couldn't match, because the file's intent
   was specific and we failed to honour it.

`confidence: "low"` means the value was read out of a document's prose rather than a cell. Say
so — *"read from the document, confirm it"* — and treat it as needs-confirmation the same way.

The Code adapter gets both behaviours from `build_config.py` automatically; on this path they
are yours to render.

### Batch mode — identical-term bulk grants

The per-stakeholder repeater above renders one full block per person — for a genuinely mixed
batch (different option types, prices, vesting per person) that's the only layout that works.
But an HR-driven batch ("30 new hires, all ISOs at $1.45, same vesting") has **one set of
terms and N names** — rendering 30 identical blocks is ~30x the form HTML and the submit
payload for zero extra information. Batch mode collapses that case to shared terms once +
a compact per-person table.

**When to use it.** Auto-activate batch mode when **both** hold:
- More than 10 rows (`knowns.rows.length > 10`, or an equivalent headcount signal per [Hard
  rule 11](../SKILL.md#hard-rules)).
- Every row's non-personal terms are identical or unset — i.e. the prompt/`knowns` gave one
  shared set of batch-level terms (option type, exercise price, vesting, document set, etc. for
  grants; share class, price, legend, etc. for certs) and no individual row overrides any of
  them.

If either condition fails — 10 or fewer rows, **or** any row carries its own distinct term —
render the per-row repeater instead (existing behavior, unchanged). Batch mode is an
optimization for the common case, not a replacement for the general one.

**Layout.** Two sections instead of N blocks:
1. **Shared terms, once** — the exact same fields as a per-row block's non-personal terms
   (option type/exercise price/vesting/documents/etc., or share class/price/vesting/legend/etc.
   for certs), rendered a single time at the top. Every computable default still applies here
   ([§4](#4-trust-computable-defaults--never-pre-ask)) — these are the batch-level fallback
   every row inherits.
2. **Per-grantee table, below** — one row per person, **three columns only**: name · email ·
   quantity. No per-row expansion of the shared terms; if a specific person genuinely needs
   different terms, that's a mixed-term batch and belongs in the per-row layout instead (tell
   the user to say so, or detect it from the prompt before choosing batch mode).

**Submit contract — must produce the same `rows` shape as the per-row layout.** Batch mode is
a *rendering* optimization only; the engine never sees the difference. When the form submits,
expand the shared terms across every table row so the JSON payload is indistinguishable from
what the per-row form would have sent — same [Submit contract](#submit-contract) shape, one
entry per person, each carrying the full field set (shared terms copied onto every row,
name/email/quantity from that row's own table cells). `row_key` is still assigned per person
(`r0`, `r1`, …) so [draft-state bookkeeping](save-validate-flow.md#draft-state-bookkeeping)
works identically to the per-row path.

**Escape hatch.** If the user adds a person with different terms mid-batch, or says a specific
row needs to differ, don't try to shoehorn that into the compact table — switch that batch to
the per-row repeater (pre-filled from the batch-mode rows collected so far) so the exception
gets its own full block.

### Submit contract

The form's submit button calls `sendPrompt()` with a JSON payload. It must carry the same
shape the panel's action-request file does, so the engine's "On submit" step is shared:

```json
{"action": "config_submit",
 "security_type": "option_grant",
 "corp_id": 40,
 "rows": [{"row_key": "r0", "name": "…", "email": "…", "stakeholder_kind": "INDIVIDUAL",
           "relationship": "…", "quantity": "1000", "option_type": "NSO",
           "exercise_price": "1.45", "issue_date": "2026-07-27", "…": "…"}]}
```

`action` is `config_submit` (save + validate, then review) or `save_only` (save, no
validation, no review) — same two actions, same meanings, as the panel's two footer buttons.
Keep `row_key` stable per block — see [Draft state on this path](#draft-state-on-this-path)
below for what threads through it and why position won't do.

After rendering the form, say one line and **wait**. Do not stack an `AskUserQuestion` on top
of it — that spends the second interactive wait before the review even exists.

### Draft state on this path

**Cowork has no persistence layer. Your context is the state.**
[save-validate-flow.md § Draft-state bookkeeping](save-validate-flow.md#draft-state-bookkeeping)
describes this in Code-adapter terms — `$OUT_DIR/_draft_state.json`, written alongside
`_data.json`/`_knowns.json`, with `row_key`s stamped by `build_config.py`. **None of that
exists here.** Read that section for the *reasoning*; the mechanism below is what you actually
run.

[Hard rule 4](../SKILL.md#hard-rules) still binds in full, so track the same three things in
context, from the first mutate response onward:

| Track | From | Goes on |
|---|---|---|
| `draft_set_id` | the first mutate response | every subsequent `issue_securities`, `save_drafts`, `load_drafts`, `validate_drafts`, `resolve_duplicate_stakeholder` |
| each row's `draft_pk` | that row's first save | that row on every retry, alongside *every* required field |
| each row's `row_key` | the `row_key` you assigned in the form | the key you match `draft_pk` back by — **never** array position |

Omitting `draft_set_id` makes the server auto-create a *second* draft set holding the same
incomplete rows. Omitting a row's `draft_pk` inserts a new row instead of updating the
existing one. Both fail silently — you get a success response either way.

**The error-retry is where position-matching breaks.** Re-rendering the form after a
validation error is an ordinary editable-form action, and the user may add or remove a
stakeholder block before re-submitting. When they do:

- **A block the user removed** — drop its `row_key` from your tracking. Do not shift the
  remaining `draft_pk`s up to fill the gap; that is precisely the corruption `row_key`
  matching prevents.
- **A block the user added** — it has a new `row_key` and **no** `draft_pk`. Send it without
  one; the server inserts it and returns its `draft_pk` in the response. Never hand it a
  `draft_pk` borrowed from another row.
- **Every surviving block** — keeps the `row_key` it already had, and therefore the
  `draft_pk` already threaded to it, regardless of where it now sits in the array.

**The stale-state rule has no teeth here, and that is the one way Cowork is simpler.** The
Code path must actively discard a leftover `_draft_state.json`, because `OUT_DIR` is keyed
only by `corporation_id` and persists across unrelated sessions — so a stranger's `draft_pk`
can be sitting there under an identical `r0`/`r1` key. On this path a fresh request starts
with empty context and there is nothing on disk to inherit, so a genuinely fresh batch is
fresh by construction. What still applies: **within** one conversation, if the user pivots to
a genuinely new batch (a different corporation, a different `security_type`, or plainly a new
request rather than a retry of the one in flight), drop the tracked `draft_set_id` and every
`draft_pk` and start clean. Carrying them forward re-saves the new batch into the old set, and
for a first-ever grant save it also wrongly skips `equity_plan_id` because the run looks like
a retry.

---

## 2. `showReview` — chat markdown

Print the resolved, already-saved-and-validated rows as markdown. **This does not block** —
it is output, immediately followed by the §3 confirm in the same turn.

Column spec, conditional/optional columns, per-value default explanations, and the
`ZEPO` / pending-board-approval renderings are all in
[chat-review.md](chat-review.md) — that file is this capability's content
spec, unchanged. Render every always-column with its `(default)` / `(autofill — …)` /
`(from existing record)` tag: **the review is the single override point** for everything the
skill chose on the user's behalf (§4), so a default that isn't displayed is a default the
user never got to reject.

State the draft set the rows were saved into, then hand off to the confirm.

**Optional — an artifact tracker.** For a large batch you may additionally render the review
as an artifact so the user can scroll it independently of the chat. This is a convenience,
never a replacement: the markdown review must still be printed, and the artifact must not
introduce a third interactive wait.

---

## 3. `confirm` — one `AskUserQuestion`

The one place in this adapter where `AskUserQuestion` is correct: a single blocking choice
over a fixed option set, with no free text to collect.

| Option | Engine path |
|---|---|
| `"Issue N <type> now"` | [Run the issue securities mutate](../SKILL.md#run-the-issue-securities-mutate) |
| `"Save as draft"` | [Save as draft](../SKILL.md#save-as-draft-escape-hatch) |
| `"Edit a row"` | re-render the §1 form pre-filled with the resolved rows |
| `"Cancel"` | stop — *Canceled* closing |

Free-text affirmatives (*"yes"*, *"go"*, *"issue it"*) map to **Issue now**.

The SDK's HITL prompt on the `issue_securities` mutate is a **separate**, final
irreversibility gate — it shows raw tool input, not the reviewed rows, so it is never the
review gate and never substitutes for this confirm.

**Recovery `AskUserQuestion`s are unrestricted.** The one-confirmation rule that governs the
Code adapter exists because an open `AskUserQuestion` suspends the panel's submit-watcher.
There is no watcher here, so nothing can be starved: after a server short-circuit (validation
errors, duplicates, warnings) ask as many follow-ups as the recovery genuinely needs. The
2-wait budget covers the **happy path**, not error recovery.

---

## 4. Trust computable defaults — never pre-ask

Anything the skill can compute, it stamps — then shows it in the §2 review tagged and
overridable. Asking for these before the form is what turned a 2-wait flow into a 3+-wait one
in the incident run.

| Value | Default | Tag |
|---|---|---|
| Issue date | today | `(default)` |
| Grant expiration | `issue_date` + 10 years | `(default)` |
| Exercise price | the sole active valuation (409A / EMI / CSOP / share price) | `(default — current <source>)` |
| Option plan | the only non-expired plan | `(default — only active plan)` |
| Document set | the only set | `(default — only template)` |
| Legend | the only legend, or the one flagged `default` | `(default)` |
| Vesting (grant) | the corp's 4yr / 1yr-cliff schedule | `(default)` |
| Vesting (cert) | none — opt-in | — |
| Board approval | today | `(default)` |
| Exemption / currency | the `so_type` autofill | `(autofill — <so_type> rule)` |
| Rule 144 date | `issue_date` | `(default)` |

Ask only when the value is genuinely **not** computable — several non-expired plans, an
ambiguous `security_type`, a duplicate-name collision. "The user might want something else"
is not a reason to ask: that is precisely what the review is for.
