# Refresh Grant Planner — issuance handoff findings

Status: **design recorded, not built.** Captures why the handoff looks the way it
does, so the reasoning does not have to be rediscovered when Step 6 is picked up.

Source: PRD "Refresh Grant Workflow (CTC MicroApp v2)" §6 Step 6, §8 Dependencies.

---

## The constraint

This console is read-only with respect to Carta, and that is enforced in three
independent places. Any Step 6 design has to survive all three.

1. **`serve.py` header** — "The browser NEVER calls the Carta MCP — it only reads
   JSON the skill produced. This app is READ-ONLY with respect to Carta: the sole
   write path is the local scenarios save (PUT /api/scenarios), which never leaves
   this machine."
2. **`SKILL.md` frontmatter** — `allowed-tools` grants `call_tool`, `fetch`,
   `search_tools`, `list_accounts`. There is no `mutate`. The skill is
   `publish: true` and its description says READ-ONLY to customers.
3. **`chat_session.py:25`** — the ask box subprocess runs with
   `ALLOWED_TOOLS = "Read,Edit,Write,Grep,Glob"`, no Bash, and MCP servers
   explicitly stripped. The comment at lines 87-89 names the exact failure being
   prevented: inheriting the user's MCP servers "would let a prompt typed in the
   browser reach Carta."

So the write cannot originate in the browser, and it cannot originate in the ask
box. It has to happen in the session that launched the console.

## Why not just grant the ask box `mutate`

Considered and rejected. `build_argv` (chat_session.py:71) passes
`--permission-mode acceptEdits`, so the subprocess auto-approves. Granting it
`mutate` would let a sentence typed into a browser textfield create real option
grants against a real cap table with no confirmation anywhere.

It also would not work end-to-end: an option-grant row needs `document_set_id`,
`vesting_template`, `equity_plan_id`, `exercise_price`, `so_type` and `exemption`,
none of which the planner holds. `carta-issuance` collects those through
multi-phase interactive gates plus an account-setup check
(`document_sets.count >= 1`). Reproducing that inside a single-textfield surface
means reimplementing the skill.

`carta-issuance` Rule 6 — "Never delegate to a background agent. The gates require
interactive HITL" — is the same conclusion reached from the issuance side.

## The shape

A file handoff in the data dir, with the write happening in the launching session.

```
App Step 6 button
  -> PUT /api/handoff  ->  handoff-request.json     (browser writes local file only)
  -> UI enters "waiting" state

Launching Claude session
  -> reads handoff-request.json
  -> invokes carta-issuance
  -> its gates run (equity plan, vesting template, document set) — the real HITL
  -> cap_table:mutate:save_drafts          DRAFT ONLY, never issue_securities
  -> writes receipt.json to the data dir

App
  -> polls GET /api/receipt
  -> success state: draft count, draft set id, deep link into Carta
```

The browser still only reads JSON the skill produced. The invariant holds.

### Why CSV rather than a bespoke payload

`carta-issuance` Phase 0.25 already dispatches `issuance-import`, whose
`parse_upload.py` accepts CSV against a documented header vocabulary
(`issuance-import/references/column-map.md`). `grant_reason` has **`Refresh`** as
a picklist member — the exact case this feature produces.

Reusing that path inherits its coercion rules and its "unresolved is blank, never
guessed" guarantee. Inventing a second payload format would fork the vocabulary
and bypass `parse_upload.py`'s import-notes reporting.

Leave `Vesting Schedule`, `Equity Plan Name` and `Exercise Price` **blank** unless
the user supplied them. An almost-matching vesting template issues genuinely wrong
terms that the server cannot catch.

Verify before building: `model/csv.js` `downloadCsv` writes a UTF-8 BOM. Confirm
`parse_upload.py` tolerates it; if not, add a BOM-less writer as a new export
rather than changing `downloadCsv`, which both existing tabs depend on.

### Receipt shape

```json
{ "scenarioSlotId": "slot-2",
  "status": "created",
  "draftSetId": 8814,
  "created": 47,
  "failed": 0,
  "errors": [],
  "issuedAt": "2026-09-01T10:42:11Z",
  "deepLink": "https://app.carta.com/drafts/option_grant/<corp>/draft/?draftSetPk=8814" }
```

`scenarioSlotId` must match the request that produced it, or a stale receipt from
an earlier run will decorate a new plan with the wrong numbers.

### States that need handling

The happy path is the easy part.

| State | Behaviour |
|---|---|
| No session picked it up | Time out (~2 min) with "No Claude session picked this up." Files stay on disk; nothing is lost. An indefinite spinner is worse than an honest timeout. |
| Gates abandoned mid-flow | Receipt with `status: "cancelled"`; UI returns to the button. |
| Partial success | `created: 44, failed: 3` with per-employee errors surfaced verbatim, no silent retries (PRD §6 Step 6). |
| Stale receipt | Ignored unless `scenarioSlotId` matches. |

### Cost

Two `serve.py` routes (`PUT /api/handoff` mirroring the existing scenarios
handler, `GET /api/receipt` as a `_FILE_ROUTES` line), a poll hook, and the state
machine above. Small, because the PUT/ETag machinery already exists.

## Known limitation

The gate questions render in the Claude session, not in the app — so the
confirmation step spans two surfaces before returning to one. Pulling them into
the app would mean reimplementing issuance's flow, which is the thing this design
avoids.

## Measurement note

The CTC route's "Draft Equity Awards" click has been **untracked since July 2024**
(analytics never wired in after the CTCPOD-3659 refactor). The PRD's "≥70% of
employees in a completed plan reach draft state" therefore has no baseline today.
`receipt.json` makes that step observable for the first time — worth wiring an
analytics event when Step 6 lands.

## Open items to confirm before implementation

- `parse_upload.py` BOM tolerance (above).
- The `document_sets.count >= 1` account-setup gate is a hard stop in
  `carta-issuance`; the app should surface it as a precondition rather than
  letting the user reach Step 6 and fail there.
- Whether `save_drafts` accepts a `draft_set_name` long enough for scenario slot
  names (documented limit: 30 chars) — slot names are user-authored and will
  exceed it.
