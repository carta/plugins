# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Turn resolved rows into the exact `drafts` array `save_drafts` /
`issue_securities` expect.

Three rules used to live only as prose in SKILL.md, which meant the model had to
remember them at mutate time — the single most dangerous moment in the flow:

1. **Per-field date formats.** Most date fields are `DateField`s and take either
   format, but `grant_expiration_date`, `vesting_start_date` and `rule_144_date`
   are `CharField(max_length=10)` on the draft model and take **`MM/DD/YYYY`
   only**. An ISO string in one of them is rejected with `Date is invalid`. There
   is no server-side coercion (payload-reference.md → Date format quirks).
2. **Non-payload keys must be stripped.** `import_notes` and `row_key` are
   bookkeeping; `plan_name`, `document_set_label`, `exercise_periods_text` and
   `legend_body` are review-only display fields. Any of them in the payload gets
   the whole mutate rejected for an unknown field.
3. **Empty means omit.** A `None`/`""` value is dropped rather than sent — an
   empty string in a date or price field is an error, not a blank.

Prose was already a weak mechanism. The spreadsheet-import path made rule 1's
stated precondition false outright: SKILL.md said these three fields "should
already be MM/DD/YYYY from Phases 0.5/1", but an imported row arrives prefilled
by the parser in ISO (correct — `<input type="date">` accepts nothing else) and
Phases 0.5/1 have nothing to do for it. So the conversion moved here.

Idempotent by construction: every date is parsed to a `date` first, then
formatted once. A row that is already `MM/DD/YYYY` — hand-edited, or from a run
that followed the old prose rule — round-trips unchanged.

Usage:
  uv run serialize_drafts.py --security-type option_grant \
      --rows <OUT_DIR>/_review_rows.json --out <OUT_DIR>/_drafts.json

Reads a JSON array of resolved rows; writes the `drafts` array. Pass the result
as the mutate's `drafts` argument verbatim.

Exit 0 — serialized. Exit 2 — a date could not be parsed, or the input was not a
JSON array; stderr names the row and field. It fails loudly rather than sending a
value the server will reject with a message the user can't act on.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

# Stored as CharField on the draft model — MM/DD/YYYY only, no server coercion.
CHARFIELD_DATE_FIELDS = frozenset({
    "grant_expiration_date",
    "vesting_start_date",
    "rule_144_date",
})

# DateFields: either format is accepted. Sent as ISO, the form every panel input
# and the parser already produce, so there is nothing to convert.
ISO_DATE_FIELDS = frozenset({
    "issue_date",
    "board_approval_date",
    "dividend_accrual_start_date",
    "hmrc_notified",          # DateTimeField — server normalises either format
})

# Never sent. Bookkeeping plus the review-only display fields.
NON_PAYLOAD_FIELDS = frozenset({
    "import_notes",
    "row_key",
    "plan_name",
    "document_set_label",
    "exercise_periods_text",
    "legend_body",
})

# Fields that are legitimately False/0 and must survive the empty-value drop.
KEEP_IF_FALSY = frozenset({
    "exercise_price",         # ZEPO hard-sets "0"
    "law_firm_price",         # 0 is valid on an LLC
    "price_per_share",
    "quantity",               # server rejects 0, but let it say so
    "needs_board_approval",   # False is meaningful: approved, not pending
    "vesting_template",       # null after an explicit "No vesting"
})

_ACCEPTED = ("%Y-%m-%d", "%m/%d/%Y")


class SerializeError(RuntimeError):
    """A value could not be put on the wire."""


def _to_date(value: Any, *, field: str, index: int) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    for fmt in _ACCEPTED:
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise SerializeError(
        "row {}: {} is {!r}, which is neither YYYY-MM-DD nor MM/DD/YYYY".format(
            index + 1, field, raw
        )
    )


def serialize_row(row: Dict[str, Any], index: int = 0) -> Dict[str, Any]:
    """One resolved row → one payload dict."""
    out: Dict[str, Any] = {}
    for field, value in row.items():
        if field in NON_PAYLOAD_FIELDS:
            continue
        if value is None or (isinstance(value, str) and not value.strip()):
            if field in KEEP_IF_FALSY and value is not None:
                continue  # an empty string is still not a value
            if field == "vesting_template" and value is None:
                out[field] = None  # explicit "No vesting" is a real null
            continue
        if field in CHARFIELD_DATE_FIELDS:
            out[field] = _to_date(value, field=field, index=index).strftime("%m/%d/%Y")
        elif field in ISO_DATE_FIELDS:
            out[field] = _to_date(value, field=field, index=index).strftime("%Y-%m-%d")
        else:
            out[field] = value
    return out


def serialize(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [serialize_row(r, i) for i, r in enumerate(rows) if isinstance(r, dict)]


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Serialize resolved rows into a drafts array.")
    p.add_argument("--rows", required=True, type=Path)
    p.add_argument("--out", type=Path, help="Write here; otherwise print to stdout")
    p.add_argument("--security-type", choices=["option_grant", "certificate"],
                   help="Recorded for symmetry with the other scripts; formats are per-field")
    args = p.parse_args(argv)

    try:
        rows = json.loads(args.rows.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("ERROR: could not read/parse {}: {}".format(args.rows, exc), file=sys.stderr)
        return 2
    if not isinstance(rows, list):
        print("ERROR: --rows must be a JSON array of row objects", file=sys.stderr)
        return 2

    try:
        drafts = serialize(rows)
    except SerializeError as exc:
        print("ERROR: {}".format(exc), file=sys.stderr)
        return 2

    payload = json.dumps(drafts, indent=2, ensure_ascii=False)
    if args.out:
        args.out.write_text(payload, encoding="utf-8")
        print("DRAFTS={}".format(args.out))
        print("ROW_COUNT={}".format(len(drafts)))
    else:
        print(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
