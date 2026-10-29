# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
build_template_definition.py — turn the report a user built into a Carta report template definition.

Usage:
    uv run build_template_definition.py --config <config.json> --report-type <type> \
        --name-file <name.txt> --out <definition.json> [--report <report.json>] [--create-params <params.json>]

--config         the report_processor.py config that produced the report on screen.
--report-type    the report type that was run, e.g. securities_ledger_report.
--name-file      a text file holding the name to save the template under. A file rather than an
                 argument, so a name is never read by the shell.
--out            the definition file to write (schema v1, the body's `definition` for the save).
--report         the downloaded report JSON; defaults to the config's `local_file`.
--create-params  the arguments the report was created with; the filters among them are not saved.

The config names columns by header, and headers follow each company's terminology. The
definition names them by `key`, which the downloaded report JSON carries on every column, so the
script looks each header up in that file. It writes only what a template stores, and only what
the screen showed: the sheets in report order, the columns, the filters and the sort. A template
never stores an as-of date: every run asks for one. It ignores the config's `label_overrides`:
a renamed value is a display choice, and Carta's template renders its own labels. A filter on a
renamed value cannot be reproduced reliably there (text matches case-insensitively, a rename can
land on a value the report already holds, several raw values can share a label), so the script
never rewrites a filter value. When the config has `label_overrides`, it refuses only a filter a
rename can affect: a `contains` whose text (ignoring letter case) is inside a rename's raw value
or label, or any other operator whose value equals one of them. Every other filter is saved
unchanged.

Stdout is JSON. On success: {"out": <file>, "sheets": [<sheet name>, ...], "dropped_params": [...]},
where dropped_params are the report's scoping filters (people, plans, securities, share classes,
issue dates), which every run of the template leaves open; it is [] when the report had none. Any
other create param (one the report needs on every run, such as a stakeholder) refuses the save.
When it cannot save the report it writes nothing, exits 1, and prints
{"refused": [<reason in plain words>, ...]} with every reason it found.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# The plugin's shared lib/ sits above the skill; walk up so this runs standalone under `uv run`.
for _root in Path(__file__).resolve().parents:
    if (_root / "lib" / "report_display.py").is_file() and (_root / "lib" / "report_rows.py").is_file():
        sys.path.insert(0, str(_root / "lib"))
        break
from report_display import detect_hidden_columns, excel_sheet_name, normalize_columns  # noqa: E402
from report_rows import is_structural  # noqa: E402

SCHEMA_VERSION = 1

# The definition schema's limits, as references/mcp-tool-reference.md (reporting__create__report_template)
# lists them. Carta refuses a definition past them.
MAX_NAME = 255
MAX_SHEETS = 10
MAX_COLUMNS = 200
MAX_AFFIX = 31  # a prefix or suffix `from.value`
FILTER_OPS = (">", "<", ">=", "<=", "=", "!=", "contains")
SORT_DIRECTIONS = ("asc", "desc")

# Create params that every run sets for itself. They are not part of what a template stores.
RUN_TIME_PARAMS = frozenset(
    {"corporation_id", "report_type", "report_name", "export_format", "preview", "as_of_date"}
)

# Scoping filters a template leaves open on every run (mcp-tool-reference.md, filter params).
SCOPING_FILTERS = frozenset(
    {"stakeholder_ids", "equity_plan_ids", "security_ids", "share_class_ids", "issued_from", "issued_to"}
)

# A config field that transforms the data beyond select, filter and sort, with what to tell the user.
UNSUPPORTED = {
    "formulas": "Formulas (computed columns) can't be saved in a template yet.",
    "aggregations": "Summary rows and group-by totals can't be saved in a template yet.",
}
# Custom-field columns exist only at some dates; every other dynamic column (one per share class,
# equity plan, currency...) is saved by kind, field and the item the screen showed.
CUSTOM_FIELD_KINDS = frozenset({"custom_event", "custom_property"})
# Of those, the ones the config can also set for a single sheet.
UNSUPPORTED_PER_SHEET = ("formulas", "aggregations")


