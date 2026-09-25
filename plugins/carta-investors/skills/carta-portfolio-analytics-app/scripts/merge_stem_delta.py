#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""merge_stem_delta.py — fold an incremental fetch into a cached stem's ndjson.

Usage:
  uv run merge_stem_delta.py <base.ndjson> <delta.ndjson> --key "<cols>" --order "<cols>"
  uv run merge_stem_delta.py <base.ndjson> <delta.ndjson> --append-only
  uv run merge_stem_delta.py <base.ndjson> <delta.ndjson> --replace-companies \
      --companies-file PATH [--since YYYY-MM-DD]

Keyed mode replaces the base row that shares a delta row's key when the delta row is
at least as new by `--order` (compared column by column; a NULL sorts oldest), and adds
rows for keys the base lacks. `--key` uses save_query_result's column spec (`a,b|c`:
comma-separated columns, `|` = COALESCE). Append-only mode concatenates.
Replace-companies mode drops the named companies' base rows (their period_end >= since
rows only, when --since is given) and appends the delta — the company-scoped refresh
merge. The base is rewritten atomically. Exits 2 when the base is missing or either
file is unreadable. Stdlib-only, Python 3.9-safe.
"""
import importlib.util
import json
import os
import sys


def _sibling(name):
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = importlib.util.spec_from_file_location("_pa_" + name, p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_sqr = _sibling("save_query_result")


def _rows(path):
    """(raw_line, row_dict) per non-blank line; a malformed line is dropped."""
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            s = line.strip()
            if not s:
                continue
            try:
                out.append((s, json.loads(s)))
            except ValueError:
                continue
    return out


def _order_key(row, cols):
    """Comparable tuple over `cols`, case-insensitive on the column name. A NULL sorts
    before any value; a value that parses as a number compares numerically."""
    folded = {k.lower(): v for k, v in row.items()}
    parts = []
    for c in cols:
        v = folded.get(c.lower())
        if v is None or v == "":
            parts.append((0, ""))
            continue
        try:
            parts.append((1, float(v)))
        except (TypeError, ValueError):
            parts.append((1, str(v)))
    return tuple(parts)


def _newer_or_same(delta_row, base_row, order_cols):
    try:
        return _order_key(delta_row, order_cols) >= _order_key(base_row, order_cols)
    except TypeError:
        return True  # incomparable types in one column: the fetched row is the fresher one


def merge(base_path, delta_path, key_cols=None, order_cols=None):
    """Return (added, replaced, kept) after rewriting base_path in place."""
    base = _rows(base_path)
    delta = _rows(delta_path)
    if key_cols is None:
        lines = [ln for ln, _ in base] + [ln for ln, _ in delta]
        added, replaced, kept = len(delta), 0, len(base)
    else:
        index = {}
        lines = []
        for ln, row in base:
            index[_sqr._row_key(row, key_cols)] = len(lines)
            lines.append(ln)
        added = replaced = 0
        for ln, row in delta:
            k = _sqr._row_key(row, key_cols)
            at = index.get(k)
            if at is None:
                index[k] = len(lines)
                lines.append(ln)
                added += 1
            elif _newer_or_same(row, json.loads(lines[at]), order_cols or []):
                lines[at] = ln
                replaced += 1
        kept = len(base) - replaced
    tmp = base_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for ln in lines:
            fh.write(ln + "\n")
    os.replace(tmp, base_path)
    return (added, replaced, kept)


def merge_replace_companies(base_path, delta_path, gl_issuer_ids, corp_uuids,
                            llc_entity_ids, since=None):
    """Drop the selected companies' base rows, append all delta rows; other companies
    are untouched. Matches the identity columns the fetch filtered by. With `since`,
    drop only their rows with period_end >= since — a date-narrowed fetch must never
    delete older cached history. Returns (added, dropped, kept)."""
    base = _rows(base_path)
    delta = _rows(delta_path)
    gl_set = set(gl_issuer_ids or [])
    corp_set = set(corp_uuids or [])
    llc_set = set(llc_entity_ids or [])
    lines = []
    dropped = 0
    for ln, row in base:
        folded = {k.lower(): v for k, v in row.items()}
        gl = folded.get("general_ledger_issuer_id")
        cid = folded.get("corporation_id")
        llc = folded.get("llc_entity_id")
        selected = ((gl is not None and str(gl) in gl_set)
                    or (cid is not None and str(cid) in corp_set)
                    or (llc is not None and str(llc) in llc_set))
        if selected and since is not None:
            # Period-aware: a row without a comparable period_end is kept — it can't
            # be proven in-window, and keeping beats deleting history.
            pe = folded.get("period_end")
            selected = isinstance(pe, str) and pe >= since
        if selected:
            dropped += 1
            continue
        lines.append(ln)
    kept = len(lines)
    added = 0
    for ln, _ in delta:
        lines.append(ln)
        added += 1
    tmp = base_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        for ln in lines:
            fh.write(ln + "\n")
    os.replace(tmp, base_path)
    return (added, dropped, kept)


def _read_companies_file(path):
    """(glIssuerIds, corporationUuids, llcEntityIds) from the JSON companies file.
    Raises ValueError on a malformed file so a bad filter fails loud rather than
    silently dropping nothing. emit_stem_sql.py carries a deliberately identical
    copy — keep the two field-for-field in sync."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as e:
        raise ValueError("couldn't read --companies-file %r: %s" % (path, e))
    if not isinstance(data, dict):
        raise ValueError("--companies-file must be a JSON object")
    gl_ids = data.get("glIssuerIds") or []
    corp_uuids = data.get("corporationUuids") or []
    llc_ids = data.get("llcEntityIds") or []
    if not all(isinstance(v, list) for v in (gl_ids, corp_uuids, llc_ids)):
        raise ValueError("glIssuerIds, corporationUuids and llcEntityIds must be JSON arrays")
    return gl_ids, corp_uuids, llc_ids


