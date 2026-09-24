#!/usr/bin/env python3
"""save_query_result.py — normalize a Carta MCP query result into clean ndjson.

Deterministically converts ANY of the shapes the DWH / claude.ai Carta MCP emits
into one-JSON-object-per-line ndjson that ``build_kpi_datadir.py`` reads cleanly
via its ``read_ndjson``/``col`` helpers. Run it after every ``dwh__execute__query`` instead of hand-copying
the printed result file — it removes the per-run "which shape is this / where did
the rows go" guesswork that makes the first launch slow and occasionally empty.

Shapes handled:
  * plain ndjson (optionally with a ``total_rows: N`` preamble line)
  * a JSON array of row objects, or a single row object
  * the MCP content-block wrapper — e.g.
    ``[{"type":"text",...},{"type":"resource","resource":{"blob":"<base64>",
    "mimeType":"application/x-ndjson"}}]`` (or a dict with a
    ``content``/``result``/``rows``/``data`` key) — by base64-decoding the
    resource blob, which is itself ndjson or a JSON array.
  * the harness-persisted large-result wrapper ``{"result": "<total_rows: N …>\n\n
    <ndjson>"}`` — a *string*-valued ``result``/``content``/``text``, which the
    claude.ai Carta MCP writes to a tool-results ``.txt`` when a result exceeds the
    context limit. The string is parsed as embedded ndjson. Before this was handled,
    saving that wrapper verbatim wrote one junk ``{"result": …}`` row and exited 0
    (false success) — exactly the "0 funds / 0 companies" silent failure downstream.
  * a pipe / markdown table — parsed into ndjson rows (header cells become keys,
    the ``--- | ---`` separator is dropped, numeric cells are coerced, blank /
    ``null`` cells become JSON null) so small inline results land in the exact
    same shape as the large persisted ones

Exits non-zero (2) if it cannot produce at least one data row, printing what it
saw, so the caller never silently feeds an empty file to the builder.

**Truncation must not be silent.** The DWH clamps every ``limit`` to 10,000 rows
server-side and signals a further page with ``next_offset`` in the result header. This
helper used to discard that header, so a stem whose data exceeded the clamp was written
short and the build proceeded on partial data with no warning. Now: the rows are still
written, a ``<dest>.truncated`` marker records the resume offset, and a literal
``TRUNCATED next_offset=<N>`` sentinel is printed to stdout. The only way forward is to
fetch the next page and append it (``--append``), which clears the marker once a page
comes back complete.

**Truncation exits 0 on purpose.** A partial page is the normal path for a stem larger
than the clamp, not a failure, and a non-zero exit renders as an error in the Claude
session that reads as something being broken. This mirrors ``ff-cache.sh``'s
``CACHE_MISS`` sentinel, which is exit-0 for the same reason. The sentinel is what the
caller branches on; the marker is what makes it impossible to
ignore. Non-zero stays reserved for genuine failures — no rows extracted, or bad usage.

**Integrity checking is opt-in, for callers that page over a total ORDER BY.**
``--verify-complete`` runs on the FINAL page only (no ``next_offset``): it re-reads the
assembled ``dest`` file and asserts the saved row count equals the server's reported
``total_rows``. ``--unique-key "colA,colB|colC,..."`` additionally asserts zero duplicate
keys, where each comma-separated token is one key column and a ``|`` inside a token means
COALESCE (first non-empty; a missing/None/empty value coalesces to ``""``). Either check
failing means a page was dropped or the tiling overlapped — exits 2 and writes
``<dest>.integrity_error`` with the failure details, so a caller never silently builds on
an incomplete or duplicated stem.

**Firm-scope check, for stems emitted with --firm-uuid.** ``--expect-firm <firm_uuid>``
runs on EVERY page: each extracted row's ``firm_id`` must equal it (case-insensitive).
Staff row scoping is one shared grant per user, rewritable by the user's other surfaces
mid-refresh, so a page can carry another firm's rows while the session still believes
its own ``set_context``. A failing page writes ``<dest>.scope_error`` and NOTHING else —
the poisoned rows never land — and exits 2; re-run ``set_context`` and re-fetch the stem
from offset 0. Rows with no ``firm_id`` column fail too (the SQL wasn't emitted with
``--firm-uuid``, so nothing was verified).

Usage:  uv run save_query_result.py <src_path> <dest.ndjson> [--append]
        uv run save_query_result.py - <dest.ndjson>   # read the raw result from stdin
                                                      # (for small INLINE results)

Exit codes: 0 complete OR truncated (branch on the stdout sentinel) · 2 no rows / bad usage.

Stdlib-only, Python 3.9-safe (matches build_kpi_datadir.py / serve.py constraints).
"""
import base64
import binascii
import json
import os
import re
import sys


