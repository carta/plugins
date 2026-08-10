# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Render the issuance-review panel to a standalone HTML file with sample data —
NO Carta MCP, NO full skill run. The review-panel counterpart to
issuance-config/scripts/preview_config.py.

A designer edits ``references/styles.css`` or ``references/template.html``, runs this
once, and opens the result in a browser to see the change — including the read-only
per-row detail table and KPI stat tiles now that ``build_review.py`` produces them
deterministically.

Usage:
  uv run preview_review.py                       # both types → /tmp, print paths
  uv run preview_review.py --security-type certificate --open
  uv run preview_review.py --out-dir ./_preview

The Back to edit / Confirm & Issue buttons are inert in preview (they POST to a dead
port), so you can open the modals and click through freely. Edit the inline
``SAMPLE_ROWS`` to preview a different shape (more rows, intl employees, flags,
a long legend)."""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE.parent / "references"
BUILD = HERE / "build_review.py"
TEMPLATE = REFS / "template.html"
STYLES = REFS / "styles.css"

SAMPLE_ROWS = {
    # Field names match the Row templates in ../../SKILL.md#row-templates — the
    # same shape used for the issue_securities/save_drafts mutate payload, since
    # _review_rows.json is written straight from the Phase-1-resolved rows. In
    # particular board_approval_date is OMITTED (not "") on a pending row, and
    # vesting_template holds an id (resolved to a name via --vesting-templates),
    # never a display label — using the wrong shape here would hide field-name
    # bugs the real render would hit (board_approval_date/vesting_start_date/
    # vesting_template, not board_date/vesting_start/vesting_schedule).
    "option_grant": [
        {"name": "Jane Doe", "email": "jane@acme.com", "so_type": "ISO", "quantity": "1000",
         "exercise_price": "1.45", "currency": "USD", "issue_date": "2026-06-11",
         "board_approval_date": "2026-06-11", "vesting_start_date": "2026-06-11",
         "vesting_template": "94", "grant_expiration_date": "2036-06-11",
         "stakeholder_kind": "INDIVIDUAL", "issue_date_relationship": "Employee",
         "plan_name": "2024 Stock Plan", "exemption": "Section 4(a)(2)",
         "document_set_label": "Standard ISO docs",
         "exercise_periods_text": "Voluntary 90 Days · Involuntary 90 Days · Death 12 Months "
                                   "(inherited from 2024 Stock Plan)"},
        {"name": "Pierre Martin", "email": "pierre@acme.eu", "so_type": "INTL", "quantity": "750",
         "exercise_price": "1.45", "currency": "EUR", "issue_date": "2026-06-11",
         # Pending board approval — no board_approval_date key at all (Row template
         # rule: omit entirely, never an empty string). Proves the KPI "Pending
         # board approval" tile reads the real field and doesn't over/under-count.
         "vesting_template": None,
         "grant_expiration_date": "2036-06-11",
         "is_international": True, "stakeholder_kind": "INDIVIDUAL",
         "issue_date_relationship": "International Employee", "plan_name": "2024 Stock Plan",
         "exemption": "Non-U.S.", "document_set_label": "Standard ISO docs"},
    ],
    "certificate": [
        {"name": "Jane Doe", "email": "jane@acme.com", "prefix": "PA", "quantity": "500",
         "law_firm_price": "1.50", "currency": "USD", "issue_date": "2026-06-11",
         "board_approval_date": "2026-06-11", "rule_144_date": "2026-06-11",
         "legend_body": "THE SECURITIES REPRESENTED BY THIS CERTIFICATE HAVE NOT BEEN "
                        "REGISTERED UNDER THE SECURITIES ACT OF 1933.",
         "stakeholder_kind": "INDIVIDUAL", "issue_date_relationship": "Founder",
         "exemption": "Section 4(a)(2)"},
        {"name": "Acme Ventures Trust", "email": "ops@acmeventures.com", "prefix": "CS",
         "quantity": "200", "law_firm_price": "0.10", "currency": "USD",
         "issue_date": "2026-06-11", "board_approval_date": "2026-06-11",
         # Different Rule 144 date — renders the reason annotation next to it.
         "rule_144_date": "07/01/2026", "rule_144_difference_reason": "has_determined_144_date",
         "legend_body": "Restricted.", "stakeholder_kind": "NON-INDIVIDUAL",
         "issue_date_relationship": "Investor", "exemption": "Section 4(a)(2)"},
    ],
}

SAMPLE_CLASSES = [{"prefix": "CS", "name": "Common Stock"},
                  {"prefix": "PA", "name": "Series A Preferred"}]

SAMPLE_VESTING_TEMPLATES = [{"id": "94", "name": "4yr / 1yr cliff"},
                             {"id": "95", "name": "3yr / no cliff"}]

SAMPLE_SCALARS = {
    "option_grant": {
        "CORP_NAME": "Acme Corp", "CORP_ID": "2776", "ENV_HOST": "app.test.carta.rocks",
        "ISSUE_DATE": "June 11, 2026", "DRAFT_SET_ID": "new",
        "FLOW_TITLE": "Issue Option Grants",
        "SUBHEADING": "2024 Stock Plan &nbsp;·&nbsp; June 11, 2026",
        "DETAIL_TITLE": "Grant Detail",
        "DETAIL_INTRO": "Review before issuing. Use Back to edit to change anything.",
        "VIEW_URL_PATH": "options/list/2776/", "SECURITY_NOUN_PLURAL": "option grants",
        "ISSUE_MODAL_DISCLAIMER": "Confirming will save these grants to Carta and send "
                                  "them to the signatory for signature.",
    },
    "certificate": {
        "CORP_NAME": "Acme Corp", "CORP_ID": "2776", "ENV_HOST": "app.test.carta.rocks",
        "ISSUE_DATE": "June 11, 2026", "DRAFT_SET_ID": "new",
        "FLOW_TITLE": "Issue Certificates",
        "SUBHEADING": "June 11, 2026",  # no share-class names (design feedback) or draft-set status
        "DETAIL_TITLE": "Certificate Detail",
        "DETAIL_INTRO": "Review before issuing. Use Back to edit to change anything.",
        "VIEW_URL_PATH": "certificates/list/2776/",
        "SECURITY_NOUN_PLURAL": "certificates",
        "ISSUE_MODAL_DISCLAIMER": "Confirming will save these certificates to Carta and "
                                  "issue them to the cap table.",
    },
}

BLOCK_FILES = {
    "DETAIL_TABLE": "_detail_table.html",
    "KPI_STRIP": "_kpi.html",
    "PLAN_CARD": "_plan_card.html",
}


def _build_blocks(sectype: str, work: Path) -> dict:
    import json
    (work / "_rows.json").write_text(json.dumps(SAMPLE_ROWS[sectype]))
    args = [sys.executable, str(BUILD), "--security-type", sectype,
            "--rows", str(work / "_rows.json"), "--out-dir", str(work)]
    if sectype == "certificate":
        (work / "_cls.json").write_text(json.dumps(SAMPLE_CLASSES))
        args += ["--share-classes", str(work / "_cls.json")]
    else:
        (work / "_vt.json").write_text(json.dumps(SAMPLE_VESTING_TEMPLATES))
        args += ["--vesting-templates", str(work / "_vt.json")]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise SystemExit(f"build_review.py failed:\n{proc.stderr}")
    return {token: (work / fname).read_text() if (work / fname).is_file() else ""
            for token, fname in BLOCK_FILES.items()}


def render(sectype: str, out_dir: Path) -> Path:
    with tempfile.TemporaryDirectory() as td:
        blocks = _build_blocks(sectype, Path(td))
    html = TEMPLATE.read_text()
    subs = {"STYLES": STYLES.read_text(), "SAVE_PORT": "0",
            **SAMPLE_SCALARS[sectype], **blocks}
    for token, value in subs.items():
        html = html.replace("{{" + token + "}}", value)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"preview_review_{sectype}.html"
    out.write_text(html)
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Preview the issuance-review panel with sample data.")
    p.add_argument("--security-type", choices=["option_grant", "certificate"])
    p.add_argument("--out-dir", type=Path, default=Path(tempfile.gettempdir()) / "issuance-preview")
    p.add_argument("--open", action="store_true")
    args = p.parse_args(argv)

    types = [args.security_type] if args.security_type else ["option_grant", "certificate"]
    for t in types:
        out = render(t, args.out_dir)
        print(out)
        if args.open:
            webbrowser.open(out.as_uri())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
