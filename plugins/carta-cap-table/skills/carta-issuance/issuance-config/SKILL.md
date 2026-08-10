---
name: carta-cap-table:issuance-config
description: >-
  Internal config panel sub-skill for carta-issuance. Renders a pre-flight
  configuration panel with one full key-value block per stakeholder — name,
  email, stakeholder type, relationship, quantity, and the whole type-specific
  field set (option type / exercise price / vesting / documents for option
  grants, or share class / price per share / legend / Rule 144 for
  certificates, plus issue date and board approval) — so a single batch can
  carry genuinely different terms per person. Not invocable directly —
  dispatched by carta-issuance Phase 0.5.
owner: carta-cap-table maintainers (#cap-table-eng)
allowed-tools: []
---

<!-- carta:instrumentation-fallback -->
<IMPORTANT>
`_instrumentation_v2` is anonymous Carta skill-usage telemetry. ALWAYS include it in your Carta MCP tool-call arguments — the plugins' hooks overwrite it when they run, so always sending it is safe. Shape:
`_instrumentation_v2: {"skills": ["<plugin>:<skill>", ...], "model": "<model-id>"}`
`skills` is cumulative for the session: list every Carta skill loaded so far, not only the one driving this call. Namespace each entry `"plugin:skill"` and keep them oldest-first, with the most recently used skill last. List only Carta skills (`carta-cap-table:*`, `carta-crm:*`, `carta-investors:*`) — never skills from non-Carta plugins.
</IMPORTANT>

# issuance-config panel

Pre-flight configuration panel for issuance. Replaces the `AskUserQuestion` chain
with a single interactive panel in the Claude Desktop side panel. The panel is a
repeater of **one full key-value block per stakeholder** — every field (name,
email, stakeholder type, relationship, quantity, and the whole type-specific
field set) lives inside that person's own block, so one batch can issue
genuinely different terms to different people. A "+ Add stakeholder" button
appends another block, pre-filled by copying the most-recently-added block's
non-personal terms forward. **One template serves both security types**: it
carries both field sets, and the `{{SECURITY_TYPE}}` switch (`option_grant` |
`certificate`) hides the rows whose `data-sectype` doesn't match and selects
the matching `submit()` payload. Issue date and Board approval are shared field
rows (not type-gated) inside every block.

**Two footer buttons.** **Review** posts `action: "config_submit"` — the parent
skill saves *and* validates (`save_drafts` + `validate_drafts`) before ever
rendering the review surface ([carta-issuance SKILL.md's Phase
1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only)); any
server error re-renders this same panel with a banner (see [Server-error
banners](#server-error-banners), below), never silently moves on. **Save**
posts `action: "save_only"` — a lighter escape hatch, `save_drafts` only, no
validation, no panel re-render. Both gate on the exact same per-block
readiness check (`missingFields()`) — Save isn't a weaker bar.

**Do not invoke this skill directly.** Dispatched by `carta-issuance` Phase 0.5.

## References

| File | Purpose |
|---|---|
| `scripts/build_config.py` | **Builds every dynamic block** (the toggle-button groups **and** the grantee/holder rows, plus the stakeholder roster for autocomplete) deterministically from the fetched data + the prompt-derived `knowns`. The model never hand-authors panel HTML — doing so once shipped dead `btn-card` buttons and stamped a plan id where a document-set id belonged. |
| `scripts/preview_config.py` | **Design-iteration harness.** Renders the panel to a standalone HTML file with committed sample data — no MCP, no skill run. See [Iterating on the UI](#iterating-on-the-ui). |
| `references/artifact.yaml` | Shared `required` + per-type `optional` substitutions; `save` + `submit-watcher` capabilities |
| `references/template.html` | Config panel — both field sets gated by `data-sectype`, shared sticky Review/Save footer |
| `references/styles.css` | Ink-compliant styles (toggles, date/price inputs, legend attestation box) |
| `references/Inter-roman.var.woff2` | Inter variable font |
| `references/SangBleuVersailles-Regular-WebS.ttf` | SangBleu Versailles for corp name |

## Substitutions

`required` (both types provide): `CORP_NAME`, `CORP_ID`, `FLOW_TITLE`
(`Issue Option Grants` | `Issue Certificates` — verb-first, since this is a write
operation), `HEADER_SUB` (`7 grantees` |
`2 holders`), `SECURITY_TYPE` (`option_grant` | `certificate`).

`optional` (default `""`; built by `build_config.py`):

| Key | Value |
|---|---|
| `STAKEHOLDER_ROWS` | one full `.stake-block` per person from `knowns.rows` — every field (name, email, stakeholder type, relationship, quantity, and the whole type-specific field set) lives inside that block; one blank block when the prompt named no one. `TODAY_ISO`/`CURRENCY`/`EXERCISE_PRICE_DEFAULT`/`PRICE_PER_SHARE_DEFAULT` are no longer separate template substitutions — they're `knowns` scalar inputs `build_config.py` stamps into each block directly (see [payload delivered on submit](#payload-delivered-on-submit) below for why: a token inside a generated fragment isn't re-substituted by render-panel's single text-replace pass) |
| `STAKEHOLDER_LIST_JSON` | JSON array of the corp roster (`[{name,email,id,kind,event_relationship},…]`) for name autocomplete + email/stakeholder-type/relationship auto-fill |
| `BATCH_ERRORS_HTML` | Panel-level red banner (above the Grantees/Holders list) for corp-/batch-level server errors from a Phase 1.5 validation round — built from `knowns.batch_errors`; `""` (collapsed via CSS `:empty`) when clean. See [Server-error banners](#server-error-banners). |

**`build_config.py` normalizes the real MCP shape.** The live `cap_table:get:stakeholders`
result uses `full_name`, never `name` — reading only `name` silently dropped every real
record (each one looked "nameless"), which emptied `STAKEHOLDER_LIST_JSON` against live
data even though every test fixture (built with a `name` key) kept passing. `build_stakeholder_list()`
reads `s.get("name") or s.get("full_name")` and always normalizes the output to a `name` key.

Every per-type option list (option type, vesting, documents, share class, legend, Rule 144)
that used to be its own top-level substitution now lives **inside each block** within
`STAKEHOLDER_ROWS` — there's no separate `OPTION_TYPE_OPTIONS`/`VESTING_OPTIONS`/etc. key
anymore, since each stakeholder's block needs its own independently-selected set.

`{{SAVE_PORT}}` is filled by render-panel.

### Per-block field contracts

**`build_config.py` emits all of these — this is the spec it implements, not a
hand-authoring guide.** The parent skill writes the fetched data + a `knowns`
object to disk and runs the script; the model never emits panel HTML. The rows
below document what the script produces (and what a reviewer should expect) for
**each** stakeholder block. Each button carries the attributes the template's JS
reads, and the row's own default is marked `selected` (falling back to the
batch-level `knowns` default when the row didn't specify its own value — see
[carta-issuance SKILL.md](../SKILL.md#phase-05--configure-the-issuance)). The
**No vesting** (grant) option is part of the script's output too.

| Group | Per-button HTML |
|---|---|
| Stakeholder type | `<button class="toggle[ selected]" data-group="kind" data-value="INDIVIDUAL\|NON-INDIVIDUAL" onclick="pick(this)">Individual\|Non-individual</button>` — two buttons; `INDIVIDUAL` selected by default. Auto-selected (but still clickable/editable) by template JS on an exact roster-name match. |
| Type (`so_type`) | `<div class="toggle-row">` of the corp's own resolved jurisdiction's 3 `so_type` buttons only, each `<button class="toggle[ selected]" data-group="type" data-value="<so_type>" onclick="pickType(this)"><so_type></button>` — US `ISO`/`NSO`/`INTL`, UK `EMI`/`CSOP`/`Unapproved`, or AU `Startup Concessions`/`Non-Concessional`/`ZEPO`, gated by `knowns.jurisdiction` (design feedback reversed an earlier "show all 9 across all 3 jurisdictions, grouped by jurisdiction" layout — a corp only ever issues one jurisdiction's types, so the other 6 read as clutter, not a genuine affordance). Mark this row's resolved type `selected` when it has one. `pickType()` (not the generic `pick()`) additionally re-syncs the HMRC/ATO conditional rows below for the newly-selected type. |
| Vesting | `<select class="select-input block-vesting-select">` with one `<option data-label="<name>">` per template plus the **No vesting** sentinel (`value="__none__"`). **Grants**: always shown, defaults to the 4yr/1yr cliff (or this row's own prior value) — `vesting_template` is `always` server-side (payload-reference.md). **Certificates**: also shown (opt-in server-side), but defaults to **No vesting** unless the row or the batch `knowns` default already names a real template — the opposite default from grants. |
| Documents | `<button class="toggle[ selected]" data-group="docset" data-value="<set id>" data-label="<set name>" onclick="pick(this)"><name></button>` — one per set; mark `selected` when only one set exists or this row already named one. |
| HMRC notified | Grant-only. A checkbox (`.block-hmrc-notified`, bound to `is_hmrc_notified`) + date input (`.block-hmrc-notified-date`, bound to `hmrc_notified`), tagged `data-conditional="so_type_emi"` — shown only when the row's `so_type` is `EMI`, hidden (and omitted from the submit payload) otherwise. `pickType()` toggles this row when the type selection changes. |
| ATO notified | Grant-only. A checkbox (`.block-ato-notified`, bound to `is_ato_notified`), tagged `data-conditional="so_type_au"` — shown only when `so_type` is `Startup Concessions`/`Non-Concessional`/`ZEPO`, hidden (and omitted) otherwise. |
| Share class | `<button class="toggle[ selected]" data-group="shareclass" data-value="<prefix>" data-label="<class name>" onclick="pick(this)">(<prefix>) <class name></button>` — one per share class (button text carries the prefix, e.g. `(CS) Common`, so the user can tell classes apart without decoding it themselves; `data-label` stays the bare name). `selected` on the prompt-named/row's-own class; else the only class when there's just one; else the **last** class in the fetched list (proxy for "most recently created" — no creation timestamp in the response, see [certificate-fields.md's Share-class reconciliation](../references/certificate-fields.md#share-class-reconciliation-certificate)). |
| Legend | `<button class="toggle[ selected]" data-group="legend" data-value="<legend id>" data-label="<legend name>" data-body="<full legal body, HTML-escaped>" onclick="pickLegend(this)"><legend name></button>` — one per legend; mark the default/only/row's-own legend `selected`. Selecting one reveals its `data-body` in that block's attestation box. |
| Rule 144 reason | `<select class="select-input block-rule144-reason">` with the 5-value `rule_144_difference_reason` enum (payload-reference.md); pre-selected with this row's own value. Lives inside `.block-rule144-reason-wrap`, shown/hidden by `pickRule144()` in lockstep with the Rule 144 date input — visible only when "Use a different date" is picked. Collected here, in the panel, instead of a separate post-submit `AskUserQuestion` (the prior design) — the reason is required at the same moment the date is, so there's no reason to make it a second round-trip. The Rule 144 date field itself carries the `required=True` marker (`*`) — design feedback that it read as optional without one, even though it's always collected (defaulting to the issue date). |
| Advanced fields (grant) | A collapsed `<details class="advanced-fields"><summary>More fields (optional)</summary>`, in order: `custom_label`, `grant_reason` (`<select>` — carta-web's own picklist, [carta-modify-issuables/references/field-contract.md](../../carta-modify-issuables/references/field-contract.md): New Hire, Merit, Promotion, Refresh, Corporate transaction, Relationship change, Retention, Advisor, Consultant, Board, Performance bonus, Boxcar grant — was free text, which silently invited server-rejected values), `acceleration_template` (moved in from its own top-level row; still tagged `data-conditional="vesting"`, hidden when the block's own vesting is "No vesting"), `early_exercise`, `auto_exercise_at_vest`, `is_flexible_issue_date`, `notes` (moved in from the shared section). Collapsed is presentation only: `collectBlocks()` reads every one of these fields regardless of the accordion's open/closed state. (`state_exemption`/`employee_id`/`cost_center`/`job_title`/`salary` were dropped from the panel entirely — design feedback.) |
| Advanced fields (certificate) | Same accordion pattern, in order: `acceleration_template` (moved in, same conditional-on-vesting behavior), `prefix_number`, `cash_paid`, `debt_canceled`, `notes` (moved in). (`convertible_note` was dropped from the panel entirely — design feedback. `returned_invested_capital` was dropped too — it's LLC-only and no MCP command can confirm LLC status.) |

`data-label` is required on vesting / acceleration / documents / share-class / legend buttons
(read for the submit payload). `data-body` is required on legend buttons (the
attestation box and your record of what the user attested to).

### Server-error banners

Two additive, display-only inputs support [carta-issuance SKILL.md's Phase
1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only) — neither is ever sent
to a mutate:

- **`row.row_key`** — stamped onto every block's `data-row-key` (`build_stakeholder_blocks()`
  assigns a positional `r<index>` fallback only when a row doesn't already carry its own).
  Read by `collectBlocks()` on every submit so the parent skill can re-match a resubmitted row
  to its previously-saved `draft_pk` across a validation-error retry — **never** array
  position, which desyncs the moment a block is added or removed mid-retry (an ordinary thing
  to do while fixing an error on an otherwise-still-open panel). `addStakeBlock()` stamps a
  fresh, non-colliding key (`'new-' + Date.now() + …`) on a clone — a clone is a new person,
  not an edit to the source block's already-saved row.
- **`row.server_errors`** — a list of already-translated, already-human-readable message
  strings for that specific stakeholder (e.g. *"Quantity: Not enough shares in the option
  plan"*). `build_stakeholder_block()` renders them as a `.block-error-banner` (`role="alert"`)
  between the block head and the kv-table when present and non-empty — absent or empty renders
  nothing (never an empty box). Messages are HTML-escaped but otherwise shown **verbatim** —
  the parent skill translates payload keys before ever writing to this field (Voice &
  defaults), this script never reinterprets a server message.
- **`knowns.batch_errors`** — the panel-level counterpart, for corp-/batch-level errors not
  tied to any one stakeholder (missing signatory, a whole-issuance-level error). Renders as
  `.panel-error-banner` into `BATCH_ERRORS_HTML`, above the Grantees/Holders list.

### Stakeholder auto-populate

The Name field is a text input with a **custom** typeahead dropdown against the
full roster (`STAKEHOLDER_LIST_JSON`) — select an existing stakeholder or type a
new name. This is template.html's own JS (`renderSuggestions()` /
`selectSuggestion()`), not a native HTML `<datalist>`: a `<datalist>` was tried
first and dropped — its suggestion popover doesn't render reliably inside Claude
Desktop's embedded webview, which made the "Search…" placeholder a lie (nothing
ever appeared). The dropdown filters the roster by substring match as the user
types, caps at 8 results, and closes on blur/Escape/outside-click. **Focusing an empty Name
field also shows the first 8 roster entries** (`renderSuggestions()`'s empty-query branch) —
design feedback that clicking into a blank field showed nothing until the user typed a
character, even when a roster clearly existed to pick from.

On an exact (case-insensitive) match — whether typed or picked from the dropdown
— the block's Email, Stakeholder type, and Relationship fields auto-populate from
the roster record. **Fields stay editable, never locked** — a prior version
locked them (read-only / disabled) on the theory that an edit would be "ignored
server-side," but that read as broken UI with no offsetting data-safety benefit:
Phase 1 always uses the real cap-table record for an existing stakeholder
regardless of what this panel shows, so locking the field doesn't protect
anything the field's own value could threaten — it just looks like a bug. This
mirrors the real Carta product's typeahead behavior in the drafts-v2 spreadsheet
and simple-issuance forms.

## Payload delivered on submit

This is the **Code adapter's** JSON action-request (machine-to-machine) — see
[artifact-flow §3](../references/artifact-flow.md#3-wake-on-submit). On the Cowork path the
parent skill collects the same fields via a `show_widget` form, which returns the **same
`rows` shape** through `sendPrompt()` — see
[cowork-adapter.md §1](../references/cowork-adapter.md#1-collectconfig--the-show_widget-form).

The payload carries `action` (`"config_submit"` for **Review**, `"save_only"` for **Save** —
identical `rows` shape either way; only `action` tells the parent skill which Phase 1.5
branch to run), `security_type`, and `rows` — **every field lives inside each row now**,
since each stakeholder's block is independently configured; there are no separate
batch-wide scalars alongside `rows` anymore. The parent skill takes `rows` as its working
set and looks each `name` up on the cap table; it does **not** re-ask for
quantity/stakeholder/terms in chat.

Every row also carries `row_key` (each block's stable identity — see [Server-error
banners](#server-error-banners)), `notes`, and `acceleration_template` (`null` when "No
acceleration" is selected) regardless of type — omitted from the examples below for
brevity, same as the other empty-string-default optional fields. **Grant** rows additionally carry `custom_label`,
`early_exercise`, `auto_exercise_at_vest`, `is_flexible_issue_date`,
`grant_reason` (all from the "More fields" accordion — `grant_reason` is a picklist value, not
free text), plus `is_hmrc_notified`/`hmrc_notified`
(only present when `option_type` is `EMI`) and `is_ato_notified` (only present when
`option_type` is one of the AU types) — the template's `collectBlocks()` omits those two keys
entirely for any other `so_type`, mirroring the panel `data-conditional` visibility, rather
than sending a stale value for a type that can't carry it. **Certificate** rows additionally
carry `vesting_template_id`/`vesting_start_date` (same shape as grants, `null` when "No
vesting"), `prefix_number`, `cash_paid`, `debt_canceled` (accordion fields).

**Option grant** (two rows shown with genuinely different terms — the second demonstrates a
block that diverged from the first via per-row edits or a copy-forward-then-changed value):

```json
{
  "action": "config_submit",
  "security_type": "option_grant",
  "corp_id": "2776",
  "rows": [
    {"name": "Jane Doe", "email": "", "quantity": "1000", "relationship": "Employee",
     "stakeholder_kind": "INDIVIDUAL", "issue_date": "2026-06-11",
     "board_approval": "approved_other", "board_approval_date": "2026-06-11",
     "option_type": "ISO", "exercise_price": "1.45",
     "vesting_template_id": "94", "vesting_label": "4yr / 1yr cliff",
     "vesting_start_date": "2026-06-11",
     "document_set_id": "12", "document_set_label": "Standard option grant docs"},
    {"name": "John Smith", "email": "", "quantity": "250", "relationship": "Consultant",
     "stakeholder_kind": "INDIVIDUAL", "issue_date": "2026-06-11",
     "board_approval": "approved_other", "board_approval_date": "2026-06-11",
     "option_type": "NSO", "exercise_price": "2.00",
     "vesting_template_id": null, "vesting_label": "No vesting",
     "vesting_start_date": null,
     "document_set_id": "12", "document_set_label": "Standard option grant docs"}
  ]
}
```

- `option_type` is that row's selected `so_type`. `exercise_price` is a bare number; the parent skill hard-sets `0` for ZEPO regardless.
- `vesting_template_id` / `vesting_start_date` are `null` when **No vesting** is selected on that row (`vesting_label` is then `"No vesting"`).
- `stakeholder_kind` (`INDIVIDUAL` | `NON-INDIVIDUAL`) is the row's Stakeholder-type toggle — auto-populated (but still editable) when the name matched an existing roster record; the parent skill only trusts it for a genuinely new stakeholder (an existing record's `kind` always wins regardless of what this toggle shows).

**Certificate:**

```json
{
  "action": "config_submit",
  "security_type": "certificate",
  "corp_id": "2776",
  "rows": [
    {"name": "Jane Doe", "email": "", "quantity": "500", "relationship": "Employee",
     "stakeholder_kind": "INDIVIDUAL", "issue_date": "2026-06-11",
     "board_approval": "approved_other", "board_approval_date": "2026-06-11",
     "share_class_prefix": "CS", "share_class_label": "Common",
     "price_per_share": "1.50",
     "legend_id": "7", "legend_label": "Standard restrictive legend",
     "rule_144_mode": "issue_date", "rule_144_date": null, "rule_144_reason": null}
  ]
}
```

- `share_class_prefix` is that row's selected class prefix (`share_class_label` its display name) — different rows can carry different classes.
- `board_approval` is `approved_other` (the panel doesn't distinguish "today" from "another date" — both are just a board-approval date; only `pending` is a distinct state) or `pending` (option-grant only — hidden for certificates, which always require a board approval date); `board_approval_date` is the chosen date, omitted when `pending`.
- `rule_144_mode` is `issue_date` (the default — `rule_144_date` and `rule_144_reason` are both `null`, and the parent skill stamps the issue date as the Rule 144 date) or `other` (`rule_144_date` carries the chosen `YYYY-MM-DD`; `rule_144_reason` carries the enum value picked from the panel's own reason `<select>` — the parent reformats the date to `MM/DD/YYYY` and stamps `rule_144_reason` as `rule_144_difference_reason`, no separate collection step needed).
- `relationship` in a row is the value the user selected in that block — the full
  `issue_date_relationship` picklist ([payload-reference.md](../references/payload-reference.md#picklists)),
  **always required** for a new stakeholder (the panel's Review button won't enable until it's
  set — the template's `missingFields()` checks it). It can still arrive as `""` for a
  **roster-matched** row whose own record has no relationship on file — `missingFields()`
  detects a roster match by re-running the same name lookup `onStakeNameInput()` uses (fields
  are never locked/disabled — [Stakeholder auto-populate](#stakeholder-auto-populate), above —
  so this can't be read off a field's disabled state), so an empty value there reflects the
  existing record, not a skipped required field. The parent
  skill stamps `relationship` as `issue_date_relationship` only for new stakeholders not found
  on the cap table; an empty-string row still falls through to the roster lookup, then
  `AskUserQuestion` as before.

### Back-to-edit round-trip

When the review panel's **Back to edit** returns the user here, the parent skill
reconstructs `knowns.rows` from `$OUT_DIR/_review_rows.json` (the Phase-1-resolved rows,
written before the review rendered) rather than re-deriving defaults — see [carta-issuance
code-adapter.md's Back to edit](../references/code-adapter.md#back-to-edit). Every per-row key in the payload above
has a same-named or documented-mapping counterpart in a resolved row, so this is a
mechanical 1:1 copy, not a re-resolution.

## Iterating on the UI

For design changes to the config panel (colors, spacing, layout, copy), you only
touch three files — no Carta MCP and no full skill run:

| File | What lives here |
|---|---|
| `references/styles.css` | All panel styling (Ink tokens, toggles, inputs, legend box) |
| `references/template.html` | Structure + the inline behavior JS |
| `scripts/build_config.py` | The dynamic blocks (buttons, grantee rows, roster) |

**Preview loop** — edit a file, then:

```bash
uv run scripts/preview_config.py --open              # renders both types, opens in browser
uv run scripts/preview_config.py --security-type certificate --open
```

It reproduces what `render-panel` does at runtime (runs `build_config.py` on the
committed sample fixtures, inlines `styles.css`, substitutes every `{{TOKEN}}`) and
writes `preview_config_<type>.html`. The **Review** and **Save** buttons are both inert
in preview (they POST to a dead port), so you can click through the form freely. Edit the
inline `SAMPLE_*` fixtures in `preview_config.py` to preview a different shape (more rows, a
longer legend, a UK jurisdiction, sample `server_errors`/`batch_errors`, etc.).
