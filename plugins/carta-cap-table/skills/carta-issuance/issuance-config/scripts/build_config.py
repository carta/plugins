# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Build the issuance-config panel's dynamic HTML from fetched reference data.

Implements the per-stakeholder block contract in issuance-config/SKILL.md and the
field rules in carta-issuance/SKILL.md Phase 0.5. The model never writes panel markup.
The field builders live in `lib/issuance_fields.py` — the Cowork form collects the
identical set, and the two surfaces must not drift.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, List, Optional

_LIB = Path(__file__).resolve().parents[4] / "lib"
if str(_LIB) not in sys.path:
    sys.path.insert(0, str(_LIB))

from issuance_fields import (  # noqa: E402
    BuildError,
    build_batch_error_banner,
    build_stakeholder_blocks,
    build_stakeholder_list,
    results,
)


def _load(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise BuildError(f"could not read/parse {path}: {exc}") from exc


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Build issuance-config dynamic HTML blocks.")
    p.add_argument("--security-type", required=True, choices=["option_grant", "certificate"])
    p.add_argument("--data", required=True, type=Path, help="JSON of raw MCP reference results")
    p.add_argument("--knowns", required=True, type=Path, help="JSON of what the prompt supplied")
    p.add_argument("--out-dir", required=True, type=Path)
    args = p.parse_args(argv)

    try:
        data = _load(args.data)
        knowns = _load(args.knowns)
        if not isinstance(data, dict) or not isinstance(knowns, dict):
            print("ERROR: --data and --knowns must each be a JSON object", file=sys.stderr)
            return 2

        args.out_dir.mkdir(parents=True, exist_ok=True)
        written: List[str] = []

        def emit(key: str, filename: str, content: str) -> None:
            path = args.out_dir / filename
            path.write_text(content, encoding="utf-8")
            written.append(f"{key}={path}")

        rows = knowns.get("rows") or []
        if not isinstance(rows, list):
            rows = []
        rows = [r for r in rows if isinstance(r, dict)]

        emit("STAKEHOLDER_ROWS", "_rows.html", build_stakeholder_blocks(rows, args.security_type, data, knowns))

        # Roster powers autocomplete here and Phase 1's local name match, so
        # it's fetched once instead of per grantee. Absent → "[]".
        emit("STAKEHOLDER_LIST_JSON", "_stakeholders.json",
             build_stakeholder_list(results(data.get("stakeholders"))))

        # Panel-level banner for corp-/batch-level server errors (row-level
        # errors live in build_stakeholder_block instead). "" when clean.
        emit("BATCH_ERRORS_HTML", "_batch_errors.html", build_batch_error_banner(knowns.get("batch_errors")))
    except BuildError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    for line in written:
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
