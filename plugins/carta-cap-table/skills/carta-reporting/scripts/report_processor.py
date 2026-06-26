# /// script
# requires-python = ">=3.10"
# dependencies = ["requests"]
# ///
"""
report_processor.py — download, filter, transform, and preview cap table report JSON.

Usage:
    uv run report_processor.py <<'EOF'
    { "download_url": "...", "preview": 5 }
    EOF

Config JSON fields:
  download_url    str              S3 presigned URL
  sheets          list[str]|dict   Sheets to include (null = all).
                                   List form: filter to named sheets, apply global transforms.
                                   Dict form: per-sheet config — each key is a sheet name,
                                   value is an object with any of: columns, filters, sort,
                                   formulas, aggregations. Per-sheet values override globals.
  columns         list[str]        Global columns to include, in order (null = all)
  filters         list             Global filter predicates (see below)
  sort            list             Global sort spec (see below)
  formulas        list             Global formula column definitions (see below)
  aggregations    object           Global summary or group-by aggregation (see below)
  label_overrides dict             Map raw string cell values → display names, applied to all
                                   string-typed columns across every sheet (e.g. {"CBU": "Phantom Units"}).
                                   Matching is exact and case-sensitive. Applied before filtering and column selection.
  preview         int              Return first N rows only per sheet (null = all rows)

Per-sheet dict example:
  {
    "download_url": "...",
    "sheets": {
      "Equity Grants":    {"columns": ["Grant ID", "Award Type"], "sort": [{"column": "Grant Date", "direction": "desc"}]},
      "Vesting Schedule": {"columns": ["Grant ID", "Vest Date", "Shares Vested"]}
    }
  }

Filter:
  {"column": "Vested %", "op": ">", "value": 0.5}
  ops: > < >= <= = != contains

Sort:
  {"column": "Grant Date", "direction": "asc"}   # direction: asc | desc

Formulas:
  pct_of_total  {"name": "% of Total",   "op": "pct_of_total", "column": "Shares Issued"}
  running_sum   {"name": "Running Total", "op": "running_sum",  "column": "Amount"}
  ratio         {"name": "Ratio",         "op": "ratio",        "numerator": "A", "denominator": "B"}
  delta         {"name": "Change",        "op": "delta",        "column": "Price"}

Aggregations:
  Summary row:
    {"type": "summary", "columns": {"Shares Issued": "sum", "Vested %": "avg"}}
  Group-by:
    {"type": "group_by", "group_by": "Stakeholder Name",
     "columns": {"Shares Issued": "sum", "Grant Count": "count"}}
  Supported ops: sum avg min max count

Output JSON:
  {
    "data":  {sheet_name: {"columns": [...], "rows": [...]}},
    "stats": {sheet_name: {"original_row_count": N, "filtered_row_count": N,
                           "displayed_row_count": N, "missing_columns": [...],
                           "skipped_formulas": [...]}}
  }
"""

