#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.9"
# dependencies = ["openpyxl>=3.1"]
# ///
"""
Parse a firm-supplied "Carta COA → Budget Category" mapping workbook into a
compact coa-mapping.json for consumption by build_manco_datadir.py + the
dashboard. The mapping bridges naming drift between a budget workbook's own
department/category labels and Carta's real reporting-tag values.

A mapping typically carries entries shaped like:
  Carta GL 7101 / Carta tag "CS (Client Svcs)" / Budget section
  "CS (Client Services)" / Budget category "Salaries"
while the actual Carta journal entries are tagged with just "CS" and the
budget workbook's own department super-header reads "Client Services".
Without a mapping, the Budget-vs-Actuals table can't join Carta actuals to
the workbook's department columns for anything tagged that way — the column
silently reads $0.

Column layout and position are DETECTED, not assumed — a firm's mapping
sheet is exactly as likely to carry 5 columns (no confidence/notes, no
distinct section column) as the full 7. Two independent signals locate each
field: header-cell text (broad keyword coverage per field, never assumed
exhaustive) and, for the GL-code column specifically, the column's own
DATA — a run of 3-5 digit values is a GL-code column regardless of what its
header says, which matters because that header is the single least
predictable one across real workbooks. See `_find_header_row_and_columns`
and `_column_looks_like_gl_codes`.

When no distinct section column exists, the department-tag column is reused
as the section-resolution input too — some sheets pack both into one
column, encoding the department context inside the tag itself (e.g.
"GAP (FS)": "GAP" is the Carta tag, "(FS)" is what resolves the department).

The sheet itself is also discovered, not assumed by a fixed default name:
`inspect_workbook.py`'s `coa-mapping` shape classification finds it by the
same GL-code-column signal, guarded against matching a financial statement
or a raw ledger dump (see that module for the row-count and repeat-ratio
guards this needs).

`header_row`/`columns` are round-tripped in the output's `workbook_meta` so
a caller can persist them (the skill does, in `.coa-mapping-ref.json`) and
feed them back via `--header-row`/`--columns` on a later re-ingest of the
same workbook — skipping re-detection rather than re-running it and risking
a different outcome on a sheet that hasn't changed shape.

v1 emits only dept-level aliases. Category-level joining (needed for cases
like "Payroll Taxes (Employer) + Workers Comp" folding two workbook rows
into one Carta GL) is deferred.

A sheet with no reporting-tag column at all — no department, cost center,
fund, office, or other breakout axis, just a plain GL-to-category map — needs
`--no-tag-axis` to confirm that's real rather than a detection gap; see the
ValueError this otherwise raises, and `--suggest` for checking which case a
given sheet is before reaching for the flag.

`tag_category` names which Carta reporting-tag category the workbook's
columns break out by. Firms tag for their own reasons, and there is no
default: it is resolved at ingest against the categories the firm
actually uses, by matching their values to the workbook's columns.

Emitted coa-mapping.json shape:
  {
    "records": [{gl, gl_name, carta_tag, section, category, confidence, notes}, ...],
    "value_aliases": {"<workbook_dept>": ["<carta_tag_1>", ...]},
    "tag_category": "<Carta reporting-tag category>",   # optional
    "workbook_meta": {"filename": "...", "parsed_at": "..."}
  }

Derivation rules for value_aliases:
  - Take each unique (Carta Department Tag, Budget File Section) pair.
  - Normalize the Carta tag by stripping any parenthetical annotation
    ("CS (Client Svcs)" → "CS"). This is what actually appears on JEs.
  - Resolve the Budget Section to the canonical department name via
    shapes/vocab.py — a parenthetical expansion wins ("CS (Client
    Services)" → "Client Services"), then the part before a separator
    ("Operations/Finance" → "Operations"), then the section itself.
  - Sections naming an accounting concept rather than a team ("Income",
    "All departments") are cross-cutting: a row filed under one applies
    firm-wide, so deriving a department alias from it would wrongly bind
    every department to that row's Carta tag. Those are skipped.
  - `--dept-vocabulary-from <budget.json>` reconciles the derived names
    against the department names the budget workbook actually uses, so a
    section reading "Investment" lands on the workbook's "Investment Team"
    and every artifact in the pipeline keys on one spelling. Optional —
    without it the derived names are emitted as-is.

No firm's vocabulary is hardcoded. Everything is derived from the two files
the parser is handed.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shapes.vocab import tag_value_for_section, dept_vocabulary  # noqa: E402


# Column headers are matched by keyword, broadened for the common ways a
# firm phrases each field — not an exhaustive dictionary (no fixed keyword
# list ever is), which is why `_column_looks_like_gl_codes` below exists as
# a header-text-independent fallback for the one field that most needs to
# be right. Order matters within a field's own test tuple where one phrasing
# could shadow another (e.g. "name" is checked before the bare gl/account
# test, so "GL Account Name" doesn't get misread as the GL-code column).
_HEADER_FIELD_TESTS = (
    ("gl_name",    lambda t: "name" in t and ("gl" in t or "account" in t or "acct" in t)),
    ("gl",         lambda t: any(k in t for k in (
                       "gl account", "gl code", "gl #", "gl id", "account #",
                       "account number", "acct #", "acct number", "carta gl",
                   )) or t.strip() in ("gl", "gl #", "account", "acct")),
    # Before carta_tag: a firm whose sub-accounts are offices heads the
    # column "Office", which the tag test below would otherwise claim.
    ("sub_account", lambda t: any(k in t for k in (
                       "sub-account", "sub account", "subaccount",
                       "sub-acct", "sub acct", "subacct",
                   ))),
    ("carta_tag",  lambda t: any(k in t for k in (
                       # Fallback only. The firm's real tag values identify
                       # this column when they're known (see
                       # _column_by_tag_overlap) — no keyword list covers
                       # what a client names their own category. These are
                       # words a CLIENT writes, so add, never replace:
                       # every one dropped is a client file that stops
                       # matching.
                       "department", "tag_value", "cost center", "cost centre",
                       "team", "carta tag", "reporting tag", "tag",
                       "office", "location", "initiative", "project",
                       "program", "programme", "entity", "class",
                   ))),
    ("section",    lambda t: any(k in t for k in ("section", "bucket", "group"))),
    ("category",   lambda t: any(k in t for k in (
                       "category", "line item", "budget line", "budget category",
                   ))),
    ("confidence", lambda t: any(k in t for k in ("confidence", "match quality", "certainty"))),
    ("notes",      lambda t: any(k in t for k in ("notes", "comment", "remark"))),
)


def carta_sub_accounts(path):
    """Every sub-account the firm's own journal entries carry.

    Same ground truth as carta_tag_values, for the column a client heads
    with their own word for it — "Office", "Location", "Site". Nothing in
    the wording says sub-account; the values do.
    """
    try:
        payload = json.loads(Path(path).expanduser().read_text())
    except Exception:
        return set()
    out = {(e.get("sub") or "").strip() for e in (payload.get("entries") or [])}
    for d in (payload.get("rowDimensions") or []):
        if d.get("source") == "sub_account":
            out |= {(v.get("value") or "").strip() for v in (d.get("values") or [])}
    return {v for v in out if v}


def carta_tag_values(path):
    """Every reporting-tag value the firm's own journal entries carry.

    Ground truth, straight from Carta. Read from a prior run's
    accounts.json (or snapshot.json), so a cold first run simply has none
    and falls back to the header wording.
    """
    try:
        payload = json.loads(Path(path).expanduser().read_text())
    except Exception:
        return set()
    out = set()
    for e in (payload.get("entries") or []):
        for t in (e.get("tags") or []):
            v = (t.get("value") or "").strip()
            if v:
                out.add(v)
    for d in (payload.get("dimensions") or payload.get("tagCategories") or []):
        for v in (d.get("values") or []):
            val = (v.get("value") or "").strip()
            if val:
                out.add(val)
    return out


def _column_by_tag_overlap(ws, header_row, known_values, sample=40, threshold=0.4):
    """The column whose cells are the firm's real Carta tag values.

    Header wording is the weaker signal: a firm can head this column
    "Carta Department Tag", "Reporting Tag", or the category's own name,
    and no keyword list covers what a client might invent. What doesn't
    vary is the data — the column that holds their tag values IS the tag
    column. Same reasoning as _column_looks_like_gl_codes.
    """
    if not known_values:
        return None
    wanted = {_norm_tag(v) for v in known_values}
    best, best_score = None, 0.0
    for col in range(1, (ws.max_column or 0) + 1):
        seen = hits = 0
        for r in range(header_row + 1, min(ws.max_row, header_row + sample) + 1):
            cell = ws.cell(r, col).value
            if cell is None or not str(cell).strip():
                continue
            seen += 1
            if _norm_tag(_strip_parenthetical(str(cell))) in wanted or _norm_tag(str(cell)) in wanted:
                hits += 1
        if seen and (hits / seen) > max(threshold, best_score):
            best, best_score = col, hits / seen
    return best


def _norm_tag(v):
    return " ".join(str(v or "").strip().lower().split())


def _classify_column_header(value) -> str | None:
    """Which record field a header cell's text names, or None for a column
    this parser doesn't use (e.g. an informational '$ Actual' column)."""
    if not isinstance(value, str) or not value.strip():
        return None
    t = value.strip().lower()
    for field, test in _HEADER_FIELD_TESTS:
        if test(t):
            return field
    return None


