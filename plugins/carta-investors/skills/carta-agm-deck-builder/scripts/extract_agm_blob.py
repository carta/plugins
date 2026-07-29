#!/usr/bin/env python3
"""extract_agm_blob.py

Splits an AGM precompute blob (a single-line JSON file, typically 3–5 MB)
into one small JSON file per query so the LLM can Read each one individually.

Usage:
    python3 extract_agm_blob.py <blob_path> [output_dir]

    blob_path   Path returned by fa:get:agm_deck_data (the auto-saved blob)
    output_dir  Directory for per-query files  (default: /tmp/agm-queries)

Stdout — one line per query, then a summary line:
    OK   | Fund Performance Summary     |  1 rows | /tmp/agm-queries/fund_performance_summary.json
    OK   | NAV Trend                    | 24 rows | /tmp/agm-queries/nav_trend.json
    FAIL | Asset Type Breakdown         | error: <message>
    ...
    DONE | 20/21 succeeded | dir=/tmp/agm-queries | time=4200ms

The LLM should Read each file listed on OK lines to access the full query
result (columns + rows) for that slide.
"""

import json
import os
import re
import sys


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def main() -> int:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <blob_path> [output_dir]", file=sys.stderr)
        return 1

    blob_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "/tmp/agm-queries"

    if not os.path.exists(blob_path):
        print(f"ERROR: blob not found at {blob_path}", file=sys.stderr)
        return 1

    with open(blob_path, encoding="utf-8") as fh:
        data = json.load(fh)

    queries: dict = data.get("queries", {})
    meta: dict = data.get("metadata", {})

    os.makedirs(output_dir, exist_ok=True)

    succeeded = 0
    for name, result in queries.items():
        slug = _slugify(name)
        out_path = os.path.join(output_dir, f"{slug}.json")

        if result.get("error"):
            print(f"FAIL | {name:<40} | error: {result['error']}")
            continue

        columns = result.get("columns", [])
        raw_rows = result.get("rows", [])
        named_rows = [dict(zip(columns, row)) for row in raw_rows]

        payload = {
            "query_name": name,
            "columns": columns,       # kept for schema reference
            "rows": named_rows,       # dicts keyed by column name — never access by index
            "total_rows": result.get("total_rows", 0),
        }
        with open(out_path, "w", encoding="utf-8") as out:
            json.dump(payload, out, ensure_ascii=False, indent=2)

        row_count = result.get("total_rows", len(result.get("rows", [])))
        print(f"OK   | {name:<40} | {row_count:>4} rows | {out_path}")
        succeeded += 1

    total = len(queries)
    time_ms = meta.get("execution_time_ms", "?")
    print(f"DONE | {succeeded}/{total} succeeded | dir={output_dir} | time={time_ms}ms")

    # Write an index file so the LLM can discover all paths in one Read
    index = {
        "metadata": meta,
        "queries": {
            name: {
                "file": os.path.join(output_dir, f"{_slugify(name)}.json"),
                "total_rows": result.get("total_rows", 0),
                "error": result.get("error"),
            }
            for name, result in queries.items()
        },
    }
    index_path = os.path.join(output_dir, "_index.json")
    with open(index_path, "w", encoding="utf-8") as idx:
        json.dump(index, idx, ensure_ascii=False, indent=2)
    print(f"INDEX: {index_path}")

    return 0 if succeeded > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
