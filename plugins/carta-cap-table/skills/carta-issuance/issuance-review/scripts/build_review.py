# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Build the issuance-review panel's dynamic blocks deterministically from the
resolved rows — the review counterpart to issuance-config/scripts/build_config.py.

WHY THIS EXISTS
---------------
The review panel's chrome (top bar, modals, footer, save/submit JS) is a real
``references/template.html``. But the per-row markup — the ``DETAIL_TABLE`` (one
read-only row per grantee/holder) and the ``KPI_STRIP`` (stat tiles) — is
model-hostile to hand-author for the same reason ``build_config.py`` exists:
hand-authored blocks once shipped dead buttons, and a designer could not open the
row layout in a browser to edit it.

Every field the batch used to let the user edit *here* is now collected and
resolved before the review even renders — one full key-value table per
stakeholder in the config panel (see ``issuance-config``), and Phase 1's roster
resolution. By the time the review panel opens, everything is already decided;
this panel's only job is a read-only confirmation, so the row markup below emits
plain display cells instead of the editable inputs it used to.

CONTRACT
--------
Implements the ``DETAIL_TABLE`` and ``KPI_STRIP`` block contracts in
``issuance-review/SKILL.md``.

Usage (--vesting-templates is option-grant only):
  uv run build_review.py \
    --security-type option_grant \
    --rows    <OUT_DIR>/_review_rows.json \
    --vesting-templates <OUT_DIR>/_vesting_templates.json \
    --out-dir <OUT_DIR>

``--rows`` is a JSON array of the RESOLVED rows (post Phase 1) — same field names
as the Row templates in ../../SKILL.md#row-templates. ``--vesting-templates``
(option grant) / ``--share-classes`` (certificate) are the fetched reference-data
lists, used only to resolve an id on the row into a display name. Pass the RAW
fetched MCP result straight through — this script unwraps the standard
``{count, results}`` envelope itself (same as issuance-config's build_config.py);
a flat array also still works. Writes to ``--out-dir`` and prints one
``KEY=path`` line per block file:
  DETAIL_TABLE=<dir>/_detail_table.html
  KPI_STRIP=<dir>/_kpi.html
  PLAN_CARD=<dir>/_plan_card.html
"""
from __future__ import annotations

import argparse
import html
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

CURRENCIES = ("USD", "EUR", "GBP", "CAD", "AUD")

# `rule_144_difference_reason` picklist (payload-reference.md) — customer-facing
# labels for the enum values the row carries when `rule_144_date` != `issue_date`.
RULE_144_REASON_LABELS = {
    "has_determined_144_date": "Has determined 144 date",
    "non_restricted_144": "Non-restricted 144",
    "relevance_provision": "Relevance provision",
    "affiliates": "Affiliates",
    "non_affiliates": "Non-affiliates",
}


class BuildError(RuntimeError):
    """Raised when inputs can't be parsed."""


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BuildError(f"could not read/parse {path}: {exc}") from exc


def _unwrap(obj: Any) -> Any:
    """Peel the common Carta MCP result envelopes down to the inner payload —
    same logic as issuance-config's build_config.py, ported here so callers
    can pass the raw fetched `{count, results}` shape directly instead of
    hand-flattening it first."""
    seen = 0
    while seen < 8:
        seen += 1
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except ValueError as exc:
                raise BuildError(f"could not parse nested JSON string in envelope: {exc}") from exc
            continue
        if isinstance(obj, dict):
            if "result" in obj and isinstance(obj["result"], (str, dict, list)):
                obj = obj["result"]
                continue
            if "text" in obj and isinstance(obj["text"], str):
                obj = obj["text"]
                continue
            return obj
        if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], dict) \
                and "text" in obj[0] and isinstance(obj[0]["text"], str):
            obj = obj[0]["text"]
            continue
        return obj
    return obj