def _column_looks_like_gl_codes(ws, header_row: int, col: int,
                                 sample: int = 20, threshold: float = 0.6) -> bool:
    """Whether the data below `header_row` in `col` reads like GL codes.

    Header wording for the GL-code column varies more than any keyword list
    can keep up with — a firm can call it "Acct #", "Ledger Code", or nothing
    at all. What doesn't vary is the data: GL codes are short numbers.
    Checking the actual cell values directly identifies this column
    regardless of what its header says, and doubles as corroboration when
    the header text IS recognizable (real header + real GL data agreeing is
    much stronger evidence than either alone).
    """
    checked = matched = 0
    for r in range(header_row + 1, min(header_row + 1 + sample, ws.max_row + 1)):
        v = ws.cell(r, col).value
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        checked += 1
        if _parse_gl_codes(v):
            matched += 1
    return checked >= 3 and (matched / checked) >= threshold


def _find_header_row_and_columns(ws) -> tuple[int, dict[str, int]] | tuple[None, None]:
    """Locate the real header row and which column holds each field.

    Two independent signals, deliberately combined rather than either one
    alone: header-text keywords (broad but never exhaustive — a firm can
    phrase a column however it likes) and column *content* (a GL-code
    column is short numbers no matter what its header says). Requiring
    either an unambiguous keyword match on `gl` OR a content-detected
    numeric-code column, plus at least one more recognized column, is what
    keeps a title/description banner (a sentence, not a table row) from
    being mistaken for the header — a banner row has no adjacent column
    carrying real GL-code data below it, so content detection correctly
    rejects it even on a row whose own text happens to mention "GL Account".
    """
    max_col = min(ws.max_column, 15)
    for r in range(1, min(15, ws.max_row + 1)):
        cols: dict[str, int] = {}
        for c in range(1, max_col + 1):
            field = _classify_column_header(ws.cell(r, c).value)
            if field and field not in cols:  # first occurrence wins
                cols[field] = c

        # Content corroboration / fallback for the GL column specifically.
        # Prefer a keyword-classified column if its own data also looks like
        # GL codes; otherwise scan every column for one that does, since the
        # header phrasing for this column is the least predictable of all.
        gl_col = cols.get("gl")
        if gl_col is None or not _column_looks_like_gl_codes(ws, r, gl_col):
            for c in range(1, max_col + 1):
                if _column_looks_like_gl_codes(ws, r, c):
                    gl_col = c
                    break
        if gl_col is not None:
            cols["gl"] = gl_col

        if "gl" in cols and len(cols) >= 2:
            return r, cols
    return None, None


