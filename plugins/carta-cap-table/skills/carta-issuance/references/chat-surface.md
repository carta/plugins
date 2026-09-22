# The chat surface

Selected by [SKILL.md § Pick the surface](../SKILL.md#pick-the-surface) when the host has
**no `Artifact`** tool. The only path that spends your own turns on data entry, and the only
one where you assemble the payload by hand.

**No HTML on this path — at all.** Not a widget, not an inline document, not a built file.
Chat *is* the surface: prose, `AskUserQuestion`, printed markdown. Being here is not a degraded
run and needs nothing this session lacks — never report it as unavailable, and never say it is
blocked on a tool, a CLI or a connection.

**Interactive-wait budget: 2.** One batched collect (§1), one confirm (§3); the review (§2) is
printed markdown and does not block. **A single-recipient issuance that spends more than two
blocking waits has a bug in it** — most often a question about a value that was computable
(§4), or one question per field where one batch would have done.

## The phase sequence

The phases are the engine's. [engine.md](engine.md) is where they live — read it, don't
reconstruct it from here.

| Phase | Reads |
|---|---|
| **0** Preflight — tools, environment, corporation, account-level hard stops | [engine.md § Phase 0](engine.md#phase-0--preflight) |
| **0.25** Import — only when the prompt points at a file | [issuance-import/SKILL.md](../issuance-import/SKILL.md) |
| **0.5** Reference data, gates, **collect** | [engine.md § Phase 0.5](engine.md#phase-05--configure-the-issuance) · §1 · the type's field file |
| **1** Resolve rows, reconcile classes and plans, map to payload keys | [engine.md § Phase 1](engine.md#phase-1--resolve-each-row--reconcile-share-classes) · [payload-reference.md](payload-reference.md) · [row-mapping.md](row-mapping.md) |
| **1.5** Save + validate, before the review, always | [save-validate-flow.md](save-validate-flow.md) |
| **2** Review → confirm, in that order | [chat-review.md](chat-review.md) · §2 · §3 |
| **3** Issue, then the closing | [SKILL.md § Issue](../SKILL.md#issue) · [issue-and-close.md](issue-and-close.md) |

A server rejection a re-call can't clear: [mutate-recovery.md](mutate-recovery.md). *"Resume
draft set 472"*: [resume-flow.md](resume-flow.md).

## 1. Collect — one batch, and only what is genuinely open

Ask **once**, for everything still unknown after §4's defaults are applied. Several questions
go in **one** `AskUserQuestion` call — one wait, not one per field. Before a field goes in the
batch, check it against §4; if it is there, it is already answered.

**Never ask who the recipients are.** A prompt that named nobody is one recipient whose name
you ask for *inside* the batch, not a gating question ahead of it, and never a reason to invent
a name or a quantity ([engine rule 5](engine.md#engine-hard-rules)).

**`AskUserQuestion` is an option-picker**, so it cannot carry a free-text quantity, price, date
or name — and inventing three plausible prices to make it fit is worse than not asking. Split
the batch by shape, in one turn: fixed option sets (option type, share or unit class, vesting
template, legend, document set, board-approval mode, Rule 144 basis — the issue date or a
different one, threshold value type, which of two live valuations to price from) each become one
question in the `AskUserQuestion` call; free-text values go in the same turn's prose for the
user to answer in one reply.

The pickers themselves — sources, default posture, what gets stamped — are
[engine.md § Shared resolution helpers](engine.md#shared-resolution-helpers). Here they are the
primary collection mechanism, not a fallback: nothing else has gathered legend, vesting,
acceleration or document set for you. Read the type's field file once `security_type` resolves
— exactly one of [option-grant-fields.md](option-grant-fields.md),
[certificate-fields.md](certificate-fields.md) or [piu-fields.md](piu-fields.md).

**An imported row overrides §4.** Where a row from [Phase
0.25](engine.md#phase-025--ingest-an-uploaded-file) carries `import_notes` (display-only,
**never** in a mutate payload), report what the file said and put that field in the batch
instead of taking its default — a default is right for a prompt that said nothing and wrong for
a file that said something specific. Full obligations:
[issuance-import/SKILL.md](../issuance-import/SKILL.md).

## 2. Review — printed markdown, non-blocking

Print the resolved, **already-saved-and-validated** rows as markdown. It is output, not a tool
call, and §3 follows in the same turn.

**The review is printed *before* the confirm tool call, always** — an explicit exception to any
host rule about prose between tool calls, because the review is not narration of the gate, it
**is** the gate. A confirm that reaches the user first means they approved an irreversible
issuance without seeing the terms, and printing the review afterwards cannot repair an answer
already given. If you are about to call `AskUserQuestion` and the review is not on screen,
print it first.

Columns, conditional and optional fields, the per-value default explanations, the `ZEPO` and
pending-board-approval renderings, and the compressed format for identical-term batches are in
[chat-review.md](chat-review.md). **Render every always-column with its `(default)` /
`(autofill — …)` / `(from existing record)` tag** — the review is the single override point for
everything the skill chose, so an undisplayed default is one the user never got to reject.

State the draft set the rows were saved into, then hand off to §3.

## 3. Confirm — exactly one `AskUserQuestion`

A single blocking choice over a fixed option set, with nothing free-text to collect.

| Option | Where it goes |
|---|---|
| `"Issue N <type> now"` | [SKILL.md § Issue](../SKILL.md#issue) |
| `"Save as draft"` | [engine.md § Save as draft](engine.md#save-as-draft-escape-hatch) |
| `"Edit a row"` | back to §1 for that row, then §1.5 and §2 again |
| `"Cancel"` | stop — the *Canceled* [closing](issue-and-close.md#closing) |

Free-text affirmatives — *"yes"*, *"go"*, *"issue it"* — map to **Issue now**.

The host's confirmation prompt on the mutate is a **separate**, final irreversibility gate: it
shows raw tool input rather than the reviewed rows, so it never substitutes for this confirm
([SKILL.md hard rule 2](../SKILL.md#hard-rules)).

**Recovery questions are unrestricted** — nothing here can be starved by an open question, so
after a server short-circuit ask as many follow-ups as the recovery needs. The 2-wait budget
covers the happy path, not error recovery.

## 4. Computable defaults — apply and show, never ask

Anything the skill can compute, it stamps, then shows in the §2 review tagged and overridable.

**A field the form presents as a choice is not on this table.** The other surfaces render a
pre-selected control the user can see and change before they ever submit; chat has no such
control, so the same value unasked is a value the user meets for the first time in the review.
Where a row below says *not a default*, that field was an explicit control on the form and
belongs in the §1 batch here.

| Value | Default | Tag |
|---|---|---|
| Issue date | today | `(default)` |
| Grant expiration | the plan's term from `issue_date` ([payload-reference.md](payload-reference.md#grant-expiration-follows-the-plan)) | `(default — plan term)` |
| Exercise price | the sole active valuation on the plan's common share class, whatever its source — 409A, EMI, CSOP or share price ([engine.md § FMV](engine.md#option-grant-resolve-the-fmv-and-the-jurisdiction)) | `(default — current <source>)` |
| Option plan | the only non-expired plan | `(default — only active plan)` |
| Document set | the only set — on a PIU with no sets there is nothing to ask | `(default — only template)` |
| Legend | the only legend, or the one flagged `default` | `(default)` |
| Vesting — certificate, PIU | **none** — opt-in; nothing infers a schedule from a template's name | — |
| Vesting — option grant | **not a default.** A grant's schedule is required server-side, so it goes in the §1 batch as a picker. "No vesting" is a real answer, and an atypical one — accept it and warn ([engine.md § Vesting resolution](engine.md#vesting-resolution)) | — |
| Board approval | today | `(default)` |
| Board approval (PIU) | today, and clearable — the field is optional | `(default — today)` |
| Share class / PIU unit class | the only class when there is one | `(default — only class)` |
| PIU equity plan | **none** — never the only plan | — |
| PIU threshold value / type | **never defaulted** — terms of the grant | — |
| Exemption / currency | the `so_type` autofill ([payload-reference.md](payload-reference.md#so_type-auto-fill-rules)) | `(autofill — <so_type> rule)` |
| Rule 144 date | **not a default.** The form asks it as a two-way choice — the issue date, or a different one — so in chat it goes in the §1 batch. Picking the issue date needs no difference reason; a different date makes `rule_144_difference_reason` required ([certificate-fields.md](certificate-fields.md#rule-144-difference-reason)) | — |

**Two or more classes are never ranked, and neither are two live valuations on one class.**
Which class a security sits in changes the holder's tax position, and an HMRC report's AMV and
UMV are both live with nothing saying which a grant prices from. Those are real forks — §1
batch, never this table.

Ask only when the value is genuinely **not** computable: several non-expired plans, an
ambiguous `security_type`, a duplicate-name collision, a jurisdiction the evidence doesn't
settle. *"The user might want something else"* is not a reason to ask — that is what §2 is for.
