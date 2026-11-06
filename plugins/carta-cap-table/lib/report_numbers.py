"""How report cells written as text are read as numbers.

Shared by report_processor.py (filters, sorts, formulas, aggregations) and excel_exporter.py
(workbook cells), so a figure means the same thing at every stage of the pipeline.
Mirrored in JavaScript by skills/carta-reporting/assets/artifact_engine.html: parse_number by
parseNum, parse_fraction by parseCell and is_percent_text by isPercentText; change each pair together.
"""
import math
from decimal import Decimal


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


def is_percent_text(val):
    """Whether a cell is written as a percentage ("46.81%", "(5.00%)")."""
    return isinstance(val, str) and "%" in val


def parse_fraction(val):
    """Read a cell as a number, where text with a percent sign is a fraction wherever it sits:
    "46.81%" -> 0.4681 and "(5.00%)" -> -0.05, also in a count column (a cap table's ownership
    rows put percentages under share-count headers). Anything else reads as parse_number does."""
    number = parse_number(val)
    if number is None or not is_percent_text(val):
        return number
    # Decimal division, so "14.28%" is the same float as 0.1428.
    return float(Decimal(repr(number)) / 100)