def _rows_from_ndjson_text(text):
    """Extract row dicts from ndjson text (one JSON object per line).
    Ignores blank lines and a ``total_rows: N`` preamble."""
    rows = []
    for line in text.splitlines():
        s = line.strip()
        if not s or s.lower().startswith("total_rows"):
            continue
        if s[0] == "{" and s[-1] == "}":
            try:
                obj = json.loads(s)
            except ValueError:
                continue
            if isinstance(obj, dict) and not _is_summary(obj):
                rows.append(obj)
    return rows


# The claude.ai Carta MCP prefixes a result with a small SUMMARY object
# (``{"total_rows":N,"row_count":N,"offset":..,"limit":..,"format":..,"bytes":..}``)
# as its own text block. When we walk a content-block wrapper we must NOT treat that
# summary as a data row — it inflated wide stems by one junk row.
_SUMMARY_KEYS = {"total_rows", "row_count", "offset", "limit", "format",
                 "bytes", "next_offset", "has_next"}


def _is_summary(obj):
    return (isinstance(obj, dict) and bool(obj)
            and set(obj.keys()) <= _SUMMARY_KEYS
            and ("total_rows" in obj or "row_count" in obj))


# ``next_offset`` reaches us in two shapes and we must catch both, because missing it
# is exactly the silent-truncation bug: the plain-text result header
# (``total_rows: 12,345 | offset: 0 | limit: 10000 | format: ndjson | next_offset: 10000``)
# and the JSON summary/ack object the blob path emits (``{"total_rows":…,"next_offset":10000}``).
_NEXT_OFFSET_HEADER_RE = re.compile(r"next_offset\"?\s*:\s*\"?([\d,]+)", re.IGNORECASE)


def detect_next_offset(text):
    """Return the resume offset the DWH reported, or None when the page is the last.

    Scans the raw result text rather than the parsed rows, so it works for every
    wrapper shape (inline header, harness-persisted ``{"result": "<header>…"}``,
    base64 blob ack) without having to model each one."""
    if not isinstance(text, str):
        return None
    m = _NEXT_OFFSET_HEADER_RE.search(text)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def marker_path(dest_path):
    """Sidecar that records an incomplete stem, so a caller can gate on it."""
    return dest_path + ".truncated"


_TOTAL_ROWS_HEADER_RE = re.compile(r"total_rows\"?\s*:\s*\"?([\d,]+)", re.IGNORECASE)


def detect_total_rows(text):
    """Return the server's reported total row count for the whole query, or None.

    Every page's header carries the full ``total_rows`` (not just the page's own
    count), so the final page alone is enough to verify completeness."""
    if not isinstance(text, str):
        return None
    m = _TOTAL_ROWS_HEADER_RE.search(text)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def integrity_error_path(dest_path):
    """Sidecar marking an assembled file that failed its completeness check."""
    return dest_path + ".integrity_error"


def scope_error_path(dest_path):
    """Sidecar marking a page whose rows belong to the wrong firm."""
    return dest_path + ".scope_error"


def scope_errors(rows, expect_firm):
    """Check every row's firm_id against ``expect_firm`` (case-insensitive key and
    value); non-empty ``errors`` means the page must not be written. A missing
    firm_id column also fails — the stem SQL ran without --firm-uuid, so nothing
    was verified. Returns ``(errors, foreign_firms, missing)``."""
    expected = expect_firm.lower()
    foreign = {}
    missing = 0
    for r in rows:
        v = None
        for k, val in r.items():
            if k.lower() == "firm_id":
                v = val
                break
        if v is None:
            missing += 1
        elif str(v).lower() != expected:
            foreign[str(v)] = foreign.get(str(v), 0) + 1
    errors = []
    if foreign:
        errors.append("%d row(s) belong to %d other firm(s): %s"
                      % (sum(foreign.values()), len(foreign),
                         ", ".join(sorted(foreign))))
    if missing:
        errors.append("%d row(s) carry no firm_id column — emit the stem SQL with "
                      "--firm-uuid so the scope is verifiable" % missing)
    return (errors, foreign, missing)


