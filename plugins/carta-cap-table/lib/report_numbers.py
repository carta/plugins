"""How report cells written as text are read as numbers.

Shared by report_processor.py (filters, sorts, formulas, aggregations) and excel_exporter.py
(workbook cells), so a figure means the same thing at every stage of the pipeline.
"""
import math


def parse_number(val):
    """Read a cell as a finite number: plain numbers, "1,000", "$1,234.56", "46.81%" and
    "(5.00)" (negative, also "(5.00%)"). A percent sign is stripped, not scaled; the caller
    decides what it means. Returns None for anything else (blank, text, NaN, infinity)."""
    if val is None or isinstance(val, bool):
        return None
    if isinstance(val, (int, float)):
        return val if math.isfinite(val) else None
    text = str(val).strip()
    negative = text.startswith("(") and text.endswith(")")
    text = text.strip("()").replace(",", "").replace("$", "").rstrip("%").strip()
    try:
        number = float(text)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return -number if negative else number
