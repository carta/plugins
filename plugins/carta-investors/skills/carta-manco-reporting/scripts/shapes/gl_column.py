"""
Finds a workbook's own dedicated GL/account-code column by its header text.

Crosstab adapters default to reading GL codes from column A. Some real
workbooks instead carry a fully-populated "Account #" column elsewhere,
with column A given to a label — silently joining zero rows to actuals.

Vocabulary matches parse_coa_mapping.py's own "gl" field test, kept in
sync on purpose so a client's phrasing is only recognized in one place.
"""

from __future__ import annotations

from collections.abc import Iterable

# Substrings that only appear in a GL header, never as a stray fragment
# ("gl code" always pairs "gl" with a qualifier, unlike bare "gl").
_GL_HEADER_SUBSTRINGS = (
    "gl account", "gl code", "gl #", "gl id", "account #",
    "account number", "acct #", "acct number", "carta gl",
)
# Bare words are exact-matched only — "gl" as a substring would also catch
# "single" or "angle".
_GL_HEADER_EXACT = ("gl", "gl #", "account", "acct")


def find_gl_header_column(ws, header_rows: int | Iterable[int],
                           max_col: int | None = None) -> int | None:
    """Column (1-based) of a header cell naming a GL/account-code column,
    or None when none of `header_rows` carries one.

    `header_rows` is a single row or an iterable of them, scanned in row
    order with the first match winning — a crosstab's own header block can
    span more than one row (a title band above the row that actually
    labels each column), and the GL column's label can land on either.
    """
    rows = (header_rows,) if isinstance(header_rows, int) else tuple(header_rows)
    limit = max_col or ws.max_column
    for row in rows:
        for c in range(1, limit + 1):
            v = ws.cell(row, c).value
            if not isinstance(v, str) or not v.strip():
                continue
            t = v.strip().lower()
            if t in _GL_HEADER_EXACT or any(k in t for k in _GL_HEADER_SUBSTRINGS):
                return c
    return None