def _row_key(row, key_cols):
    """Build the tuple key for one row. Each token in ``key_cols`` is one key
    column; a ``|`` inside a token means COALESCE — take the first NOT-NULL of
    the alternatives, matching SQL: an empty string is a real value and stops
    the fallthrough, only a missing/None value continues to the next
    alternative. A key part with no not-null alternative becomes ''."""
    # Lookups are case-insensitive: --unique-key is lowercase but the warehouse
    # returns UPPERCASE keys, so fold the row's keys once and match folded names.
    folded = {k.lower(): v for k, v in row.items()}
    parts = []
    for token in key_cols:
        chosen = ""
        for name in token.split("|"):
            v = folded.get(name.lower())
            if v is not None:
                chosen = str(v)
                break
        parts.append(chosen)
    return tuple(parts)


def verify_complete(dest_path, page_text, unique_key):
    """Return a list of integrity error strings for the assembled file (empty = OK).

    Called only on the FINAL page (no next_offset). Re-reads the whole dest file:
      * row-count check: saved rows must equal the server's total_rows (when the
        header is parseable); a short write is a dropped-page defect.
      * duplicate-key check (only when unique_key is given): the dedup query
        guarantees one row per key, so any duplicate is a paging tiling defect."""
    errors = []
    try:
        with open(dest_path, encoding="utf-8") as fh:
            rows = [json.loads(ln) for ln in fh if ln.strip()]
    except (OSError, ValueError) as e:
        return ["could not re-read %s for integrity check: %s" % (dest_path, e)]
    saved = len(rows)
    total = detect_total_rows(page_text)
    if total is not None and total != saved:
        errors.append("row-count mismatch: saved %d rows but server reported "
                      "total_rows=%d" % (saved, total))
    if unique_key:
        counts = {}
        for r in rows:
            k = _row_key(r, unique_key)
            counts[k] = counts.get(k, 0) + 1
        dups = sum(c - 1 for c in counts.values() if c > 1)
        if dups:
            errors.append("%d duplicate row(s): %d unique keys for %d saved rows "
                          "on key (%s)" % (dups, len(counts), saved,
                                           ",".join(unique_key)))
    return errors


def _write_marker(dest_path, next_offset, rows_so_far):
    with open(marker_path(dest_path), "w", encoding="utf-8") as fh:
        json.dump({"next_offset": next_offset, "rows_so_far": rows_so_far}, fh)
        fh.write("\n")


def _clear_marker(dest_path):
    try:
        os.remove(marker_path(dest_path))
    except OSError:
        pass


def _rows_from_json_value(val):
    """Row dicts from a decoded JSON value: an array of dicts, or a single dict."""
    if isinstance(val, list):
        return [x for x in val if isinstance(x, dict)]
    if isinstance(val, dict):
        return [val]
    return []


def _rows_from_text(text):
    """Parse a text blob as ndjson, then a JSON value, then a pipe/markdown table.
    Returns [] for empty / unparseable text.
    The table fallback matters for a wrapped ``{"result": "<markdown table>"}``
    payload, which otherwise silently yielded zero rows."""
    if not isinstance(text, str) or not text.strip():
        return []
    # If the whole text is ONE JSON document that is itself a content-block wrapper
    # (e.g. the harness's two-element .txt where element[1].text nests
    # ``{"result":[{...},{"resource":{"blob": <base64 ndjson>}}]}``), walk it for
    # blobs — do NOT let the ndjson pass below treat that single wrapper object as
    # one junk row, which silently truncated wide stems to 1 row.
    st = text.strip()
    if st[:1] in ("[", "{"):
        try:
            val = json.loads(st)
        except ValueError:
            val = None
        if val is not None and _looks_like_content_blocks(val):
            return _walk_for_rows(val)
    rows = _rows_from_ndjson_text(text)
    if rows:
        return rows
    try:
        return _rows_from_json_value(json.loads(text))
    except ValueError:
        pass
    table_lines = [ln for ln in text.splitlines()
                   if ln.strip() and not ln.strip().lower().startswith("total_rows")]
    if any("|" in ln for ln in table_lines):
        table_rows = _rows_from_table(table_lines)
        if table_rows:
            return table_rows
    return []


