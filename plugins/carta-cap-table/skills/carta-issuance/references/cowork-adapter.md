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
Keep `row_key` stable per block: [draft-state
bookkeeping](save-validate-flow.md#draft-state-bookkeeping) threads `draft_pk` by `row_key`,
not by array position, so a user adding or removing a block between retries doesn't corrupt
the mapping.

After rendering the form, say one line and **wait**. Do not stack an `AskUserQuestion` on top
of it — that spends the second interactive wait before the review even exists.

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
