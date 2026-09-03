# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Emit the Cowork issuance form as one self-contained `show_widget` document.

build_config.py is the same thing for the Code side panel. Both read the builders in
`lib/issuance_fields.py`, so the surfaces submit an identical `rows` payload
(issuance-config/SKILL.md). Batch mode is a rendering choice the payload never shows.
Invocation: issuance-config/SKILL.md § Cowork form.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

_LIB = Path(__file__).resolve().parents[4] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

from issuance_fields import (  # noqa: E402
    BuildError,
    advanced_accordion_cert,
    advanced_accordion_grant,
    board_approval_html,
    build_batch_error_banner,
    build_docsets,
    build_exercise_price_hint,
    build_legends,
    build_option_type,
    build_rule144_reason_select,
    build_share_classes,
    build_stakeholder_blocks,
    build_stakeholder_list,
    build_vesting,
    cert_no_vesting,
    default_legend_id,
    default_so_type,
    esc,
    kv_row,
    results,
    row_no_vesting,
    row_preferred_vesting,
    sel,
    so_type_js_constants,
    sole_fmv_price,
    ATO_SO_TYPES,
    EMPLOYMENT_RELATED_SO_TYPES,
    HMRC_SO_TYPES,
)

REFS = Path(__file__).resolve().parent.parent / "references"
TEMPLATE = REFS / "cowork-template.html"
STYLES = REFS / "cowork-styles.css"

# cowork-adapter.md § Batch mode: collapse to shared-terms-once only when the
# batch is big enough for N identical blocks to be pure waste AND no row carries
# terms of its own. Either condition failing means a mixed batch, which only the
# per-row repeater can express.
BATCH_MODE_MIN_ROWS = 10

# A row key here means "this person's terms differ from the batch", which is what
# disqualifies batch mode. Identity and amount fields are per-person by nature and
# never disqualify it.
_IDENTITY_KEYS = {
    "name", "email", "quantity", "relationship", "stakeholder_kind",
    "row_key", "notes", "import_notes", "server_errors",
}


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BuildError(f"could not read/parse {path}: {exc}") from exc


def rows_carry_own_terms(rows: List[Dict[str, Any]]) -> bool:
    """True when any row sets a non-identity field — a mixed-term batch."""
    return any(
        key not in _IDENTITY_KEYS
        for row in rows
        if isinstance(row, dict)
        for key in row
    )


def use_batch_mode(rows: List[Dict[str, Any]], knowns: Dict[str, Any]) -> bool:
    """Both conditions from cowork-adapter.md must hold, and an explicit
    `knowns.batch_mode` overrides the heuristic either way."""
    override = knowns.get("batch_mode")
    if override is not None:
        return bool(override)
    return len(rows) > BATCH_MODE_MIN_ROWS and not rows_carry_own_terms(rows)