class TemplateRefused(Exception):
    def __init__(self, reasons):
        super().__init__("; ".join(reasons))
        self.reasons = reasons


def _unsupported_features(config):
    found = [feature for feature in UNSUPPORTED if config.get(feature)]
    sheets = config.get("sheets")
    if isinstance(sheets, dict):
        for feature in UNSUPPORTED_PER_SHEET:
            if feature not in found and any(sheet.get(feature) for sheet in sheets.values()):
                found.append(feature)
    reasons = [UNSUPPORTED[feature] for feature in found]
    reasons += _unreproducible_filters(config)
    return reasons


def _unreproducible_filters(config):
    """Refusal reasons for filters that touch a renamed value.

    A template cannot keep a `label_overrides` rename, and report_processor filters on the
    relabelled text. A rename replaces whole cells only, so it changes a filter's rows only when
    a `contains` text is inside a raw value or label, or another operator's value equals one
    (ignoring letter case, as report_processor does)."""
    overrides = config.get("label_overrides")
    if not overrides:
        return []
    sheets = config.get("sheets")
    filters = list(config.get("filters") or [])
    if isinstance(sheets, dict):
        filters += [item for sheet in sheets.values() for item in sheet.get("filters") or []]
    reasons = []
    for item in filters:
        if not isinstance(item, dict):
            continue
        text = str(item.get("value")).lower()
        op = item.get("op")
        for raw, label in overrides.items():
            names = (str(raw).lower(), str(label).lower())
            if text and any(text in name if op == "contains" else text == name for name in names):
                reasons.append(
                    f'The filter on "{item.get("column")}" uses "{item.get("value")}", a renamed value '
                    f'("{raw}" is shown as "{label}"), and a template can\'t keep that rename. '
                    "Filter on another column to save it."
                )
                break
    return reasons


def _sheet_transforms(config, report):
    """{sheet name: (columns, filters, sort, shared)} for the sheets to save, in the order
    report_processor shows them: report order. A named sheet the report lacks comes last, so it
    is refused.

    A per-sheet value replaces the global one. No `sheets` means every sheet of the report. In a
    `sheets` list, a `merge_sheets` target stands for its sources, as report_processor's own
    sheet list names the merged tab once its sources are folded into it.
    `shared` names the fields that came from the global value: report_processor applies those to
    every sheet and skips, on a sheet, a column that sheet lacks.
    """
    sheets = config.get("sheets")
    per_sheet = sheets if isinstance(sheets, dict) else {}
    merged = config.get("merge_sheets") or {}
    if isinstance(sheets, list):
        sheets = [src for name in sheets for src in (merged[name] if isinstance(merged.get(name), list) else [name])]
    if sheets is None:
        names = list(report)
    else:
        names = [name for name in report if name in sheets] + [name for name in sheets if name not in report]
    transforms = {}
    for name in names:
        own = per_sheet.get(name, {})
        values, shared = [], set()
        for field in ("columns", "filters", "sort"):
            if field in own:
                values.append(own[field])
            else:
                values.append(config.get(field))
                shared.add(field)
        columns, filters, sort = values
        transforms[name] = (columns, filters or [], sort or [], frozenset(shared))
    return transforms


def _shown_columns(sheet):
    """The sheet's columns as report_processor names and hides them: a blank header reads
    "Column N", and technical identifier columns are hidden by default."""
    columns = normalize_columns(sheet["columns"])
    n_cols = len(sheet["columns"])
    rows = [row for row in sheet.get("rows") or [] if not is_structural(row, n_cols)]
    return detect_hidden_columns(columns, rows)


