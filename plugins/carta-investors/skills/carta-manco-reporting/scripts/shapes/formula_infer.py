"""
Deterministic inference of GL-account mappings from a budget workbook's own
formulas — the client's own calculation, read as mapping evidence alongside
(never instead of) name-matching a line's label against Carta's chart of
accounts.

What this resolves, mirroring the two cases a live session found by reading
a workbook by hand: a bucket line's own Actual/Budget cell is a `SUM` (or a
plain `+`-chain) over OTHER rows — on the same sheet, or a single named
sheet elsewhere in the workbook — and those rows carry the real GL identity;
or it is a `SUMIF`/`SUMIFS` whose criteria argument is itself a literal GL
code or reporting-tag value.

This module never executes a formula and never resolves what a referenced
row actually contains — that answer lives in a different part of the
already-parsed workbook, not in the formula string. Callers supply that as
`row_gl_codes` (this sheet) and `other_sheet_row_gl_codes` (a named sheet
elsewhere in the same workbook).

Anything this can't resolve with confidence — `VLOOKUP`/`INDEX`/`MATCH`, a
whole-column/whole-row range, a formula naming more than one other sheet, a
`SUMIFS` criteria that is itself computed rather than literal or a single
cell, an arithmetic expression mixing addition with subtraction/
multiplication/division — comes back as unresolved with a plain-English
reason and the raw formula preserved. Never guessed at: a wrong mapping
moves real money and is worse than a blank, which is at least visible.

long-comment-ok: mirrors this plugin's existing module-docstring convention
(see parse_coa_mapping.py) — the rationale for refusing rather than guessing
is exactly the kind of non-obvious constraint that convention keeps here.
"""

from __future__ import annotations

import re

# A same-sheet reference: `C5`, `$C$5`. Anchored so a caller-split argument
# is checked whole, not just matched somewhere inside a longer expression.
_CELL_RX = re.compile(r"^\$?[A-Za-z]{1,3}\$?(\d+)$")
_RANGE_RX = re.compile(r"^\$?[A-Za-z]{1,3}\$?(\d+)\s*:\s*\$?[A-Za-z]{1,3}\$?(\d+)$")

# 'Sheet Name'! or SheetName! — Excel quotes a sheet name only when it needs
# to (spaces, punctuation), so both forms appear in real workbooks.
_SHEET_PREFIX_RX = re.compile(r"(?:'([^']+)'|([A-Za-z_][\w. ]*))!")

_QUOTED_RX = re.compile(r'^"([^"]*)"$|^\'([^\']*)\'$')
_FUNC_RX = re.compile(r"^([A-Za-z]+)\((.*)\)$", re.DOTALL)

_SUM_FUNCS = {"SUM", "SUBTOTAL"}
_CRITERIA_FUNCS = {"SUMIF", "SUMIFS"}

# SUBTOTAL's own aggregation-function codes for SUM (109 ignores hidden rows,
# 9 doesn't) — the only codes this module treats as addition.
_SUBTOTAL_SUM_CODES = {9, 109}


def referenced_sheet(formula: str) -> str | None:
    """The other sheet this formula names.

    None for a same-sheet formula (no `!` at all). The sentinel string
    `"__ambiguous__"` when the formula names more than one distinct other
    sheet — a real formula shape (`=Sheet1!C5+Sheet2!C9`), but not one this
    module trusts itself to resolve, since the caller-supplied lookups are
    keyed by a single sheet name.
    """
    sheets = {m.group(1) or m.group(2) for m in _SHEET_PREFIX_RX.finditer(formula)}
    if len(sheets) == 1:
        return next(iter(sheets))
    if len(sheets) > 1:
        return "__ambiguous__"
    return None


