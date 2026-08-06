#!/usr/bin/env python3
"""save_query_result.py — normalize a Carta MCP query result into clean ndjson.

Deterministically converts ANY of the shapes the DWH / claude.ai Carta MCP emits
into one-JSON-object-per-line ndjson that ``build_datadir.py``'s ``parse_table``
reads cleanly. Run it after every ``dwh__execute__query`` instead of hand-copying
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
short and the build proceeded on partial data with no warning — observed live on a real
firm's ``financials`` stem, which reports ``total_rows: 12,483`` and was being captured
at exactly 10,000. Now: the rows are still written, a ``<dest>.truncated`` marker records
the resume offset, and a literal ``TRUNCATED next_offset=<N>`` sentinel is printed to
stdout. ``build_datadir.py`` refuses to build while any marker exists, so the only way
forward is to fetch the next page and append it (``--append``), which clears the marker
once a page comes back complete.

**Truncation exits 0 on purpose.** A partial page is the normal path for a stem larger
than the clamp, not a failure, and a non-zero exit renders as an error in the Claude
session that reads as something being broken. This mirrors ``ff-cache.sh``'s
``CACHE_MISS`` sentinel, which is exit-0 for the same reason. The sentinel is what the
caller branches on; the marker plus the builder's refusal are what make it impossible to
ignore. Non-zero stays reserved for genuine failures — no rows extracted, or bad usage.

Usage:  uv run save_query_result.py <src_path> <dest.ndjson> [--append]
        uv run save_query_result.py - <dest.ndjson>   # read the raw result from stdin
                                                      # (for small INLINE results)

Exit codes: 0 complete OR truncated (branch on the stdout sentinel) · 2 no rows / bad usage.

Stdlib-only, Python 3.9-safe (matches build_datadir.py / serve.py constraints).
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
    """Sidecar that records an incomplete stem. ``build_datadir.py`` gates on it."""
    return dest_path + ".truncated"


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
    """Parse a text blob as ndjson (tolerating a ``total_rows:`` preamble), falling
    back to a JSON array / single object. Returns [] for empty / unparseable text.
    This is what lets a string-valued ``result`` / ``content`` / ``text`` — the
    harness-persisted ``{"result": "<preamble>\\n\\n<ndjson>"}`` wrapper the claude.ai
    Carta MCP writes for large results — yield its real rows instead of being copied
    through as one junk row."""
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
    """Parse pipe/markdown table lines into row dicts. The first non-separator
    pipe row is the header; each later row is zipped to it (ragged rows pad/truncate
    to the header width). Keys keep the header's case so they match the DWH ndjson
    (``build_datadir.parse_table`` lowercases both identically)."""
    header = None
    rows = []
    for ln in lines:
        if "|" not in ln or _is_separator(ln):
            continue
        cells = _split_table_row(ln)
        if header is None:
            header = cells
            continue
        row = {header[i]: (_coerce_cell(cells[i]) if i < len(cells) else None)
               for i in range(len(header))}
        rows.append(row)
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


def normalize_text(text, dest_path, append=False):
    """Convert raw result ``text`` into clean ndjson at ``dest_path``.

    Returns ``(rows_written_this_page, next_offset)``. ``rows_written_this_page`` is 0
    when nothing usable was found. ``next_offset`` is None when this page completed the
    stem — in which case any stale ``.truncated`` marker is cleared, so a resumed
    pagination that finally catches up leaves a clean raw dir behind."""
    kind, payload = parse_query_output(text)
    dest_dir = os.path.dirname(os.path.abspath(dest_path))
    if dest_dir:
        os.makedirs(dest_dir, exist_ok=True)

    if kind == "rows" and payload:
        payload = [r for r in payload if not _is_summary(r)]  # drop MCP summary blocks
    if not (kind == "rows" and payload):
        return (0, None)

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
    args = [a for a in argv[1:] if a != "--append"]
    append = "--append" in argv[1:]
    if len(args) != 2:
        sys.stderr.write("usage: save_query_result.py <src_path|-> <dest.ndjson> [--append]\n")
        return 2
    src, dest = args
    if src != "-" and not os.path.exists(src):
        sys.stderr.write("save_query_result: source not found: %s\n" % src)
        return 2
    try:
        text = _read_source(src)
    except OSError as e:
        sys.stderr.write("save_query_result: could not read %s: %s\n" % (src, e))
        return 2
    n, next_offset = normalize_text(text, dest, append=append)
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
            "  Repeat until TRUNCATED stops appearing. build_datadir.py will refuse to "
            "build while %s exists.\n"
            % (dest, next_offset, next_offset, dest, marker_path(dest)))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