def _column_key(sheet_name, column, reasons):
    """The column as a definition names it: its key, or for a dynamic column a
    {"dynamic", "field"?, "source"} reference to the one item the screen showed."""
    header = column.get("name")
    kind = column.get("dynamic")
    # A custom-field column is refused even when it also carries a key: the key does not make it
    # appear at every as-of date.
    if column.get("key") and not kind:
        return column["key"]
    if kind and kind not in CUSTOM_FIELD_KINDS and column.get("source") is not None:
        ref = {"dynamic": kind, "source": str(column["source"])}
        if column.get("field"):
            ref["field"] = column["field"]
        return ref
    if kind:
        reasons.append(
            f'"{header}" in "{sheet_name}" is a custom column that exists only at some dates, '
            "so it can't be saved in a template."
        )
    else:
        reasons.append(f"\"{header}\" in \"{sheet_name}\" carries no stable key, so it can't be saved in a template.")
    return None


def _incomplete(item, fields, what, sheet_name, reasons):
    missing = [field for field in fields if not isinstance(item, dict) or field not in item]
    if missing:
        reasons.append(f'A {what} on "{sheet_name}" is missing its {", ".join(missing)}.')
    return bool(missing)


def _sheet_definition(sheet_name, sheet, transforms, headers_elsewhere, reasons):
    columns, filters, sort, shared = transforms
    shown = _shown_columns(sheet)
    by_header = {}
    for column in shown:
        by_header.setdefault(column["name"], []).append(column)

    def applies(header, field):
        """False for a global column this sheet lacks but another saved sheet has:
        report_processor skips it here. One no saved sheet has is a typo, and is refused."""
        return header in by_header or field not in shared or header not in headers_elsewhere

    def key_of(header):
        matches = by_header.get(header)
        if not matches:
            reasons.append(f'"{sheet_name}" has no column "{header}".')
            return None
        if len(matches) > 1:
            reasons.append(f'"{sheet_name}" has several columns headed "{header}", so it is unclear which to save.')
            return None
        return _column_key(sheet_name, matches[0], reasons)

    if columns:
        chosen = [header for header in columns if applies(header, "columns")]
        keys = [key_of(header) for header in chosen]
        output_headers = {header for header in chosen if header in by_header}
    else:
        # The columns the screen shows: a spacer only lays the sheet out, and a hidden column
        # (an id or an email address) was never in front of the user.
        visible = [c for c in shown if not c.get("spacer") and not c.get("hidden")]
        keys = [_column_key(sheet_name, c, reasons) for c in visible]
        output_headers = {c["name"] for c in shown}

    saved_keys = [key for key in keys if key is not None]
    if not keys:
        reasons.append(f'"{sheet_name}" has no column to save.')
    if len(saved_keys) > MAX_COLUMNS:
        reasons.append(f'"{sheet_name}" has {len(saved_keys)} columns; a template keeps at most {MAX_COLUMNS} per sheet.')
    labels = [_ref_label(key) for key in saved_keys]
    repeated = sorted({label for label in labels if labels.count(label) > 1})
    if repeated:
        reasons.append(f'"{sheet_name}" names the same column more than once ({", ".join(repeated)}).')

    definition = {
        "name": excel_sheet_name(sheet_name),
        "from": {"match": "exact", "value": sheet_name},
        "columns": [key if isinstance(key, dict) else {"key": key} for key in saved_keys],
    }

    def filter_or_sort_key(header, what):
        """A filter or sort names a keyed column only: a template can't filter or sort on a
        dynamic one."""
        key = key_of(header)
        if isinstance(key, dict):
            reasons.append(f'The {what} on "{header}" in "{sheet_name}" uses a per-item column, which a template can\'t {what} on yet.')
            return None
        return key

    # report_processor filters before it selects columns, so a filter may name any column.
    saved_filters = []
    for item in filters:
        if _incomplete(item, ("column", "op", "value"), "filter", sheet_name, reasons):
            continue
        if not applies(item["column"], "filters"):
            continue
        if item["op"] not in FILTER_OPS:
            reasons.append(
                f'A filter on "{sheet_name}" uses "{item["op"]}"; use one of {" ".join(FILTER_OPS)}.'
            )
            continue
        value = item["value"]
        if not isinstance(value, (str, int, float, bool)):
            reasons.append(f'A filter on "{item["column"]}" in "{sheet_name}" compares to a value that is not text, a number or true/false.')
            continue
        key = filter_or_sort_key(item["column"], "filter")
        if key is not None:
            saved_filters.append({"key": key, "op": item["op"], "value": value})
    if saved_filters:
        definition["filters"] = saved_filters

    # It sorts after selecting, and skips a sort on a column the output lacks: save only the
    # sort the screen applied.
    saved_sort = []
    for item in sort:
        if _incomplete(item, ("column",), "sort", sheet_name, reasons):
            continue
        if item["column"] not in output_headers:
            continue
        direction = item.get("direction", "asc")
        if direction not in SORT_DIRECTIONS:
            reasons.append(f'The sort on "{item["column"]}" in "{sheet_name}" is "{direction}"; use asc or desc.')
            continue
        key = filter_or_sort_key(item["column"], "sort")
        if key is not None:
            saved_sort.append({"key": key, "direction": direction})
    if saved_sort:
        definition["sort"] = saved_sort
    return definition