def build_shared_terms(security_type: str, data: Dict[str, Any], knowns: Dict[str, Any]) -> str:
    """The non-personal terms every batch row inherits, rendered once.

    Same builders, same classes and `data-*` contract as a per-row block, so the
    form JS and `collectTerms()` treat this scope exactly like one.
    """
    currency = esc(knowns.get("currency", ""))
    today = knowns.get("today_iso", "")
    row: Dict[str, Any] = {}
    rows_html: List[str] = []

    if security_type == "option_grant":
        price = sole_fmv_price(knowns)
        if price is None:
            price = knowns.get("exercise_price_default", "")
        templates = results(data.get("vesting_templates"))
        accel_templates = results(data.get("acceleration_templates"))
        docsets = results(data.get("document_sets"))
        no_vesting = row_no_vesting(row, knowns)
        jurisdiction = str(knowns.get("jurisdiction", "US"))
        so_type = default_so_type(jurisdiction, None, None)
        vest_wrap_style = "" if not no_vesting else ' style="display:none;"'

        rows_html.append(kv_row(
            "Type", build_option_type(jurisdiction, None, None),
            sectype="option_grant", required=True,
        ))
        rows_html.append(kv_row(
            "Exercise price",
            f'<p class="field-hint">{esc(build_exercise_price_hint(knowns, currency))}</p>'
            f'<div class="price-row">'
            f'<input class="text-input block-exercise-price" type="text" inputmode="decimal" '
            f'value="{esc(price)}" oninput="onStakeInput()"/>'
            f'<span class="currency-suffix">{currency}</span></div>',
            sectype="option_grant", required=True,
        ))
        rows_html.append(kv_row(
            "Issue date",
            f'<input class="date-input block-issue-date" type="date" value="{esc(today)}" '
            f'oninput="updateIssueDate(this)"/>',
            required=True,
        ))
        rows_html.append(kv_row(
            "Board approval", board_approval_html(row, today, security_type), required=True,
        ))
        rows_html.append(kv_row(
            "Vesting schedule",
            f'<select class="select-input block-vesting-select" onchange="pickVesting(this)">'
            f'{build_vesting(templates, no_vesting, row_preferred_vesting(row, knowns))}</select>'
            f'<div class="block-vesting-start-wrap"{vest_wrap_style}>'
            f'<p class="field-sublabel">Vesting start date</p>'
            f'<input class="date-input block-vesting-start-date" type="date" value="{esc(today)}" '
            f'oninput="updateVestingStart(this)"/></div>',
            sectype="option_grant", required=True,
        ))
        rows_html.append(kv_row(
            "Documents",
            f'<p class="field-hint">Document templates attached to every grant.</p>'
            f'<div class="toggle-row wrap">{build_docsets(docsets, None)}</div>',
            sectype="option_grant", required=True,
        ))
        rows_html.append(kv_row(
            "HMRC notified",
            f'<label class="pending-label"><input type="checkbox" class="block-hmrc-notified" '
            f'onchange="onStakeInput()"/> HMRC has been notified</label>'
            f'<input class="date-input block-hmrc-notified-date" type="date" value="{esc(today)}" '
            f'oninput="onStakeInput()"/>',
            sectype="option_grant", conditional_on="so_type_emi",
            hidden=(so_type not in HMRC_SO_TYPES),
        ))
        rows_html.append(kv_row(
            "ATO notified",
            f'<label class="pending-label"><input type="checkbox" class="block-ato-notified" '
            f'onchange="onStakeInput()"/> ATO has been notified</label>',
            sectype="option_grant", conditional_on="so_type_au",
            hidden=(so_type not in ATO_SO_TYPES),
        ))
        rows_html.append(kv_row(
            "Employment related",
            f'<p class="field-hint">Was this grant acquired by reason of employment? Required for '
            f'Unapproved grants so they are reported correctly in the HMRC Other ERS annual return.</p>'
            f'<div class="toggle-row">'
            f'<button type="button" class="toggle" data-group="employment-related" '
            f'data-value="yes" onclick="pick(this)">Yes</button>'
            f'<button type="button" class="toggle" data-group="employment-related" '
            f'data-value="no" onclick="pick(this)">No</button></div>',
            sectype="option_grant", conditional_on="so_type_employment_related",
            hidden=(so_type not in EMPLOYMENT_RELATED_SO_TYPES), required=True,
        ))
        rows_html.append(advanced_accordion_grant(row, accel_templates, no_vesting, {}))
    else:
        price_default = knowns.get("price_per_share_default", "")
        classes = results(data.get("share_classes"))
        legends = results(data.get("legends"))
        templates = results(data.get("vesting_templates"))
        accel_templates = results(data.get("acceleration_templates"))
        no_vesting = cert_no_vesting(row, knowns)
        chosen_legend_id = default_legend_id(legends, None)
        selected_legend = next((lg for lg in legends if str(lg.get("id")) == chosen_legend_id), None)
        body = (selected_legend.get("text") or selected_legend.get("body") or "") if selected_legend else ""
        vest_wrap_style = "" if not no_vesting else ' style="display:none;"'

        rows_html.append(kv_row(
            "Share class",
            f'<div class="toggle-row wrap">{build_share_classes(classes, knowns.get("share_class_prefix"))}</div>',
            sectype="certificate", required=True,
        ))
        rows_html.append(kv_row(
            "Price per share",
            f'<p class="field-hint">0 is only valid for LLC corporations — otherwise enter a price '
            f'greater than 0.</p>'
            f'<div class="price-row"><span class="currency-suffix">{currency}</span>'
            f'<input class="text-input block-price-per-share" type="text" inputmode="decimal" '
            f'value="{esc(price_default)}" oninput="onStakeInput()"/></div>',
            sectype="certificate", required=True,
        ))
        rows_html.append(kv_row(
            "Issue date",
            f'<input class="date-input block-issue-date" type="date" value="{esc(today)}" '
            f'oninput="updateIssueDate(this)"/>',
            required=True,
        ))
        rows_html.append(kv_row(
            "Board approval", board_approval_html(row, today, security_type), required=True,
        ))
        attest_style = "" if body else ' style="display:none;"'
        rows_html.append(kv_row(
            "Build legend",
            f'<p class="field-hint">Legal text printed on every certificate to restrict transfer. Read '
            f'the full body before continuing — you are attesting to it.</p>'
            f'<div class="toggle-row wrap">{build_legends(legends, None)}</div>'
            f'<div class="block-legend-attest legend-attest"{attest_style}>{esc(body)}</div>',
            sectype="certificate", required=True,
        ))
        rows_html.append(kv_row(
            "Rule 144 date",
            f'<p class="field-hint">Holding-period start date for restricted securities.</p>'
            f'<div class="toggle-row">'
            f'<button type="button" class="toggle{sel(True)}" data-group="rule144" '
            f'data-value="issue_date" onclick="pickRule144(this)">Use the issue date</button>'
            f'<button type="button" class="toggle" data-group="rule144" '
            f'data-value="other" onclick="pickRule144(this)">Use a different date</button></div>'
            f'<input class="date-input block-rule144-date" type="date" value="{esc(today)}"'
            f' style="display:none;" oninput="onStakeInput()"/>'
            f'<div class="block-rule144-reason-wrap" style="display:none;">'
            f'<p class="field-sublabel">Reason for the different date</p>'
            f'{build_rule144_reason_select(None)}</div>',
            sectype="certificate", required=True,
        ))
        rows_html.append(kv_row(
            "Vesting schedule",
            f'<select class="select-input block-vesting-select" onchange="pickVesting(this)">'
            f'{build_vesting(templates, no_vesting, row_preferred_vesting(row, knowns))}</select>'
            f'<div class="block-vesting-start-wrap"{vest_wrap_style}>'
            f'<p class="field-sublabel">Vesting start date</p>'
            f'<input class="date-input block-vesting-start-date" type="date" value="{esc(today)}" '
            f'oninput="updateVestingStart(this)"/></div>',
            sectype="certificate",
        ))
        rows_html.append(advanced_accordion_cert(row, accel_templates, no_vesting, {}))

    return (
        f'<div class="stake-block" data-shared-terms>'
        f'<div class="kv-table">{"".join(rows_html)}</div>'
        f'</div>'
    )


