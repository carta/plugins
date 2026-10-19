#!/usr/bin/env python3
"""stem_queries.py — the executable manifest of Fund Admin stem SQL.

The SQL itself lives in ``queries.json`` at the skill root, the one file both fetch
paths read: this module for the local skill, and ``server/worker.js`` for the hosted
app. Each stem pairs a SELECT with the `limit`/`format` args and the fetch wave.
`emit_stem_sql.py` reads this to print ready-to-run queries so the LLM never
hand-templates SQL or pastes an IN-list by hand.

`sql` carries a single ``{fund_uuids}`` slot (matching ``id_param``);
`emit_stem_sql.py` fills it with a quoted, comma-joined IN-list. A firm-context stem
(``id_param`` None — `financials`, `ops_benchmarks`) has no slot: its table is
row-scoped by `set_context`, so it renders as-is. Every stem is `wave` 1 and the whole
fetch is one concurrent batch (SKILL.md Step 2) with no ordering dependency between
stems. The three corporation-filtered stems (`financing`, `captable`, `corporations`)
reach their corporation scope through the ``corp_scope`` subquery over
FUND_CORPORATION_OWNERSHIP, so they stay fund-scoped and need no corporation IN-list.

`limit` is capped at **10,000** for every stem because that is the DWH's real
ceiling — the server clamps any higher value (`min(limit, 10000)`) and reports the
remainder via `next_offset`. A stem whose data exceeds 10,000 rows is handled by
pagination, not by a bigger number — `save_query_result.py` flags the short page and
`build_datadir.py` refuses to build until it is completed.

`WIDE` holds a builder-compatible superset query per stem (`SELECT *`, keeping the
alias expressions the builder reads), used to force a small firm's result over the
harness auto-persist threshold so it lands in a tool-results file instead of inline.

The STEM_CONTRACT drift-guard test asserts every stem's SELECT still covers the
builder's load-bearing columns. Stdlib-only, Python 3.9-safe.
"""
import json
from pathlib import Path

_QUERIES = json.loads((Path(__file__).resolve().parent.parent / "queries.json").read_text(encoding="utf-8"))

_CORP_SCOPE = "\n".join(_QUERIES["corp_scope"])


def _sql(lines):
    return "\n".join(lines).replace("{corp_scope}", _CORP_SCOPE)


# §0 firm directory, the census every fund-scoped stem is filtered by.
DIRECTORY_SQL = "\n".join(_QUERIES["directory"]["sql"])
DIRECTORY_LIMIT = _QUERIES["directory"]["limit"]
DIRECTORY_FORMAT = _QUERIES["directory"]["format"]


def render_directory(firm_uuid):
    """Return (sql, limit, format) for the §0 directory query scoped to one firm."""
    return DIRECTORY_SQL.replace("{firm_uuid}", str(firm_uuid)), DIRECTORY_LIMIT, DIRECTORY_FORMAT


def directory_fund_uuids(path):
    """Ordered, de-duplicated fund_uuid column of a captured §0 directory (ndjson,
    DWH-uppercase or lowercase keys). Preamble and unparseable lines are skipped."""
    seen, out = set(), []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line.startswith("{"):
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                u = next((str(v).strip() for k, v in row.items()
                          if str(k).lower() == "fund_uuid" and v), "")
                if u and u not in seen:
                    seen.add(u)
                    out.append(u)
    except OSError:
        return []
    return out


# stem -> {id_param, wave, limit, format, sql}
STEMS = {
    name: {"id_param": s["id_param"], "wave": s["wave"], "limit": s["limit"],
           "format": s["format"], "sql": _sql(s["sql"])}
    for name, s in _QUERIES["stems"].items()
}

# stem -> superset query; the GROUP-BY carry stems have none.
WIDE = {name: _sql(s["wide"]) for name, s in _QUERIES["stems"].items() if "wide" in s}


def in_list(ids):
    """Render an id list as a SQL IN-list body: ``'a','b','c'`` (single-quoted,
    comma-joined). Ids are UUIDs from Carta with no embedded quotes."""
    return ",".join("'%s'" % str(i) for i in ids)


def render(stem, ids, wide=False):
    """Return (sql, limit, format) for a stem with its IN-list substituted. When
    ``wide`` is set and the stem has a WIDE variant, emit that superset query (it
    reliably persists to a file so the result is captured by path, not inline)."""
    spec = STEMS[stem]
    template = WIDE[stem] if (wide and stem in WIDE) else spec["sql"]
    if spec["id_param"] is None:
        return template, spec["limit"], spec["format"]
    sql = template.replace("{%s}" % spec["id_param"], in_list(ids))
    return sql, spec["limit"], spec["format"]