def suggest(workbook_path: str | Path, sheet_name: str, sample_rows: int = 10) -> dict:
    """A starting guess plus the raw data to check it against — never the
    final word on column identification.

    `_find_header_row_and_columns`'s keyword + GL-code-content heuristics
    cover the common cases well, but no fixed heuristic generalizes to every
    way a firm might lay out a mapping sheet — different language, an
    unusual column order, a convention this parser has never seen. Rather
    than growing the keyword list indefinitely to chase that, this returns
    the guess ALONGSIDE the actual header text and a handful of real data
    rows, so the caller (the skill, running as an LLM with real judgment)
    can look at what the sheet actually contains and confirm or correct the
    guess before anything is parsed for real. `_find_header_row_and_columns`
    remains a reasonable default for the well-behaved case — the point is
    that it is a suggestion to check, not a decision to trust blindly.
    """
    wb_path = Path(workbook_path)
    wb = load_workbook(wb_path, data_only=True, read_only=False)
    if sheet_name not in wb.sheetnames:
        raise ValueError(f"Sheet {sheet_name!r} not found. Available: {wb.sheetnames}")
    ws = wb[sheet_name]

    header_row, cols = _find_header_row_and_columns(ws)
    max_col = min(ws.max_column, 15)

    # Preview from the guessed header row when found; otherwise the sheet's
    # first rows, so there's still something to look at when detection
    # itself came up empty (an entirely unrecognized layout).
    preview_header_row = header_row or 1
    header_texts = [
        _clean(ws.cell(preview_header_row, c).value) for c in range(1, max_col + 1)
    ]
    rows = []
    for r in range(preview_header_row + 1, min(preview_header_row + 1 + sample_rows, ws.max_row + 1)):
        rows.append([ws.cell(r, c).value for c in range(1, max_col + 1)])

    return {
        "header_row_guess": header_row,
        "columns_guess": cols,
        "header_row_used_for_preview": preview_header_row,
        "header_texts": header_texts,
        "sample_rows": rows,
        "sheet_max_row": ws.max_row,
        "sheet_max_col": ws.max_column,
    }