def _cols(spec):
    return [c.strip() for c in (spec or "").split(",") if c.strip()]


def main(argv):
    rest = argv[1:]
    append_only = "--append-only" in rest
    replace_companies = "--replace-companies" in rest
    key = order = companies_file = since = None
    positional = []
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok in ("--key", "--order", "--companies-file", "--since"):
            i += 1
            if i < len(rest):
                if tok == "--key":
                    key = _cols(rest[i])
                elif tok == "--order":
                    order = _cols(rest[i])
                elif tok == "--companies-file":
                    companies_file = rest[i]
                else:
                    since = rest[i]
        elif tok not in ("--append-only", "--replace-companies"):
            positional.append(tok)
        i += 1
    if len(positional) != 2 or (replace_companies and not companies_file) or \
            (not replace_companies and not append_only and not key):
        sys.stderr.write("usage: merge_stem_delta.py <base.ndjson> <delta.ndjson> "
                         "(--key cols --order cols | --append-only | "
                         "--replace-companies --companies-file PATH [--since YYYY-MM-DD])\n")
        return 2
    base_path, delta_path = positional
    for p in (base_path, delta_path):
        if not os.path.exists(p):
            sys.stderr.write("merge_stem_delta: not found: %s\n" % p)
            return 2
    try:
        if replace_companies:
            gl_ids, corp_uuids, llc_ids = _read_companies_file(companies_file)
            added, dropped, kept = merge_replace_companies(
                base_path, delta_path, gl_ids, corp_uuids, llc_ids, since)
            sys.stdout.write("merge_stem_delta: %d added, %d dropped, %d kept -> %s\n"
                             % (added, dropped, kept, base_path))
            return 0
        added, replaced, kept = merge(base_path, delta_path, None if append_only else key, order)
    except (OSError, ValueError) as e:
        sys.stderr.write("merge_stem_delta: %s\n" % e)
        return 2
    sys.stdout.write("merge_stem_delta: %d added, %d replaced, %d kept -> %s\n"
                     % (added, replaced, kept, base_path))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
