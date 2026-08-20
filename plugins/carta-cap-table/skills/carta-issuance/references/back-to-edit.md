# Back to edit — reconstructing the config panel

Referenced from [code-adapter.md § Back to edit](code-adapter.md#back-to-edit). The user clicked
**Back to edit** — no confirmation modal, since the review is read-only with nothing
further to confirm before returning to edit (the rows were already saved by [Phase
1.5](../SKILL.md#phase-15--save--validate-before-review-or-save-only)'s earlier
save+validate step, but re-editing and saving again just updates those same rows in place,
it doesn't create a second copy or lose anything). Re-open the config panel with every
stakeholder block's **field values** restored as they left them: read
`$OUT_DIR/_review_rows.json` (written before Phase 2 rendered) and map each resolved row back
onto a `knowns.rows` entry — the inverse of [On submit — read each row's own
fields](row-mapping.md). Reconstruct every key **from the
resolved row's actual fields** (per [Row templates](../SKILL.md#row-templates)) — several need
a derived value, not a straight copy, and getting this wrong silently corrupts data on the
round-trip:

**This same mapping is also reused by [Phase 1.5's validation-error
retry](save-validate-flow.md#re-render-the-config-panel-with-server-errors)** — same resolved-row →
`knowns.rows` derivation, whether triggered by a "Back to edit" click or a Review-time
validation failure. They differ only in (a) source rows (all Phase-2-confirmed rows here vs.
this turn's freshly-resolved rows there) and (b) the re-render mechanism: **cross-tab
navigation here** (Back to edit fires from the *Review* tab, which must be retargeted to
config — see the tab-navigation steps below), vs. **a plain same-tab re-open there** (the
validation retry fires from the *config* tab itself — no tab-hunting needed). Do not extend
the tab-navigation machinery below to the Phase 1.5 case; it solves a problem that doesn't
exist there.

**Reconstruct the batch-level `knowns.jurisdiction` and `knowns.currency` first, before
mapping rows.** `build_config.py` defaults a missing `jurisdiction` to `"US"`, which would
silently drop ZEPO/EMI/CSOP/Unapproved/Startup Concessions/Non-Concessional from the
reconstructed option-type buttons and mis-default the selection to NSO on any UK/AU batch.
Reverse-lookup which bucket contains any resolved row's `so_type` (US: `ISO`/`NSO`/`INTL`; UK:
`EMI`/`CSOP`/`Unapproved`; AU: `Startup Concessions`/`Non-Concessional`/`ZEPO`) and set
`knowns.jurisdiction` once for the whole batch — every row in one draft set shares a
jurisdiction. Also set `knowns.currency` (from any resolved row's `currency`) and, for
grants, `knowns.fmv_options` / `knowns.fmv_source` (from the original `issuance_init` fetch's
`international_valuations.active`) — these are cosmetic only (they feed the
exercise-price/price-per-share hint text, not the submitted payload), but worth carrying
across so the hint doesn't render blank or name the wrong valuation source. Carrying
`fmv_options` also preserves the AMV/UMV picker: drop it and a two-valuation batch silently
loses the prompt to choose.

**Certificates: leave `knowns.is_llc` out of the reconstructed panel.** It's never resolved,
so there's nothing to carry across or re-derive from the resolved rows.

**Reformat `MM/DD/YYYY` CharFields back to `YYYY-MM-DD` before writing them into
`knowns.rows`.** `vesting_start_date` and `rule_144_date` are `MM/DD/YYYY` on a resolved row
(Row templates) but the config panel's date inputs are HTML `<input type="date">`, which
silently renders **blank** on anything other than `YYYY-MM-DD` — carrying either value across
verbatim looks like it worked (no error) but produces an empty date field.

**Both types:** `name`, `email`, `quantity`, `stakeholder_kind`, `issue_date_relationship`→
`relationship`, `issue_date`. Don't skip `name`/`email`/`quantity` because they look like a
1:1 copy with nothing to derive — they're still required keys on the reconstructed
`knowns.rows` entry; omitting them re-opens every block with a blank name, email, and
quantity (`build_config.py` has no fallback for a row missing these — it renders empty
inputs, not an error). **Also carry across `notes`** (straight copy; omit the key entirely
if the resolved row has no `notes`) — it lives in the "More fields" accordion on both flows,
so it's easy to forget it's still a required-to-reconstruct field like any other.

**Option grant:** `so_type`→`option_type`; `exercise_price`; `vesting_template`→
`vesting_template_id` (`null`→`"__none__"`); `vesting_start_date`→same (reformat to
`YYYY-MM-DD`); `document_set_id`→same. **`needs_board_approval`→`board_approval`: `true`→
`"pending"`, `false`→`"approved_other"`** — never copy `board_approval_date` alone. A pending
resolved row has no `board_approval_date` key at all (Row templates: "omit from the row
entirely"); without this derived `board_approval` value the reconstructed block silently
unchecks **Pending** and stamps today's date. `board_approval_date` (omit when pending).
**Also carry across, straight copy (all live in the "More fields" accordion, all optional —
omit the key when the resolved row doesn't have it): `custom_label`, `grant_reason`,
`acceleration_template` (meaningful only once `vesting_template_id` is set — still carry it
even though it's cosmetic-looking, or a row that had picked a non-default acceleration
schedule silently reverts to none), `early_exercise`, `auto_exercise_at_vest`,
`is_flexible_issue_date`. **EMI-only:** `is_hmrc_notified`, `hmrc_notified` — only carry these
when the reconstructed row's `option_type` is `"EMI"`; a row that's since moved to a
different so_type via reconstruction should not carry a stale HMRC value across (mirrors
`build_config.py`'s own so_type-scoped clearing). **AU-types-only** (`Startup Concessions`/
`Non-Concessional`/`ZEPO`): `is_ato_notified`, same rule. **`Unapproved`-only:**
`employment_related`, same rule — and carry `false` across as faithfully as `true`, since
dropping an explicit "No" back to unanswered re-breaks the validation the answer cleared.

**Certificate:** `prefix`→`share_class_prefix`; `law_firm_price`→`price_per_share`;
`legend_id`→same; `board_approval_date`. **Compare `rule_144_date` to `issue_date`
(normalize formats first — `rule_144_date` is `MM/DD/YYYY`, `issue_date` is often
`YYYY-MM-DD`) to derive `rule_144_mode`: equal → `"issue_date"` (omit `rule_144_date`);
different → `"other"` with `rule_144_date` carried across, reformatted to `YYYY-MM-DD`, and
`rule_144_difference_reason`→`rule_144_reason` carried across too** — a resolved row's
`rule_144_date` is always populated whether or not the user picked a different one, so
defaulting `rule_144_mode` to `"issue_date"` without this comparison silently discards the
user's "different date" choice (and its reason) on Back to edit. Omit `rule_144_reason`
entirely when `rule_144_mode` is `"issue_date"` — a row that never diverged from the issue
date carries no reason to carry across. **Certificates also carry vesting and the accordion's
amount fields now (new this round — don't assume vesting is grant-only):** `vesting_template`→
`vesting_template_id` (`null`/omitted→`"__none__"`, same rule as option grant above);
`vesting_start_date`→same (reformat to `YYYY-MM-DD`, only when `vesting_template_id` isn't
`"__none__"`); `acceleration_template` (same carry-across rule as option grant); and, straight
copy, optional, omit the key when absent: `prefix_number`, `cash_paid`, `debt_canceled`.

**Attaching server errors (Phase 1.5 only).** When this same reconstruction is used for a
[validation-error retry](../SKILL.md#phase-15--save--validate-before-review-or-save-only)
rather than a "Back to edit" click, two additional keys ride along, straight copy, same as
`notes`: `row_key` (each row's own — carried through unchanged; **never** regenerate it or
`build_stakeholder_blocks()`'s positional-fallback logic silently invents a fresh one, which
would break the Phase 1.5 `draft_pk` re-match this key exists for) and `server_errors` (the
list of translated, human-readable messages for that row — omit the key entirely on a row
with none, same as any other optional field). A plain "Back to edit" reconstruction never
sets either key — they're specific to the Phase 1.5 retry path.

Re-render Phase 0.5's config panel with this reconstructed `knowns.rows` (no new MCP fetches
needed for the reference-data blob — reuse the same `_data.json` as-is), then **navigate
the review panel's own tab to it** — regenerating `<CORP_ID>_config.html` and reloading the *config* panel's tab
does nothing the user can see, because the config tab isn't the one in front of them; the
review tab is. A prior version of this doc reloaded the config tab and told the user to go
find it manually — that's what made a "Back to edit" click look like it silently did
nothing. Navigating the visible tab instead is both fixable and more honest:

1. Regenerate `<CORP_ID>_config.html` as usual (`build_config.py` + `generate.py` against the
   config `OUT_DIR`) — same as any other config-panel render.
2. Call `preview_list` and find the entry where `name == "carta-cap-table-issuance-config-<CORP_ID>"`.
   Read its `port`. **If that entry is missing** (the config panel's server process died —
   rare, but possible), skip to the fallback below instead of inventing a port.
3. Call `preview_list` again (or reuse the same result) for
   `name == "carta-cap-table-issuance-review-<CORP_ID>"` — the review panel, i.e. the tab the
   user is actually looking at right now — and read **its** `serverId`.
4. `preview_eval` with **the review panel's `serverId`** (not the config panel's):
   `window.location.href = 'http://localhost:<config_port>/<CORP_ID>_config.html'`.

This reuses the tab already in front of the user instead of silently touching a different,
backgrounded one. Because the navigation genuinely happened in the visible tab, it's now
accurate to tell the user *"I've switched your browser back to the config panel with your
previous entries."* — not a "should have" claim, an observed one (the `preview_eval` call
either succeeds or errors; only say it switched if the call actually returned success).

**Fallback — the config panel's `preview_list` entry is missing:** its server process is
gone, so there's nothing to navigate to. Re-open it the normal way
([artifact-flow §2](artifact-flow.md#2-render-the-side-panel)), then navigate the *review*
panel's tab to the newly-opened port once `preview_list` confirms it's up — still reusing the
visible tab, never leaving the user to go find a separate new one. Only if this also fails do
you fall back to the honest caveat: *"I've rebuilt the config panel with your previous
entries, but couldn't switch your browser to it automatically. If your browser is still
showing the review summary, switch to the config panel's tab (or refresh it) to keep
editing."*

**Either path, restart the config panel's submit-watcher afterward** — its previous watcher
already fired and exited on the original `config_submit` (watchers are one-shot, artifact-flow
§3), so the next click needs a fresh one or it won't be noticed.