def parse(
    workbook_path: str | Path,
    sheet_name: str = "COA to Budget Mapping",
    dept_vocabulary: list[str] | None = None,
    header_row: int | None = None,
    columns: dict[str, int] | None = None,
    known_tag_values: set | None = None,
    known_sub_accounts: set | None = None,
    no_tag_axis: bool = False,
) -> dict:
    """Parse a COA mapping sheet.

    `header_row`/`columns` are normally left None so the sheet's layout is
    detected fresh (see `_find_header_row_and_columns`). Pass both to skip
    detection entirely — this is what a re-ingest does: the first parse's
    detected layout is persisted to `.coa-mapping-ref.json` (see this
    module's `main()` / the skill's budget-workbook.md), and a later
    invocation of the same workbook feeds it straight back in rather than
    re-running detection (and re-risking a different outcome) on a sheet
    that hasn't changed shape.

    `no_tag_axis` confirms a missing tag column is real, not
    undetected — see the ValueError below for why one is otherwise required.
    """
    wb_path = Path(workbook_path)
    wb = load_workbook(wb_path, data_only=True, read_only=False)
    if sheet_name not in wb.sheetnames:
        raise ValueError(
            f"Sheet {sheet_name!r} not found. Available: {wb.sheetnames}"
        )
    ws = wb[sheet_name]

    if header_row is None or columns is None:
        header_row, cols = _find_header_row_and_columns(ws)
    else:
        cols = columns

    # The firm's real tag values outrank the header wording: a client can
    # head this column anything, including their category's own name, but
    # the column holding their tag values is the tag column.
    tag_by_data = None
    if header_row and known_tag_values:
        tag_by_data = _column_by_tag_overlap(ws, header_row, known_tag_values)
        if tag_by_data:
            cols = dict(cols or {})
            cols["carta_tag"] = tag_by_data
    if header_row and known_sub_accounts:
        by_data = _column_by_tag_overlap(ws, header_row, known_sub_accounts)
        # "Office" reads as a tag heading and holds sub-accounts. Values
        # are evidence; a keyword guess is not, so the guess yields.
        if by_data and by_data != tag_by_data:
            cols = dict(cols or {})
            cols["sub_account"] = by_data
            if cols.get("carta_tag") == by_data:
                cols.pop("carta_tag")
                # Let the tag fall to the best remaining header match.
                for c in range(1, ws.max_column + 1):
                    if c == by_data:
                        continue
                    if _classify_column_header(ws.cell(header_row, c).value) == "carta_tag":
                        cols["carta_tag"] = c
                        break
    if header_row is None:
        raise ValueError(
            "Could not locate the mapping header row (looked for a row naming "
            "a GL account column plus at least two others — department tag, "
            "section, category, confidence, or notes). Is this the right sheet?"
        )
    if "carta_tag" not in cols and not no_tag_axis:
        # A GL-only sheet would otherwise parse clean and derive zero
        # aliases — indistinguishable from a healthy mapping with nothing to flag.
        raise ValueError(
            "No department/tag column found — no header cell matched a tag "
            "keyword, and (if --carta-tags-from was given) no column's "
            "values overlapped the firm's real tags. Without one, every "
            "record's carta_tag is blank and value_aliases comes back "
            "empty, which reads as a healthy mapping with nothing to alias "
            "rather than a mapping that can't join to anything. Confirm "
            "this is the mapping sheet, or pass --carta-tags-from. If this "
            "budget genuinely has no reporting-tag breakout at all (no "
            "department, cost center, fund, office, or other axis — a "
            "plain GL-to-category map), pass --no-tag-axis instead — an "
            "empty value_aliases is then the correct, expected output."
        )

    # No dedicated 'section' column (the 5-column shape: GL#, GL Name,
    # Department Tag, Line Item, $ Actual — no Section/Confidence/Notes at
    # all). The department-tag column is doing double duty in that shape: it
    # names both the Carta tag AND the department context a section column
    # would otherwise carry (e.g. "GAP (FS)" — "GAP" is the Carta tag, "FS"
    # is what resolves the department). Falls back to reusing carta_tag's
    # own (unstripped) text as the section-resolution input.
    has_section_column = "section" in cols

    records: list[dict] = []
    for r in range(header_row + 1, ws.max_row + 1):
        gl = ws.cell(r, cols["gl"]).value
        if gl is None:
            continue
        # Some rows have string GL cells (comma-separated, e.g. "4170, 4175")
        gls = _parse_gl_codes(gl)
        if not gls:
            continue
        carta_tag = _clean(ws.cell(r, cols["carta_tag"]).value) if "carta_tag" in cols else ""
        record = {
            "gl":         gls[0],
            "gl_all":     gls if len(gls) > 1 else None,
            "gl_name":    _clean(ws.cell(r, cols["gl_name"]).value) if "gl_name" in cols else "",
            "carta_tag":  carta_tag,
            "sub_account": (_clean(ws.cell(r, cols["sub_account"]).value)
                            if "sub_account" in cols else ""),
            "section":    (_clean(ws.cell(r, cols["section"]).value) if has_section_column
                           else carta_tag),
            "category":   _clean(ws.cell(r, cols["category"]).value) if "category" in cols else "",
            "confidence": _clean(ws.cell(r, cols["confidence"]).value) if "confidence" in cols else "",
            "notes":      _clean(ws.cell(r, cols["notes"]).value) if "notes" in cols else "",
        }
        records.append(record)

    value_aliases = _derive_value_aliases(records, dept_vocabulary)
    # A tag the sheet names that Carta doesn't have joins to nothing. That
    # is a mapping error worth surfacing, not something to pass through and
    # render as zeros.
    unknown = sorted({v for vals in value_aliases.values() for v in vals
                      if _norm_tag(v) not in {_norm_tag(k) for k in (known_tag_values or ())}}
                     ) if known_tag_values else []

    return {
        "records": records,
        "value_aliases": value_aliases,
        "unknown_tag_values": unknown,
        "workbook_meta": {
            "filename": wb_path.name,
            "sheet":    sheet_name,
            "parsed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            # Round-tripped so a caller can persist them for reuse — see the
            # `header_row`/`columns` params above.
            "header_row": header_row,
            "columns":    cols,
        },
    }


