# Code adapter — the side-panel surface

Everything the Code adapter does differently, and the build recipes behind its `collectConfig`
(config panel) and `showReview` (review panel) capabilities. Selected by [Phase 0 Step
1](../SKILL.md#step-1--detect-the-environment-from-the-tool-surface) when `preview_start` is
**present** in the tool surface. Read this file — start at §0 — only when that adapter is
selected; on the Cowork path it is dead weight.

[SKILL.md](../SKILL.md) documents the engine in its Cowork form, since that is ~95% of usage.
§0 below lists every point where this adapter diverges from it. Everything §0 does not mention
is shared and behaves exactly as the core describes.

The **generic** render-panel mechanics (rendering the side panel, waking on submit, the
one-confirmation rule, panel lifecycle gotchas) are a separate concern — see
[artifact-flow.md](artifact-flow.md), which this file assumes as background.

---

## 0. Phase overrides — what differs from the core

| Core step | Cowork does | You do instead |
|---|---|---|
| **Phase 0.5** — reference data | one targeted `search=` for the named people | **fetch the unfiltered full roster** (`detail=full`, no `search`). The panel's name autocomplete and email auto-fill genuinely need every row — it becomes `STAKEHOLDER_LIST_JSON`. Oversized rosters: [§1 Roster fetch](#roster-fetch-for-large-corporations) |
| **Phase 0.5** — `collectConfig` | one `show_widget` form | the config panel — [§1](#1-config-panel-build_configpy-builds-every-block) |
| **Phase 0.5** — on submit | read the form's `sendPrompt()` JSON | `cat "$OUT_DIR/<CORP_ID>_action_request.json"` — same shape, same [row mapping](row-mapping.md) |
| **Phase 1** — match set | the targeted `search` results | `STAKEHOLDER_LIST_JSON`, the full roster. The invariant is unchanged: stakeholder calls are bounded by roster **misses**, never by row count |
| **Shared resolution helpers** | `AskUserQuestion` per unresolved field | **they don't run.** The panel collects legend, vesting, acceleration, and document set as fields inside each block, so the row already carries the resolved id/label out of `config_submit`. Board approval and dividend-accrual are the exceptions noted in the core |
| **Phase 2** — `showReview` | chat markdown per [chat-review.md](chat-review.md) | the review panel — [§2](#2-review-panel-build_reviewpy-builds-the-recap). It renders a deliberately **shorter** recap ([issuance-review/SKILL.md](../issuance-review/SKILL.md#block-detail_table)); skip `chat-review.md` entirely |
| **Phase 2** — `confirm` | one `AskUserQuestion` | the panel's **Confirm & Issue** button. **Never stack an `AskUserQuestion` on an open panel** — it suspends the submit watcher, so the click never lands ([artifact-flow §4](artifact-flow.md#4-the-one-confirmation-rule)) |
| **Phase 3** — branch | on the `AskUserQuestion` answer | on the action in the request file: `"submit"` → issue · `"back_to_edit"` → [Back to edit](#back-to-edit) · typed "cancel" → stop |
| **Save as draft** | offered in the Phase 2 confirm | the review panel has **no Save button** — Phase 1.5's **Save** already covers it, since it saved before this surface ever rendered |

**Recovery `AskUserQuestion`s after a server short-circuit are fine** — no watcher is running
at that point. The restriction applies only while a panel is open and awaiting a click.

**The config panel stays open** after submit — it can't reliably close itself
([artifact-flow §5](artifact-flow.md#5-panel-lifecycle-gotchas)). Proceed to Phase 1 anyway.

### Back to edit

The user clicked **Back to edit**. No confirmation modal is needed: the review is read-only,
so there is nothing further to confirm before returning to edit. The rows were already saved
by [Phase 1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only), but that is
not a reason to warn — re-editing and saving again updates those same rows in place via
`draft_pk`; it does not create a second copy or lose anything.

Reconstruct `knowns.rows` from `$OUT_DIR/_review_rows.json` (the Phase-1-resolved rows) and
re-render the [§1 config panel](#1-config-panel-build_configpy-builds-every-block). Several
fields need a **derived** value rather than a straight copy — jurisdiction/currency
reverse-lookup, date reformatting, `needs_board_approval` → `board_approval`, `rule_144_date`
vs `issue_date` → `rule_144_mode` — and getting one wrong silently corrupts data on the
round-trip. Full field-by-field mapping: [back-to-edit.md](back-to-edit.md).

---

## 1. Config panel (`build_config.py` builds every block)

Render the config in the side panel — the Code adapter's `collectConfig`
(artifact-flow §1): its submit watcher fires the moment the user clicks, with no extra step.
You never hand-author panel HTML. Write the raw MCP results + a `knowns` object to
`OUT_DIR`, run `build_config.py` (it emits the toggle groups **and** the grantee rows with
the exact `class`/`data-*`/`onclick` the template's JS reads), then assemble `SUB_FLAGS`
and invoke render-panel per [artifact-flow §2](artifact-flow.md#2-render-the-side-panel).
The full substitution list is in the [issuance-config sub-skill](../issuance-config/SKILL.md).

`knowns` (omit any key the prompt didn't give — that's what makes the form context-aware).
Batch-level keys below are the **fallback default** every block uses when it doesn't carry
its own value — the common case (a fresh prompt that only named people) leaves every row
without per-row terms, so every block falls back to these, reproducing one shared default
across the batch. A per-row key (see `rows`) always wins over the batch-level fallback:

| `knowns` key | Value |
|---|---|
| `rows` | one entry per person named, `{name, email?, quantity?, relationship?, stakeholder_kind?, notes?}` plus that person's own optional per-row terms — grant: `option_type?, exercise_price?, vesting_template_id?, vesting_start_date?, acceleration_template?, board_approval?, board_approval_date?, issue_date?, document_set_id?, is_hmrc_notified?, hmrc_notified?, is_ato_notified?, custom_label?, early_exercise?, auto_exercise_at_vest?, is_flexible_issue_date?, grant_reason?`; cert: `share_class_prefix?, price_per_share?, legend_id?, rule_144_mode?, rule_144_date?, rule_144_reason?, board_approval_date?, issue_date?, vesting_template_id?, vesting_start_date?, acceleration_template?, prefix_number?, cash_paid?, debt_canceled?` (*"1,000 ISOs to Jane"* → `[{"name":"Jane","quantity":"1000"}]`); no names, bare "N \<securities\>" (*"100 option grants"*, *"100 certificates"*) → **quantity**, not headcount → `[{"quantity":"100"}]` (one entry, [Hard rule 10](../SKILL.md#hard-rules)); no names, "N \<people-noun\>" (*"100 employees"*) → **headcount** → N empty dicts (`[{}, {}, …]`, length N); no names and no number at all → `[]` → one blank block |
| `today_iso` | `YYYY-MM-DD` — stamped as the default issue/board/vesting-start date on every block that doesn't override it |
| `currency` | e.g. `"USD"` — informational only (the exercise-price/price-per-share hint text); the real payload `currency` comes from the per-`so_type` autofill, not this |
| `jurisdiction` | `"US"`/`"UK"`/`"AU"` for the option-type buttons. Grant only. **Derive it** ([SKILL.md Phase 0.5](../SKILL.md#option-grant-resolve-the-fmv-and-the-jurisdiction-before-building-the-surface)) — the `"US"` default shows a UK company ISO/NSO instead of EMI/CSOP |
| `fmv_options` | `issuance_init`'s `international_valuations.active` rows, as-is (`price`, `currency`, `valuation_type`, `effective_date`). Drives both the hint and the prefill. Grant only. **Exactly one row prefills the field; two or more leaves it empty** so the admin picks between an HMRC report's AMV and UMV rather than the skill guessing |
| `fmv_source` | those rows' shared `support_reference_type` — `409A` / `EMI` / `CSOP` / `SHARE_PRICE` (the `*_VALUATION_REPORT` wire forms are accepted too). Names the source in the hint. Grant only |
| `fmv_expired_on` | the lapsed `expiration_date`, set **only** when `active` is empty but `history` isn't — the hint then says when cover ended instead of just "none on file". Grant only |
| `exercise_price_default` | fallback prefill as a bare number, used when `fmv_options` doesn't resolve one. Grant only |
| `has_409a` | **Deprecated** — the pre-international shape, honoured with `exercise_price_default` for one release so a panel rebuilt mid-conversation still renders a price. Use `fmv_options`/`fmv_source` instead |
| `no_vesting` | `true` **only** when the user explicitly said no vesting (fallback default; a row's own `vesting_template_id: "__none__"` overrides per-row). Grant only; omit otherwise |
| `default_vesting_id` | vesting template id to pre-select when you can identify the corp's 4yr/1yr-cliff schedule; omit to let the script pick. Both types — for a certificate batch, setting this also opts every row into vesting by default (certs otherwise default to **No vesting**, being opt-in) |
| `price_per_share_default` | default price per share as a bare number, or omit to leave blank. Cert only |
| `share_class_prefix` | prefix to pre-select when the prompt named a class (*"Series A"* → `"PA"`). Cert only. Omit to let the script default to the most recently fetched class (see [certificate-fields.md § Share-class reconciliation](certificate-fields.md#share-class-reconciliation-certificate)) |
| `is_llc` | never resolved — no MCP command returns a corporation's `legal_entity_type`; always omit. Cert only |

```bash
OUT_DIR="$HOME/.carta/cache/issuance-config/<CORP_ID>"
mkdir -p "$OUT_DIR"
REFS="${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-config/references"
cp "$REFS/Inter-roman.var.woff2" "$OUT_DIR/" 2>/dev/null || true
cp "$REFS/SangBleuVersailles-Regular-WebS.ttf" "$OUT_DIR/" 2>/dev/null || true
# This is a FRESH batch (a new user request, not a Phase 1.5 error-retry
# re-render of an in-progress one) — discard any _draft_state.json already
# sitting here. OUT_DIR is keyed only by corporation_id and persists
# indefinitely, so a leftover from an unrelated earlier session on this same
# corp would otherwise get misread as this batch's own state (see
# save-validate-flow.md's Draft-state bookkeeping).
rm -f "$OUT_DIR/_draft_state.json"

# 1) Reference sections from the `issuance_init` payload (script unwraps the envelopes).
#    Each section is the same shape as its standalone command. Note the key rename:
#    build_config expects `share_classes`, init returns `certificate_share_classes`.
#    Include the roster (`stakeholders`) for BOTH types — it drives autocomplete and
#    Phase 1 matching (a separate fetch, not part of issuance_init).
#    Option grant:
cat > "$OUT_DIR/_data.json" <<'JSON'
{"vesting_templates": <init.vesting_templates>, "acceleration_templates": <init.acceleration_templates>,
 "document_sets": <init.document_sets>, "stakeholders": <raw roster result>}
JSON
#    …OR certificate: {"share_classes": <init.certificate_share_classes>, "legends": <init.legends>,
#     "vesting_templates": <init.vesting_templates>, "acceleration_templates": <init.acceleration_templates>,
#     "stakeholders": <raw roster result>}

# 2) What the prompt supplied (today_iso/currency are the batch-level fallbacks every block
#    uses unless it carries its own value). fmv_options/fmv_source come from issuance_init's
#    international_valuations.active; jurisdiction and currency are derived alongside them
#    (SKILL.md Phase 0.5) — both grant-only:
cat > "$OUT_DIR/_knowns.json" <<'JSON'
{"jurisdiction":"UK","today_iso":"2026-06-11","currency":"GBP","fmv_source":"EMI",
 "fmv_options":[{"valuation_type":"AMV","price":"0.50","currency":"GBP","effective_date":"2026-01-15"}],
 "rows":[{"name":"Jane","quantity":"1000"}]}
JSON

# 3) Build every stakeholder block in one run:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-config/scripts/build_config.py" \
  --security-type <option_grant|certificate> \
  --data "$OUT_DIR/_data.json" --knowns "$OUT_DIR/_knowns.json" --out-dir "$OUT_DIR"
# → prints STAKEHOLDER_ROWS=… STAKEHOLDER_LIST_JSON=…

# 4) SUB_FLAGS — just the shared frame scalars + the two script-built blocks
#    (--substitute-file). Every per-type field (option type, vesting, exercise price,
#    documents, or share class, price, legend, Rule 144) lives INSIDE STAKEHOLDER_ROWS now
#    — there is no separate per-field substitution to assemble:
SUB_FLAGS=(--substitute "CORP_NAME=<value>" --substitute "CORP_ID=<value>")
SUB_FLAGS+=(--substitute "SECURITY_TYPE=<option_grant|certificate>")
SUB_FLAGS+=(--substitute "FLOW_TITLE=<Issue Option Grants|Issue Certificates>")
SUB_FLAGS+=(--substitute "HEADER_SUB=<N grantees|N holders>")
SUB_FLAGS+=(--substitute-file "STAKEHOLDER_ROWS=$OUT_DIR/_rows.html")
SUB_FLAGS+=(--substitute-file "STAKEHOLDER_LIST_JSON=$OUT_DIR/_stakeholders.json")
```

Then invoke `artifact-manager:render-panel` (ARTIFACT_YAML = `issuance-config/references/artifact.yaml`,
ARTIFACT_FILENAME = `<CORP_ID>_config.html`). Tell the user one line and **wait** — no
`AskUserQuestion` (artifact-flow §4). Include the panel's own URL as a fallback (render-panel's
Step 6 returns it) in case the side panel doesn't visibly appear:

> Configure the issuance in the side panel and click **Review** when ready. If the panel doesn't
> appear, open http://localhost:\<port\>/\<file\>.html directly.

### Roster fetch for large corporations

**Code adapter only:** if the roster is too large to return in one call, fetch what the call
returns and let Phase 1's per-miss lookup cover the rest — never loop one `search` call per
name. **Exception: if the prompt named specific people and one of them has no
case-insensitive match in what came back**, issue one supplemental `search` covering just
the missing name(s) before building the panel, and merge the results into
`STAKEHOLDER_LIST_JSON` — a roster page that happens to cut off before the very person the
user typed defeats the panel's auto-populate (email/type/relationship) for exactly the
people it matters most for. This is still one extra call, not one per grantee.

---

## 2. Review panel (`build_review.py` builds the recap)

Render the review in the side panel — the Code adapter's `showReview`
(artifact-flow §1): its submit watcher fires the moment the user clicks, with no extra step.
The panel is **read-only** — every field was already decided per-stakeholder in the config
panel, so this surface is a confirmation, not another editing pass. The panel is
parameterized by `security_type`. **Build the per-type HTML blocks (`DETAIL_TABLE`,
`KPI_STRIP`, `PLAN_CARD`) by running `issuance-review/scripts/build_review.py` on the
resolved rows — never hand-author them** (same discipline as `build_config.py`; see the
[issuance-review sub-skill](../issuance-review/SKILL.md)):

```bash
# Write the resolved rows (post Phase 1) as a JSON array, then build the blocks.
cat > "$OUT_DIR/_review_rows.json" <<'JSON'
[ { ...resolved row... }, … ]
JSON
# Write the RAW fetched share-classes/vesting-templates result verbatim — build_review.py
# unwraps the standard {count, results} envelope itself (same as build_config.py). Always
# (re)write these two files fresh from THIS turn's fetch, even if a same-named file already
# exists in $OUT_DIR from a prior run — OUT_DIR is keyed only by corporation_id, so it
# persists across unrelated sessions on the same corp. Never hand-flatten the envelope into
# a differently-named ad hoc file first and reuse whatever's already sitting there "because
# it looks right" — that was a real incident (a leftover `_vesting_templates_arr.json` from
# an earlier, unrelated run got reused instead of regenerated).
cat > "$OUT_DIR/_classes.json" <<'JSON'      # certificate only — raw fetched share-class result
<raw cap_table:get:certificate_share_classes result>
JSON
cat > "$OUT_DIR/_vesting_templates.json" <<'JSON'  # option grant only — raw fetched vesting-templates result
<raw cap_table:get:vesting_templates result>
JSON
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-review/scripts/build_review.py" \
  --security-type <option_grant|certificate> \
  --rows "$OUT_DIR/_review_rows.json" \
  --share-classes "$OUT_DIR/_classes.json" \        # certificate only — resolves `prefix` to a display name
  --vesting-templates "$OUT_DIR/_vesting_templates.json" \  # option grant only — resolves `vesting_template` id to a display name; never pass a label as this row's value
  --out-dir "$OUT_DIR"
# → prints DETAIL_TABLE=… KPI_STRIP=… PLAN_CARD=… ; pass each via --substitute-file.
# PLAN_CARD is "" for certificates — still pass it (artifact.yaml declares it optional
# with that same "" default, so an empty file is fine either way).
```

Then provide the shared scalars (`CORP_NAME`, `CORP_ID`, `ENV_HOST` hardcoded to
`app.carta.com` (no MCP command resolves an environment-specific host — a deliberate,
accepted tradeoff), `ISSUE_DATE` long-form, `DRAFT_SET_ID` (the real id
[save-validate-flow.md](save-validate-flow.md) just returned — never the
literal `"new"`; save-validate-flow always runs first, so there's always a real id by now),
`FLOW_TITLE`, `SUBHEADING`, `DETAIL_TITLE`, `DETAIL_INTRO`, `VIEW_URL_PATH`,
`SECURITY_NOUN_PLURAL`, `ISSUE_MODAL_DISCLAIMER`) as inline `--substitute` scalars. Every
value comes from Phase 1 — nothing is hardcoded. Pass the three script-built blocks (above)
via `--substitute-file`, then invoke render-panel per [artifact-flow
§2](artifact-flow.md#2-render-the-side-panel) (ARTIFACT_YAML =
`issuance-review/references/artifact.yaml`, ARTIFACT_FILENAME = `<CORP_ID>_review.html`).
Then:

> The issuance review is open in the side panel — already saved as draft set
> #\<draft_set_id\>. Review the summary and click **Confirm & Issue** when ready — or
> **Back to edit** to change anything, or type "cancel" to abort. If the panel doesn't appear,
> open http://localhost:\<port\>/\<file\>.html directly.