def _decode_blob(blob):
    """base64-decode an MCP resource blob and read it as ndjson or a JSON array."""
    if not isinstance(blob, str):
        return []
    try:
        raw = base64.b64decode(blob, validate=False)
    except (binascii.Error, ValueError):
        return []
    text = raw.decode("utf-8", "replace")
    return _rows_from_text(text)


def _looks_like_content_blocks(val):
    """True when ``val`` looks like an MCP content-block structure rather than a
    bare row / array of rows — so we walk it for blobs instead of treating the
    blocks themselves as data rows."""
    if isinstance(val, list):
        return any(isinstance(x, dict) and "type" in x for x in val)
    if isinstance(val, dict):
        if "resource" in val or "blob" in val:
            return True
        # Only a *container*-valued wrapper key (str ndjson / list / dict) marks a
        # content-block structure. A scalar-valued key like ``{"result": 5, ...}``
        # is a genuine data row that merely happens to use a reserved column name.
        return any(isinstance(val.get(k), (str, list, dict))
                   for k in ("content", "result", "results", "rows", "data"))
    return False


def _walk_for_rows(node):
    """Recursively pull rows out of an MCP content-block structure: decode any
    ``resource.blob`` (base64 ndjson), read inline ``text`` blocks, and — crucially —
    treat a *string* value (e.g. a string-valued ``result``/``content``, the
    harness-persisted large-result wrapper) as embedded ndjson/JSON text.

    A dict that matches none of those shapes (no resource/blob/text, no nested
    content/result/results/rows/data key) only got here because
    ``_looks_like_content_blocks`` saw a container-valued reserved key *elsewhere*
    in the same payload — it's a genuine data row, not a wrapper, so treat it as
    one rather than silently dropping it."""
    rows = []
    if isinstance(node, str):
        return _rows_from_text(node)
    if isinstance(node, dict):
        recognized = False
        res = node.get("resource")
        if isinstance(res, dict) and res.get("blob"):
            rows += _decode_blob(res.get("blob"))
            recognized = True
        if node.get("blob") and "resource" not in node:
            rows += _decode_blob(node.get("blob"))
            recognized = True
        txt = node.get("text")
        if isinstance(txt, str) and txt.strip():
            rows += _rows_from_text(txt)
            recognized = True
        for k in ("content", "result", "results", "rows", "data"):
            if k in node:
                rows += _walk_for_rows(node.get(k))
                recognized = True
        if not recognized and node:
            rows.append(node)
    elif isinstance(node, list):
        for x in node:
            rows += _walk_for_rows(x)
    return rows


def _split_table_row(line):
    """Split a pipe row into stripped cells, dropping the empty leading/trailing
    cells produced by markdown's surrounding ``| ... |`` pipes (a genuinely empty
    interior cell is kept)."""
    cells = [c.strip() for c in line.split("|")]
    if cells and cells[0] == "":
        cells = cells[1:]
    if cells and cells[-1] == "":
        cells = cells[:-1]
    return cells


def _is_separator(line):
    """True for a markdown header separator like ``--- | :--- | ---``."""
    s = line.strip()
    return bool(s) and set(s) <= set("-:| ")


def _coerce_cell(v):
    """Coerce a table cell string toward the native JSON type the DWH ndjson would
    carry: blank / null -> None, integer / float text -> number, else the string.
    Leaves non-finite tokens (inf/nan) as strings so the output stays valid JSON."""
    s = v.strip()
    if s == "" or s.lower() in ("null", "none"):
        return None
    if s.lower() in ("inf", "+inf", "-inf", "infinity", "-infinity", "nan"):
        return s
    if re.fullmatch(r"[+-]?\d+", s):
        try:
            return int(s)
        except ValueError:
            pass
    try:
        return float(s)
    except ValueError:
        return s