def _results(raw: Any) -> List[Dict[str, Any]]:
    """Unwrap an MCP payload and return its list of result dicts. Tolerates a
    plain flat array too (already-unwrapped input keeps working)."""
    data = _unwrap(raw)
    if isinstance(data, dict) and "results" in data:
        data = data["results"]
    if not isinstance(data, list):
        return []
    return [d for d in data if isinstance(d, dict)]


def _esc(s: Any) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def _display_kind(kind: Any) -> str:
    """`stakeholder_kind` ("INDIVIDUAL"/"NON-INDIVIDUAL"/"ORGANIZATION") -> the
    customer-facing label from carta-issuance SKILL.md's Voice table."""
    k = str(kind or "INDIVIDUAL").strip().upper()
    return "Individual" if k == "INDIVIDUAL" else "Non-individual"


def _or_dash(v: Any) -> str:
    v = "" if v is None else str(v).strip()
    return v if v else "—"


_ISO_DATE_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")


def _fmt_date(v: Any) -> Optional[str]:
    """Normalize a resolved row's date value to `MM/DD/YYYY` for display (SKILL.md
    Voice & defaults: "Dates display as MM/DD/YYYY everywhere the user sees them").
    Resolved rows carry a mix of formats by design: `issue_date`/`board_approval_date`
    are DateFields the config panel's `<input type="date">` always returns as
    `YYYY-MM-DD`, while `vesting_start_date`/`grant_expiration_date`/`rule_144_date`
    are already `MM/DD/YYYY` CharFields (payload-reference.md). Converting the
    former and passing the latter through unchanged means every date column ends
    up in the one format the user actually sees, instead of a raw ISO string on
    some columns and a masked one on others."""
    if v is None:
        return None
    v = str(v).strip()
    if not v:
        return None
    m = _ISO_DATE_RE.match(v)
    if m:
        y, mo, d = m.groups()
        return f"{mo}/{d}/{y}"
    return v  # already MM/DD/YYYY (or unparsable — surface verbatim, never hide it)


def _date_or_dash(r: Dict[str, Any], key: str) -> str:
    return _or_dash(_fmt_date(r.get(key)))


def _qty(v: Any) -> int:
    try:
        return int(v or 0)
    except (TypeError, ValueError):
        return 0


# ── Read-only display cells shared by both row types (Type/Email/Relationship —
# never editable here; carta-issuance Phase 1 already resolved them). ──

def _identity_cells(r: Dict[str, Any]) -> str:
    return (
        f'<td>{_esc(_display_kind(r.get("stakeholder_kind")))}</td>'
        f'<td>{_esc(r.get("email",""))}</td>'
        f'<td>{_esc(_or_dash(r.get("issue_date_relationship")))}</td>'
    )


# ── Flags (certificate only — the grant table dropped its Flags column when it
# was trimmed to a concise 10-column set; see build_detail_table()) ──

def _cert_flags(r: Dict[str, Any]) -> str:
    tags = []
    # Reuse _display_kind's classification (not a second, narrower exact-match
    # check) so the Flags tag and the Type column can never disagree about
    # whether the same stakeholder_kind value counts as non-individual.
    if _display_kind(r.get("stakeholder_kind")) == "Non-individual":
        tags.append('<span class="tag tag-intl">Non-individual</span>')
    if r.get("non_cash_dividend"):
        tags.append('<span class="tag tag-warn">Non-cash dividend</span>')
    if r.get("llc_zero_ok"):
        tags.append('<span class="tag tag-first">LLC $0 OK</span>')
    return "".join(tags)


# ── Read-only rows ──
#
# Field names below match the Row templates in ../../SKILL.md#row-templates — the
# same dict shape used for the issue_securities/save_drafts mutate payload — since
# _review_rows.json is written straight from the Phase-1-resolved rows. In
# particular: `board_approval_date` (NOT `board_date`) is omitted entirely on a
# pending grant row, and `vesting_template` (NOT `vesting_schedule`) holds an id
# or `None` ("No vesting") — never a display label — so vesting_templates is
# threaded through to resolve a name, the same way share_classes resolves `prefix`.