def build_batch_rows(rows: List[Dict[str, Any]]) -> str:
    """The compact name / email / quantity table — three columns, nothing else.

    Per-row terms have no place here by construction: a row that needs its own
    terms is a mixed batch and belongs in the per-row repeater.
    """
    if not rows:
        rows = [{}]
    out = []
    for i, row in enumerate(rows):
        key = esc(row.get("row_key") or f"r{i}")
        name = esc(row.get("name", ""))
        email = esc(row.get("email", ""))
        qty = row.get("quantity", "")
        qty = "" if qty is None else esc(qty)
        out.append(
            f'<tr data-batch-row data-row-key="{key}">'
            f'<td class="col-num">{i + 1}</td>'
            f'<td><div class="stake-name-wrap">'
            f'<input class="text-input stake-name-in" type="text" autocomplete="off" '
            f'placeholder="Search or type a new name…" value="{name}" '
            f'oninput="onStakeNameInput(this)" onfocus="onStakeNameFocus(this)"/>'
            f'<div class="stake-suggestions" style="display:none;"></div></div></td>'
            f'<td><input class="text-input stake-email-in" type="email" placeholder="Email" '
            f'value="{email}" oninput="onStakeInput()"/></td>'
            f'<td><input class="text-input stake-qty-in" type="number" inputmode="numeric" '
            f'placeholder="Quantity" value="{qty}" oninput="onStakeInput()"/></td>'
            f'<td class="col-act">'
            f'<button class="btn-trash" type="button" onclick="removeBatchRow(this)" '
            f'title="Remove stakeholder" aria-label="Remove stakeholder">'
            f'<svg width="13" height="13" fill="none" viewBox="0 0 20 20" aria-hidden="true">'
            f'<path d="M8 2h4M3 5h14M6 5l1 12h6l1-12" stroke="currentColor" stroke-width="1.5" '
            f'stroke-linecap="round" stroke-linejoin="round"/></svg></button></td>'
            f'</tr>'
        )
    return "".join(out)