def _rows_from_table(lines):
    """Parse pipe/markdown table lines into row dicts, zipping each row to the header
    (keys keep the header's case; ``build_kpi_datadir.col`` folds both). A JSON/VARIANT
    cell the DWH renders pretty-printed (e.g. ``tags_json``) carries embedded newlines
    that split one row across physical lines; a line leaving the row short of the header
    width is re-joined onto it before zipping, so the newline can't inflate/misalign rows."""
    header = None
    rows = []
    buf = None  # physical lines of the row being assembled, or None between rows

    def _emit(block):
        cells = _split_table_row(block)
        rows.append({header[i]: (_coerce_cell(cells[i]) if i < len(cells) else None)
                     for i in range(len(header))})

    for ln in lines:
        if header is None:
            if "|" in ln and not _is_separator(ln):
                header = _split_table_row(ln)
            continue
        if buf is None:
            # skip the header separator and any stray text sitting between rows
            if "|" in ln and not _is_separator(ln):
                buf = ln
        elif len(_split_table_row(buf)) >= len(header):
            _emit(buf)  # current row already has every column -> this line starts a new one
            buf = ln if ("|" in ln and not _is_separator(ln)) else None
        else:
            buf = buf + "\n" + ln  # row is short a column -> this line continues it
    if buf is not None:
        _emit(buf)
    return rows


def parse_query_output(text):
    """Return ``(kind, payload)``:
      * ``("rows", [dict, ...])`` — structured rows extracted
      * ``("empty", [])``          — nothing usable found
    """
    stripped = text.strip()
    if stripped[:1] in ("[", "{"):
        try:
            val = json.loads(stripped)
        except ValueError:
            val = None
        if val is not None:
            # The whole input is ONE JSON document, so the structured extractors are
            # authoritative — return their result (even if empty) rather than falling
            # through to the raw-ndjson pass, which would re-parse the top-level
            # wrapper object as a single junk row (the old false-exit-0 bug).
            if _looks_like_content_blocks(val):
                return ("rows", _walk_for_rows(val))
            return ("rows", _rows_from_json_value(val))

    nd = _rows_from_ndjson_text(text)
    if nd:
        return ("rows", nd)

    table_lines = [ln for ln in text.splitlines()
                   if ln.strip() and not ln.strip().lower().startswith("total_rows")]
    if any("|" in ln for ln in table_lines):
        table_rows = _rows_from_table(table_lines)
        if table_rows:
            return ("rows", table_rows)

    return ("empty", [])


def _read_source(src):
    """Read the raw result text from a file, or from stdin when ``src`` is ``-``.
    The stdin path lets a small *inline* MCP result be captured by piping it
    straight through this helper — the same deterministic decode used for the
    large results the harness persists to a file — so the LLM never hand-authors
    ndjson."""
    if src == "-":
        return sys.stdin.read()
    with open(src, encoding="utf-8", errors="replace") as fh:
        return fh.read()


class ScopeError(Exception):
    """The page's rows fail the --expect-firm check; nothing was written."""

    def __init__(self, errors):
        super().__init__("; ".join(errors))
        self.errors = errors


def _check_scope(payload, dest_path, expect_firm):
    """Refuse the page (ScopeError + ``.scope_error`` sidecar) when any row fails
    the firm check; clear a stale sidecar when the page is clean."""
    errors, foreign, missing = scope_errors(payload, expect_firm)
    if not errors:
        try:
            os.remove(scope_error_path(dest_path))
        except OSError:
            pass
        return
    with open(scope_error_path(dest_path), "w", encoding="utf-8") as fh:
        json.dump({"expected_firm": expect_firm, "foreign_firms": foreign,
                   "missing_firm_id_rows": missing, "errors": errors}, fh)
        fh.write("\n")
    raise ScopeError(errors)


def normalize_text(text, dest_path, append=False, expect_firm=None):
    """Convert raw result ``text`` into clean ndjson at ``dest_path``.

    Returns ``(rows_written_this_page, next_offset)``. ``rows_written_this_page`` is 0
    when nothing usable was found. ``next_offset`` is None when this page completed the
    stem — in which case any stale ``.truncated`` marker is cleared, so a resumed
    pagination that finally catches up leaves a clean raw dir behind. ``expect_firm``
    raises ScopeError (writing nothing) when any row's firm_id is not that firm."""
    kind, payload = parse_query_output(text)
    dest_dir = os.path.dirname(os.path.abspath(dest_path))
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)

    if kind == "rows" and payload:
        payload = [r for r in payload if not _is_summary(r)]  # drop MCP summary blocks
    if not (kind == "rows" and payload):
        return (0, None)
    if expect_firm:
        _check_scope(payload, dest_path, expect_firm)

    with open(dest_path, "a" if append else "w", encoding="utf-8") as fh:
        for r in payload:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")

    next_offset = detect_next_offset(text)
    if next_offset is None:
        _clear_marker(dest_path)
    else:
        total = next_offset if append else len(payload)
        _write_marker(dest_path, next_offset, total)
    return (len(payload), next_offset)