def _vesting_label(r: Dict[str, Any], vesting_templates: List[Dict[str, Any]]) -> str:
    """Never fabricate "Custom" for an unresolved id — this skill can never set a
    genuinely custom vesting schedule (Hard rule 7: "Templates only"), so that
    word actively misrepresents what happened. An unresolved id means the caller
    forgot to thread `--vesting-templates` through (guarded against in `main()`
    below) or a template was deleted from Carta after being fetched — either way,
    say so honestly instead of implying the user configured something bespoke."""
    tid = r.get("vesting_template")
    if tid is None:
        return "No vesting"
    match = next((t for t in vesting_templates if str(t.get("id")) == str(tid)), None)
    return str(match.get("name")) if match else "Selected — details unavailable"


def _grant_row(r: Dict[str, Any], vesting_templates: List[Dict[str, Any]]) -> str:
    return (
        '<tr data-stake>'
        f'<td><div class="stake-name">{_esc(r.get("name",""))}</div>'
        f'<div class="stake-email">{_esc(r.get("email",""))}</div></td>'
        f'<td>{_esc(r.get("email",""))}</td>'
        f'<td>{_esc(r.get("so_type","NSO"))}</td>'
        f'<td>{_qty(r.get("quantity")):,}</td>'
        f'<td>{_esc(_or_dash(r.get("exercise_price")))}</td>'
        f'<td>{_esc(_date_or_dash(r, "board_approval_date"))}</td>'
        f'<td>{_esc(_date_or_dash(r, "issue_date"))}</td>'
        f'<td>{_esc(_vesting_label(r, vesting_templates))}</td>'
        f'<td>{_esc(_date_or_dash(r, "vesting_start_date"))}</td>'
        f'<td>{_esc(_date_or_dash(r, "grant_expiration_date"))}</td>'
        '</tr>'
    )


def _rule_144_cell(r: Dict[str, Any]) -> str:
    """The date, plus the difference reason (payload-reference.md picklist) as a
    parenthetical when the row carries one — only set server-/panel-side when
    `rule_144_date` != `issue_date` (Row templates), so its mere presence is the
    trigger; no separate date comparison needed here."""
    date = _esc(_date_or_dash(r, "rule_144_date"))
    reason = r.get("rule_144_difference_reason")
    if not reason:
        return date
    label = RULE_144_REASON_LABELS.get(str(reason), str(reason))
    return f'{date} <span class="rule144-reason">({_esc(label)})</span>'


def _cert_row(r: Dict[str, Any], share_classes: List[Dict[str, Any]], any_flags: bool) -> str:
    prefix = str(r.get("prefix", ""))
    match = next((c for c in share_classes if str(c.get("prefix")) == prefix), None)
    class_display = f'{match.get("name")} ({prefix})' if match else _or_dash(prefix)
    flags = _cert_flags(r)
    flags_td = f"<td>{flags}</td>" if any_flags else ""
    legend_body = r.get("legend_body", "")
    return (
        '<tr data-stake>'
        f'<td><div class="stake-name">{_esc(r.get("name",""))}</div>'
        f'<div class="stake-email">{_esc(r.get("email",""))}</div></td>'
        f'{_identity_cells(r)}'
        f'<td>{_esc(class_display)}</td>'
        f'<td>{_qty(r.get("quantity")):,}</td>'
        f'<td>{_esc(_or_dash(r.get("law_firm_price")))}</td>'
        f'<td>{_esc(_date_or_dash(r, "board_approval_date"))}</td>'
        f'<td>{_esc(_date_or_dash(r, "issue_date"))}</td>'
        f'<td>{_rule_144_cell(r)}</td>'
        f'<td><button class="legend-view-btn" onclick="showLegendModal(this)" '
        f'data-legend-body="{_esc(legend_body)}">View legend</button></td>'
        f'{flags_td}'
        '</tr>'
    )


