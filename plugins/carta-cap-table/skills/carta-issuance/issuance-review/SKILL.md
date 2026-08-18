---
name: carta-cap-table:issuance-review
description: >-
  Internal artifact sub-skill for carta-issuance. Renders a read-only HTML
  review summary for option-grant AND certificate issuance batches — stat
  tiles plus one confirmation row per stakeholder. Not invocable directly —
  dispatched by carta-issuance Phase 2 via artifact-manager:render-panel.
owner: carta-cap-table maintainers (#cap-table-eng)
allowed-tools: []
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>", "surface": "<value>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
`surface` is the Claude surface you are running in: `"chat"` (claude.ai or the Claude app, i.e. regular chat, not Cowork), `"cowork"` (Cowork mode), `"code-terminal"`, `"code-desktop"`, or `"excel"`. Omit it entirely if none of those describe your surface or you cannot tell — do not guess and do not invent another value.
</IMPORTANT>

# issuance-review artifact

This skill holds the `references/` assets for the issuance review panel rendered
by `carta-issuance` Phase 2. **The panel is read-only** — every field was
already decided per-stakeholder in the config panel (`issuance-config`), so this
surface is a confirmation summary, not another editing pass; corrections happen
via **Back to edit**, which re-opens the config panel with every block restored.
**One template serves both security types** — the shared chrome (top bar,
modals, footer, save/submit JS) is fixed, and everything that differs between
option grants and certificates is injected as a per-type **block substitution**.
Those blocks (`DETAIL_TABLE`, `KPI_STRIP`, `PLAN_CARD`) are produced by
**`scripts/build_review.py`** from the resolved rows — `carta-issuance` runs the
script and passes the outputs via `--substitute-file`; **the model never
hand-authors the row markup.** The block contracts below are the spec
`build_review.py` implements (and what a reviewer should expect), not a
hand-authoring guide.

**Do not invoke this skill directly.** It is dispatched internally by
`carta-issuance` via `artifact-manager:render-panel`.

## References

| File | Purpose |
|---|---|
| `scripts/build_review.py` | **Builds the dynamic blocks** (read-only `DETAIL_TABLE` rows, `KPI_STRIP` stat tiles, `PLAN_CARD` equity-plan summary) deterministically from the resolved rows. The model never hand-authors row HTML — same discipline as `build_config.py`. |
| `scripts/preview_review.py` | **Design-iteration harness** — renders the panel to a standalone HTML file with sample data, no MCP. See [Iterating on the UI](#iterating-on-the-ui). |
| `references/artifact.yaml` | Declares the shared substitutions and capabilities (`save`, `submit-watcher`) |
| `references/template.html` | Thin shared frame — per-type regions injected via `{{BLOCK}}` tokens |
| `references/styles.css` | Ink-compliant CSS (typography, layout, modals, legend rows) |
| `references/Inter-roman.var.woff2` | Inter variable font — served from the preview server at render time |
| `references/SangBleuVersailles-Regular-WebS.ttf` | SangBleu Versailles for the `heading-1` company name |

## Substitutions

All keys in `artifact.yaml`'s `required` list are **shared** — both security
types provide every one. Type-specific numbers live *inside* the block values
(`KPI_STRIP`, `DETAIL_TABLE`, `PLAN_CARD`), never as top-level placeholders, so
the frame stays type-agnostic. `{{SAVE_PORT}}` is filled by render-panel, not
here. `PLAN_CARD` is the one **optional** key (default `""`) — see [Block:
`PLAN_CARD`](#block-plan_card) below.

### Scalars (per type)

| Key | Option grant | Certificate |
|---|---|---|
| `FLOW_TITLE` | `Issue Option Grants` | `Issue Certificates` |
| `SUBHEADING` | `<plan name> &nbsp;·&nbsp; <issue date>` | `<issue date>` (no share-class names — a batch's classes are already shown per-row in `DETAIL_TABLE`, so repeating them here is redundant, and it read oddly with a single class name floating alone next to a date) |
| `DETAIL_TITLE` | `Grant Detail` | `Certificate Detail` |
| `DETAIL_INTRO` | `Review before issuing. Use Back to edit to change anything.` | same |
| `VIEW_URL_PATH` | `options/list/<CORP_ID>/` | `certificates/list/<CORP_ID>/` |
| `SECURITY_NOUN_PLURAL` | `option grants` | `certificates` |
| `ISSUE_MODAL_DISCLAIMER` | grant signature-flow sentence (below) | certificate legend-restriction sentence (below) |

- **Grant `ISSUE_MODAL_DISCLAIMER`**: *"Confirming will save these grants to Carta and send them to the signatory for signature."*
- **Cert `ISSUE_MODAL_DISCLAIMER`**: *"Confirming will save these certificates to Carta and issue them to the cap table."*

**Never append draft-set status to `SUBHEADING`** (e.g. "· new draft set") — this has been
ad-libbed in production for both types even though it's not part of either pattern above.
`{{DRAFT_SET_ID}}` is its own separate substitution for exactly this kind of state; the
subheading's job is just "what is this, and when" (plan/nothing, then the date).

### Block: `PLAN_CARD`

Option-grant only — **empty string for certificates** (no equity plan concept
there; the template renders nothing). A highlighted `<div class="card section
plan-card">` (blue left-accent bar, tinted background) naming the resolved
equity plan and its exercise periods — elevated out of `SUBHEADING`'s plain
text into its own card (design feedback: the plan name used to be buried in a
subheading line with no visual weight). Built once by `build_review.py`'s
`build_plan_card()` from the **first** resolved row's `plan_name` /
`exercise_periods_text` (every row in one draft set shares the same
`equity_plan_id` — Phase 1's Option-plan reconciliation — so there's nothing to
reconcile across rows). Omits the periods paragraph entirely when
`exercise_periods_text` is blank, rather than rendering an empty line.

### Block: `KPI_STRIP`

A `<div class="kpi-grid">` of `.kpi-cell` stat tiles, computed once in Python from the
resolved rows (nothing on this panel is editable, so nothing needs to live-recompute):
**Recipients** (row count); **Total options** / **Total shares** (sum of every row's
`quantity` — safe to sum regardless of currency, since a share/option count isn't money) with
a sub-line breakdown (ISO/NSO split for grants, per-share-class breakdown for certs);
**Pending board approval** (count of rows with no `board_approval_date` — a pending row omits
the key entirely per the Row templates, never an empty string) — **option grant only**;
certificates always carry a board date (Row templates: always required, no pending state),
so this tile would forever read 0 there — dropped instead of showing a count that can never
be anything else; **Currency**/**Currencies** (the distinct set of currencies across rows — a
batch can genuinely mix currencies now that option type/currency are chosen per-row in the
config panel, so this tile surfaces that plainly instead of a combined dollar total, per the
repo-wide "never sum across currencies" rule).

**Grants render 4 tiles, certificates render 3** — `.kpi-grid`'s CSS is `repeat(auto-fit,
minmax(160px, 1fr))`, not a fixed `repeat(4,1fr)`, so it adapts to whichever count
`build_kpi_strip()` actually emits instead of leaving an empty 4th slot for certs.

### Block: `DETAIL_TABLE`

This block is a **read-only table** — one `<tr data-stake>` per grantee/holder — wrapped in
`<div class="grantee-table-wrap"><table class="grantee-table">`. Every cell is plain text (or,
for the legend column, a read-only expand/collapse toggle) — **no `data-field`, no inputs, no
per-row remove button.** Corrections happen via the **Back to edit** button in the action bar,
which returns to the config panel with every stakeholder block restored, not by editing a cell
here.

- **Each row root still carries `data-stake`** — kept as a stable hook for future tooling
  (e.g. per-row highlighting); nothing selects on it to collect a payload anymore, and the
  legend button no longer needs it either (`showLegendModal()` reads `data-legend-body`
  straight off the clicked button, not an ancestor lookup).
- **Name → `.stake-name`, email → `.stake-email`** in the first `<td>` (display only).

**Option grant** — a deliberately trimmed recap (design feedback), not carta-issuance's
full 16-column chat-review list (see
[references/chat-review.md](../references/chat-review.md) for why the
panel and the chat spec now differ):
Stakeholder · Email · Type (`so_type` — labeled "Type", not "Option type"; there is no
separate stakeholder-kind column on this table to collide with) · Quantity · Exercise price ·
Board approval · Issue date · Vesting schedule · Vesting start · Grant expiration. No Remove
column, no Flags column. Plan and Currency are stated once in `SUBHEADING` / `KPI_STRIP`
instead of repeating per row (see [issuance-config/SKILL.md](../issuance-config/SKILL.md) for
where Relationship, Stakeholder type, Exemption, Documents, and Exercise periods were already
shown and confirmed one screen earlier).

Grant table template:

```html
<div class="grantee-table-wrap">
<table class="grantee-table">
  <thead><tr>
    <th>Stakeholder</th><th>Email</th><th>Type</th><th>Quantity</th><th>Exercise price</th><th>Board approval</th><th>Issue date</th><th>Vesting schedule</th><th>Vesting start</th><th>Grant expiration</th>
  </tr></thead>
  <tbody>
    ROW_PER_GRANTEE
  </tbody>
</table>
</div>
```

Each `ROW_PER_GRANTEE` (every cell plain text):

```html
<tr data-stake>
  <td><div class="stake-name">FULL_NAME</div><div class="stake-email">EMAIL</div></td>
  <td>EMAIL</td>
  <td>SO_TYPE</td>
  <td>QUANTITY (comma-formatted)</td>
  <td>EXERCISE_PRICE_OR_DASH</td>
  <td>BOARD_DATE_OR_DASH</td>
  <td>ISSUE_DATE_OR_DASH</td>
  <td>VESTING_SCHEDULE_NAME</td>
  <td>VESTING_START_OR_DASH</td>
  <td>GRANT_EXPIRATION_OR_DASH</td>
</tr>
```

- Every `*_OR_DASH` = the resolved value, or `—` when the row doesn't carry it. **Source field
  names are the Row-template keys** (`../../SKILL.md#row-templates`) — `BOARD_DATE_OR_DASH`
  reads `board_approval_date` (never present on a pending row — that's how the KPI strip's
  Pending-board-approval count works), `VESTING_START_OR_DASH` reads `vesting_start_date`.
  Neither is the short `board_date`/`vesting_start` name a stale prior version of this table
  used — don't reintroduce it.
- **Every `*_DATE_OR_DASH` cell is masked to `MM/DD/YYYY`** by `_fmt_date()`, not emitted
  raw — resolved rows mix DateField `YYYY-MM-DD` (`issue_date`, `board_approval_date`) with
  CharField `MM/DD/YYYY` (`vesting_start_date`, `grant_expiration_date`, `rule_144_date`);
  `_fmt_date()` converts an ISO value and passes an already-masked one through unchanged, so
  every date column lands on the one format the user actually sees (Voice & defaults). Don't
  reintroduce a bare `r.get("issue_date")` — that was the pre-fix bug (raw `2026-06-11` shown
  next to already-masked columns).
- `VESTING_SCHEDULE_NAME` is **resolved from the row's `vesting_template` id** against the
  fetched vesting-templates list (`--vesting-templates`), the same way the certificate table's
  share-class name is resolved from `prefix` — `vesting_template` never holds a display label
  directly; `null` → `"No vesting"`. **`build_review.py`'s `main()` refuses to run** (exits 2
  with a stderr message) if any row carries a `vesting_template` id and `--vesting-templates`
  came back empty — this used to silently render `"Custom"` for a perfectly real selection
  whenever the reference-data file wasn't threaded through, which is actively misleading
  (this skill can never set genuinely custom vesting — Hard rule 7). An id that's still
  unresolved despite a non-empty list (e.g. a template deleted after being fetched) renders
  `"Selected — details unavailable"`, never `"Custom"`.
  - **Pass the raw fetched result to `--vesting-templates`/`--share-classes` — don't
    hand-flatten it.** `build_review.py` unwraps the standard `{count, results}` envelope
    (and nested `{result: ...}`/`{text: ...}` shapes) itself, same as `build_config.py`. By
    recorded incident: a caller that instead wrote its own flattened array to a
    separately-named file (because it didn't know the script would unwrap the envelope) once
    found a same-named leftover from an unrelated prior run already sitting in the corp-keyed
    `$OUT_DIR` and reused it rather than regenerating it. Writing the raw fetch straight to
    the documented `--vesting-templates`/`--share-classes` path, fresh, every run, removes
    both the ad hoc step and the staleness risk.

**Certificate** — columns (carta-issuance SKILL.md's 13 "always" columns, minus Currency —
redundant with the KPI strip's Currency/Currencies tile — and minus Exemption, design
feedback dropped it from this trimmed recap): Stakeholder · Type · Email · Relationship ·
Share class · Quantity · Price/share · Board approval · Issue date · Rule 144 date · Build
legend · Flags (when applicable). No Remove column, no Currency column, no Exemption column.

Cert table template:

```html
<div class="grantee-table-wrap">
<table class="grantee-table">
  <thead><tr>
    <th>Stakeholder</th><th>Type</th><th>Email</th><th>Relationship</th><th>Share class</th><th>Quantity</th><th>Price / share</th><th>Board approval</th><th>Issue date</th><th>Rule 144 date</th><th>Build legend</th>FLAGS_TH
  </tr></thead>
  <tbody>
    ROW_PER_HOLDER
  </tbody>
</table>
</div>
```

Each `ROW_PER_HOLDER`:

```html
<tr data-stake>
  <td><div class="stake-name">FULL_NAME</div><div class="stake-email">EMAIL</div></td>
  <td>STAKEHOLDER_KIND_LABEL</td>
  <td>EMAIL</td>
  <td>RELATIONSHIP_OR_DASH</td>
  <td>SHARE_CLASS_NAME (PREFIX)</td>
  <td>QUANTITY (comma-formatted)</td>
  <td>PRICE_OR_DASH</td>
  <td>BOARD_DATE_OR_DASH</td>
  <td>ISSUE_DATE_OR_DASH</td>
  <td>RULE144_OR_DASH</td>
  <td><button class="legend-view-btn" onclick="showLegendModal(this)" data-legend-body="LEGEND_BODY">View legend</button></td>
  FLAGS_TD
</tr>
```

- `STAKEHOLDER_KIND_LABEL` / `RELATIONSHIP_OR_DASH` — same display rules as the grant table above.
- `SHARE_CLASS_NAME (PREFIX)` = the matching class's full name from the fetched share-class list plus its prefix, or just the prefix (`—` if blank) when no match is found.
- `FLAGS_TH` / `FLAGS_TD` — same logic as grant: include column only when ≥1 row has a flag.
- `FLAGS_HTML` = `<span class="tag tag-intl">Non-individual</span>` / `<span class="tag tag-warn">Non-cash dividend</span>` / `<span class="tag tag-first">LLC $0 OK</span>`.
- `RULE144_OR_DASH` appends the difference reason as a parenthetical (`_rule_144_cell()`,
  `RULE_144_REASON_LABELS`) whenever the row carries `rule_144_difference_reason` — set only
  when `rule_144_date` ≠ `issue_date` (Row templates), so its mere presence is the trigger;
  no separate date comparison needed.
- `LEGEND_BODY` = full legal body text (HTML-escaped), read from `data-legend-body` and shown
  in `#modal-legend` on click (`showLegendModal()`) — **not** an inline expand/collapse
  anymore. The inline version lived inside `.grantee-table-wrap`, which scrolls horizontally;
  a revealed body inside a narrow `<td>` could be clipped or invisible depending on scroll
  position. A modal sidesteps the table-layout constraint entirely.

## Button wiring

| Button | Action |
|---|---|
| **Back to edit** | No confirmation modal — immediately POSTs `action: "back_to_edit"` → `carta-issuance` re-renders the config panel with every block restored |
| **Confirm & Issue** | Opens confirmation modal → on confirm, POSTs `action: "submit"` → `carta-issuance` runs `issue_securities` only (the rows were already saved by the parent skill's Phase 1.5 save+validate step, before this panel ever rendered) |
| **View on Carta ↗** | `target="_blank"` anchor to `https://<ENV_HOST>/<VIEW_URL_PATH>` → opens in a new browser tab |

There is no "Save draft" button on this panel — it moved to the config panel's own **Save**
button (parent SKILL.md's Phase 1.5), since by the time this review panel renders, the rows
are already saved. Both remaining action-bar buttons disable via `setActionsDisabled(true)`
the instant their POST fires (kept disabled through the progress-view spinner), re-enabling
only if the POST itself fails (`onError`) — this prevents a double-click from re-sending
`back_to_edit` / `submit` while the first request is still in flight.

On either action, the panel POSTs `{ action, corp_id, corp_name, draft_set_id }` to
the save-server (the **side-panel** JSON — see
[../references/artifact-flow.md](../references/artifact-flow.md#3-wake-on-submit); on the
Cowork path the parent skill confirms with one `AskUserQuestion` instead of this JSON
contract — see [cowork-adapter.md §3](../references/cowork-adapter.md#3-confirm--one-askuserquestion)). **No `rows`** — the panel is read-only, so there is nothing on the surface
to collect; `carta-issuance` builds the mutate payload straight from its own Phase-1-resolved
rows (see [carta-issuance SKILL.md](../SKILL.md#build-the-mutate-payload-from-your-phase-1-resolved-rows)).
The save-server write wakes `carta-issuance` via the submit-watcher; the generic wake /
panel-close / no-poll mechanics live once in
[../references/artifact-flow.md](../references/artifact-flow.md) §3, §5. On **Confirm &
Issue**, `showSubmitted()` swaps the modal's progress message to an honest hand-off line —
there is **no "Done" button**: nothing is left to click, and the modal's dimmed backdrop
stays clickable to dismiss it manually. **Deliberately does not call `window.close()`**:
unlike a true host-opened webview (where it's a guaranteed no-op), some automation-controlled
test hosts actually honor it, which would hide the hand-off message before the user ever
reads it — a regression caught in testing. **Back to edit** shows no modal at all — the rows
were already saved by Phase 1.5, re-editing and saving again just updates those same rows in
place, and the panel is about to be replaced by the re-rendered config panel anyway.

**Grace-timer fallback (`armGraceTimer()`/`START_GRACE_MS`), same 30s contract as the config
panel's `_startTimer`** (`issuance-config/references/template.html`) — by recorded incident,
a prior version of this panel had no recovery path at all once a POST succeeded: the modal
showed "Sent to Claude…" and every action-bar button stayed disabled forever, with no signal
to the user if the submit-watcher stalled or never woke (indistinguishable, from the panel's
own perspective, from Claude simply taking a while). Every success path that leaves the
actions disabled (`showSubmitted()` for Confirm & Issue, and `backToEdit()`'s own toast) arms
the timer; if it elapses with no visible progress, the modal resets to its confirm view, the
action bar re-enables, and a toast tells the user to type "continue" in chat or click the
button again. The panel can't observe whether Claude actually processed the request in time —
this is the same accepted limitation the config panel already has, not a new one.

## Iterating on the UI

For design changes to the review panel (colors, spacing, table layout, copy), you
touch three files — no Carta MCP, no full skill run:

| File | What lives here |
|---|---|
| `references/styles.css` | All panel styling (Ink tokens, table, modals, legend rows, KPI tiles) |
| `references/template.html` | Shared chrome + save/submit JS |
| `scripts/build_review.py` | The per-row detail table and the KPI stat tiles |

**Preview loop** — edit a file, then:

```bash
uv run scripts/preview_review.py --open              # renders both types, opens in browser
uv run scripts/preview_review.py --security-type certificate --open
```

It runs `build_review.py` on committed sample rows, inlines `styles.css`, and
substitutes every `{{TOKEN}}`, writing `preview_review_<type>.html`. The Back to
edit / Confirm & Issue buttons are inert in preview (they POST to a dead port),
so you can open the modals and click through freely. Edit the inline `SAMPLE_ROWS`
in `preview_review.py` to preview more rows, an international employee, non-cash
dividend flags, or a long legend body.