def _derive_value_aliases(
    records: list[dict],
    vocabulary: list[str] | None = None,
) -> dict[str, list[str]]:
    """Emit {workbook_dept: [carta_tag_1, carta_tag_2, ...]}.

    A Carta tag with a parenthetical annotation ("CS (Client Svcs)") is
    normalized to what actually appears on JEs ("CS") by stripping the
    parenthesized part. The section is resolved to a canonical department
    name by shapes/vocab.py, reconciled against `vocabulary` (the department
    names the budget workbook itself uses) when one is supplied.
    """
    aliases: dict[str, set[str]] = {}
    for rec in records:
        section = rec["section"]
        tag = rec["carta_tag"]
        if not section or not tag:
            continue
        workbook_dept = tag_value_for_section(section, vocabulary)
        if not workbook_dept:
            # Cross-cutting section (income, firm-wide allocations) —
            # can't derive a dept-level alias without over-binding.
            continue
        normalized_tag = _strip_parenthetical(tag)
        aliases.setdefault(workbook_dept, set()).add(normalized_tag)

    # JSON needs lists, and stable ordering is nice for diffs.
    return {dept: sorted(tags) for dept, tags in aliases.items()}


_PAREN_RX = re.compile(r"\s*\([^)]*\)\s*$")
_GL_RX    = re.compile(r"\d{3,5}")


