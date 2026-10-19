"""Row shapes in Carta report JSON that label or total the data instead of carrying it.

Shared by report_processor.py and excel_exporter.py. The artifact engine
(skills/carta-reporting/assets/artifact_engine.html: rowIsSection / rowIsTotal) applies the
same section rules in JavaScript, plus one extra total rule: a plain list of 2+ cells whose
first cell starts with "Total" is a totals row there but a data row here. Change them together.

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
