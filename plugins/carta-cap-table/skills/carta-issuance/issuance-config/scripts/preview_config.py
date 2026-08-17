# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Render the issuance-config panel to a standalone HTML file with sample data —
NO Carta MCP, NO full skill run.

This is a **design-iteration harness**. A designer edits ``references/styles.css`` or
``references/template.html``, runs this once, and opens the result in a browser to see
the change live. It reproduces what ``artifact-manager:render-panel`` does at runtime:

  1. runs ``build_config.py`` on committed sample fixtures to produce the dynamic
     blocks (option/vesting/docset or share-class/legend buttons, grantee rows, and
     the stakeholder roster for autocomplete),
  2. inlines ``styles.css`` into ``{{STYLES}}`` and substitutes every other
     ``{{TOKEN}}`` with a sample value,
  3. neutralizes ``{{SAVE_PORT}}`` so the Review button no-ops instead of POSTing,
  4. writes ``<out>/preview_config_<type>.html``.

Usage:
  uv run preview_config.py                      # both types → /tmp, print paths
  uv run preview_config.py --security-type certificate --open
  uv run preview_config.py --out-dir ./_preview

The sample fixtures live inline below so the harness is self-contained and never
touches the network. Edit them if you want to preview a different shape (more rows,
a longer legend, etc.)."""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
REFS = HERE.parent / "references"
BUILD = HERE / "build_config.py"
TEMPLATE = REFS / "template.html"
STYLES = REFS / "styles.css"

# ── Sample fixtures (stand in for the fetched MCP reference data + roster) ──
SAMPLE_DATA = {
    "option_grant": {
        "vesting_templates": {"results": [
            {"id": "94", "name": "4yr / 1yr cliff"},
            {"id": "95", "name": "3yr / no cliff"},
        ]},
        "acceleration_templates": {"results": [
            {"id": "3", "name": "Single trigger"},
            {"id": "4", "name": "Double trigger"},
        ]},
        "document_sets": {"results": [
            {"id": "12", "name": "Standard option grant docs"},
        ]},
        "stakeholders": {"results": [
            {"name": "Jane Doe", "email": "jane@acme.com", "id": 7,
             "kind": "INDIVIDUAL", "event_relationship": "Employee"},
            {"name": "John Smith", "email": "john@acme.com", "id": 8,
             "kind": "INDIVIDUAL", "event_relationship": "Consultant"},
        ]},
    },
    "certificate": {
        "share_classes": {"results": [
            {"prefix": "CS", "name": "Common Stock"},
            {"prefix": "PA", "name": "Series A Preferred"},
        ]},
        "legends": {"results": [
            {"id": "7", "name": "Standard restrictive legend",
             "body": "THE SECURITIES REPRESENTED BY THIS CERTIFICATE HAVE NOT BEEN "
                     "REGISTERED UNDER THE SECURITIES ACT OF 1933 AND MAY NOT BE "
                     "SOLD OR TRANSFERRED ABSENT REGISTRATION OR AN EXEMPTION."},
        ]},
        "vesting_templates": {"results": [
            {"id": "94", "name": "4yr / 1yr cliff"},
        ]},
        "acceleration_templates": {"results": [
            {"id": "3", "name": "Single trigger"},
        ]},
        "stakeholders": {"results": [
            {"name": "Jane Doe", "email": "jane@acme.com", "id": 7,
             "kind": "INDIVIDUAL", "event_relationship": "Employee"},
        ]},
    },
}

SAMPLE_KNOWNS = {
    # Two rows demonstrate divergent per-row terms: Jane keeps the batch
    # default; John carries his own NSO/no-vesting/price/reason. Both stay
    # within the one resolved jurisdiction (US). John also carries
    # `import_notes` so the amber import markers (issuance-import) are visible
    # in the preview — both the inline per-field kind and the block-level
    # fallback for a field this panel has no row for.
    "option_grant": {
        "jurisdiction": "US", "today_iso": "2026-06-11", "currency": "USD",
        "exercise_price_default": "1.45",
        "rows": [
            {"name": "Jane Doe", "quantity": "1000", "acceleration_template": "3"},
            {"name": "John Smith", "quantity": "250", "option_type": "NSO",
             "exercise_price": "2.00", "vesting_template_id": "__none__",
             "grant_reason": "Promotion",
             "import_notes": [
                 {"field": "vesting_template_id", "raw_value": "1/48 monthly 1yr cliff",
                  "reason": "no vesting schedule on this company matches it — pick one"},
                 {"field": "state_of_residency", "raw_value": "CA",
                  "reason": "not a field on this panel"},
             ]},
        ],
    },
    "certificate": {
        "today_iso": "2026-06-11", "currency": "USD", "price_per_share_default": "",
        "share_class_prefix": "PA",
        "rows": [
            {"name": "Jane Doe", "quantity": "500",
             "import_notes": [
                 {"field": "quantity", "raw_value": "five hundred",
                  "reason": "couldn't read this quantity"},
             ]},
            # Demonstrates the inline Rule 144 reason and opt-in vesting/acceleration.
            {"name": "John Smith", "quantity": "200", "rule_144_mode": "other",
             "rule_144_date": "2026-07-01", "rule_144_reason": "affiliates",
             "vesting_template_id": "94", "acceleration_template": "3"},
        ],
    },
}

# ── Sample scalar substitutions (the values render-panel would pass at runtime) ──
SAMPLE_SCALARS = {
    "option_grant": {
        "CORP_NAME": "Acme Corp", "CORP_ID": "2776",
        "FLOW_TITLE": "Issue Option Grants", "HEADER_SUB": "2 grantees",
        "SECURITY_TYPE": "option_grant",
    },
    "certificate": {
        "CORP_NAME": "Acme Corp", "CORP_ID": "2776",
        "FLOW_TITLE": "Issue Certificates", "HEADER_SUB": "1 holder",
        "SECURITY_TYPE": "certificate",
    },
}

# Dynamic-block token → the file build_config.py writes for it. (The per-type
# option/vesting/docset/share-class/legend button HTML no longer has its own
# top-level token — it's assembled inside each per-row block within
# STAKEHOLDER_ROWS.)
BLOCK_FILES = {
    "STAKEHOLDER_ROWS": "_rows.html",
    "STAKEHOLDER_LIST_JSON": "_stakeholders.json",
    "BATCH_ERRORS_HTML": "_batch_errors.html",
}


def _build_blocks(sectype: str, work: Path) -> dict:
    """Run build_config.py on the sample fixtures; return token → block-string.
    Missing files (the inactive type's blocks) default to "" — same as artifact.yaml."""
    import json
    (work / "_data.json").write_text(json.dumps(SAMPLE_DATA[sectype]))
    (work / "_knowns.json").write_text(json.dumps(SAMPLE_KNOWNS[sectype]))
    proc = subprocess.run(
        [sys.executable, str(BUILD), "--security-type", sectype,
         "--data", str(work / "_data.json"), "--knowns", str(work / "_knowns.json"),
         "--out-dir", str(work)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0:
        raise SystemExit(f"build_config.py failed:\n{proc.stderr}")
    blocks = {}
    for token, fname in BLOCK_FILES.items():
        f = work / fname
        blocks[token] = f.read_text() if f.is_file() else ""
    return blocks


def render(sectype: str, out_dir: Path) -> Path:
    with tempfile.TemporaryDirectory() as td:
        blocks = _build_blocks(sectype, Path(td))
    html = TEMPLATE.read_text()
    subs = {"STYLES": STYLES.read_text(),
            "SAVE_PORT": "0",   # Review POSTs to :0 → fails fast, harmless in preview
            **SAMPLE_SCALARS[sectype], **blocks}
    for token, value in subs.items():
        html = html.replace("{{" + token + "}}", value)
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / f"preview_config_{sectype}.html"
    out.write_text(html)
    return out


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Preview the issuance-config panel with sample data.")
    p.add_argument("--security-type", choices=["option_grant", "certificate"],
                   help="Render just one type (default: both).")
    p.add_argument("--out-dir", type=Path, default=Path(tempfile.gettempdir()) / "issuance-preview")
    p.add_argument("--open", action="store_true", help="Open the rendered file(s) in a browser.")
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