def _minify_css(css: str) -> str:
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.DOTALL)
    css = re.sub(r"\s+", " ", css).strip()
    return re.sub(r" ?([{};:,>+~]) ?", r"\1", css)


def _minify_inline_js(html: str) -> str:
    def _strip(match: "re.Match[str]") -> str:
        tag, body, close = match.group(1), match.group(2), match.group(3)
        # Negative lookbehind keeps `https://` from being read as a comment.
        body = re.sub(r"(?<!:)//[^\n]*", "", body)
        body = re.sub(r"/\*.*?\*/", "", body, flags=re.DOTALL)
        body = re.sub(r"[ \t]*\n[ \t]*", "\n", body)
        return tag + re.sub(r"\n{2,}", "\n", body).strip() + close

    return re.sub(r"(<script[^>]*>)(.*?)(</script>)", _strip, html, flags=re.DOTALL)


def render(security_type: str, data: Dict[str, Any], knowns: Dict[str, Any],
           corp_name: str, corp_id: str, minify: bool = True) -> str:
    """Fill the template into one self-contained document.

    The CSS `<link>` is a sentinel the widget host could never resolve, so it is
    always replaced by an inline `<style>`.
    """
    rows = [r for r in (knowns.get("rows") or []) if isinstance(r, dict)]
    batch = use_batch_mode(rows, knowns)

    html = TEMPLATE.read_text(encoding="utf-8")
    css = STYLES.read_text(encoding="utf-8")
    if minify:
        css = _minify_css(css)
        html = _minify_inline_js(html)

    noun = "holder" if security_type == "certificate" else "grantee"
    count = len(rows) or 1
    subs = {
        "CORP_NAME": esc(corp_name),
        "CORP_ID": esc(corp_id),
        "SECURITY_TYPE": security_type,
        "FLOW_TITLE": "Issue Certificates" if security_type == "certificate" else "Issue Option Grants",
        "HEADER_SUB": f"{count} {noun}{'' if count == 1 else 's'}",
        "BATCH_MODE": "true" if batch else "false",
        "SO_TYPE_CONSTANTS": so_type_js_constants(),
        "BATCH_ERRORS_HTML": build_batch_error_banner(knowns.get("batch_errors")),
        # Only the active layout is rendered; the other stays an empty slot so a
        # hidden duplicate can never be collected on submit.
        "STAKEHOLDER_ROWS": "" if batch else build_stakeholder_blocks(rows, security_type, data, knowns),
        "BATCH_SHARED_TERMS": build_shared_terms(security_type, data, knowns) if batch else "",
        "BATCH_ROWS": build_batch_rows(rows) if batch else "",
    }
    for token, value in subs.items():
        html = html.replace("{{" + token + "}}", value)

    html = html.replace(
        '<link rel="stylesheet" href="/cowork-styles.css"/>',
        "<style>" + css + "</style>",
    )
    roster = build_stakeholder_list(results(data.get("stakeholders")))
    return html.replace('"__INJECTED_DATA__"', roster)


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Build the Cowork issuance show_widget form.")
    p.add_argument("--security-type", required=True, choices=["option_grant", "certificate"])
    p.add_argument("--data", required=True, type=Path, help="JSON of raw MCP reference results")
    p.add_argument("--knowns", required=True, type=Path, help="JSON of what the prompt supplied")
    p.add_argument("--corp-name", default="", help="Company legal name for the header")
    p.add_argument("--corp-id", default="", help="corporation_id, echoed in the submit payload")
    p.add_argument("--out", type=Path, help="Write the document here")
    p.add_argument("--stdout", action="store_true", help="Write the document to stdout instead")
    p.add_argument("--no-minify", action="store_true",
                   help="Keep comments and whitespace (for design iteration)")
    args = p.parse_args(argv)

    if not args.out and not args.stdout:
        p.error("pass --out <path> or --stdout")

    try:
        data = _load(args.data)
        knowns = _load(args.knowns)
        if not isinstance(data, dict) or not isinstance(knowns, dict):
            print("ERROR: --data and --knowns must each be a JSON object", file=sys.stderr)
            return 2
        html = render(args.security_type, data, knowns, args.corp_name, args.corp_id,
                      minify=not args.no_minify)
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.stdout:
        sys.stdout.write(html)
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(html, encoding="utf-8")
        print(f"FORM={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
