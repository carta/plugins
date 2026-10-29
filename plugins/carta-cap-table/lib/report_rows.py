"""Row shapes in Carta report JSON that label or total the data instead of carrying it.

Shared by report_processor.py and excel_exporter.py. `{_t}` rows are totals in the engine and the
exporter. The artifact engine (skills/carta-reporting/assets/artifact_engine.html) applies the
section and total rules in JavaScript: rowIsSection (the `{_s}` object and one-string list) and
rowIsTotal (the `{_t}` object only). A plain list is always a data row, whatever its first cell
says. excel_exporter counts its summary formula rows from the end of the sheet
(summary_meta.count), not from `{_t}`. Change the shared rules together.

  {"_s": "Preferred"}      section heading
  ["Preferred"]            section heading (one-element string list) -- only when the sheet
                           has more than one column; in a one-column sheet it is a data row
  {"_t": ["Total", 8]}     totals row
"""


def is_section_list(row, n_cols):
    """n_cols is the sheet's column count: with one column, ["Alice"] is data, not a heading."""
    return n_cols > 1 and isinstance(row, list) and len(row) == 1 and isinstance(row[0], str)


def is_structural(row, n_cols):
    """True for any row that is not a plain list of data cells."""
    return isinstance(row, dict) or is_section_list(row, n_cols)


def relabel_structural(row, overrides):
    """Apply a {raw: display} label map to the text a structural row shows."""
    if not overrides:
        return row
    if isinstance(row, dict):
        if isinstance(row.get("_s"), str):
            return {**row, "_s": overrides.get(row["_s"], row["_s"])}
        if isinstance(row.get("_t"), list):
            return {**row, "_t": [overrides.get(c, c) if isinstance(c, str) else c for c in row["_t"]]}
        return row
    return [overrides.get(row[0], row[0])]  # only reached for section lists
