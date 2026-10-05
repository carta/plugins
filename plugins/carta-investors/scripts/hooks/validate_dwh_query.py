#!/usr/bin/env -S uv run
# /// script
# requires-python = ">=3.9"
# ///
"""PreToolUse hook: stop unbounded reads of DOCUMENT_AI_RECORD through the DWH query tool.

The hook matches every Carta MCP server, so it also sees other plugins' queries on the
table (the carta-nda-insights skills assemble their own CTEs filtered on
``document_type = 'nda'``). Those must keep working, so the rule is:

1. A query that matches a ``"sql"`` block in the SKILL.md of a skill registered in
   ``hooks/dwh-guard/`` is allowed (a ``<placeholder>`` matches a bounded value, never
   SQL), provided its ``limit`` argument is at most the ``"limit"`` declared in that
   same block (``DEFAULT_ROW_LIMIT`` when the block declares none).
2. Any other query on the table is denied if its ``limit`` argument exceeds
   ``DEFAULT_ROW_LIMIT``, or if it is an unbounded read. This is a text heuristic, not a SQL
   parser, run on the comment-stripped SQL (``--``, ``//`` and ``/* */``) with string literals
   masked. A read of the table is bounded only if the WHERE clause of the SELECT that reads it
   (parenthesis depth 0 of that SELECT, up to the next GROUP BY / ORDER BY / QUALIFY / HAVING /
   LIMIT) has a top-level ``AND`` term that is ``FIRM_ID`` or ``DOCUMENT_TYPE`` ``=`` a string
   literal or ``IN`` a list of string literals, and that clause contains no ``NOT``, ``OR``,
   ``TRUE`` or ``FALSE``. A comparison inside parentheses or a function call, an ``EXISTS`` or
   other subquery, a ``JOIN ... ON``, an ``ORDER BY`` or a column on the right-hand side does not
   count. An ``OR`` anywhere in the read's SELECT also denies, as does an inline ``LIMIT`` above
   ``DEFAULT_ROW_LIMIT`` and a bare ``SELECT *`` straight from the table with neither ``LIMIT``
   nor ``QUALIFY``. (No carta-nda-insights query passes a ``limit``.)

Queries that do not touch the table, and other tools, pass untouched. Any error in
this hook allows, so a bug here never blocks a call.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

PLUGIN_ROOT = Path(__file__).resolve().parents[2]
GUARDED_TABLE = "DOCUMENT_AI_RECORD"  # also matches the plural and the datashare copies
DWH_QUERY_TOOL = "dwh__execute__query"
# The row limit is a tool argument, not part of the SQL, so the SQL match cannot cap
# it. Each SKILL.md block declares its own ``"limit"``; a block without one is capped here.
DEFAULT_ROW_LIMIT = 500

# A single-quoted SQL string. A backslash is excluded because Snowflake reads
# ``\'`` as an escaped quote, which would let a value end its own literal early.
_LITERAL = r"'(?:[^'\\]|'')*'"
_NAME = rf"P\.PURCHASER_NAME ILIKE {_LITERAL}"
_PLACEHOLDERS = {
    "firm_id": r"[\w-]+",
    "firm_name": r"(?:[^'\\]|'')*",
    "firm_name_spaced": r"(?:[^'\\]|'')*",
    "company_name": r"(?:[^'\\]|'')*",
    # The CASE the skill assembles from canonical-investors.json (Step B0); Q1 adds the alias.
    "CANONICAL_CASE": rf"CASE(?: WHEN {_NAME}(?: OR {_NAME})* THEN {_LITERAL})+ ELSE P\.PURCHASER_NAME END(?: AS CANONICAL_NAME)?",
}
_PLACEHOLDER_RE = re.compile(r"<(" + "|".join(_PLACEHOLDERS) + r")>")
# One ``call_tool({"name": "dwh__execute__query", "arguments": {...}})`` block; the
# arguments are one JSON member per line, so the body parses as a JSON object.
_CALL_BLOCK_RE = re.compile(r'call_tool\(\{"name": "dwh__execute__query", "arguments": \{\n(.*?)\n\}\}\)', re.DOTALL)
# A bounding term compares the column with string literals only (checked on a masked copy, where every
# literal's content is underscores). It must be a whole top-level ``AND`` term of the table's WHERE clause.
_MASKED = r"'_*'"
_FILTER_TERM_RE = re.compile(
    rf"(?:\w+\.)?(?:FIRM_ID|DOCUMENT_TYPE)\s*(?:=\s*{_MASKED}|IN\s*\(\s*{_MASKED}(?:\s*,\s*{_MASKED})*\s*\))", re.IGNORECASE
)
_WHERE_RE = re.compile(r"\bWHERE\b", re.IGNORECASE)
_AND_RE = re.compile(r"\bAND\b", re.IGNORECASE)
_CLAUSE_END_RE = re.compile(r"\b(?:GROUP\s+BY|ORDER\s+BY|QUALIFY|HAVING|LIMIT)\b", re.IGNORECASE)
_WIDENING_RE = re.compile(r"\b(?:NOT|OR|TRUE|FALSE)\b", re.IGNORECASE)
_LITERAL_RE = re.compile(_LITERAL)
# A string literal (kept) or a comment (dropped); literals come first so a ``--`` or ``//`` inside one is text.
_LITERAL_OR_COMMENT_RE = re.compile(rf"({_LITERAL})|--[^\n]*|//[^\n]*|/\*.*?\*/", re.DOTALL)
_OR_RE = re.compile(r"\bOR\b", re.IGNORECASE)
_STAR_FROM_RE = re.compile(r"\bSELECT\s+(?:\w+\.)?\*\s+FROM\s+[\w.\"]*$", re.IGNORECASE)
_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)", re.IGNORECASE)
_BOUND_RE = re.compile(r"\bLIMIT\s+\d+|\bQUALIFY\b", re.IGNORECASE)
_TABLE_RE = re.compile(GUARDED_TABLE, re.IGNORECASE)


def normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip().rstrip(";").strip()


def skill_blocks(skill_md: str) -> list[tuple]:
    """``(sql, limit)`` for every DWH query call block in a SKILL.md; limit is None if undeclared."""
    blocks = []
    for m in _CALL_BLOCK_RE.finditer(skill_md):
        args = json.loads("{" + m.group(1) + "}")
        if "sql" in args:
            blocks.append((args["sql"], args.get("limit")))
    return blocks


def template_pattern(template: str) -> "re.Pattern[str]":
    parts = _PLACEHOLDER_RE.split(normalize(template))
    # split() alternates fixed text (even) and placeholder names (odd)
    body = "".join(re.escape(p) if i % 2 == 0 else _PLACEHOLDERS[p] for i, p in enumerate(parts))
    return re.compile(body, re.IGNORECASE)


def guarded_skills(root: Path) -> list[str]:
    return [json.loads(f.read_text(encoding="utf-8"))["skill"] for f in sorted((root / "hooks" / "dwh-guard").glob("*.json"))]


def allowed_patterns(root: Path) -> list[tuple]:
    """``(pattern, row cap)`` for every query block of every registered skill."""
    patterns = []
    for skill in guarded_skills(root):
        skill_md = (root / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
        for sql, limit in skill_blocks(skill_md):
            cap = limit if isinstance(limit, int) else DEFAULT_ROW_LIMIT
            patterns.append((template_pattern(sql), cap))
    return patterns


def _scope_end(sql: str, start: int) -> tuple:
    """End of the SELECT that reads the table at ``start``, and whether it is the top-level one."""
    depth = 0
    for i in range(start, len(sql)):
        if sql[i] == "(":
            depth += 1
        elif sql[i] == ")":
            depth -= 1
            if depth < 0:
                return i, False
        elif depth == 0 and sql[i:i + 7].upper() == " UNION ":
            return i, True
    return len(sql), True


def strip_comments(sql: str) -> str:
    """``sql`` without ``--``, ``//`` and ``/* */`` comments (each replaced by a space); string literals are left intact."""
    return _LITERAL_OR_COMMENT_RE.sub(lambda m: m.group(1) or " ", sql)


