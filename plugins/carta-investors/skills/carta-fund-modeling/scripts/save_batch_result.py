#!/usr/bin/env python3
"""save_batch_result.py — split a dwh__execute__queries response into per-stem ndjson.

`dwh__execute__queries` runs a batch of SELECTs concurrently and returns their results
**indexed to input order**. This helper takes that one aggregate response plus the stem
order it was emitted with (``emit_stem_sql.py --batch`` prints aligned ``stems``/``queries``
arrays) and writes each query's rows to ``<raw_dir>/<stem>.ndjson``, reusing
``save_query_result``'s normalization and truncation handling verbatim — so the batched
path lands rows in the exact same shape the single-query path does, and the same
``TRUNCATED next_offset`` / ``.truncated`` marker contract still gates ``build_datadir.py``.

Usage:
  uv run save_batch_result.py <src_path|-> <raw_dir> --stems nav_latest,investments,...
  uv run save_batch_result.py <src_path|-> <raw_dir> --dump-shape   # inspect the envelope

Per stem it prints one summary line; a truncated stem also prints
``TRUNCATED stem=<name> next_offset=<N>`` (page it with a single dwh__execute__query at
that offset and ``save_query_result.py ... --append``), and an empty stem is written as a
0-row file so the fetch-contract's "the file must exist" still holds.

Exit codes: 0 the batch split into exactly one slice per stem · 2 could not (bad usage,
or the response envelope didn't yield ``len(stems)`` ordered results — fall back to
per-stem single ``dwh__execute__query`` calls, which are unaffected).

**Envelope (per carta-mcp dwh:execute:queries).** The command returns a JSON array, one
element per query, positionally matched and carrying its own ``index``: a success element
is ``{index, total_rows, result}`` (``result`` is the formatted ndjson body, same as a
single ``dwh:execute:query``) and a failed one is ``{index, error}``. ``split_aggregate``
also tolerates the harness-persisted string wrapper and in-order MCP resource blobs, and
REFUSES rather than guesses when it can't produce exactly ``len(stems)`` slices — so a
mis-map can't write false-empty stems. ``--dump-shape`` prints the envelope if it ever
drifts. Stdlib-only, Python 3.9-safe.
"""
import base64
import binascii
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import save_query_result as sqr

# Keys under which an aggregate dict is most likely to carry the ordered result list.
_LIST_KEYS = ("results", "data", "queries", "responses", "items", "rows", "content", "result")


def _b64_text(blob):
    if not isinstance(blob, str):
        return None
    try:
        return base64.b64decode(blob, validate=False).decode("utf-8", "replace")
    except (binascii.Error, ValueError):
        return None


def _b64_json(blob):
    """base64-decode a resource blob and parse it as JSON (the positional array is an
    ``application/json`` blob); None if it isn't base64 JSON."""
    txt = _b64_text(blob)
    if txt is None:
        return None
    st = txt.strip()
    if st[:1] not in ("[", "{"):
        return None
    try:
        return json.loads(st)
    except ValueError:
        return None


def _is_result_elem(x):
    """A dwh:execute:queries result element, not an MCP content block — guards the
    length-``n`` match so the ``[pointer, wrapper]`` .txt can't false-match a 2-query batch."""
    return isinstance(x, dict) and any(
        k in x for k in ("index", "error", "total_rows", "result"))


def _find_positional_array(node, n, _depth=0):
    """Find the n-element positional array in the harness .txt envelope, where it hides
    behind an embedded JSON string and a base64 blob the earlier passes don't reach."""
    if _depth > 12 or n <= 0:
        return None
    if isinstance(node, list) and len(node) == n and all(_is_result_elem(x) for x in node):
        if all(isinstance(x.get("index"), int) for x in node):
            return sorted(node, key=lambda x: x["index"])
        return list(node)
    if isinstance(node, list):
        for x in node:
            hit = _find_positional_array(x, n, _depth + 1)
            if hit is not None:
                return hit
    elif isinstance(node, dict):
        res = node.get("resource")
        blob = res.get("blob") if isinstance(res, dict) else node.get("blob")
        if blob:
            dec = _b64_json(blob)
            if dec is not None:
                hit = _find_positional_array(dec, n, _depth + 1)
                if hit is not None:
                    return hit
        for k, v in node.items():
            if k in ("resource", "blob"):
                continue
            if isinstance(v, str):
                sv = v.strip()
                if sv[:1] in ("[", "{"):
                    try:
                        parsed = json.loads(sv)
                    except ValueError:
                        parsed = None
                    if parsed is not None:
                        hit = _find_positional_array(parsed, n, _depth + 1)
                        if hit is not None:
                            return hit
            elif isinstance(v, (dict, list)):
                hit = _find_positional_array(v, n, _depth + 1)
                if hit is not None:
                    return hit
    return None