def infer_gl_codes(
    formula: str,
    *,
    row_gl_codes,
    other_sheet_row_gl_codes: dict | None = None,
    known_gl_codes=None,
    known_tag_values=None,
    cell_value=None,
) -> dict:
    """Resolve a formula to the GL code(s) it evidently pulls from.

    `row_gl_codes`/`other_sheet_row_gl_codes` map a row number (this sheet,
    or one named other sheet) to its own GL codes. Returns `{"resolved":
    [...], "sources": [...], "unresolved_reason": None}`, or an empty
    `resolved` with a plain-English `unresolved_reason` — never a guess.
    """
    if not isinstance(formula, str) or not formula.strip().startswith("="):
        return _unresolved("not a formula")

    body = formula.strip()[1:].strip()
    m = _FUNC_RX.match(body)
    func = m.group(1).upper() if m else None

    # SUMIF/SUMIFS resolve off literal criteria, not off a range's sheet —
    # check this before the sheet-lookup gating below, which doesn't apply.
    if func in _CRITERIA_FUNCS:
        return _resolve_criteria_func(func, m.group(2), known_gl_codes, known_tag_values, cell_value)
    if func is not None and func not in _SUM_FUNCS:
        return _unresolved(f"formula calls {func}(), which this doesn't resolve")

    lookup, err = _sheet_lookup(formula, row_gl_codes, other_sheet_row_gl_codes)
    if err:
        return err

    if func in _SUM_FUNCS:
        # Strip every sheet prefix so the reference regexes below see bare
        # cell/range tokens, exactly as for a same-sheet formula.
        return _resolve_sum(func, _SHEET_PREFIX_RX.sub("", m.group(2)), lookup)

    # No function call — a bare reference or an additive chain of them
    # ("=C27+C29+C44", "='Budget FY2026 outline'!C44").
    return _resolve_plain(_SHEET_PREFIX_RX.sub("", body), lookup)


def _sheet_lookup(formula: str, row_gl_codes, other_sheet_row_gl_codes):
    """`(lookup, None)` for the sheet this formula's references live on, or
    `(None, <unresolved dict>)` when that sheet is ambiguous or unsupplied."""
    sheet = referenced_sheet(formula)
    if sheet == "__ambiguous__":
        return None, _unresolved("references more than one other sheet")
    if not sheet:
        return row_gl_codes, None
    other = (other_sheet_row_gl_codes or {}).get(sheet)
    if other is None:
        return None, _unresolved(f"references sheet {sheet!r}, which wasn't supplied for lookup")
    return other, None


def _resolve_sum(func: str, args_str: str, lookup) -> dict:
    args = _split_top_level(args_str)
    if func == "SUBTOTAL":
        if not args or not _looks_like_int(args[0].strip()):
            return _unresolved("SUBTOTAL with a non-literal function-code argument")
        code = int(args[0].strip())
        if code not in _SUBTOTAL_SUM_CODES:
            return _unresolved(f"SUBTOTAL function code {code} is not a sum")
        args = args[1:]

    rows: list[int] = []
    for raw in args:
        a = raw.strip()
        if not _is_pure_ref(a):
            return _unresolved(f"argument {a!r} is not a plain cell/range reference")
        rows.extend(_rows_in_ref(a))
    if not rows:
        return _unresolved("no cell references found")
    return _resolve_rows(rows, lookup)


def _resolve_plain(body: str, lookup) -> dict:
    # An additive chain only. Subtraction/multiplication/division changes
    # which rows to include or how, not just which to add — resolving that
    # correctly needs more than "union the rows this formula touches", so
    # it stays out of scope rather than being approximated.
    if re.search(r"[-*/]", body):
        return _unresolved("not a plain sum of cell references")
    rows: list[int] = []
    for raw in body.split("+"):
        a = raw.strip()
        if not a:
            continue
        if not _is_pure_ref(a):
            return _unresolved(f"{a!r} is not a plain cell/range reference")
        rows.extend(_rows_in_ref(a))
    if not rows:
        return _unresolved("no cell references found")
    return _resolve_rows(rows, lookup)