def _ref_label(key):
    if not isinstance(key, dict):
        return key
    return ":".join(str(key[part]) for part in ("dynamic", "field", "source") if key.get(part))


def _merge_affix(sources, sheet_names):
    """(match, value) naming exactly these sheets among all the report's sheets: their common end
    (else start) of name, cut to the schema's limit. None when neither picks out exactly these sheets."""
    wanted = set(sources)
    reversed_names = [name[::-1] for name in sources]
    for match, value in (
        ("suffix", os.path.commonprefix(reversed_names)[::-1][-MAX_AFFIX:]),
        ("prefix", os.path.commonprefix(list(sources))[:MAX_AFFIX]),
    ):
        if not value:
            continue
        picked = {n for n in sheet_names if (n.endswith(value) if match == "suffix" else n.startswith(value))}
        if picked == wanted:
            return match, value
    return None


def _merge_sheets(config, sheets_by_source, report, reasons):
    """Fold each `merge_sheets` target into one definition sheet that matches its sources by a
    common end or start of name and merges them. The order is report_processor's: the sheets not
    merged, in report order, then each merged sheet in `merge_sheets` order."""
    merged = config.get("merge_sheets") or {}
    merged_out, merged_sources = [], set()
    for target, sources in merged.items():
        missing = [src for src in sources if src not in sheets_by_source] if isinstance(sources, list) else []
        if not isinstance(sources, list) or len(sources) < 2 or missing:
            reasons.append(f'The merged sheet "{target}" needs at least two sheets the report shows.')
            continue
        # report_processor pops each source the first time a merge uses it.
        if len(set(sources)) != len(sources) or merged_sources & set(sources):
            reasons.append(f'The merged sheet "{target}" uses a sheet that is already merged, so it can\'t be saved in a template.')
            continue
        affix = _merge_affix(sources, list(report))
        if affix is None:
            reasons.append(
                f'The sheets merged into "{target}" share no start or end of name that picks out only them, '
                "so the merge can't be saved in a template."
            )
            continue
        parts = [sheets_by_source[src] for src in sources]
        transforms = [{k: part.get(k) for k in ("columns", "filters", "sort")} for part in parts]
        if any(t != transforms[0] for t in transforms[1:]):
            reasons.append(f'The sheets merged into "{target}" pick, filter or sort columns differently, so they can\'t be saved as one sheet.')
            continue
        match, value = affix
        sheet = {"name": excel_sheet_name(target), "from": {"match": match, "value": value, "merge": True}}
        sheet.update({k: v for k, v in parts[0].items() if k not in ("name", "from")})
        merged_out.append(sheet)
        merged_sources.update(sources)
    return [sheet for source, sheet in sheets_by_source.items() if source not in merged_sources] + merged_out