def _blob_texts_in_order(node, out):
    """Collect decoded resource-blob texts in document order (best-effort — for the
    MCP content-block envelope where each query result is its own base64 blob)."""
    if isinstance(node, dict):
        res = node.get("resource")
        if isinstance(res, dict) and res.get("blob"):
            t = _b64_text(res["blob"])
            if t is not None:
                out.append(t)
        elif node.get("blob"):
            t = _b64_text(node["blob"])
            if t is not None:
                out.append(t)
        for k, v in node.items():
            if k not in ("resource", "blob"):
                _blob_texts_in_order(v, out)
    elif isinstance(node, list):
        for x in node:
            _blob_texts_in_order(x, out)


def _as_text(elem):
    """Render one result element as text (a string passes through; a dict/list is
    re-serialized). Used both for shape-splitting recursion and for next_offset detection,
    which scans the serialized form."""
    if isinstance(elem, str):
        return elem
    return json.dumps(elem, ensure_ascii=False)


_DATA_KEYS = ("rows", "data", "results", "records", "result")


def extract(elem):
    """Return ``(rows, next_offset)`` for one query's result element, reusing
    save_query_result's row extractors so batched rows land in the identical shape the
    single-query path produces. Handles: an ndjson / JSON / table *string*; a JSON array
    of rows or MCP content-blocks; and a dict that either wraps content-blocks or carries a
    plain row list under a data key (``{"rows": [...], "next_offset": N}``) — the last of
    which normalize_text's walker alone would drop."""
    next_offset = sqr.detect_next_offset(_as_text(elem))
    if isinstance(elem, str):
        kind, rows = sqr.parse_query_output(elem)
        return (rows if kind == "rows" else []), next_offset
    if isinstance(elem, list):
        if sqr._looks_like_content_blocks(elem):
            return sqr._walk_for_rows(elem), next_offset
        return sqr._rows_from_json_value(elem), next_offset
    if isinstance(elem, dict):
        is_cb = sqr._looks_like_content_blocks(elem)
        # A failed query element (``{index, error}``) has no result body — 0 rows, never a
        # junk row. Checked before the bare-row fallback, which would otherwise keep it.
        if elem.get("error") and not (is_cb or any(k in elem for k in _DATA_KEYS)):
            return [], None
        if is_cb:
            rows = sqr._walk_for_rows(elem)
            if rows:
                return rows, next_offset
        for k in _DATA_KEYS:
            if k in elem and isinstance(elem[k], list):
                return ([x for x in elem[k]
                         if isinstance(x, dict) and not sqr._is_summary(x)], next_offset)
        # A bare row dict — but only when it isn't a content-block wrapper that genuinely
        # yielded no rows (else we'd write the wrapper itself as a junk row).
        if not is_cb and elem and not sqr._is_summary(elem):
            return [elem], next_offset
    return [], next_offset


def _write_rows(rows, dest, next_offset):
    with open(dest, "w", encoding="utf-8") as fh:
        for r in rows:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    if rows and next_offset is not None:
        sqr._write_marker(dest, next_offset, len(rows))
    else:
        sqr._clear_marker(dest)


def split_aggregate(text, n):
    """Return a list of exactly ``n`` result *elements* (raw dict/list/str, in input
    order) for ``extract`` to consume, or None if the envelope can't be confidently split
    into ``n`` slices. Isolated so it's the one thing to adjust once the real
    execute_queries envelope is confirmed (see module docstring)."""
    if n <= 0:
        return None
    st = (text or "").strip()

    if st[:1] in ("[", "{"):
        try:
            doc = json.loads(st)
        except ValueError:
            doc = None
        if doc is not None:
            # top-level list of results, ordered by each element's own `index`. The
            # _is_result_elem guard stops the [pointer, wrapper] .txt false-matching n==2.
            if isinstance(doc, list) and len(doc) == n and all(_is_result_elem(x) for x in doc):
                if all(isinstance(x.get("index"), int) for x in doc):
                    return sorted(doc, key=lambda x: x["index"])
                return list(doc)
            if isinstance(doc, dict):
                for k in _LIST_KEYS:
                    v = doc.get(k)
                    if isinstance(v, list) and len(v) == n:
                        return list(v)
                # harness-persisted string wrapper: recurse into the embedded text
                for k in ("result", "content", "text"):
                    v = doc.get(k)
                    if isinstance(v, str) and v.strip():
                        inner = split_aggregate(v, n)
                        if inner is not None:
                            return inner
            # in-order resource blobs (MCP content-block envelope) — decoded to ndjson text
            blobs = []
            _blob_texts_in_order(doc, blobs)
            if len(blobs) == n:
                return blobs
            # last resort: dig the array out of the harness .txt so passing it directly works.
            deep = _find_positional_array(doc, n)
            if deep is not None:
                return deep
    return None


