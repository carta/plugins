# Code adapter — the side-panel surface

Everything the Code adapter does differently, and the build recipes behind its `collectConfig`
(config panel) and `showReview` (review panel) capabilities. Selected by [Pick the
surface](../SKILL.md#pick-the-surface) when a tool whose name
**ends in** `preview_start` is present — bare or prefixed, e.g.
`mcp__Claude_Browser__preview_start`. Read this file — start at §0, and **before Phase 0.25 or
Phase 0.5 issues its first Carta call**, because two §0 rows change that call — only when that
adapter is selected. On the Cowork path skip §0 and §2, but §1's `knowns` table is the shared
contract both surfaces build from: read it when you need a key's meaning, whichever adapter you
are on.

Every bare `preview_start` / `preview_list` / `preview_eval` below means the resolved name the
tool list carries, prefix included — or `javascript_tool` as the eval fallback.

[engine.md](engine.md) documents the engine in its Cowork form, since that is ~95% of usage.
§0 below lists every point where this adapter diverges from it. Everything §0 does not mention
is shared and behaves exactly as the core describes.

The **generic** render-panel mechanics (rendering the side panel, waking on submit, the
one-confirmation rule, panel lifecycle gotchas) are a separate concern — see
[artifact-flow.md](artifact-flow.md), which this file assumes as background.

---

## 0. Phase overrides — what differs from the core

| Core step | Cowork does | You do instead |
|---|---|---|
| **Phase 0.25** — import markers | render `import_notes` in the form yourself, and blank any noted field | **nothing extra** — `build_config.py` renders the amber markers and blanks noted fields (so `missingFields()` holds **Review**, which reports the blocker on click) straight from `row.import_notes` |
| **Phase 0.5** — reference data | `issuance_init` with `stakeholder_names`, resolved server-side into its `stakeholders` section | `issuance_init` with **`include_bootstrap: true`** and **`issue_date`**, **plus** one `cap_table:get:stakeholders` for the full roster the panel's autocomplete needs — both issued in one turn, both written to files and passed by path ([§1](#1-config-panel-build_configpy-builds-every-block)). The roster becomes `STAKEHOLDER_LIST_JSON`, and is paged: [§1 Roster fetch](#roster-fetch--page-until-you-have-everyone) |
| **Phase 0.5** — blockers | none; the core's own gates are all there is | `include_bootstrap` computes `blockers` server-side and they are binding — a `hard_stop` means **no surface** ([§1 Blockers](#blockers--what-the-server-worked-out-so-you-dont-have-to)) |
| **Phase 0.5** — `collectConfig` | one `show_widget` form | the config panel — [§1](#1-config-panel-build_configpy-builds-every-block) |
| **Phase 0.5** — cache hygiene | nothing to clear; the state is your context | `rm -f "$OUT_DIR/_draft_state.json"` **before building** ([§1](#1-config-panel-build_configpy-builds-every-block)). `OUT_DIR` is keyed only by `corporation_id` and persists, so a file left by an unrelated session on this corp reuses the same `r0`/`r1` keys and threads a stranger's `draft_pk` onto these rows |
| **Phase 0.5** — on submit | read the form's `sendPrompt()` JSON | `cat "$OUT_DIR/<CORP_ID>_action_request.json"` — same shape, same [row mapping](row-mapping.md) |
| **Phase 1** — match set | the `issuance_init` payload's `stakeholders` section | `STAKEHOLDER_LIST_JSON`, the full roster. The invariant is unchanged: stakeholder calls are bounded by roster **misses**, never by row count. A miss still resolves via `names=`, never a multi-name `search=` |
| **Shared resolution helpers** | `AskUserQuestion` per unresolved field | **they don't run.** The panel collects legend, vesting, acceleration, and document set as fields inside each block, so the row already carries the resolved id/label out of `config_submit`. Board approval and dividend-accrual are the exceptions noted in the core |
| **Phase 2** — `showReview` | chat markdown per [chat-review.md](chat-review.md) | the review panel — [§2](#2-review-panel-build_reviewpy-builds-the-recap). It renders a deliberately **shorter** recap ([issuance-review/SKILL.md](../issuance-review/SKILL.md#block-detail_table)); skip `chat-review.md` entirely |
| **Phase 2** — `confirm` | one `AskUserQuestion` | the panel's **Confirm & Issue** button. **Never stack an `AskUserQuestion` on an open panel** — it suspends the submit watcher, so the click never lands ([artifact-flow §4](artifact-flow.md#4-the-one-confirmation-rule)) |
| **Phase 3** — branch | on the `AskUserQuestion` answer | on the action in the request file: `"submit"` → issue · `"back_to_edit"` → [Back to edit](#back-to-edit) · typed "cancel" → stop |
| **Save as draft** | offered in the Phase 2 confirm | the review panel has **no Save button** — Phase 1.5's **Save** already covers it, since it saved before this surface ever rendered |

**Recovery `AskUserQuestion`s after a server short-circuit are fine** — no watcher is running
at that point. The restriction applies only while a panel is open and awaiting a click.

**The [account-setup gate](engine.md#account-setup-gate-option-grant-and-piu) is not a
divergence** — worth stating because it is the one stop that precedes panel work. It runs on
this path exactly as the core describes, so an option-grant corporation with zero document sets
stops in Phase 0.5 and the config panel never renders.

**The config panel stays open** after submit — it can't reliably close itself
([artifact-flow §5](artifact-flow.md#5-panel-lifecycle-gotchas)). Proceed to Phase 1 anyway.

### Back to edit

The user clicked **Back to edit**. No confirmation modal is needed: the review is read-only,
so there is nothing further to confirm before returning to edit. The rows were already saved
by [Phase 1.5](engine.md#phase-15--save--validate-before-review-or-save-only), but that is
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
You never hand-author panel HTML. Two MCP reads give you everything; you write their results
into `OUT_DIR` as three files, run `build_config.py` (it emits the toggle groups **and** the grantee rows with
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
| `rows` | one entry per person named, `{name, email?, quantity?, relationship?, stakeholder_kind?, notes?}` plus that person's own optional per-row terms — grant: `option_type?, exercise_price?, vesting_template_id?, vesting_start_date?, acceleration_template?, board_approval?, board_approval_date?, issue_date?, document_set_id?, is_hmrc_notified?, hmrc_notified?, is_ato_notified?, custom_label?, early_exercise?, auto_exercise_at_vest?, is_flexible_issue_date?, grant_reason?`; cert: `share_class_prefix?, price_per_share?, legend_id?, rule_144_mode?, rule_144_date?, rule_144_reason?, board_approval_date?, issue_date?, vesting_template_id?, vesting_start_date?, acceleration_template?, prefix_number?, cash_paid?, debt_canceled?` (*"1,000 ISOs to Jane"* → `[{"name":"Jane","quantity":"1000"}]`); no names, bare "N \<securities\>" (*"100 option grants"*, *"100 certificates"*) → **quantity**, not headcount → `[{"quantity":"100"}]` (one entry, [engine rule 5](engine.md#engine-hard-rules)); no names, "N \<people-noun\>" (*"100 employees"*) → **headcount** → N empty dicts (`[{}, {}, …]`, length N); no names and no number at all → `[]` → one blank block |
| `today_iso` | `YYYY-MM-DD` — stamped as the default issue/board/vesting-start date on every block that doesn't override it |
| `currency` | e.g. `"USD"` — informational only (the exercise-price/price-per-share hint text); the real payload `currency` comes from the per-`so_type` autofill, not this |
| `jurisdiction` | `"US"`/`"UK"`/`"AU"` for the option-type buttons. Grant only. **Derive it** ([engine.md Phase 0.5](engine.md#option-grant-resolve-the-fmv-and-the-jurisdiction-before-building-the-surface)) — the `"US"` default shows a UK company ISO/NSO instead of EMI/CSOP |
| `fmv_options` | `issuance_init`'s `international_valuations.active` rows, as-is — keep `share_class_type` and `share_class_name` alongside `price`, `currency`, `valuation_type`, `effective_date`. Drives both the hint and the prefill. Grant only. The script first narrows to the plan's common share class (an option never prices off a preferred FMV), then **exactly one surviving row prefills the field; two or more leaves it empty** so the admin picks between an HMRC report's AMV and UMV rather than the skill guessing |
| `fmv_source` | those rows' shared `support_reference_type` — `409A` / `EMI` / `CSOP` / `SHARE_PRICE` (the `*_VALUATION_REPORT` wire forms are accepted too). Names the source in the hint. Grant only |
| `fmv_expired_on` | the lapsed `expiration_date`, set **only** when `active` is empty but `history` isn't — the hint then says when cover ended instead of just "none on file". Grant only |
| `common_share_class_name` | the chosen option plan's `common_share_class_name`. The fallback the script matches on when a valuation row omits `share_class_type`. Grant only |
| `exercise_price_default` | fallback prefill as a bare number, used when `fmv_options` doesn't resolve one. Grant only |
| `has_409a` | **Deprecated** — the pre-international shape, honoured with `exercise_price_default` for one release so a panel rebuilt mid-conversation still renders a price. Use `fmv_options`/`fmv_source` instead |
| `no_vesting` | `true` **only** when the user explicitly said no vesting (fallback default; a row's own `vesting_template_id: "__none__"` overrides per-row). Grant only; omit otherwise |
| `default_vesting_id` | vesting template id to pre-select when you can identify the corp's 4yr/1yr-cliff schedule; omit to let the script pick. Both types — for a certificate batch, setting this also opts every row into vesting by default (certs otherwise default to **No vesting**, being opt-in) |
| `price_per_share_default` | default price per share as a bare number, or omit to leave blank. Cert only |
| `share_class_prefix` | prefix to pre-select when the prompt named a class (*"Series A"* → `"PA"`). Cert and PIU. Omitting it selects the corp's only class when it has exactly one, and **nothing** when it has several — the control then renders required and unselected and the panel holds Review until a human picks, because ranking the classes hands the holder a class nobody chose ([certificate-fields.md](certificate-fields.md#share-class-reconciliation-certificate), [piu-fields.md](piu-fields.md#unit-class-reconciliation)) |
| `option_plan_id` | plan pk to pre-select when the prompt named one. **PIU only, and never a default** — omitting it selects "no plan", which issues off the unit class ([piu-fields.md](piu-fields.md#equity-plan-reconciliation--per-row-optional-prefix-matched)) |
| `threshold_noun` | the issuer's own word for the threshold, from `issuance_init`'s `draft_set_init.thresholdNoun` — `"threshold"` by default, `"hurdle"` on the UK growth-shares preset. PIU only |
| `is_llc` | `issuance_init`'s `draft_set_init.isLLC`, fetched on the PIU flow. Not available on the certificate flow, which has no `draft_set_init` section — omit it there |

**A row's `board_approval` takes exactly `"pending"` — lowercase, or nothing at all.** The
builder tests `row.get("board_approval") == "pending"`, so `"Pending"`, `"approved"`, `true`
and every other value fall through to **board-approved**, with no error and nothing on the
surface to show it: a grant meant to be pending records as approved. For approved, omit the
key and set `board_approval_date`; for pending, send the literal `"pending"` and omit the
date.

**0) Prepare `OUT_DIR`.**

```bash
OUT_DIR="$HOME/.carta/cache/issuance-config/<CORP_ID>"
mkdir -p "$OUT_DIR"
REFS="${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-config/references"
cp "$REFS/Inter-roman.var.woff2" "$OUT_DIR/" 2>/dev/null || true
cp "$REFS/SangBleuVersailles-Regular-WebS.ttf" "$OUT_DIR/" 2>/dev/null || true
# A FRESH batch inherits nothing: OUT_DIR is keyed only by corporation_id and
# persists, so a leftover _draft_state.json from an unrelated session on this
# corp would thread a stranger's draft_pk onto these rows under the same r0/r1
# key (save-validate-flow.md § Draft-state bookkeeping).
rm -f "$OUT_DIR/_draft_state.json"
```

**1) Both reads, in ONE turn.** `include_bootstrap: true` adds `blockers`, `blockers_summary`
and `knowns_seed` to the reference payload; `issue_date` is what lets the grant-expiration
check run at all ([Blockers](#blockers--what-the-server-worked-out-so-you-dont-have-to)). An
unparseable `issue_date` is refused, not ignored — send `YYYY-MM-DD` or omit the key.

```
mcp__carta__call_tool({"name": "cap_table__get__issuance_init", "arguments": {
  "corporation_id": <corporation_id>, "security_type": "<option_grant|certificate|piu>",
  "include_bootstrap": true, "issue_date": "<YYYY-MM-DD>"}})

mcp__carta__call_tool({"name": "cap_table__get__stakeholders", "arguments": {
  "corporation_id": <corporation_id>, "detail": "full", "page_size": 200, "page": 1}})
```

**2) Write the three files** — one heredoc, one pass. Both results exist only in your context,
so this is the one place you transcribe them; everything downstream reads the files.

```bash
uv run python - <<'PYEOF'
import json, pathlib
d = pathlib.Path("<OUT_DIR>")   # substitute the literal path; env vars don't cross Bash calls

init   = { }   # the issuance_init result, verbatim
roster = { }   # the stakeholders envelope, every page's `stakeholders` concatenated

# The builder reads `share_classes`; the response section is `certificate_share_classes`.
skip = ("certificate_share_classes", "blockers", "blockers_summary", "knowns_seed", "errors")
data = {k: v for k, v in init.items() if k not in skip}
if init.get("certificate_share_classes") is not None:
    data["share_classes"] = init["certificate_share_classes"]
(d / "_data.json").write_text(json.dumps(data))
(d / "_roster.json").write_text(json.dumps(roster))

seed = init["knowns_seed"]
# Copy what the seed already answers; a null never reaches `knowns` (is_llc and
# threshold_noun come back null on the flows that have no draft_set_init).
knowns = {k: seed[k] for k in ("today_iso", "currency", "fmv_options", "fmv_source",
                               "fmv_expired_on", "threshold_noun", "is_llc")
          if seed.get(k) is not None}
knowns.update({
    "jurisdiction": "UK",                             # YOUR decision — never seeded
    "common_share_class_name": "Ordinary",            # the chosen plan's
    "rows": [{"name": "Jane", "quantity": "1000"}],   # from the prompt
})
(d / "_knowns.json").write_text(json.dumps(knowns))
PYEOF

# 3) Build every stakeholder block in one run:
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-config/scripts/build_config.py" \
  --security-type <option_grant|certificate|piu> \
  --data "$OUT_DIR/_data.json" --knowns "$OUT_DIR/_knowns.json" \
  --stakeholders "$OUT_DIR/_roster.json" --out-dir "$OUT_DIR"
# → prints STAKEHOLDER_ROWS=… STAKEHOLDER_LIST_JSON=…

# 4) SUB_FLAGS — just the shared frame scalars + the two script-built blocks
#    (--substitute-file). Every per-type field (option type, vesting, exercise price,
#    documents, or share class, price, legend, Rule 144) lives INSIDE STAKEHOLDER_ROWS now
#    — there is no separate per-field substitution to assemble:
SUB_FLAGS=(--substitute "CORP_NAME=<value>" --substitute "CORP_ID=<value>")
SUB_FLAGS+=(--substitute "SECURITY_TYPE=<option_grant|certificate|piu>")
SUB_FLAGS+=(--substitute "FLOW_TITLE=<Issue Option Grants|Issue Certificates|Issue Profits Interest Units>")
SUB_FLAGS+=(--substitute "HEADER_SUB=<N grantees|N holders|N holders>")
SUB_FLAGS+=(--substitute-file "STAKEHOLDER_ROWS=$OUT_DIR/_rows.html")
SUB_FLAGS+=(--substitute-file "STAKEHOLDER_LIST_JSON=$OUT_DIR/_stakeholders.json")
```

**The three files you write from the two results:**

| File | Holds | Goes to |
|---|---|---|
| `_data.json` | every reference section, `certificate_share_classes` renamed to the `share_classes` key the builder reads | `build_config.py --data` |
| `_roster.json` | the stakeholders envelope as returned — `{"stakeholders": [...], "count": N, "total": N}`, no reshaping, no field-picking, no pretty-printing; the script reads either a `stakeholders` or a `results` key, keeps the five fields it needs (`full_name`, `email`, `id`, `kind`, `event_relationship`) and ignores the rest | `build_config.py --stakeholders` |
| `_knowns.json` | the result's `knowns_seed` plus what only you know | `build_config.py --knowns` |

Write each one **once** and read nothing back: a file re-read into context is the 129-second
defect wearing a new hat. A `stakeholders` key inside `_data.json` still works as a fallback
for `--stakeholders`, and the same flag exists on `build_cowork_form.py`.

**`knowns_seed` already speaks the builder's vocabulary**, so its keys copy across unchanged:
`today_iso`, `issue_date`, `currency` / `currency_candidates`, `fmv_options`, `fmv_source`,
`fmv_expired_on`. The one thing it deliberately does not carry is `jurisdiction`: it gives you
`jurisdiction_evidence` instead, because that is a decision, not a value to copy.

### Blockers — what the server worked out so you don't have to

`include_bootstrap: true` adds `blockers` (a list of `{key, severity, message, evidence}`) and
`blockers_summary` (`{total, hard_stop, needs_decision, informational, keys}`) to the result.
Branch on `key`, never on the message text. What each severity obliges you to do is in
[engine.md § Blockers](engine.md#blockers--act-on-them-before-building-anything); the keys
are:

| Key | Severity | Means |
|---|---|---|
| `option_plan.none_selectable` | `hard_stop` | No plan this grant could issue from — every one expired, or none with shares available |
| `grant_expiration.before_issue_date` | `hard_stop` | The plan-derived expiry lands before the issue date, so the server rejects the grant |
| `grant_expiration.unchecked_no_issue_date` | `informational` | No `issue_date` was passed, so the check above could not run; carries each plan's derived expiry instead |
| `valuation.no_active_fmv` | `needs_decision` | No live valuation to price from |
| `valuation.multiple_active_same_class` | `needs_decision` | An HMRC report's AMV and UMV are both live — the admin picks, the panel leaves the field empty |
| `jurisdiction.unresolved_conflict` | `needs_decision` | Competing signals and **deliberately no verdict** |

**`jurisdiction.unresolved_conflict` is the one to be careful with.** `jurisdiction_evidence`
holds signals and no ranking on purpose: a ranked field is a default, a default gets taken,
and the wrong one sets real holders' tax treatment. Put the competing evidence to the admin
and use their answer as `knowns.jurisdiction`. **Do not run the precedence ladder in
[engine.md Phase 0.5](engine.md#option-grant-resolve-the-fmv-and-the-jurisdiction-before-building-the-surface)
over it** — that ladder is for a run with no blocker to consult, and re-deriving a verdict
here is the silent default this blocker exists to prevent.

### Roster fetch — page until you have everyone

**Code adapter only.** `page_size: 200` is the ceiling. A larger page is **refused outright,
not shortened**, so asking for 500 costs a round trip and returns nothing.

**The response's `total` is the corporation; `stakeholders` is the page.** Count the rows you
have gathered against `total` and fetch `page: 2`, `page: 3` … until they match, concatenating
each page's `stakeholders` before you write `_roster.json`. Stopping at the first page reads everyone past row
200 as a new person and issues them as **duplicate stakeholders on a live cap table**.

**If a roster is too large to page through**, take what came back and let Phase 1's per-miss
lookup cover the rest — never loop one `search` call per name. **Exception: if the prompt
named specific people and one of them has no case-insensitive match in what came back**, issue
one supplemental `search` covering just the missing name(s) before building the panel, and
merge the results into `STAKEHOLDER_LIST_JSON` — a roster that happens to cut off before the
very person the user typed defeats the panel's auto-populate (email/type/relationship) for
exactly the people it matters most for. This is still one extra call, not one per grantee.

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
# build_review.py wants two sections as their own files. Split them out of the
# _data.json §1 already wrote — never re-fetch and never retype. It unwraps the
# standard {count, results} envelope itself.
uv run python - <<'PYEOF'
import json, pathlib
d = pathlib.Path("<OUT_DIR>")
data = json.loads((d / "_data.json").read_text())
(d / "_vesting_templates.json").write_text(json.dumps(data.get("vesting_templates", [])))
(d / "_classes.json").write_text(json.dumps(data.get("share_classes", [])))
PYEOF
uv run "${CLAUDE_PLUGIN_ROOT}/skills/carta-issuance/issuance-review/scripts/build_review.py" \
  --security-type <option_grant|certificate|piu> \
  --rows "$OUT_DIR/_review_rows.json" \
  --share-classes "$OUT_DIR/_classes.json" \        # certificate only — resolves `prefix` to a display name
  --vesting-templates "$OUT_DIR/_vesting_templates.json" \  # option grant and PIU — resolves `vesting_template` id to a display name; never pass a label as this row's value
  --out-dir "$OUT_DIR"
# → prints DETAIL_TABLE=… KPI_STRIP=… PLAN_CARD=… ; pass each via --substitute-file.
# PLAN_CARD is "" for certificates — still pass it (artifact.yaml declares it optional
# with that same "" default, so an empty file is fine either way).
```

Then provide the shared scalars (`CORP_NAME`, `CORP_ID`, `ENV_HOST` — the host from
`get_current_user`'s `base_url`, without its scheme (`demo.carta.team`), never a hardcoded
`app.carta.com`, which would link a test issuance into production, `ISSUE_DATE` long-form, `DRAFT_SET_ID` (the real id
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