def mask_literals(sql: str) -> str:
    """``sql`` with the content of every string literal replaced by underscores (same length, same offsets)."""
    return _LITERAL_RE.sub(lambda m: "'" + "_" * (len(m.group()) - 2) + "'", sql)


def _top_level_matches(text: str, pattern: "re.Pattern[str]") -> list:
    """Matches of ``pattern`` in ``text`` that sit outside any parentheses."""
    depth, depths = 0, []
    for ch in text:
        if ch == ")":
            depth -= 1
        depths.append(depth)
        if ch == "(":
            depth += 1
    return [m for m in pattern.finditer(text) if depths[m.start()] == 0]


def has_bounding_filter(scope: str) -> bool:
    """True if the SELECT body ``scope`` (literals masked, comments stripped) has a top-level WHERE clause
    with a ``FIRM_ID``/``DOCUMENT_TYPE`` literal ``=``/``IN`` term joined by AND and nothing that can widen it."""
    where = _top_level_matches(scope, _WHERE_RE)
    if not where:
        return False
    clause = scope[where[0].end():]
    end = _top_level_matches(clause, _CLAUSE_END_RE)
    if end:
        clause = clause[:end[0].start()]
    if _WIDENING_RE.search(clause):
        return False
    cuts = [0] + [x for m in _top_level_matches(clause, _AND_RE) for x in (m.start(), m.end())] + [len(clause)]
    terms = [clause[cuts[i]:cuts[i + 1]].strip() for i in range(0, len(cuts), 2)]
    return any(_FILTER_TERM_RE.fullmatch(t) for t in terms)