def _dump_shape(text):
    st = (text or "").strip()
    try:
        doc = json.loads(st)
    except ValueError:
        sys.stdout.write("shape: non-JSON text (%d chars); first 300:\n%s\n"
                         % (len(st), st[:300]))
        return
    def desc(v, depth=0):
        if isinstance(v, dict):
            return "dict{%s}" % ", ".join(
                "%s: %s" % (k, desc(val, depth + 1)) for k, val in list(v.items())[:12])
        if isinstance(v, list):
            head = desc(v[0], depth + 1) if v else "-"
            return "list[%d] of %s" % (len(v), head)
        if isinstance(v, str):
            return "str(%d)" % len(v)
        return type(v).__name__
    sys.stdout.write("shape: %s\n" % desc(doc))


def main(argv):
    args = argv[1:]
    dump = "--dump-shape" in args
    stems = None
    if "--stems" in args:
        i = args.index("--stems")
        if i + 1 < len(args):
            stems = [s for s in args[i + 1].split(",") if s]
        args = args[:i] + args[i + 2:]
    args = [a for a in args if a != "--dump-shape"]
    if len(args) != 2:
        sys.stderr.write("usage: save_batch_result.py <src|-> <raw_dir> "
                         "--stems a,b,c [--dump-shape]\n")
        return 2
    src, raw_dir = args
    if src != "-" and not os.path.exists(src):
        sys.stderr.write("save_batch_result: source not found: %s\n" % src)
        return 2
    try:
        text = sqr._read_source(src)
    except OSError as e:
        sys.stderr.write("save_batch_result: could not read %s: %s\n" % (src, e))
        return 2

    if dump:
        _dump_shape(text)
        return 0
    if not stems:
        sys.stderr.write("save_batch_result: --stems is required\n")
        return 2

    slices = split_aggregate(text, len(stems))
    if slices is None:
        preview = text.strip().replace("\n", " ")[:200]
        sys.stderr.write(
            "save_batch_result: could not split the response into %d ordered results — "
            "saw: %s\n  Re-run with --dump-shape to inspect the envelope, then fall back "
            "to per-stem dwh__execute__query calls.\n" % (len(stems), preview or "<empty>"))
        return 2

    os.makedirs(raw_dir, exist_ok=True)
    truncated, errored = [], []
    for stem, chunk in zip(stems, slices):
        dest = os.path.join(raw_dir, stem + ".ndjson")
        err = chunk.get("error") if isinstance(chunk, dict) else None
        if err:
            _write_rows([], dest, None)  # failed query: empty file, still exists per contract
            errored.append((stem, err))
            # Flatten to one line — the DWH puts the real cause after a newline (e.g. below
            # "SQL compilation error:"), which the single-line downstream parser would drop.
            sys.stdout.write("ERROR stem=%s: %s\n" % (stem, " ".join(str(err).split())[:300]))
            continue
        rows, next_offset = extract(chunk)
        # Truncation is signalled by the element's own total_rows exceeding what came back,
        # for the shapes where next_offset isn't embedded in the body header.
        if next_offset is None and isinstance(chunk, dict) and rows:
            tr = chunk.get("total_rows")
            if isinstance(tr, int) and tr > len(rows):
                next_offset = len(rows)
        _write_rows(rows, dest, next_offset)  # 0 rows -> empty file (contract: file exists)
        if not rows:
            sys.stdout.write("save_batch_result: %-16s 0 rows (empty file)\n" % stem)
            continue
        if next_offset is not None:
            truncated.append((stem, next_offset))
            sys.stdout.write("TRUNCATED stem=%s next_offset=%d\n" % (stem, next_offset))
        sys.stdout.write("save_batch_result: %-16s %d row(s) -> %s%s\n"
                         % (stem, len(rows), dest,
                            "  [INCOMPLETE]" if next_offset is not None else ""))

    if errored:
        sys.stdout.write("save_batch_result: %d quer(y/ies) FAILED (empty file written): %s "
                         "— re-run each as a single dwh__execute__query to see the error.\n"
                         % (len(errored), ", ".join(s for s, _ in errored)))
    if truncated:
        sys.stdout.write(
            "save_batch_result: %d stem(s) truncated — page each with a single "
            "dwh__execute__query at its offset, then save_query_result.py ... --append. "
            "build_datadir.py refuses to build while a .truncated marker exists.\n"
            % len(truncated))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