def normalize(src_path, dest_path, append=False):
    """Convert ``src_path`` (a file, or ``-`` for stdin) into clean ndjson at
    ``dest_path``. Never raises on malformed input. Returns ``(rows, next_offset)``."""
    return normalize_text(_read_source(src_path), dest_path, append=append)


def main(argv):
    rest = argv[1:]
    append = "--append" in rest
    verify = "--verify-complete" in rest
    unique_key = None
    expect_firm = None
    positional = []
    i = 0
    while i < len(rest):
        tok = rest[i]
        if tok == "--unique-key":
            i += 1
            if i < len(rest):
                unique_key = [c.strip() for c in rest[i].split(",") if c.strip()]
        elif tok == "--expect-firm":
            i += 1
            if i < len(rest):
                expect_firm = rest[i]
        elif tok in ("--append", "--verify-complete"):
            pass
        else:
            positional.append(tok)
        i += 1
    if len(positional) != 2:
        sys.stderr.write("usage: save_query_result.py <src_path|-> <dest.ndjson> "
                         "[--append] [--verify-complete] [--unique-key cols] "
                         "[--expect-firm firm_uuid]\n")
        return 2
    src, dest = positional
    if src != "-" and not os.path.exists(src):
        sys.stderr.write("save_query_result: source not found: %s\n" % src)
        return 2
    try:
        text = _read_source(src)
    except OSError as e:
        sys.stderr.write("save_query_result: could not read %s: %s\n" % (src, e))
        return 2
    try:
        n, next_offset = normalize_text(text, dest, append=append, expect_firm=expect_firm)
    except ScopeError as e:
        sys.stderr.write("save_query_result: SCOPE CHECK FAILED for %s:\n" % dest)
        for msg in e.errors:
            sys.stderr.write("  - %s\n" % msg)
        sys.stderr.write(
            "  The warehouse returned another firm's rows: the session's row-access "
            "grant was switched mid-refresh (it is shared across this user's surfaces). "
            "Nothing was written. Re-run set_context for the intended firm, then "
            "re-fetch this stem from offset 0.\n")
        return 2
    if n < 1:
        preview = text.strip().replace("\n", " ")[:200]
        sys.stderr.write(
            "save_query_result: could not extract any rows from %s — saw: %s\n"
            % (src, preview or "<empty input>"))
        return 2
    verb = "appended" if append else "wrote"
    sys.stdout.write("save_query_result: %s %d row(s) -> %s\n" % (verb, n, dest))
    if next_offset is not None:
        # Sentinel first, on its own line, so a caller can branch on it without parsing
        # prose. Exit stays 0 — see the module docstring on why truncation is not an
        # error exit.
        sys.stdout.write("TRUNCATED next_offset=%d\n" % next_offset)
        sys.stdout.write(
            "save_query_result: %s is INCOMPLETE — the DWH clamps every limit to 10,000 "
            "rows and reported next_offset=%d.\n"
            "  Re-run the SAME query with offset=%d, then capture it with:\n"
            "    save_query_result.py <result_path> %s --append\n"
            "  Repeat until TRUNCATED stops appearing.\n"
            % (dest, next_offset, next_offset, dest))
        return 0
    if verify:
        errs = verify_complete(dest, text, unique_key)
        if errs:
            sys.stderr.write("save_query_result: INTEGRITY CHECK FAILED for %s:\n" % dest)
            for e in errs:
                sys.stderr.write("  - %s\n" % e)
            sys.stderr.write(
                "  A paged fetch tiled incorrectly (OFFSET over a non-total ORDER BY) "
                "or a page was dropped. Do NOT build on this file — re-fetch the stem.\n")
            with open(integrity_error_path(dest), "w", encoding="utf-8") as fh:
                json.dump({"errors": errs}, fh)
                fh.write("\n")
            return 2
        # completed cleanly — clear any stale integrity marker from a prior run
        try:
            os.remove(integrity_error_path(dest))
        except OSError:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
