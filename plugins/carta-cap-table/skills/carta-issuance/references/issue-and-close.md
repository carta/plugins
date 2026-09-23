# Phase 2 to Closing — review, issue, close

The tail of the engine: the review gate, the confirmation branch, the `issue_securities` call,
and every terminal message. Referenced from [engine.md](engine.md#phase-2--closing).

**Read this when you reach Phase 2** — after [Phase
1.5](engine.md#phase-15--save--validate-before-review-or-save-only) returns clean, or
straight away on a [resume](resume-flow.md#resume-an-existing-draft-set). It is deliberately
not part of the up-front read: by then the collect is done, so nobody is waiting on it.

`mcp__carta__` below is the same placeholder it is everywhere else — substitute the session's
real Carta prefix ([engine.md Step
2](engine.md#step-2--command-names-and-base_url)).

---

## Phase 2 — the review gate

Phase 1.5 has already saved and validated these rows, so this is a **read-only** confirmation
before the irreversible `issue_securities` call, not another save.

Print the review as markdown, then confirm with one `AskUserQuestion` —
[chat-surface.md §2–3](chat-surface.md#2-review--printed-markdown-non-blocking). **That order
is mandatory and overrides any host rule about prose between tool calls**; the review is the
gate, not narration of one. The full always/conditional/optional column spec, the
default-explanation text, the confirm prompt, and the compressed format for identical-term
batches are in [references/chat-review.md](chat-review.md).

> **Tool pre-load:** `call_tool` must already be loaded (Phase 0 batched it) before you print
> the review. Do not `ToolSearch` here — it adds serial latency after the user has confirmed. If
> for any reason it isn't loaded, load it now, *before* rendering the review.

### Say what confirming actually does — it differs by type

A grant or a unit goes out for signature; a certificate lands on the cap table. Whoever is
confirming is entitled to know which, so carry the matching sentence into the confirm:

| Type | Sentence |
|---|---|
| Option grant | *"Confirming will send these grants to the signatory for signature."* |
| Certificate | *"Confirming will issue these certificates to the cap table."* |
| PIU | *"Confirming will send these profits interest units to the signatory for signature."* |

The artifact carries this in its own Confirm step; on the chat surface it is yours to say, in
the same turn as the review.


---

## Phase 3 — On confirmation, run the mutate

You reach Phase 3 when the confirm comes back. **The confirmation already happened — do not
re-ask.** Branch directly on the answer:

| Answer | Do |
|---|---|
| `"Issue … now"` / any free-text affirmative | [Run the issue securities mutate](#run-the-issue-securities-mutate) |
| `"Save as draft"` | [Save as draft](engine.md#save-as-draft-escape-hatch) |
| `"Edit a row"` | re-ask for that row's changed fields, then Phase 1.5 and Phase 2 again |
| `"Cancel"` | stop — *Canceled* closing |

### First: do you need a payload at all?

**Usually not.** [Phase 1.5](engine.md#phase-15--save--validate-before-review-or-save-only) already saved
and validated these rows, and the review is read-only with nothing to merge back — so the server
is already holding exactly what the user just approved. Issue *those* rows:

```
mcp__carta__call_tool({"name": "cap_table__mutate__issue_securities", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "draft_set_id": <draft_set_id>}})     # no `drafts` key at all
```

`drafts` is optional. Given `draft_set_id` and no rows, the server skips the save entirely and
validates and issues what is already persisted on that set. Everything else is unchanged — the
same blocking validation, the same duplicate detection, the same corporation-signatory check, the
same atomic issue, the same response shape.

This is the **correctness** path, not just the cheap one ([hard rule 6](../SKILL.md#hard-rules)):
re-serializing rows between validation and issue means the payload that commits is not
provably the one that was validated and shown to the user, and nothing downstream catches the
divergence. Sending no rows makes it impossible.

**Build a `drafts` payload only when the rows aren't already on the server:**

- **Rows changed after Phase 1.5 saved them** — an error-retry that edited a value, or an
  *Edit a row* round trip. Send the changed rows **with their `draft_pk`s** so they update
  rather than insert (SKILL.md hard rule 3), then the set is current again.
- **No `draft_set_id`** — nothing was ever saved, so there is no set to issue from. Rare on this
  path: Phase 1.5 runs before the review by design, so reaching Phase 3 without one means an
  earlier step was skipped.

If either applies, build the payload per the rules below. Otherwise skip to
[Run the issue securities mutate](#run-the-issue-securities-mutate).

---

## Run the issue securities mutate

One mutate runs save → validate → check duplicates → issue, atomically. The save step is skipped
when you send no rows.

```
# The normal case, every security type — the set already holds the reviewed rows
mcp__carta__call_tool({"name": "cap_table__mutate__issue_securities", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "draft_set_id": <draft_set_id>}})
```

Only when the rows must change, or no set exists yet ([above](#first-do-you-need-a-payload-at-all)):

```
mcp__carta__call_tool({"name": "cap_table__mutate__issue_securities", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<certificate|option_grant|piu>",
  "drafts": [ ...rows of that type, each with its draft_pk when the set exists... ],
  "draft_set_id": <draft_set_id when one exists>,
  "draft_set_name": <optional label, ≤30 chars>,
  "equity_plan_id": <equity_plan_id>}})  # option_grant ONLY, and only on the FIRST save
                                         # of a new set. NEVER on a PIU — a PIU's plan is
                                         # the per-row `option_plan` field.
```

An unknown `draft_set_id` sent with no `drafts` returns a descriptive error rather than quietly
creating a new set — so a stale id fails loudly instead of issuing into the wrong place.

**Response:** `{draft_set_id, drafts:[{temp_id, draft_pk, status}], validation:{status, success,
errors, warnings}, duplicates:{has_duplicates, count, results}, issued:[{id}]|null}`. **Always
capture `draft_set_id` and each `draft_pk`**, even on success — a follow-up may retry this
conversation. On the no-rows path `drafts` comes back `[]` (nothing was saved); the `draft_pk`s
you already hold from Phase 1.5 stay valid.

| Response state | Action |
|---|---|
| `issued` non-empty | Committed — render the table per [On success](#on-success) |
| `validation.errors` | [mutate-recovery.md § Error recovery](mutate-recovery.md#error-recovery) |
| `duplicates.has_duplicates` | [mutate-recovery.md § Duplicate resolution](mutate-recovery.md#duplicate-resolution) |
| Only `validation.warnings` (`issued: null`) | Surface verbatim; `AskUserQuestion`: `"Acknowledge and issue"` / `"Edit a row"`; re-call on acknowledge |
| Issue failed / 403 | [mutate-recovery.md § Atomic issue failure](mutate-recovery.md#atomic-issue-failure) |

Every re-call carries `draft_set_id` + each `draft_pk` (SKILL.md hard rule 3).

### On success

Lead with what happens next, in the Carta app's words: **Signatories were notified to sign
options** (certificates, PIUs), then *"Once signatories sign, securities will be sent to
stakeholders."* When the response carries `board_approval`, the rows in
`pending_board_approval` are drafts awaiting a board consent, not issued: say so and link
`board_approval.url` — `create_consent` is where the user creates it, `ask_board_admin` means a
board admin has to, `view_consent` means it was sent. Prefer `issued_ledger_url` over the
ledger link built below.

Render a short table using `MM/DD/YYYY`. Add a `Label` or `Grant number` column only when
`issued[]` actually carried one for every row — the list is documented as security pks, and
some builds return a `label` (`ES-28`) alongside. Never synthesise the value or guess the next
number in a sequence: a wrong grant number is worse than an absent column.

**Don't read the securities back to confirm the issue.** A non-empty `issued` *is* the
confirmation, and there is no read that would add to it. A server that names what it wrote
puts `label`, `quantity` and `stakeholder_name` on each entry already; one that does not
leaves ids, and a read cannot close that gap either —
the only per-security lookups are `cap_table__get__piu`, `cap_table__get__certificate` and
`cap_table__get__option_grant`, each of which needs a label or id you don't have. They are
**single-security** lookups: `corporation_id` **plus exactly one** of `label` or
`security_id`, and neither (or both) is rejected with *"Provide exactly one of security_id or
label"*. None of them is a lister, and there is no PIU lister at all — the only listers are
`cap_table__list__certificates` and `cap_table__list__grants`, both `search=<holder name>`.
So a read-back for a PIU has nowhere to go; report the mutate's own result instead. And never
lift a command name out of a log or a tool-name dump: the name resolves, the arguments don't,
and the failed call is the only thing the user sees for it.

- **Certificate:** Stakeholder · Share class · Quantity · Issue date.
- **Option grant:** Stakeholder · Plan · Option type · Quantity · Exercise price · Issue date.
- **PIU:** Holder · Unit class · Quantity · Threshold value · Issue date.

Link to the ledger at `<BASE_URL>/<VIEW_URL_PATH>`, where `BASE_URL` is the host recorded in
[Step 2a](engine.md#step-2--command-names-and-base_url) and `VIEW_URL_PATH` is
`options/list/<CORP_ID>/` (option grant), `certificates/list/<CORP_ID>/` (certificate), or
`options/piu/list/<CORP_ID>/` (PIU).
**Never invent a different path** — `corporations/<corporation_id>/equity/options/` looks
plausible and is not a real route. **Never hardcode a host either:** a demo or test issuance
linked to `app.carta.com` sends the admin to a production company that doesn't hold the
securities they just issued. There is no verified URL for a specific plan's detail page, so
name the plan in plain text, not as a second link. Then close per [Closing](#closing).

## Cleanup unexpected draft rows

Extra or duplicate rows surfaced by `load_drafts` on resume, or a dropped `row_key` from a
Phase 1.5 retry: [resume-flow.md § Cleanup unexpected draft
rows](resume-flow.md#cleanup-unexpected-draft-rows).


---

## Closing

At a terminal state, lead with a one-line domain summary — company, count, type, and for an
issue, the issue date in long form (`Month D, YYYY`).

| State | Template |
|---|---|
| Issued, certificate | *"N \<share class\> certificates issued on \<company\> — \<issue date\>. Open \<company\>'s securities ledger in Carta — link text *\<company\>'s securities ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new certificates."* |
| Issued, grant (uniform) | *"N \<so_type\> option grants issued on \<company\> — \<issue date\>. Open \<company\>'s securities ledger in Carta — link text *\<company\>'s securities ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new grants, or find them under the \<plan name\> plan."* |
| Issued, grant (mixed) | as above, but *"N option grants (X ISOs, Y NSOs) issued on …"* |
| Issued, PIU | *"N \<unit class\> profits interest units issued on \<company\> — \<issue date\>. Open \<company\>'s profits interest ledger in Carta — link text *\<company\>'s profits interest ledger*, href `\<BASE_URL\>/\<VIEW_URL_PATH\>` — to see the new units."* |
| Saved as draft | *"N \<security type\> drafts saved on \<company\> — finish in the Drafts UI — link text *Drafts UI*, href `\<BASE_URL\>/drafts/\<security_type\>/\<CORP_ID\>/draft/?draftSetPk=\<draft_set_id\>`."* |
| Canceled, **a real draft set exists** | *"Issuance canceled on \<company\> — the draft set is still there if you want to come back to it: [Drafts UI](…same URL…)."* |
| Canceled, **no real draft set** | *"Issuance canceled on \<company\> — nothing was saved to Carta."* (no link — there is nothing to open) |

A draft set is **real** when this batch was resumed from an existing one, **or** at least one
row from a `save_drafts` / `issue_securities` call this session came back with a success
`status` and therefore a saved `draft_pk`. It is **not** real when `draft_set_id` is still the
initial `"new"` placeholder, or when every row's `status` came back an error.

Every link above builds on `BASE_URL` — the `base_url` from `get_current_user`, recorded in
[Step 2a](engine.md#step-2--command-names-and-base_url) — so a demo, sandbox or
test session links into the environment it actually wrote to. `security_type` in a Drafts-UI
path is the literal mutate value (`certificate`, `option_grant` or `piu`).

To **correct** an issued certificate, grant or unit afterward, that's
`carta-modify-issuables`.