def _strip_parenthetical(s: str) -> str:
    """`"GAP (FS)"` → `"GAP"`. Keeps everything before a trailing (...) clause."""
    return _PAREN_RX.sub("", s).strip()


def _parse_gl_codes(v) -> list[int]:
    # 3-5 digits, matching the regex path below — an int/float cell holding
    # 0, 1, or some other implausible value (a placeholder, a count, a year)
    # isn't a GL code just because it's numeric. Without this floor, a
    # column of repeated 0.0 placeholders (common in financial-statement
    # sheets with no activity) reads as a highly-repeated "GL code" column.
    if isinstance(v, int):
        return [v] if 100 <= v <= 99999 else []
    if isinstance(v, float):
        return [int(v)] if v.is_integer() and 100 <= v <= 99999 else []
    if isinstance(v, str):
        return [int(m) for m in _GL_RX.findall(v)]
    return []


def _clean(v) -> str:
    return str(v).strip() if isinstance(v, str) else (str(v) if v is not None else "")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Parse a Carta COA → Budget Category mapping workbook into "
            "coa-mapping.json for consumption by build_manco_datadir.py."
        )
    )
    parser.add_argument("--workbook", required=True, help="Path to the mapping .xlsx")
    parser.add_argument(
        "--sheet",
        default="COA to Budget Mapping",
        help="Sheet name (default: 'COA to Budget Mapping')",
    )
    parser.add_argument(
        "--carta-subs-from",
        help="accounts.json/snapshot.json whose sub-accounts identify that "
             "column by its values rather than its heading",
    )
    parser.add_argument(
        "--carta-tags-from",
        default=None,
        help=(
            "Path to a prior run's accounts.json / snapshot.json. Its real "
            "reporting-tag values identify the sheet's tag column by data "
            "rather than by header wording, and flag any value Carta "
            "doesn't have. Optional: a first cold run has none."
        ),
    )
    parser.add_argument("--out", required=False, help="Path to write coa-mapping.json. Not used with --suggest.")
    parser.add_argument(
        "--suggest", action="store_true",
        help="Print a header/column guess plus a raw preview (header text + "
             "sample rows) as JSON and exit — parses nothing, writes nothing. "
             "Read this before trusting the guess: check the guess against "
             "what the preview actually shows, and pass a corrected "
             "--header-row/--columns to the real parse if it's wrong.",
    )
    parser.add_argument(
        "--dept-vocabulary-from",
        help=(
            "Optional path to an already-parsed budget.json. Its department "
            "names are used to reconcile the mapping's section labels, so "
            "both artifacts key on one spelling."
        ),
    )
    parser.add_argument(
        "--header-row", type=int, default=None,
        help="Skip header-row/column detection and use this row number "
             "(1-indexed) directly. Pass alongside --columns — both come "
             "from a prior parse's workbook_meta, persisted in the skill's "
             ".coa-mapping-ref.json for reuse on re-ingest.",
    )
    parser.add_argument(
        "--columns", default=None,
        help='JSON object mapping field name to column number, e.g. '
             '\'{"gl": 1, "gl_name": 2, "carta_tag": 3, "category": 4}\'. '
             "Required alongside --header-row; both are skipped together.",
    )
    parser.add_argument(
        "--no-tag-axis", action="store_true",
        help="Confirm the sheet genuinely has no reporting-tag column at "
             "all — no department, cost center, fund, office, or other "
             "breakout axis, just a plain GL-to-category map — rather than "
             "one this parser failed to detect. Without this flag, a sheet "
             "with no recognizable tag column raises rather than silently emitting "
             "zero aliases. Check with --suggest first — this is not a way "
             "to force past a tag column detection actually missed.",
    )
    args = parser.parse_args()
    known_tags = carta_tag_values(args.carta_tags_from) if args.carta_tags_from else None
    # Same file usually answers both; --carta-subs-from only exists for a
    # caller that keeps them apart.
    _subs_from = args.carta_subs_from or args.carta_tags_from
    known_subs = carta_sub_accounts(_subs_from) if _subs_from else None

    workbook = Path(args.workbook).expanduser().resolve()
    if not workbook.exists():
        print(f"error: mapping workbook not found: {workbook}", file=sys.stderr)
        return 2

    if args.suggest:
        try:
            print(json.dumps(suggest(str(workbook), args.sheet), indent=2, default=str))
        except Exception as e:
            print(f"error: could not build a suggestion: {e}", file=sys.stderr)
            return 3
        return 0

    if not args.out:
        print("error: --out is required (unless using --suggest).", file=sys.stderr)
        return 2

    vocabulary = None
    if args.dept_vocabulary_from:
        vocab_path = Path(args.dept_vocabulary_from).expanduser().resolve()
        if not vocab_path.exists():
            print(
                f"error: --dept-vocabulary-from not found: {vocab_path}",
                file=sys.stderr,
            )
            return 2
        try:
            vocabulary = dept_vocabulary(json.loads(vocab_path.read_text()))
        except Exception as e:
            print(f"error: could not read dept vocabulary: {e}", file=sys.stderr)
            return 2
        if not vocabulary:
            print(
                f"warn: {vocab_path.name} carries no department names; "
                f"falling back to names derived from the mapping alone.",
                file=sys.stderr,
            )

    columns = None
    if args.columns is not None:
        try:
            columns = {k: int(v) for k, v in json.loads(args.columns).items()}
        except (ValueError, TypeError, AttributeError) as e:
            print(f"error: --columns is not a valid {{field: column_number}} JSON object: {e}",
                  file=sys.stderr)
            return 2
    if (args.header_row is None) != (columns is None):
        print("error: --header-row and --columns must be passed together, or not at all.",
              file=sys.stderr)
        return 2

    try:
        mapping = parse(str(workbook), args.sheet, dept_vocabulary=vocabulary,
                        known_tag_values=known_tags,
                        known_sub_accounts=known_subs,
                        header_row=args.header_row, columns=columns,
                        no_tag_axis=args.no_tag_axis)
    except Exception as e:
        print(f"error: mapping parse failed: {e}", file=sys.stderr)
        return 3

    out = Path(args.out).expanduser().resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(mapping, indent=2))

    n_records = len(mapping["records"])
    n_aliases = sum(len(v) for v in mapping["value_aliases"].values())
    print(
        f"parsed {n_records} mapping records; "
        f"derived {len(mapping['value_aliases'])} workbook depts covering "
        f"{n_aliases} Carta tag aliases; wrote {out}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