def build_detail_table(
    security_type: str, rows: List[Dict[str, Any]],
    share_classes: Optional[List[Dict[str, Any]]] = None,
    vesting_templates: Optional[List[Dict[str, Any]]] = None,
) -> str:
    share_classes = share_classes or []
    vesting_templates = vesting_templates or []
    if security_type == "option_grant":
        # Trimmed to a concise recap (design feedback): stakeholder kind,
        # relationship, plan, currency, exercise periods, exemption, documents,
        # and flags are dropped from the table — Plan/Currency are already shown
        # in the header subheading / KPI strip, and the rest were reviewed one
        # screen ago in the config panel; "Back to edit" revisits them if needed.
        body = "".join(_grant_row(r, vesting_templates) for r in rows)
        return (
            '<div class="grantee-table-wrap"><table class="grantee-table"><thead><tr>'
            '<th>Stakeholder</th><th>Email</th><th>Type</th><th>Quantity</th><th>Exercise price</th>'
            '<th>Board approval</th><th>Issue date</th><th>Vesting schedule</th><th>Vesting start</th>'
            '<th>Grant expiration</th>'
            f'</tr></thead><tbody>{body}</tbody></table></div>'
        )
    # certificate
    any_flags = any(_cert_flags(r) for r in rows)
    flags_th = "<th>Flags</th>" if any_flags else ""
    body = "".join(_cert_row(r, share_classes, any_flags) for r in rows)
    return (
        '<div class="grantee-table-wrap"><table class="grantee-table"><thead><tr>'
        '<th>Stakeholder</th><th>Type</th><th>Email</th><th>Relationship</th><th>Share class</th>'
        '<th>Quantity</th><th>Price / share</th><th>Board approval</th><th>Issue date</th>'
        f'<th>Rule 144 date</th><th>Build legend</th>'
        f'{flags_th}'
        f'</tr></thead><tbody>{body}</tbody></table></div>'
    )


def _kpi_cell(label: str, val: str, sub: Optional[str] = None) -> str:
    sub_html = f'<span class="kpi-sub">{_esc(sub)}</span>' if sub else ""
    return (
        '<div class="kpi-cell">'
        f'<span class="kpi-label">{_esc(label)}</span>'
        f'<span class="kpi-val">{_esc(val)}</span>'
        f'{sub_html}'
        '</div>'
    )


def build_kpi_strip(security_type: str, rows: List[Dict[str, Any]]) -> str:
    """Stat tiles replacing the old editable table's totals-bar footer — computed
    once here since nothing on this panel is editable. Never sums a dollar
    amount across currencies (repo-wide currency rule): quantities are
    share/option counts, safe to sum regardless of currency; a batch mixing
    currencies surfaces them in their own tile instead of a combined total.
    "Total shares" drops the per-class breakdown sub-line — the detail table
    already shows each row's own class."""
    total = sum(_qty(r.get("quantity")) for r in rows)
    recipients = len(rows)
    currencies = sorted({str(r.get("currency") or "USD") for r in rows})

    cells = [_kpi_cell("Recipients", f"{recipients:,}")]
    if security_type == "option_grant":
        iso = sum(_qty(r.get("quantity")) for r in rows if str(r.get("so_type")) == "ISO")
        nso = sum(_qty(r.get("quantity")) for r in rows if str(r.get("so_type")) == "NSO")
        cells.append(_kpi_cell("Total options", f"{total:,}", f"ISO {iso:,} · NSO {nso:,}"))
        # A pending grant row omits board_approval_date entirely (Row templates:
        # "omit when needs_board_approval=true") — a real, variable state for
        # grants. Certificates always carry a board date (Row templates: always
        # required, no pending state), so this tile would forever read 0 for
        # certs — dropped there rather than showing a count that can never be
        # anything else.
        pending = sum(1 for r in rows if not str(r.get("board_approval_date") or "").strip())
        cells.append(_kpi_cell("Pending board approval", f"{pending:,}"))
    else:
        cells.append(_kpi_cell("Total shares", f"{total:,}"))
    cells.append(_kpi_cell("Currency" if len(currencies) == 1 else "Currencies", ", ".join(currencies)))
    return f'<div class="kpi-grid">{"".join(cells)}</div>'