def is_unbounded_read(sql: str) -> bool:
    """True if any read of the table lacks a bounding top-level WHERE filter (or has an OR in its scope),
    has an inline LIMIT above the cap, or is a bare top-level SELECT *. Expects comment-free SQL."""
    sql = mask_literals(sql)
    # A LIMIT may sit outside the table's own SELECT (a CTE's outer query), so check every one.
    if any(int(n) > DEFAULT_ROW_LIMIT for n in _LIMIT_RE.findall(sql)):
        return True
    for m in _TABLE_RE.finditer(sql):
        end, top_level = _scope_end(sql, m.end())
        scope = sql[m.end():end]
        if _OR_RE.search(scope) or not has_bounding_filter(scope):
            return True
        if top_level and not _BOUND_RE.search(scope) and _STAR_FROM_RE.search(sql[:m.start()]):
            return True
    return False


def is_allowed(sql: str, limit: object = None, root: Path = PLUGIN_ROOT) -> bool:
    if GUARDED_TABLE not in sql.upper():
        return True
    normalized = normalize(sql)
    matches = [cap for p, cap in allowed_patterns(root) if p.fullmatch(normalized)]
    # A matching skill block is capped by its own declared limit; any other query by the default.
    cap = max(matches) if matches else DEFAULT_ROW_LIMIT
    if limit is not None and not (isinstance(limit, int) and 0 < limit <= cap):
        return False
    # Comments are stripped before the checks, from the raw text: normalize() folds newlines, which would
    # let a ``--`` comment swallow the SQL after it.
    return bool(matches) or not is_unbounded_read(normalize(strip_comments(sql)))


def extract_query_args(tool_name: str, tool_input: dict) -> dict:
    """The arguments of a DWH query call, or {} for any other call."""
    if tool_name.endswith("__call_tool"):
        if tool_input.get("name") != DWH_QUERY_TOOL:
            return {}
        tool_input = tool_input.get("arguments") or {}
        if isinstance(tool_input, str):
            tool_input = json.loads(tool_input)
    elif not tool_name.endswith((DWH_QUERY_TOOL, "__execute_query")):
        return {}
    return tool_input


def main() -> None:
    try:
        hook_input = json.loads(sys.stdin.read())
        args = extract_query_args(str(hook_input.get("tool_name", "")), hook_input.get("tool_input") or {})
        sql = args.get("sql")
        allowed = is_allowed(sql, args.get("limit")) if isinstance(sql, str) else True
    except Exception as exc:  # fail open: a bug here must not block unrelated calls
        print(f"validate_dwh_query: skipped ({exc})", file=sys.stderr)
        return
    if allowed:
        return
    reason = (
        f"Blocked: this query is not allowed on {GUARDED_TABLE}. Use the queries defined in the SKILL.md of "
        f"{', '.join(guarded_skills(PLUGIN_ROOT))}, substituting only their placeholders. "
        f"Row limits are capped at {DEFAULT_ROW_LIMIT} unless that skill's query declares a higher one."
    )
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": reason}}), file=sys.stderr)
    sys.exit(2)


if __name__ == "__main__":
    main()
