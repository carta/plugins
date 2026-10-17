# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
build_report_page.py — assemble the report artifact page from processed data.

Usage:
    uv run build_report_page.py --result <result.json> [--label <name>] --params <params.json> --output <slug.html>

--result  report_processor.py's --out file.
          Repeat it, with one --label per --result, for several corporations.
--params  the artifact's `config` object (title, reportType, entityName, corporationId,
          generatedBy, asOfDate, metaRows)
--output  the HTML file to write

The page is `_REPORT_PAYLOAD` script, then `_REPORT_PARAMS` script, then the engine: the engine's
boot code runs as soon as its <script> is parsed, so the payload must already be defined.
Each sheet is copied whole from the result, so currency fields are never dropped, except
that a sheet with no data rows (none matched, or only empty placeholder rows) is left out. Stdout is JSON: {"output": <file>,
"omitted_sheets": [...]}; when every sheet is empty it exits non-zero and writes nothing.
"""

import argparse
import json
import sys
from pathlib import Path

# The plugin's shared lib/ sits above the skill; walk up so this runs standalone under `uv run`.
for _root in Path(__file__).resolve().parents:
    if (_root / "lib" / "script_json.py").is_file():
        sys.path.insert(0, str(_root / "lib"))
        break
from script_json import script_json  # noqa: E402

ENGINE_PATH = Path(__file__).resolve().parent.parent / "assets" / "artifact_engine.html"


def merge_results(results, labels):
    """One `data` dict from several results, plus the sheets left out.

    A sheet with no data rows left after the filter and the empty-row drop
    (`filtered_row_count` minus `empty_rows_dropped` is 0) is left out: a totals row can make
    its `rows` non-empty. With labels, each sheet is named
    "{label} — {sheet}" so corporations stay apart in the single sheet list. Returns
    (data, omitted), omitted being the final names of the sheets left out."""
    data, omitted = {}, []
    for index, result in enumerate(results):
        for name, sheet in result["data"].items():
            final = "%s — %s" % (labels[index], name) if labels else name
            sheet_stats = result.get("stats", {}).get(name)
            if sheet_stats and sheet_stats.get("filtered_row_count", 0) - sheet_stats.get("empty_rows_dropped", 0) == 0:
                omitted.append(final)
            else:
                data[final] = sheet
    return data, omitted


def build_page(data, params, engine_html):
    payload = {"config": params, "data": data}
    return (
        "<script>const _REPORT_PAYLOAD = " + script_json(payload) + ";</script>\n"
        "<script>const _REPORT_PARAMS = " + script_json({"config": params}) + ";</script>\n"
        + engine_html
    )


def main():
    parser = argparse.ArgumentParser(description="Build the Carta report artifact page")
    parser.add_argument("--result", required=True, action="append", help="report_processor.py --out file")
    parser.add_argument("--label", action="append", help="corporation name; one per --result when merging")
    parser.add_argument("--params", required=True, help="JSON file with the artifact config object")
    parser.add_argument("--output", required=True, help="HTML file to write")
    args = parser.parse_args()

    results = [json.loads(Path(p).read_text(encoding="utf-8")) for p in args.result]
    if len(results) > 1 and len(args.label or []) != len(results):
        parser.error("give one --label per --result when using several")
    params = json.loads(Path(args.params).read_text(encoding="utf-8"))
    data, omitted = merge_results(results, args.label)
    if not data:
        sys.exit("No rows matched those filters: every sheet is empty, so there is no report to build.")
    page = build_page(data, params, ENGINE_PATH.read_text(encoding="utf-8"))
    Path(args.output).write_text(page, encoding="utf-8")
    print(json.dumps({"output": args.output, "omitted_sheets": omitted}, ensure_ascii=False))


if __name__ == "__main__":
    main()