def build_plan_card(security_type: str, rows: List[Dict[str, Any]]) -> str:
    """Equity Plan card — option-grant only, empty string for certificates (there
    is no equity plan concept there, so the template renders nothing). Every row
    in one draft set shares the same `equity_plan_id` (Phase 1's Option-plan
    reconciliation), so `plan_name` / `exercise_periods_text` — stamped identically
    onto every row as Review-only fields, carta-issuance SKILL.md — are read from
    the first row rather than recomputed per row. Elevated into its own card
    (design feedback) instead of being buried in the header subheading, which is
    all that named the plan before."""
    if security_type != "option_grant" or not rows:
        return ""
    plan_name = str(rows[0].get("plan_name") or "—")
    exercise_periods_text = str(rows[0].get("exercise_periods_text") or "")
    periods_html = (
        f'<p class="plan-card-periods">{_esc(exercise_periods_text)}</p>' if exercise_periods_text else ""
    )
    return (
        '<div class="card section plan-card">'
        '<div class="plan-card-head">'
        '<span class="plan-card-label">Equity Plan</span>'
        f'<span class="plan-card-name">{_esc(plan_name)}</span>'
        '</div>'
        f'{periods_html}'
        '</div>'
    )


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Build issuance-review dynamic HTML blocks.")
    p.add_argument("--security-type", required=True, choices=["option_grant", "certificate"])
    p.add_argument("--rows", required=True, type=Path, help="JSON array of resolved rows")
    p.add_argument("--share-classes", type=Path, help="Raw fetched share classes (certificate) — envelope or flat array")
    p.add_argument("--vesting-templates", type=Path, help="Raw fetched vesting templates (option grant) — envelope or flat array")
    p.add_argument("--out-dir", required=True, type=Path)
    args = p.parse_args(argv)

    try:
        rows = _load(args.rows)
        share_classes = _results(_load(args.share_classes)) if args.share_classes else []
        vesting_templates = _results(_load(args.vesting_templates)) if args.vesting_templates else []
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    if not isinstance(rows, list):
        print("ERROR: --rows must be a JSON array", file=sys.stderr)
        return 2
    rows = [r for r in rows if isinstance(r, dict)]

    # Fail loudly instead of silently mislabeling a real selection as "Custom"
    # (see _vesting_label): if any row picked a vesting template, the caller must
    # have threaded --vesting-templates through so the id can resolve to a name.
    if args.security_type == "option_grant" and not vesting_templates:
        if any(r.get("vesting_template") is not None for r in rows):
            print(
                "ERROR: one or more rows carry a vesting_template id, but "
                "--vesting-templates was not supplied (or was empty) — cannot "
                "resolve display names. Pass the fetched vesting-templates list.",
                file=sys.stderr,
            )
            return 2

    args.out_dir.mkdir(parents=True, exist_ok=True)
    written: List[str] = []

    def emit(key: str, filename: str, content: str) -> None:
        path = args.out_dir / filename
        path.write_text(content, encoding="utf-8")
        written.append(f"{key}={path}")

    emit("DETAIL_TABLE", "_detail_table.html",
         build_detail_table(args.security_type, rows, share_classes, vesting_templates))
    emit("KPI_STRIP", "_kpi.html", build_kpi_strip(args.security_type, rows))
    emit("PLAN_CARD", "_plan_card.html", build_plan_card(args.security_type, rows))

    for line in written:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