import json
import sys
from datetime import datetime


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_numeric(val):
    if val is None:
        return None
    try:
        return float(str(val).replace(",", "").replace("$", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


def _parse_date(val):
    if val is None:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d", "%b %d, %Y", "%B %d, %Y"):
        try:
            return datetime.strptime(str(val).strip(), fmt)
        except (ValueError, TypeError):
            continue
    return None


def _normalize_columns(columns):
    """Give unnamed columns a stable synthetic name matching the artifact engine.
    Marks them with _synthetic so the Excel export can restore the blank header."""
    result = []
    for i, col in enumerate(columns):
        if not col["name"]:
            result.append({**col, "name": f"Column {i + 1}", "_synthetic": True})
        else:
            result.append(col)
    return result


def _col_map(columns):
    return {col["name"]: i for i, col in enumerate(columns)}


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def _load_allowed_hosts():
    import json
    from pathlib import Path
    cfg = Path(__file__).parent.parent / "staff" / "allowed-hosts.json"
    base = {"documents.carta.com"}
    return base | set(json.loads(cfg.read_text())) if cfg.exists() else base


def download(url):
    from urllib.parse import urlparse
    import requests
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.netloc not in _load_allowed_hosts():
        raise ValueError(f"Unexpected download URL host: {parsed.netloc!r}")
    r = requests.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


# ---------------------------------------------------------------------------
# Filter
# ---------------------------------------------------------------------------

def _make_filter_predicate(columns, filters):
    """Return a (row) -> bool predicate for the given filter list."""
    if not filters:
        return lambda row: True
    idx_map  = _col_map(columns)
    type_map = {col["name"]: col["type"] for col in columns}

    def predicate(row):
        for f in filters:
            col_name = f["column"]
            if col_name not in idx_map:
                continue
            idx   = idx_map[col_name]
            val   = row[idx] if idx < len(row) else None
            op    = f["op"]
            thr   = f["value"]
            ctype = type_map.get(col_name, "string")
            keep  = True
            try:
                if ctype in ("money", "decimal", "percentage", "integer"):
                    v, t = _parse_numeric(val), float(thr)
                    if v is None:
                        keep = False
                    elif op == ">":        keep = v > t
                    elif op == "<":        keep = v < t
                    elif op == ">=":       keep = v >= t
                    elif op == "<=":       keep = v <= t
                    elif op == "=":        keep = v == t
                    elif op == "!=":       keep = v != t
                    elif op == "contains": keep = str(thr).lower() in str(v).lower()
                elif ctype == "date":
                    v, t = _parse_date(val), _parse_date(thr)
                    if v is None or t is None:
                        keep = False
                    elif op == ">":        keep = v > t
                    elif op == "<":        keep = v < t
                    elif op == ">=":       keep = v >= t
                    elif op == "<=":       keep = v <= t
                    elif op == "=":        keep = v == t
                    elif op == "!=":       keep = v != t
                    elif op == "contains": keep = str(thr).lower() in str(val or "").lower()
                else:
                    vs, ts = str(val or "").lower(), str(thr).lower()
                    if op == "contains":   keep = ts in vs
                    elif op == "=":        keep = vs == ts
                    elif op == "!=":       keep = vs != ts
            except (ValueError, TypeError):
                keep = False
            if not keep:
                return False
        return True

    return predicate


def apply_filters(columns, rows, filters):
    if not filters:
        return rows
    pred = _make_filter_predicate(columns, filters)
    return [row for row in rows if pred(row)]


# ---------------------------------------------------------------------------
# Empty-row elimination
# ---------------------------------------------------------------------------

def drop_empty_rows(columns, rows):
    """Drop rows where every numeric/money/percentage/integer column is null or zero.

    Identity-type columns (text, string, etc.) are excluded from the check —
    a row is "empty" only when it carries no quantitative data. This removes
    placeholder security-type rows (e.g. Options, RSAs) that Carta emits even
    when the company has never issued that type.

    A row is kept if at least one value column is non-null and non-zero.
    Rows where ALL value columns are None, 0, "0", or "" are dropped.
    If the report has no value columns at all, no rows are dropped.
    """
    value_types = {"money", "decimal", "percentage", "integer"}
    value_indices = [i for i, col in enumerate(columns) if col.get("type") in value_types]
    if not value_indices:
        return rows

    def _is_empty_value(v):
        if v is None or v == "" or v == "0":
            return True
        n = _parse_numeric(v)
        return n is not None and n == 0.0

    kept = []
    for row in rows:
        has_value = any(
            not _is_empty_value(row[i] if i < len(row) else None)
            for i in value_indices
        )
        if has_value:
            kept.append(row)
    return kept


# ---------------------------------------------------------------------------
# Column selection
# ---------------------------------------------------------------------------

def select_columns(columns, rows, column_names):
    """Returns (new_columns, new_rows, missing_column_names)."""
    if not column_names:
        return columns, rows, []

    idx_map = _col_map(columns)
    missing = [n for n in column_names if n not in idx_map]
    pairs   = [(columns[idx_map[n]], idx_map[n]) for n in column_names if n in idx_map]

    new_cols  = [c for c, _ in pairs]
    idxs      = [i for _, i in pairs]
    new_rows  = [[row[i] for i in idxs if i < len(row)] for row in rows]

    return new_cols, new_rows, missing


# ---------------------------------------------------------------------------
# Formulas
# ---------------------------------------------------------------------------

def apply_formulas(columns, rows, formulas):
    """Returns (new_columns, new_rows, skipped_formula_names)."""
    if not formulas:
        return columns, rows, []

    idx_map  = _col_map(columns)
    new_cols = list(columns)
    new_rows = [list(r) for r in rows]
    skipped  = []

    for f in formulas:
        op   = f.get("op")
        name = f.get("name", op)

        if op == "pct_of_total":
            src = f.get("column")
            if src not in idx_map:
                skipped.append(name)
                continue
            idx  = idx_map[src]
            vals = [(_parse_numeric(r[idx]) if idx < len(r) else None) or 0.0 for r in new_rows]
            total = sum(vals) or 1.0
            new_cols.append({"name": name, "type": "percentage"})
            for r, v in zip(new_rows, vals):
                r.append(round(v / total, 6))

        elif op == "running_sum":
            src = f.get("column")
            if src not in idx_map:
                skipped.append(name)
                continue
            idx     = idx_map[src]
            running = 0.0
            new_cols.append({"name": name, "type": "decimal"})
            for r in new_rows:
                running += (_parse_numeric(r[idx]) if idx < len(r) else None) or 0.0
                r.append(round(running, 4))

        elif op == "ratio":
            num_col = f.get("numerator")
            den_col = f.get("denominator")
            if num_col not in idx_map or den_col not in idx_map:
                skipped.append(name)
                continue
            ni, di = idx_map[num_col], idx_map[den_col]
            new_cols.append({"name": name, "type": "decimal"})
            for r in new_rows:
                n = _parse_numeric(r[ni]) if ni < len(r) else None
                d = _parse_numeric(r[di]) if di < len(r) else None
                r.append(round(n / d, 6) if n is not None and d else None)

        elif op == "delta":
            src = f.get("column")
            if src not in idx_map:
                skipped.append(name)
                continue
            idx  = idx_map[src]
            prev = None
            new_cols.append({"name": name, "type": "decimal"})
            for r in new_rows:
                curr = _parse_numeric(r[idx]) if idx < len(r) else None
                r.append(round(curr - prev, 4) if curr is not None and prev is not None else None)
                prev = curr

        else:
            skipped.append(name)

        # Refresh idx_map after each formula adds a column
        idx_map = _col_map(new_cols)

    return new_cols, new_rows, skipped


# ---------------------------------------------------------------------------
# Aggregations
# ---------------------------------------------------------------------------

def _agg_values(vals, op):
    nums = [v for v in vals if v is not None]
    if not nums and op != "count":
        return None
    if op == "sum":   return round(sum(nums), 4)
    if op == "avg":   return round(sum(nums) / len(nums), 4) if nums else None
    if op == "min":   return min(nums)
    if op == "max":   return max(nums)
    if op == "count": return len(nums)
    return None


def apply_aggregations(columns, rows, agg_spec):
    """
    agg_spec types:
      summary  — appends one totals row at the bottom.
      group_by — collapses rows by a key column, producing one row per group.
    Returns (new_columns, new_rows, summary_meta).
    summary_meta is {"count": N, "ops": {col_name: op}} for summary type, else None.
    """
    if not agg_spec:
        return columns, rows, None

    idx_map  = _col_map(columns)
    agg_type = agg_spec.get("type", "summary")
    agg_cols = agg_spec.get("columns", {})

    if agg_type == "summary":
        summary = []
        for i, col in enumerate(columns):
            op = agg_cols.get(col["name"])
            if i == 0:
                summary.append("Total")
            elif op:
                vals = [_parse_numeric(r[i]) for r in rows if i < len(r)]
                summary.append(_agg_values(vals, op))
            else:
                summary.append(None)
        return columns, rows + [summary], {"count": 1, "ops": agg_cols}

    elif agg_type == "group_by":
        group_col = agg_spec.get("group_by")
        if group_col not in idx_map:
            return columns, rows, None
        g_idx = idx_map[group_col]

        # Collect groups, preserving insertion order
        groups: dict = {}
        for row in rows:
            key = row[g_idx] if g_idx < len(row) else None
            groups.setdefault(key, []).append(row)

        # Output columns: group column first, then aggregated columns in original order
        out_cols  = [columns[g_idx]]
        agg_specs = []
        for col in columns:
            if col["name"] in agg_cols and col["name"] != group_col:
                op       = agg_cols[col["name"]]
                out_type = "integer" if op == "count" else col["type"]
                out_cols.append({"name": col["name"], "type": out_type})
                agg_specs.append((idx_map[col["name"]], op))

        out_rows = []
        for key, group_rows in groups.items():
            out_row = [key]
            for cidx, op in agg_specs:
                vals = [_parse_numeric(r[cidx]) for r in group_rows if cidx < len(r)]
                out_row.append(_agg_values(vals, op))
            out_rows.append(out_row)

        return out_cols, out_rows, None

    return columns, rows, None


# ---------------------------------------------------------------------------
# Sort
# ---------------------------------------------------------------------------

def sort_rows(columns, rows, sort_spec):
    if not sort_spec:
        return rows

    idx_map  = _col_map(columns)
    type_map = {col["name"]: col["type"] for col in columns}
    result   = list(rows)

    # Stable multi-key sort: apply specs in reverse order
    for s in reversed(sort_spec):
        col_name = s.get("column")
        if col_name not in idx_map:
            continue
        idx     = idx_map[col_name]
        ctype   = type_map.get(col_name, "string")
        reverse = s.get("direction", "asc") == "desc"

        def key_fn(row, idx=idx, ctype=ctype):
            val = row[idx] if idx < len(row) else None
            if ctype in ("money", "decimal", "percentage", "integer"):
                v = _parse_numeric(val)
                return (1, v) if v is not None else (0, 0.0)
            if ctype == "date":
                d = _parse_date(val)
                return (1, d) if d is not None else (0, datetime.min)
            return (1, str(val or "").lower()) if val is not None else (0, "")

        result = sorted(result, key=key_fn, reverse=reverse)

    return result


def sort_rows_with_indices(columns, rows, orig_indices, sort_spec):
    """Sort rows while keeping orig_indices in sync. Returns (rows, orig_indices)."""
    if not sort_spec:
        return rows, orig_indices

    idx_map  = _col_map(columns)
    type_map = {col["name"]: col["type"] for col in columns}
    paired   = list(zip(orig_indices, rows))

    for s in reversed(sort_spec):
        col_name = s.get("column")
        if col_name not in idx_map:
            continue
        ci      = idx_map[col_name]
        ctype   = type_map.get(col_name, "string")
        reverse = s.get("direction", "asc") == "desc"

        def key_fn(pair, ci=ci, ctype=ctype):
            row = pair[1]
            val = row[ci] if ci < len(row) else None
            if ctype in ("money", "decimal", "percentage", "integer"):
                v = _parse_numeric(val)
                return (1, v) if v is not None else (0, 0.0)
            if ctype == "date":
                d = _parse_date(val)
                return (1, d) if d is not None else (0, datetime.min)
            return (1, str(val or "").lower()) if val is not None else (0, "")

        paired = sorted(paired, key=key_fn, reverse=reverse)

    orig_indices_out = [p[0] for p in paired]
    rows_out         = [p[1] for p in paired]
    return rows_out, orig_indices_out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def apply_label_overrides(columns, rows, label_overrides):
    """Replace exact string cell values in string/text columns using the override map.

    label_overrides: dict mapping old value → new value, e.g. {"CBU": "Phantom Units"}.
    Only applied to columns whose type is string/text (not numeric or date).
    Matching is case-sensitive and exact (whole-cell only).
    """
    if not label_overrides:
        return rows
    string_types = {"string", "text", None}
    col_indices = [i for i, col in enumerate(columns) if col.get("type") in string_types]
    if not col_indices:
        return rows
    result = []
    for row in rows:
        new_row = list(row)
        for i in col_indices:
            if i < len(new_row) and new_row[i] in label_overrides:
                new_row[i] = label_overrides[new_row[i]]
        result.append(new_row)
    return result


def main():
    config = json.load(sys.stdin)

    download_url    = config.get("download_url")
    local_file      = config.get("local_file")
    sheets_config   = config.get("sheets")
    preview_n       = config.get("preview")
    label_overrides = config.get("label_overrides") or {}

    # Global transforms — used when sheets is a list or None
    g_columns     = config.get("columns")
    g_filters     = config.get("filters", [])
    g_sort        = config.get("sort", [])
    g_formulas    = config.get("formulas", [])
    g_aggregations = config.get("aggregations")

    if local_file:
        with open(local_file) as f:
            data = json.load(f)
    elif download_url:
        data = download(download_url)
    else:
        raise ValueError("Either 'local_file' or 'download_url' is required")

    # Resolve which sheets to process and their per-sheet transforms
    per_sheet = isinstance(sheets_config, dict)
    if per_sheet:
        allowed = set(sheets_config.keys())
    elif isinstance(sheets_config, list):
        allowed = set(sheets_config)
    else:
        allowed = None

    def sheet_transforms(name):
        if per_sheet:
            sc = sheets_config.get(name, {})
            return (
                sc.get("columns",      g_columns),
                sc.get("filters",      g_filters),
                sc.get("sort",         g_sort),
                sc.get("formulas",     g_formulas),
                sc.get("aggregations", g_aggregations),
            )
        return g_columns, g_filters, g_sort, g_formulas, g_aggregations

    result: dict = {}
    stats:  dict = {}

    for sheet_name, sheet in data.items():
        if allowed is not None and sheet_name not in allowed:
            continue

        columns, filters, sort_spec, formulas, aggregations = sheet_transforms(sheet_name)

        # Currency metadata from the sheet JSON
        raw_currency  = sheet.get("currency", {})
        base_currency = {"code": raw_currency.get("code", "USD"),
                         "symbol": raw_currency.get("symbol", "$")}
        # row_indexes → entire row uses the override currency
        # cell_indexes → [[row_idx, col_idx], ...] for mixed-currency rows
        row_currency_map:  dict = {}  # orig_row_idx → override currency info
        cell_currency_map: dict = {}  # (orig_row_idx, orig_col_idx) → override currency info
        for ov in raw_currency.get("overrides", []):
            ov_info = {"code": ov["code"], "symbol": ov["symbol"]}
            for ridx in ov.get("row_indexes", []):
                row_currency_map[ridx] = ov_info
            for cell in ov.get("cell_indexes", []):
                cell_currency_map[(cell[0], cell[1])] = ov_info

        cols           = _normalize_columns(sheet["columns"])
        rows           = sheet["rows"]
        original_count = len(rows)
        orig_indices   = list(range(len(rows)))  # track original row positions

        # Record original column name→index before any selection/reorder
        orig_col_name_to_idx = {col["name"]: i for i, col in enumerate(cols)}

        # Replace raw security type labels (e.g. "CBU") with configured display names
        # before filtering so filters against display names (e.g. "Phantom Units") work.
        rows = apply_label_overrides(cols, rows, label_overrides)

        # Filter with index tracking
        if filters:
            pred  = _make_filter_predicate(cols, filters)
            pairs = [(oi, r) for oi, r in zip(orig_indices, rows) if pred(r)]
            orig_indices = [p[0] for p in pairs]
            rows         = [p[1] for p in pairs]

        # Automatically drop rows where all numeric/value columns are null or zero.
        # This removes placeholder security-type rows (e.g. Options, RSAs) that
        # Carta emits even when the company has never issued that security type.
        nonempty = drop_empty_rows(cols, rows)
        if len(nonempty) < len(rows):
            kept_set     = {id(r) for r in nonempty}
            pairs        = [(oi, r) for oi, r in zip(orig_indices, rows) if id(r) in kept_set]
            orig_indices = [p[0] for p in pairs]
            rows         = [p[1] for p in pairs]

        filtered_count = len(rows)

        cols, rows, missing_cols = select_columns(cols, rows, columns)

        # Map: output column position j → original column index (None for unknown)
        new_to_old_col = [orig_col_name_to_idx.get(col["name"]) for col in cols]

        # Sort with index tracking
        rows, orig_indices = sort_rows_with_indices(cols, rows, orig_indices, sort_spec)

        n_before_formulas = len(cols)
        cols, rows, skipped_fmls = apply_formulas(cols, rows, formulas)
        # Formula columns have no original column index
        new_to_old_col.extend([None] * (len(cols) - n_before_formulas))

        cols, rows, summary_meta = apply_aggregations(cols, rows, aggregations)

        # After aggregations: summary appends one totals row (no original index);
        # group_by collapses all rows (all original indices lost).
        if summary_meta and summary_meta.get("count", 0) > 0:
            orig_indices = orig_indices + [None]
        elif aggregations and aggregations.get("type") == "group_by":
            orig_indices = [None] * len(rows)

        # Build row_currencies parallel to rows.
        # Each entry is one of:
        #   None                            → use base currency for all cells
        #   {"code":..., "symbol":...}      → row_indexes override (whole row)
        #   [None | {"code":..., "symbol":...}, ...]  → cell_indexes overrides (per output column)
        def _row_currency_entry(orig_row_idx):
            if orig_row_idx is None:
                return None
            if orig_row_idx in row_currency_map:
                return row_currency_map[orig_row_idx]
            if not cell_currency_map:
                return None
            cell_entries = [
                cell_currency_map.get((orig_row_idx, old_ci))
                for old_ci in new_to_old_col
            ]
            return cell_entries if any(e is not None for e in cell_entries) else None

        row_currencies = [_row_currency_entry(oi) for oi in orig_indices]

        displayed      = rows[:preview_n] if preview_n is not None else rows
        row_currencies = row_currencies[:preview_n] if preview_n is not None else row_currencies

        result[sheet_name] = {"columns": cols, "rows": displayed,
                              "currency": base_currency,
                              "row_currencies": row_currencies,
                              "summary_meta": summary_meta}
        stats[sheet_name]  = {
            "original_row_count":  original_count,
            "filtered_row_count":  filtered_count,
            "displayed_row_count": len(displayed),
            "missing_columns":     missing_cols,
            "skipped_formulas":    skipped_fmls,
        }

    # merge_sheets: {"Target Tab Name": ["Source Sheet A", "Source Sheet B"]}
    # Concatenates rows from source sheets into a single output tab; removes sources from output.
    # Columns in `result` are already normalized by _normalize_columns in the per-sheet loop above.
    for target_name, sources in config.get("merge_sheets", {}).items():
        merged_cols: list | None = None
        merged_rows: list = []
        merged_row_currencies: list = []
        merged_currency: dict | None = None
        merged_summary = None
        schema_warnings: list = []
        for src in sources:
            if src not in result:
                continue
            s = result.pop(src)
            stats.pop(src, None)
            if merged_cols is None:
                merged_cols    = s["columns"]
                merged_currency = s.get("currency")
            else:
                src_names = [c["name"] for c in s["columns"]]
                ref_names = [c["name"] for c in merged_cols]
                if src_names != ref_names:
                    schema_warnings.append(
                        f"'{src}' schema mismatch: expected {ref_names}, got {src_names}"
                    )
                    continue  # skip rows — mismatched schema would corrupt column alignment
            merged_rows.extend(s["rows"])
            src_rcs = s.get("row_currencies") or [None] * len(s["rows"])
            merged_row_currencies.extend(src_rcs)
            if s.get("summary_meta"):
                merged_summary = s["summary_meta"]
        if merged_cols is not None:
            result[target_name] = {"columns": merged_cols, "rows": merged_rows,
                                   "currency": merged_currency or {"code": "USD", "symbol": "$"},
                                   "row_currencies": merged_row_currencies,
                                   "summary_meta": merged_summary}
            stats[target_name] = {"original_row_count": len(merged_rows),
                                  "filtered_row_count": len(merged_rows),
                                  "displayed_row_count": len(merged_rows),
                                  "missing_columns": [], "skipped_formulas": [],
                                  "merged_from": sources,
                                  **({"schema_warnings": schema_warnings} if schema_warnings else {})}

    json.dump({"data": result, "stats": stats}, sys.stdout, indent=2, default=str)


if __name__ == "__main__":
    main()
