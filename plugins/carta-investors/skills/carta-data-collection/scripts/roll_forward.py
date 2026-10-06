"""Turn one period's requests into the next period's send:request payloads.

Reads the previous period's rows on stdin — either data_collection__list__requests
output (requirement lists as {type, required} pairs) or data_collection__get__requirements
output (sibling requested_*/required_* code lists) — applies the drops and adds,
groups companies whose resulting requirements are identical, and emits one
send:request parameter object per group (chunked at the send's entity ceiling).

Pure stdin→stdout: this script never calls the Carta API. The model reads the
source rows, runs this, and makes the send calls itself — with its confirmations.

    call output | python3 roll_forward.py \
        --organization-pk 1234 --period quarters:2026:3 --due-date 2026-10-31 \
        --drop-document 8

Output: {"summary": {...}, "sends": [...]} — companies whose requirement set
would end up empty land in summary.blocked instead of an invalid payload, and
disabled configuration rows are skipped and counted.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any

UNITS = ("weeks", "months", "quarters", "half_years", "years")
KINDS = ("files", "metrics", "documents")

Item = tuple[str, str, bool]  # (kind, type, required)


def _fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stdout)
    raise SystemExit(2)


def _parse_period(raw: str) -> tuple[str, int, int]:
    parts = raw.split(":")
    if len(parts) != 3 or parts[0] not in UNITS:
        _fail(f"--period must be UNIT:YEAR:INDEX with UNIT one of {UNITS}, got {raw!r}")
    try:
        return parts[0], int(parts[1]), int(parts[2])
    except ValueError:
        _fail(f"--period year and index must be integers, got {raw!r}")
    raise AssertionError  # unreachable


def _parse_add(raw: str, kind: str) -> Item:
    """CODE or CODE:required — everything added is optional unless said."""
    type_, _, flag = raw.partition(":")
    if flag not in ("", "required"):
        _fail(f"--add-{kind[:-1]} takes TYPE or TYPE:required, got {raw!r}")
    return (kind, type_, flag == "required")


def _pairs(value: Any) -> list[dict[str, Any]] | None:
    """The {type, required} pair shape list:requests returns, or None."""
    if not isinstance(value, list) or not all(isinstance(i, dict) for i in value):
        return None
    return value


def _row_items(row: dict[str, Any]) -> set[Item]:
    items: set[Item] = set()
    for kind in KINDS:
        pairs = _pairs(row.get(f"requested_{kind}"))
        if pairs is not None:
            for pair in pairs:
                if pair.get("type") is None:
                    continue
                items.add((kind, str(pair["type"]), bool(pair.get("required"))))
            continue
        # get:requirements shape: sibling code lists, required ⊆ requested.
        requested = row.get(f"requested_{kind}") or []
        required = {str(t) for t in (row.get(f"required_{kind}") or [])}
        for type_ in requested:
            items.add((kind, str(type_), str(type_) in required))
    return items


def _apply(items: set[Item], drops: set[tuple[str, str]], adds: set[Item]) -> tuple[set[Item], bool]:
    kept = {i for i in items if (i[0], i[1]) not in drops}
    # An add replaces any surviving entry of the same type, so TYPE:required
    # upgrades an optional item rather than duplicating it.
    add_keys = {(i[0], i[1]) for i in adds}
    kept = {i for i in kept if (i[0], i[1]) not in add_keys} | adds
    return kept, kept != items


def _requirement_lists(items: set[Item]) -> dict[str, list[dict[str, Any]]]:
    out: dict[str, list[dict[str, Any]]] = {}
    for kind in KINDS:
        entries = sorted((i for i in items if i[0] == kind), key=lambda i: i[1])
        if entries:
            out[f"requested_{kind}"] = [
                # Document types travel as their integer ids.
                {"type": int(t) if kind == "documents" else t, "required": req}
                for _, t, req in entries
            ]
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization-pk", type=int, required=True)
    parser.add_argument("--period", required=True, help="UNIT:YEAR:INDEX, e.g. quarters:2026:3")
    parser.add_argument("--due-date", required=True, help="YYYY-MM-DD; send:request requires it")
    for kind in KINDS:
        singular = kind[:-1]
        parser.add_argument(f"--drop-{singular}", action="append", default=[], metavar="TYPE")
        parser.add_argument(f"--add-{singular}", action="append", default=[], metavar="TYPE[:required]")
    parser.add_argument("--notify", action="append", default=[], choices=("company", "firm"))
    parser.add_argument("--send-follow-up", action="store_true")
    parser.add_argument("--skip-entity", action="append", default=[], metavar="ENTITY_ID",
                        help="Companies that already hold a request in the target period")
    parser.add_argument("--max-entities", type=int, default=100)
    args = parser.parse_args()

    unit, year, index = _parse_period(args.period)
    drops = {(kind, str(t)) for kind in KINDS for t in getattr(args, f"drop_{kind[:-1]}")}
    adds = {_parse_add(raw, kind) for kind in KINDS for raw in getattr(args, f"add_{kind[:-1]}")}

    try:
        data = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        _fail(f"stdin is not JSON: {exc}")
    rows = data.get("results") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        _fail("expected a list of rows, or an object with a 'results' list")

    skip = set(args.skip_entity)
    groups: dict[tuple[Item, ...], list[dict[str, str]]] = {}
    seen: set[str] = set()
    skipped: list[str] = []
    disabled: list[str] = []
    blocked: list[str] = []
    modified = 0

    for row in rows:
        if not isinstance(row, dict) or not row.get("entity_id"):
            continue
        entity_id = str(row["entity_id"])
        if entity_id in seen:
            continue
        seen.add(entity_id)
        if entity_id in skip:
            skipped.append(entity_id)
            continue
        if row.get("enabled") is False:
            disabled.append(entity_id)
            continue
        items, changed = _apply(_row_items(row), drops, adds)
        if changed:
            modified += 1
        if not items:
            blocked.append(entity_id)
            continue
        key = tuple(sorted(items))
        groups.setdefault(key, []).append(
            {"entity_id": entity_id, "entity_type": str(row.get("entity_type") or "")}
        )

    sends: list[dict[str, Any]] = []
    for key in sorted(groups):
        entities = sorted(groups[key], key=lambda e: e["entity_id"])
        for start in range(0, len(entities), args.max_entities):
            sends.append(
                {
                    "organization_pk": args.organization_pk,
                    "entities": entities[start : start + args.max_entities],
                    "interval": {"unit": unit, "value": 1},
                    "period_year": year,
                    "period_index": index,
                    "due_date": args.due_date,
                    "use_company_config_template": False,
                    **_requirement_lists(set(key)),
                    "notify_audiences": sorted(set(args.notify)),
                    "send_follow_up": args.send_follow_up,
                }
            )

    summary: dict[str, Any] = {
        "companies": sum(len(g) for g in groups.values()),
        "groups": len(groups),
        "sends": len(sends),
        "modified": modified,
    }
    if skipped:
        summary["skipped_existing"] = sorted(skipped)
    if disabled:
        summary["skipped_disabled"] = sorted(disabled)
    if blocked:
        summary["blocked_empty_requirements"] = sorted(blocked)

    json.dump({"summary": summary, "sends": sends}, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