def _resolve_rows(rows: list[int], lookup) -> dict:
    resolved: set[int] = set()
    sources: list[dict] = []
    no_identity: list[int] = []
    for r in rows:
        codes = lookup(r) or []
        if not codes:
            no_identity.append(r)
            continue
        resolved.update(codes)
        sources.append({"row": r, "gl_codes": list(codes)})
    if not resolved:
        reason = "none of the referenced rows carry a GL code of their own"
        if no_identity:
            reason += f" (rows {no_identity})"
        return _unresolved(reason)
    return {"resolved": sorted(resolved), "sources": sources, "unresolved_reason": None}


def _resolve_criteria_func(func, args_str, known_gl_codes, known_tag_values, cell_value) -> dict:
    args = _split_top_level(args_str)
    known_gl = {int(g) for g in (known_gl_codes or []) if _looks_like_int(str(g))}
    known_tags = {str(v).strip().lower() for v in (known_tag_values or []) if str(v).strip()}

    if func == "SUMIF":
        if len(args) < 2:
            return _unresolved("SUMIF with too few arguments")
        pairs = [(args[0], args[1])]
    else:
        if len(args) < 3 or (len(args) - 1) % 2 != 0:
            return _unresolved("SUMIFS with an unexpected argument count")
        pairs = [(args[i], args[i + 1]) for i in range(1, len(args), 2)]

    resolved_gl: set[int] = set()
    matched_tag_only = False
    matched_any = False
    for _crit_range, criteria in pairs:
        c = criteria.strip()
        value = _literal_value(c)
        if value is None and cell_value is not None and _is_pure_ref(c):
            value = cell_value(c)
        if value is None:
            continue
        # Excel's own SUMIFS matching treats "7101" the same as 7101.
        numeric = int(value) if isinstance(value, (int, float)) else (
            int(value) if isinstance(value, str) and _looks_like_int(value) else None)
        if numeric is not None and numeric in known_gl:
            resolved_gl.add(numeric)
            matched_any = True
        elif isinstance(value, str) and value.strip().lower() in known_tags:
            matched_any = True
            matched_tag_only = True

    if not matched_any:
        return _unresolved("no literal criteria matched a known GL code or tag value")
    if resolved_gl:
        return {
            "resolved": sorted(resolved_gl),
            "sources": [{"criteria": "literal"}],
            "unresolved_reason": None,
        }
    assert matched_tag_only
    return _unresolved(
        "criteria matched a known reporting-tag value, but resolving that to a GL "
        "account would require scanning the summed range's own rows, which this "
        "module doesn't do — only a literal GL-code criteria resolves directly"
    )


def _split_top_level(s: str) -> list[str]:
    """Split on commas outside quotes and nested parens."""
    parts: list[str] = []
    cur: list[str] = []
    depth = 0
    in_quote = False
    for ch in s:
        if ch == '"':
            in_quote = not in_quote
            cur.append(ch)
        elif ch == "(" and not in_quote:
            depth += 1
            cur.append(ch)
        elif ch == ")" and not in_quote:
            depth -= 1
            cur.append(ch)
        elif ch == "," and depth == 0 and not in_quote:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def _is_pure_ref(s: str) -> bool:
    return bool(_CELL_RX.match(s) or _RANGE_RX.match(s))


def _rows_in_ref(s: str) -> list[int]:
    m = _RANGE_RX.match(s)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        return list(range(min(a, b), max(a, b) + 1))
    m = _CELL_RX.match(s)
    if m:
        return [int(m.group(1))]
    return []


def _looks_like_int(s: str) -> bool:
    s = s.strip()
    return s.lstrip("-").isdigit()


def _literal_value(s: str):
    m = _QUOTED_RX.match(s)
    if m:
        return m.group(1) if m.group(1) is not None else m.group(2)
    try:
        return int(s)
    except ValueError:
        pass
    try:
        return float(s)
    except ValueError:
        return None


def _unresolved(reason: str) -> dict:
    return {"resolved": [], "sources": [], "unresolved_reason": reason}
