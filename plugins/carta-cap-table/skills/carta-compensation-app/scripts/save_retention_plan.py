#!/usr/bin/env python3
"""Capture a corporation's refresh grant policy into <raw_dir>/retention_plan.json."""
import base64
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from save_benchmark_result import _load  # noqa: E402

# frequency_months alone is ambiguous (a benchmark version carries it too);
# require the pair that only a CorporationRetentionPlan record has.
_PLAN_KEYS = ("tenure_grant_adjustment", "tenure_eligibility_months")
_CONTAINER_KEYS = ("content", "result", "results", "rows", "data", "text")


def _is_plan(obj):
    return isinstance(obj, dict) and all(k in obj for k in _PLAN_KEYS)


def _decode_blob(blob):
    if not isinstance(blob, str):
        return None
    try:
        return json.loads(base64.b64decode(blob, validate=False).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None


def _collect(node, depth=0, found=None):
    """Every plan-shaped list reachable inside an MCP wrapper.

    Collects rather than returning the first hit, so a `{content:[{text},{resource}]}`
    wrapper cannot pick a stale summary block over the real payload sibling —
    the same failure mode save_benchmark_result was refactored to avoid.
    """
    if found is None:
        found = []
    if depth > 8:
        return found

    if isinstance(node, list):
        # Any plan-shaped element counts, not just node[0] — a leading text
        # summary block must not hide real plans that follow it.
        plans_in_list = [p for p in node if _is_plan(p)]
        if plans_in_list:
            found.append(plans_in_list)
        for item in node:
            _collect(item, depth + 1, found)
        return found

    if isinstance(node, dict):
        if _is_plan(node):
            found.append([node])

        res = node.get("resource")
        if isinstance(res, dict) and res.get("blob"):
            _collect(_decode_blob(res["blob"]), depth + 1, found)
        if node.get("blob") and "resource" not in node:
            _collect(_decode_blob(node["blob"]), depth + 1, found)

        for key in _CONTAINER_KEYS:
            val = node.get(key)
            if isinstance(val, str) and val.strip():
                try:
                    _collect(json.loads(val), depth + 1, found)
                except ValueError:
                    pass
            elif isinstance(val, (dict, list)):
                _collect(val, depth + 1, found)

    return found


def _pick_richest(candidates):
    """Winner: the candidate with the most UNIQUE plan ids (raw len() lets a
    padded text-block outrank the real resource-blob payload)."""
    if not candidates:
        return None

    def score(plans):
        seen = set()
        unique = 0
        for p in plans:
            pid = p.get("id")
            if pid is None:
                unique += 1
            elif pid not in seen:
                seen.add(pid)
                unique += 1
        return unique

    best = max(candidates, key=score)
    # Return the DEDUPED version, so a legitimate list that happens to carry a
    # duplicate id (a re-emission bug upstream) writes exactly one row per id.
    seen = set()
    out = []
    for p in best:
        pid = p.get("id")
        if pid is None or pid not in seen:
            out.append(p)
            if pid is not None:
                seen.add(pid)
    return out


def capture(src, raw_dir):
    plans = _pick_richest(_collect(_load(src)))
    if plans is None:
        sys.exit(
            "save_retention_plan: no retention plan payload found — the MCP "
            "result did not contain a record with tenure_grant_adjustment + "
            "tenure_eligibility_months. Confirm the call was "
            "compensation:get:retention-plan and re-capture."
        )

    out = pathlib.Path(raw_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "retention_plan.json").write_text(json.dumps(plans, indent=2) + "\n")

    print("save_retention_plan: captured %d plan(s)" % len(plans))
    return plans


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: save_retention_plan.py <src.json|-> <raw_dir>")
    capture(sys.argv[1], sys.argv[2])


if __name__ == "__main__":
    main()
