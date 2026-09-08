#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Write a Carta MCP result to a raw file, verbatim.

Envelope shapes the Carta MCP emits, which this unwraps  (long-comment-ok: external format spec)
  plain text                     a pipe table, with or without a `total_rows:` banner
  {"result": "<text>"}           harness wrapper for a result too large to inline
  [{"type":"text","text":...}]   MCP content blocks
  {"resource":{"blob":"<b64>"}}  base64 resource blob

Not a parser: the raw file must stay what Carta returned, so a build
failure can be read against the response that caused it.

Usage:  uv run save_query_result.py <src|-> <dest.txt> [--append]
        uv run save_query_result.py --from-session <needle> <dest.txt> [--append]
"""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import re
import sys
from pathlib import Path

# A result banner: "total_rows: 1,000 | offset: 0 | limit: 1000 | format: markdown"
_BANNER_PREFIX = "total_rows:"
_BANNER_RE = re.compile(
    r"total_rows:\s*([\d,]+)\s*\|\s*offset:\s*([\d,]+)\s*\|\s*limit:\s*([\d,]+)")

# What the harness writes in place of a result too large to inline.
_SPILL_RE = re.compile(r"saved to (\S+)")

# Keys that mark a dict as an MCP envelope rather than the payload itself.
_WRAPPER_KEYS = ("result", "content", "text", "results", "data")


def _from_blob(blob):
    """Decode a base64 resource blob, or None if it isn't one."""
    if not isinstance(blob, str):
        return None
    try:
        return base64.b64decode(blob, validate=False).decode("utf-8", "replace")
    except (binascii.Error, ValueError):
        return None


def unwrap(raw: str) -> str:
    """The result text inside whatever the MCP wrapped it in.

    Returns `raw` unchanged when it is already plain text — the common
    case, and the one that must not be damaged.
    """
    stripped = raw.strip()
    if not stripped or stripped[0] not in "[{":
        return raw            # already the table

    try:
        doc = json.loads(stripped)
    except ValueError:
        return raw            # starts like JSON but isn't; trust the text

    return _unwrap_value(doc, depth=0) or raw


def _unwrap_value(node, depth: int):
    """Walk an envelope for the first string that looks like a result.

    Depth-limited because these arrive nested — a content block holding a
    resource holding a base64 blob whose contents are themselves a
    wrapper — and an unbounded walk on a malformed payload should stop
    rather than recurse forever.
    """
    if depth > 6:
        return None

    if isinstance(node, str):
        # A string that is itself an envelope (the harness writes
        # {"result": "<json>"} in some shapes) unwraps one more level.
        s = node.strip()
        if s[:1] in "[{":
            try:
                return _unwrap_value(json.loads(s), depth + 1) or node
            except ValueError:
                return node
        return node

    if isinstance(node, list):
        for item in node:
            got = _unwrap_value(item, depth + 1)
            if got:
                return got
        return None

    if isinstance(node, dict):
        # A resource blob is the payload, not a container holding one.
        res = node.get("resource")
        if isinstance(res, dict):
            decoded = _from_blob(res.get("blob"))
            if decoded:
                return decoded
        decoded = _from_blob(node.get("blob"))
        if decoded:
            return decoded

        for key in _WRAPPER_KEYS:
            if key in node:
                got = _unwrap_value(node[key], depth + 1)
                if got:
                    return got
    return None


def session_file(session_id: str, cwd: str) -> Path:
    """The session log at ~/.claude/projects/<encoded cwd>/<id>.jsonl.

    Claude Code flattens the path to a single dir name, replacing every
    character that isn't a letter, digit or dash. A dot is the one that
    bites: `first.last` is the usual shape of a work username, so getting
    this wrong breaks the save for most people rather than an edge case.
    """
    resolved = str(Path(cwd).resolve())
    encoded = re.sub(r"[^A-Za-z0-9-]", "-", resolved)
    candidates = [encoded, resolved.replace("/", "-")]
    base = Path.home() / ".claude" / "projects"
    for enc in candidates:
        path = base / enc / f"{session_id}.jsonl"
        if path.exists():
            return path
    return base / candidates[0] / f"{session_id}.jsonl"