def build_definition(config, report, report_type, default_name, create_params=None):
    """(definition, dropped_params) for the report the config describes. Raises TemplateRefused."""
    reasons = []
    reasons.extend(_unsupported_features(config))
    if not default_name.strip():
        reasons.append("The template needs a name.")
    elif len(default_name) > MAX_NAME:
        reasons.append(f"The name is {len(default_name)} characters; a template name has at most {MAX_NAME}.")

    if not all(isinstance(sheet, dict) and isinstance(sheet.get("columns"), list) for sheet in report.values()):
        reasons.append("The downloaded file is not a finished report.")
        raise TemplateRefused(reasons)

    transforms = _sheet_transforms(config, report)
    if not transforms:
        reasons.append("There is no sheet to save.")
    present = [name for name in transforms if name in report]
    headers = {name: {c["name"] for c in _shown_columns(report[name])} for name in present}
    sheets_by_source = {}
    for sheet_name, sheet_transforms in transforms.items():
        if sheet_name not in report:
            reasons.append(f'The report has no sheet called "{sheet_name}".')
            continue
        elsewhere = set().union(*(headers[name] for name in present if name != sheet_name))
        sheets_by_source[sheet_name] = _sheet_definition(sheet_name, report[sheet_name], sheet_transforms, elsewhere, reasons)
    sheets = _merge_sheets(config, sheets_by_source, report, reasons)
    # The limit counts the definition's sheets: a merged sheet is one, however many it folds in.
    if len(sheets) > MAX_SHEETS:
        reasons.append(f"The report has {len(sheets)} sheets; a template keeps at most {MAX_SHEETS}.")

    tab_names = [sheet["name"].casefold() for sheet in sheets]
    clashing = sorted({sheet["name"] for sheet in sheets if tab_names.count(sheet["name"].casefold()) > 1})
    if clashing:
        reasons.append(f"Two sheets would get the same tab name ({', '.join(clashing)}).")
    # Any other create param is one the report needs on every run (a stakeholder, a set of
    # sub-reports), which a template has nowhere to keep.
    needed = sorted(set(create_params or {}) - RUN_TIME_PARAMS - SCOPING_FILTERS)
    if needed:
        reasons.append(f"This report needs {', '.join(needed)} on every run, which a template can't keep yet.")
    if reasons:
        raise TemplateRefused(list(dict.fromkeys(reasons)))
    dropped = sorted(set(create_params or {}) & SCOPING_FILTERS)
    definition = {
        "schema_version": SCHEMA_VERSION,
        "default_name": default_name,
        # A template stores no create params: every run leaves the scoping filters open.
        "source": {"report_type": report_type, "params": {}},
        "sheets": sheets,
    }
    return definition, dropped


def _refuse(reasons):
    print(json.dumps({"refused": reasons}, ensure_ascii=False))
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Build a Carta report template definition")
    parser.add_argument("--config", required=True, help="the report_processor.py config JSON file")
    parser.add_argument("--report-type", required=True, help="the report type that was run")
    parser.add_argument("--name-file", required=True, help="text file holding the name to save the template under")
    parser.add_argument("--out", required=True, help="the definition JSON file to write")
    parser.add_argument("--report", help="the downloaded report JSON (default: the config's local_file)")
    parser.add_argument("--create-params", help="JSON file of the arguments the report was created with")
    args = parser.parse_args()

    config = json.loads(Path(args.config).read_text(encoding="utf-8"))
    name = Path(args.name_file).read_text(encoding="utf-8").strip()
    if not name:
        _refuse(["The template needs a name."])
    report_path = args.report or config.get("local_file")
    if not report_path:
        _refuse(["The downloaded report file is not on this computer, so its columns can't be read."])
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    create_params = json.loads(Path(args.create_params).read_text(encoding="utf-8")) if args.create_params else None

    try:
        definition, dropped = build_definition(config, report, args.report_type, name, create_params)
    except TemplateRefused as refused:
        _refuse(refused.reasons)
    Path(args.out).write_text(json.dumps(definition, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({"out": args.out, "sheets": [s["name"] for s in definition["sheets"]], "dropped_params": dropped}, ensure_ascii=False))


if __name__ == "__main__":
    main()