def _tool_calls(log: str):
    """(tool_use_id → (name, request)) and (tool_use_id → result text).

    Correlating on tool_use_id is what makes a needle exact: it matches the
    request that was sent, not text that happens to appear in a response.
    """
    requests, results = {}, {}
    for line in log.splitlines():
        try:
            entry = json.loads(line)
        except ValueError:
            continue
        content = (entry.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            kind = block.get("type")
            if kind == "tool_use":
                requests[block.get("id")] = (block.get("name") or "",
                                             json.dumps(block.get("input") or {}))
            elif kind == "tool_result":
                body = block.get("content")
                if isinstance(body, list):
                    text = "".join(part.get("text", "") for part in body
                                   if isinstance(part, dict))
                else:
                    text = body if isinstance(body, str) else ""
                results[block.get("tool_use_id")] = text
    return requests, results


def from_session(needles, session_id: str, cwd: str, any_tool: bool = False) -> str:
    """The verbatim result of the most recent MCP call whose request
    contained every one of `needles`.

    Only `mcp__*` calls count unless `any_tool`: a save command carries its
    own needles, so its earlier output would otherwise win on a re-run.
    """
    if isinstance(needles, str):
        needles = [needles]
    log = session_file(session_id, cwd)
    if not log.exists():
        raise SystemExit(f"error: no session log at {log}")
    requests, results = _tool_calls(log.read_text())
    hits = [tid for tid, (name, req) in requests.items()
            if all(n in req for n in needles) and tid in results
            and (any_tool or name.startswith("mcp__"))]
    shown = " + ".join(repr(n) for n in needles)
    if not hits:
        raise SystemExit(
            f"error: no {'tool' if any_tool else 'MCP'} call in this session sent "
            f"{shown} ({len(requests)} calls scanned in {log.name}). "
            "Check the needles against what was actually sent.")
    if len(hits) > 1:
        # A shared needle writes the wrong table into a raw file, and the
        # dashboard renders it without complaint. Newest wins, as a re-run should.
        print(f"warning: {len(hits)} calls sent {shown} — taking the most "
              f"recent. Add another --from-session to narrow it.",
              file=sys.stderr)
    text = results[hits[-1]]
    spill = _SPILL_RE.search(text)
    if spill:
        # Oversized results never reach the log — the harness leaves a
        # pointer to the file holding them.
        return Path(spill.group(1).rstrip(".")).read_text()
    return text


def short_page_warning(text: str, dest_name: str):
    """A page holding fewer rows than the query found, or None.

    The banner's `limit` is what the transport actually returned, which can
    be below the SQL's LIMIT. Comparing against `total_rows` catches a
    truncated pull whatever the two disagree about.
    """
    m = _BANNER_RE.search(text)
    if not m:
        return None
    total, offset, limit = (int(g.replace(",", "")) for g in m.groups())
    if total <= offset + limit:
        return None
    return (f"warning: {dest_name} holds rows {offset + 1}-{offset + limit} of "
            f"{total} — fetch the next page with OFFSET {offset + limit} and "
            f"save it with --append")


def strip_banner(text: str) -> str:
    """Drop a leading `total_rows:` banner.

    Only for appending. Each page carries its own banner, and a banner
    landing mid-file would be read as a data row by the pipe-table parser.
    """
    lines = text.lstrip("\n").split("\n")
    if lines and lines[0].lstrip().startswith(_BANNER_PREFIX):
        lines = lines[1:]
        while lines and not lines[0].strip():
            lines = lines[1:]
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Write a Carta MCP result to a raw file, verbatim.")
    ap.add_argument("src", nargs="?",
                    help="tool-results file, or - for stdin")
    ap.add_argument("dest", help="raw-dir file to write")
    ap.add_argument("--append", action="store_true",
                    help="append a further page, dropping its repeated banner")
    ap.add_argument("--from-session", metavar="NEEDLE", action="append",
                    help="take the result of the MCP call whose request "
                         "contained NEEDLE, read verbatim from the session log. "
                         "Repeatable — every needle must match the same call")
    ap.add_argument("--session", default=os.environ.get("CLAUDE_CODE_SESSION_ID"),
                    help="session id (default: $CLAUDE_CODE_SESSION_ID)")
    ap.add_argument("--cwd", default=os.getcwd(),
                    help="the session's project dir (default: cwd)")
    ap.add_argument("--any-tool", action="store_true",
                    help="let --from-session match non-MCP calls too")
    args = ap.parse_args()

    if args.from_session:
        if not args.session:
            print("error: --from-session needs a session id — pass --session or "
                  "run where $CLAUDE_CODE_SESSION_ID is set", file=sys.stderr)
            return 2
        raw = from_session(args.from_session, args.session, args.cwd, args.any_tool)
    elif args.src == "-":
        raw = sys.stdin.read()
    elif args.src:
        p = Path(args.src).expanduser()
        if not p.exists():
            print(f"error: no such file: {p}", file=sys.stderr)
            return 2
        raw = p.read_text()
    else:
        ap.error("give a source file, - for stdin, or --from-session")

    text = unwrap(raw).rstrip("\n")
    if not text.strip():
        # Writing an empty raw file would let the build proceed on nothing.
        print("error: result is empty after unwrapping — refusing to write. "
              "Check the query returned rows, and that the MCP session's "
              "firm context is still the resolved firm (see errors.md).",
              file=sys.stderr)
        return 3

    dest = Path(args.dest).expanduser()
    dest.parent.mkdir(parents=True, exist_ok=True)

    if args.append and dest.exists():
        prior = dest.read_text().rstrip("\n")
        dest.write_text(prior + "\n" + strip_banner(text) + "\n")
    else:
        dest.write_text(text + "\n")

    lines = len(text.split("\n"))
    print(f"wrote {dest} ({lines} lines{', appended' if args.append else ''})",
          file=sys.stderr)
    warning = short_page_warning(text, dest.name)
    if warning:
        print(warning, file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
