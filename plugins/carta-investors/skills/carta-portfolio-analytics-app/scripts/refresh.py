#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Button-driven data refresh for the portfolio-analytics console (SKILL.md Steps 1-3).

serve.py owns the orchestration; the headless `claude` session only issues the Carta
MCP calls it is told to, and serve.py reads each DWH result off the event stream — so
the session needs no Bash and no Write, just welcome / set_context / call_tool. The
carta MCP tools may be deferred; the real mcp__<prefix>__call_tool name is read off
the first fetch turn's tool_use.

DWH results are requested in `blob` mode: the client here is always the Claude Code
CLI, which persists a blob body to disk and hands the model a one-line ack naming the
file, so a page's size never matters to the model. Every event of the session is
mirrored into `<raw_dir>/refresh.log` so a failed refresh can be read back.
Stdlib-only, 3.9-safe.
"""
import contextlib
import importlib.util as _ilu
import json
import os
import re
import subprocess
import sys
from typing import Callable, List, Optional


def _sibling(name):
    """Load a sibling script by absolute path — never via sys.path, so importing this
    module in a shared test session can't shadow a same-named script from another skill."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = _ilu.spec_from_file_location("_pa_" + name, p)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


chat_session = _sibling("chat_session")
_datasets = _sibling("datasets")
fm_paths = _sibling("fm_paths")

REFRESH_SYSTEM_PROMPT = (
    "You are a data-fetch executor for a portfolio-analytics refresh. You have a Carta "
    "MCP server (from the carta-investors plugin) whose tools are named "
    "mcp__<server>__welcome, mcp__<server>__set_context, and mcp__<server>__call_tool. "
    "If they are not immediately visible, search for them first — they may be deferred. "
    "Do ONLY the tool calls the user message specifies, in the given order, with exactly "
    "the given arguments. Never author or alter SQL, never call any other tool, never "
    "change the firm context. "
    "CRITICAL: pass each tool call's parameters as native JSON objects, NOT as a quoted "
    "string — `arguments` and `_instrumentation_v2` are objects. Copy every value byte-for-"
    "byte from the user message; never re-escape it. In particular a single quote (') inside "
    "SQL stays a single quote — do NOT turn it into \\'. Pass each call ONLY the keys the "
    "user message gives it — never add a `prompt` or any other key. "
    "A tool result that says its output was saved to a file is a SUCCESS: do not read that "
    "file, do not repeat the call, do not call any other tool — move on to the next "
    "specified call. "
    "When the specified calls have returned, reply with exactly: DONE."
)

# Attached to EVERY Carta MCP call (welcome, set_context, call_tool): the Carta plugin's
# instrumentation hook doesn't run in this headless subprocess, and the server rejects a
# call that arrives without the field. Skills-only; model/surface omitted rather than guessed.
_INSTRUMENTATION = {"skills": ["carta-investors:carta-portfolio-analytics-app"]}

TURN_TIMEOUT = 300
MAX_PAGES = 10     # page 1 is offset 0; escalate before an 11th page (>100,000 rows)
MAX_STEM_RETRIES = 1
# The DWH's server-side row clamp. The page body never enters model context (see
# RESPONSE_MODE), so rows-per-page only sets how many turns a stem takes — bigger is better.
PAGE_LIMIT = 10000

# The client is the Claude Code CLI: it writes a `blob` body to disk and shows the model an
# ack + path. An oversized `inline` body is also spilled, but as an "Error: … exceeds
# maximum allowed tokens" message that tells the model to go read the file.
RESPONSE_MODE = "blob"
FALLBACK_RESPONSE_MODE = "inline"
_BLOB_REJECT_RE = re.compile(r"-32602|invalid_union|expected text|Unsupported response_mode", re.I)
# A dropped MCP connection mid-query (seen on QED: "The socket connection was closed
# unexpectedly" on page 2). Retried once; a query error is never retried.
_TRANSIENT_RE = re.compile(r"socket|connection (?:was )?(?:closed|reset)|ECONNRESET|EPIPE|"
                           r"timed? ?out|\b50[234]\b|fetch failed|network", re.I)
EVENT_LOG = "refresh.log"

_PREFIXES_PROD = ("claude_ai_carta", "claude_ai_Carta", "carta", "carta_production")
_PREFIXES_NONPROD = ("Carta_Sandbox", "claude_ai_Carta_Sandbox", "carta_sandbox",
                     "carta_test", "carta_demo", "carta_preprod")
_TOOLNAME_RE = re.compile(r"^mcp__(.+)__[a-z_]+$")

# save_query_result flags that verify a stem tiled completely on the single-fetch,
# retry, and paging paths (SKILL.md Step 2 / Fallback). The light stems carry their
# own unique key too, so a mis-tiled or short page — or a lossy markdown fallback —
# fails the fetch instead of silently blanking the dashboard.
_VERIFY_FLAGS = {
    "funds": ["--verify-complete", "--unique-key", "fund_uuid"],
    "holdings": ["--verify-complete", "--unique-key", "fund_investment_key"],
    "fdshares": ["--verify-complete", "--unique-key", "corporation_id,fund_id"],
    "deal_irr": ["--verify-complete", "--unique-key", "issuer_name,fund_uuid"],
    "capstack": ["--verify-complete", "--unique-key", "corporation_id,security_class_id"],
    "financials": ["--verify-complete", "--unique-key",
                   "legal_name,mnemonic|name,frequency,period_end"],
    "forecasts": ["--verify-complete"],
    "holdings_history": ["--verify-complete", "--unique-key", "_pk"],
    "entity_identity": ["--verify-complete", "--unique-key", "entity_link_id"],
    "corporation_links": ["--verify-complete", "--unique-key", "general_ledger_issuer_id,corporation_id"],
}
# Stems fetched singly, never in the light batch. Refresh-all takes the two identity
# stems first so Ownership (whose other stems ride the batch) settles in one stretch.
_PAGED_STEMS = ["entity_identity", "corporation_links", "holdings_history", "financials", "forecasts"]

# Stems refreshed as a delta past the cached max instance_id — a submission-order
# surrogate, unlike as_of_date, which companies stamp with the statement date.
# financials replaces by its dedup key in the QUALIFY's own order; forecasts keeps
# every vintage, so its delta is appended. A row edited in place or deleted upstream
# is not seen until a chat "Refresh KPI data" rebuilds the cache in full.
_INCREMENTAL = {
    "financials": {"key": "legal_name,mnemonic|name,frequency,period_end",
                   "order": "as_of_date,instance_id"},
    "forecasts": None,
}
_INSTANCE_COL = "instance_id"
# Identity keys both incremental stems select. A cached row missing one predates
# company_key(); merging a delta onto it would key one company two ways, so refetch in full.
_IDENTITY_COLS = ("general_ledger_issuer_id", "corporation_id", "llc_entity_id")
_NO_ROWS_RE = re.compile(r"Query returned no results|No more results", re.I)

# stem -> its dataset's label, for a human progress line on the fetching row.
_STEM_LABEL = {s: ds["label"] for ds in _datasets.DATASETS for s in ds["stems"]}


class RefreshError(Exception):
    def __init__(self, message, needs_human=False, detail=None):
        super(RefreshError, self).__init__(message)
        self.needs_human = needs_human
        self.detail = detail  # raw technical error, shown behind a "details" toggle


def bootstrap_allowed_tools(prefer_nonprod=False):
    # type: (bool) -> str
    prefixes = _PREFIXES_PROD + (_PREFIXES_NONPROD if prefer_nonprod else ())
    return ",".join("mcp__%s__%s" % (p, t)
                    for p in prefixes for t in ("welcome", "set_context", "call_tool"))


def prefix_from_toolname(name):
    # type: (Optional[str]) -> Optional[str]
    m = _TOOLNAME_RE.match(name or "")
    return m.group(1) if m else None


def _flatten(content):
    # type: (object) -> str
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for b in content:
            if isinstance(b, dict) and b.get("type") == "text":
                out.append(b.get("text") or "")
            elif isinstance(b, str):
                out.append(b)
        return "".join(out)
    return "" if content is None else json.dumps(content)


_SAVED_PATH_RE = re.compile(r"saved to[:\s]+(/\S+?\.(?:txt|bin|json|ndjson))", re.I)


def _persisted_path(text):
    # type: (str) -> Optional[str]
    """The file the CLI persisted a tool result to, when the result prose names one that
    exists. Two shapes: a blob result ("Binary content … saved to /….bin") and an
    oversized inline result ("… exceeds maximum allowed tokens. Output has been saved to
    /….txt")."""
    m = _SAVED_PATH_RE.search(text or "")
    if m and os.path.exists(m.group(1)):
        return m.group(1)
    return None


def _capture_src(text, dest_raw):
    # type: (str, str) -> str
    """Where a save helper should read a DWH result from: the inline {"result":...}
    payload when present, else the persisted file the prose names."""
    text = text or ""
    i = text.find('{"result"')
    if i > 0:
        text = text[i:]
    elif i < 0:
        path = _persisted_path(text)
        if path:
            return path
    with open(dest_raw, "w") as fh:
        fh.write(text)
    return dest_raw


def _run_turn(session, prompt, capture_suffix=None, on_step=None, timeout=TURN_TIMEOUT):
    """Run one prompt to turn end. Returns (ok, captured, error, tool_name): captured is
    the flattened result of the last tool call whose name ends with capture_suffix, and
    tool_name is that call's real name — so the caller learns the resolved carta prefix.
    error is the captured call's own error, else any other call's (a rejected
    set_context), so a turn that never reached the capture call still says why."""
    session.send(prompt)
    pending = {}
    captured = None
    err = None
    other_err = None
    matched = None
    for ev in session.events(timeout=timeout):
        t = ev.get("type")
        if t == "assistant":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") == "tool_use":
                    pending[b.get("id")] = b.get("name")
                    if on_step and capture_suffix and (b.get("name") or "").endswith(capture_suffix):
                        on_step("issued")
        elif t == "user":
            for b in ev.get("message", {}).get("content", []):
                if b.get("type") != "tool_result":
                    continue
                name = pending.get(b.get("tool_use_id"))
                text = _flatten(b.get("content"))
                if capture_suffix and not (name or "").endswith(capture_suffix):
                    if b.get("is_error"):
                        other_err = text or ("%s failed" % (name or "a tool call"))
                    continue
                if on_step:
                    on_step("received")
                matched = name
                # An error-flagged result that names a persisted file is still a result.
                if b.get("is_error") and not _persisted_path(text):
                    err = text
                elif capture_suffix:
                    captured = text
        elif t == "result":
            return (not ev.get("is_error"), captured, err or other_err, matched)
    return (False, captured, err or other_err or "session ended without a result", matched)


_STEM_ERR_RE = re.compile(r"ERROR stem=(\S+?):?\s+(.*)")
_TRUNC_BATCH_RE = re.compile(r"TRUNCATED stem=(\S+)\s+next_offset=(\d+)")
_TRUNC_SINGLE_RE = re.compile(r"TRUNCATED next_offset=(\d+)")


def _truncated_stems(out):
    # type: (str) -> List[tuple]
    return [(m.group(1), int(m.group(2))) for m in _TRUNC_BATCH_RE.finditer(out or "")]


def _stem_errors(out):
    # type: (str) -> List[tuple]
    return [(m.group(1), (m.group(2) or "").strip())
            for m in (_STEM_ERR_RE.search(l) for l in (out or "").splitlines()) if m]


def _py(script_dir, name, *args, **kwargs):
    # type: (str, str, str) -> subprocess.CompletedProcess
    """Run a pipeline script with serve.py's interpreter. Bound the runtime so a hang
    can't wedge the request thread holding the refresh lock; a timeout is needs_human."""
    timeout = kwargs.pop("timeout", 120)
    try:
        return subprocess.run(
            [sys.executable, os.path.join(script_dir, name)] + list(args),
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RefreshError("%s timed out after %ds; the refresh couldn't finish."
                           % (name, timeout), needs_human=True)


def _stem_sql(script_dir, stem, since, after_instance=None):
    # type: (str, str, Optional[str], Optional[int]) -> str
    args = ["sql", stem] + (["--since", since] if since else [])
    if after_instance is not None:
        args += ["--after-instance", str(after_instance)]
    r = _py(script_dir, "emit_stem_sql.py", *args)
    if r.returncode != 0:
        raise RefreshError("Couldn't build the query for %s: %s"
                           % (stem, r.stderr.strip()), needs_human=True)
    return r.stdout.strip()


def _dwh_args(sql=None, queries=None, limit=PAGE_LIMIT, offset=0, response_mode=RESPONSE_MODE):
    # type: (Optional[str], Optional[list], int, int, str) -> dict
    """Arguments for one dwh__execute__query (sql) or dwh__execute__queries (queries) call."""
    args = {"limit": limit, "format": "ndjson", "response_mode": response_mode}
    if queries is not None:
        args["queries"] = queries
    else:
        args["sql"] = sql
        args["offset"] = offset
    return args


def _single_call_prompt(call, tool, args):
    # type: (str, str, dict) -> str
    return ("Run exactly one tool call, then reply DONE:\n%s {\"name\": \"%s\", "
            "\"arguments\": %s, \"_instrumentation_v2\": %s}"
            % (call, tool, json.dumps(args), json.dumps(_INSTRUMENTATION)))


def _first_turn_prompt(firm_uuid, tool, args):
    # type: (str, str, dict) -> str
    """welcome + set_context + the first fetch call, by ROLE (the mcp prefix is unknown
    on the first turn; serve.py reads it off this turn's call_tool tool_use)."""
    inst = json.dumps(_INSTRUMENTATION)
    return (
        "Do these three tool calls in order, then reply DONE:\n"
        "1. Call the Carta MCP welcome tool with {\"_instrumentation_v2\": %s}.\n"
        "2. Call the Carta MCP set_context tool with {\"firm_id\": \"%s\", "
        "\"_instrumentation_v2\": %s}.\n"
        "3. Call the Carta MCP call_tool tool with {\"name\": \"%s\", \"arguments\": %s, "
        "\"_instrumentation_v2\": %s}."
        % (inst, firm_uuid, inst, tool, json.dumps(args), inst)
    )


def _dwh_turn(session, call_box, tool, args, on_step=None):
    # type: (object, dict, str, dict, Optional[Callable]) -> tuple
    """One DWH call. The session's first call also runs welcome + set_context and resolves
    the mcp prefix into call_box['call'] (unknown until the model picks a tool). One
    retry, and only for two failures: the client rejected the blob shape (re-run inline)
    or the connection dropped (re-run as is). A query error is returned, never retried.
    Returns (captured, error, tool_name); captured is None when there is no result."""
    if call_box["call"]:
        prompt = _single_call_prompt(call_box["call"], tool, args)
    else:
        prompt = _first_turn_prompt(call_box["firm_uuid"], tool, args)
    ok, captured, err, matched = _run_turn(session, prompt, capture_suffix="__call_tool",
                                           on_step=on_step)
    if not call_box["call"]:
        prefix = prefix_from_toolname(matched)
        if prefix:
            call_box["call"] = "mcp__%s__call_tool" % prefix
    got = captured if (ok and captured) else None
    if got is None and call_box["call"]:
        retry = None
        if args.get("response_mode") == RESPONSE_MODE and _BLOB_REJECT_RE.search(err or ""):
            retry = dict(args, response_mode=FALLBACK_RESPONSE_MODE)
        elif _TRANSIENT_RE.search(err or ""):
            retry = args
        if retry is not None:
            ok, captured, err, matched = _run_turn(
                session, _single_call_prompt(call_box["call"], tool, retry),
                capture_suffix="__call_tool", on_step=on_step)
            got = captured if (ok and captured) else None
    return (got, err, matched)


def _paginate(session, script_dir, raw_dir, call_box, stem, next_off, sql, dest, emit):
    """Page one truncated stem via offset fetches of the same `sql`, appending to `dest`."""
    verify = _VERIFY_FLAGS.get(stem, [])
    pages = 1
    while next_off is not None:
        if pages >= MAX_PAGES:
            raise RefreshError(
                "This firm's %s data exceeds 100,000 rows, which an in-app refresh can't "
                "page through. Ask Claude to “Refresh KPI data” for a full rebuild." % stem,
                needs_human=True)
        emit("fetch", "Fetching more %s rows…" % stem, page=pages + 1)
        captured, err, _n = _dwh_turn(session, call_box, "dwh__execute__query",
                                      _dwh_args(sql=sql, offset=next_off))
        if not captured:
            raise RefreshError("Paging %s failed: %s" % (stem, err or "no result"), needs_human=True)
        src = _capture_src(captured, os.path.join(raw_dir, "%s_p%d.raw" % (stem, next_off)))
        r = _py(script_dir, "save_query_result.py", src, dest, "--append", *verify)
        if r.returncode != 0:
            raise RefreshError("Couldn't append a %s page: %s"
                               % (stem, r.stderr.strip() or "no rows"), needs_human=True)
        pages += 1
        m = _TRUNC_SINGLE_RE.search((r.stdout or "") + (r.stderr or ""))
        next_off = int(m.group(1)) if m else None


_INTEGRITY_RE = re.compile(r"INTEGRITY CHECK FAILED")


def _is_integrity_failure(e):
    # type: (RefreshError) -> bool
    return bool(_INTEGRITY_RE.search("%s %s" % (e, e.detail or "")))


def _fetch_single_stem(session, script_dir, raw_dir, call_box, stem, since, emit):
    """Fetch one stem, re-fetching once if its pages failed the integrity check: the
    warehouse tables refresh every few minutes, and a refresh that lands mid-fetch
    shifts every later OFFSET page (seen on QED: 554 rows duplicated, 554 missed)."""
    try:
        _fetch_stem_once(session, script_dir, raw_dir, call_box, stem, since, emit)
    except RefreshError as e:
        if not _is_integrity_failure(e):
            raise
        emit("fetch", "Carta's data changed mid-fetch; fetching %s again…"
             % _STEM_LABEL.get(stem, stem), active=[stem])
        _fetch_stem_once(session, script_dir, raw_dir, call_box, stem, since, emit)


def _stem_watermark(raw_dir, stem):
    # type: (str, str) -> Optional[int]
    """Max instance_id in the cached stem, read line by line; None when the file is
    missing, empty, or any row predates a column the stem now selects (instance_id or
    the identity keys) — which means a full fetch."""
    path = os.path.join(raw_dir, "%s.ndjson" % stem)
    best = None
    try:
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                try:
                    row = json.loads(line)
                except ValueError:
                    continue
                if any(c not in row and c.upper() not in row for c in _IDENTITY_COLS):
                    return None
                v = row.get(_INSTANCE_COL, row.get(_INSTANCE_COL.upper()))
                try:
                    v = int(v)
                except (TypeError, ValueError):
                    continue
                if best is None or v > best:
                    best = v
    except OSError:
        return None
    return best


def _no_rows(src):
    # type: (str) -> bool
    """True when the captured result is the DWH's zero-row message rather than a page."""
    try:
        with open(src, encoding="utf-8", errors="replace") as fh:
            return bool(_NO_ROWS_RE.search(fh.read(400)))
    except OSError:
        return False


def _merge_delta(script_dir, stem, dest, delta):
    spec = _INCREMENTAL[stem]
    args = ([dest, delta, "--key", spec["key"], "--order", spec["order"]] if spec
            else [dest, delta, "--append-only"])
    r = _py(script_dir, "merge_stem_delta.py", *args)
    if r.returncode != 0:
        raise RefreshError("Couldn't merge new %s rows." % _STEM_LABEL.get(stem, stem),
                           needs_human=True, detail=r.stderr.strip() or "merge failed")
    try:
        os.remove(delta)
    except OSError:
        pass


_MARKER_SUFFIXES = (".truncated", ".integrity_error")


def _staging_path(dest):
    # type: (str) -> str
    """Where a full fetch accumulates its pages. It replaces `dest` in one move only once
    complete, so an escalated or failed fetch leaves the previous stem untouched."""
    return dest + ".fetching"


def _discard(path):
    # type: (str) -> None
    for p in (path,) + tuple(path + s for s in _MARKER_SUFFIXES):
        try:
            os.remove(p)
        except OSError:
            pass


def _promote(staging, dest):
    # type: (str, str) -> None
    os.replace(staging, dest)
    for s in _MARKER_SUFFIXES:  # a marker left beside dest by an older refresh is stale now
        try:
            os.remove(dest + s)
        except OSError:
            pass


def _save_pages(session, script_dir, raw_dir, call_box, stem, src, sql, target, emit):
    """Save the first page into `target` and page the rest after it, discarding the file
    and its markers if anything stops the fetch short."""
    try:
        r = _py(script_dir, "save_query_result.py", src, target, *_VERIFY_FLAGS.get(stem, []))
        if r.returncode != 0:
            raise RefreshError("Couldn't refresh %s." % _STEM_LABEL.get(stem, stem), needs_human=True,
                               detail=r.stderr.strip() or "no rows")
        m = _TRUNC_SINGLE_RE.search((r.stdout or "") + (r.stderr or ""))
        if m:
            _paginate(session, script_dir, raw_dir, call_box, stem, int(m.group(1)), sql, target, emit)
    except RefreshError:
        _discard(target)
        raise


def _fetch_stem_once(session, script_dir, raw_dir, call_box, stem, since, emit):
    """Fetch one stem (paging the rest). An incremental stem with a cached watermark
    fetches only rows past it into a delta file and merges; anything else is a full
    fetch from offset 0 into a staging file that replaces the stem once complete. The
    session's first call also runs welcome + set_context and resolves the mcp prefix
    into call_box['call']."""
    label = _STEM_LABEL.get(stem, stem)
    emit("fetch", "Fetching %s…" % label, active=[stem])
    dest = os.path.join(raw_dir, "%s.ndjson" % stem)
    after = _stem_watermark(raw_dir, stem) if stem in _INCREMENTAL else None
    sql = _stem_sql(script_dir, stem, since, after_instance=after)
    captured, err, _n = _dwh_turn(session, call_box, "dwh__execute__query", _dwh_args(sql=sql))
    if not call_box["call"]:
        raise RefreshError("Couldn't reach the Carta data warehouse.", needs_human=True,
                           detail=err or "No Carta MCP call_tool was found in the refresh session.")
    if not captured:
        raise RefreshError("Couldn't refresh %s." % label, needs_human=True,
                           detail=err or "no result")
    src = _capture_src(captured, os.path.join(raw_dir, "%s.raw" % stem))
    if _no_rows(src):
        # Nothing new since the watermark (keep the cache), or a stem this firm has no
        # rows for at all (an empty file is the contract). Either way it is fresh now.
        if after is None:
            open(dest, "w").close()
        else:
            os.utime(dest, None)
        emit("fetch", "Saved %s." % label, active=[], completed=[stem])
        return
    if after is not None:
        delta = os.path.join(raw_dir, "%s.delta.ndjson" % stem)
        _save_pages(session, script_dir, raw_dir, call_box, stem, src, sql, delta, emit)
        _merge_delta(script_dir, stem, dest, delta)
    else:
        staging = _staging_path(dest)
        _save_pages(session, script_dir, raw_dir, call_box, stem, src, sql, staging, emit)
        _promote(staging, dest)
    emit("fetch", "Saved %s." % label, active=[], completed=[stem])


def _fetch_optional_stem(session, script_dir, raw_dir, call_box, stem, since, emit, warnings):
    """Fetch a stem whose failure should NOT abort the whole refresh — the other datasets
    that already succeeded are worth keeping. Turns a failure into a warning + continues,
    mirroring how the light batch handles a bad stem."""
    try:
        _fetch_single_stem(session, script_dir, raw_dir, call_box, stem, since, emit)
    except RefreshError as e:
        issue = "Couldn't refresh %s." % _STEM_LABEL.get(stem, stem)
        warnings.append(issue)
        emit("issue", issue, active=[])  # clear the spinner; the run keeps going


def _retry_stem(session, script_dir, raw_dir, call_box, stem, since, emit):
    """Re-fetch one stem that errored inside the batch, so a transient fault doesn't
    silently blank data the dashboard needs. Returns True on recovery."""
    for _ in range(MAX_STEM_RETRIES):
        emit("fetch", "Retrying %s…" % stem)
        sql = _stem_sql(script_dir, stem, since)
        captured, _err, _n = _dwh_turn(session, call_box, "dwh__execute__query", _dwh_args(sql=sql))
        if not captured:
            continue
        dest = os.path.join(raw_dir, "%s.ndjson" % stem)
        src = _capture_src(captured, os.path.join(raw_dir, "%s_retry.raw" % stem))
        staging = _staging_path(dest)
        try:
            _save_pages(session, script_dir, raw_dir, call_box, stem, src, sql, staging, emit)
        except RefreshError:
            continue
        _promote(staging, dest)
        return True
    return False


def _fetch_batch(session, script_dir, raw_dir, call_box, since, emit, warnings):
    """Refresh-all fast path: the 5 light stems in one dwh__execute__queries call, run on
    the first turn (welcome + set_context resolve the prefix), then page/retry per stem."""
    r = _py(script_dir, "emit_stem_sql.py", "batch", *(["--since", since] if since else []))
    if r.returncode != 0:
        raise RefreshError("Couldn't build the fetch queries: %s" % r.stderr.strip())
    batches = json.loads(r.stdout)
    total = len(batches)
    for i, batch in enumerate(batches, 1):
        stems = batch["stems"]
        emit("fetch", "Fetching fund data from Carta…", step=i, total=total, active=stems)
        captured, err, _n = _dwh_turn(
            session, call_box, "dwh__execute__queries",
            _dwh_args(queries=batch["queries"], limit=batch.get("limit", PAGE_LIMIT)))
        if not call_box["call"]:
            raise RefreshError("Couldn't identify the Carta MCP tools in this session. "
                               "Ask Claude to “Refresh KPI data” instead.", needs_human=True,
                               detail=err)
        if not captured:
            raise RefreshError("A data fetch failed on batch %d of %d: %s"
                               % (i, total, err or "no result"), needs_human=True)
        src = _capture_src(captured, os.path.join(raw_dir, "batch%d.raw" % i))
        r = _py(script_dir, "save_batch_result.py", src, raw_dir, "--stems", ",".join(stems))
        out = (r.stdout or "") + (r.stderr or "")
        if r.returncode != 0:
            raise RefreshError("Couldn't parse batch %d of %d: %s"
                               % (i, total, r.stderr.strip() or "envelope mismatch"), needs_human=True)
        for stem_name, next_off in _truncated_stems(out):
            _paginate(session, script_dir, raw_dir, call_box, stem_name, next_off,
                      _stem_sql(script_dir, stem_name, since),
                      os.path.join(raw_dir, "%s.ndjson" % stem_name), emit)
        for stem_name, detail in _stem_errors(out):
            if _retry_stem(session, script_dir, raw_dir, call_box, stem_name, since, emit):
                continue
            issue = "Couldn't load %s data (%s)." % (stem_name, detail[:200])
            warnings.append(issue)
            emit("issue", issue)
        # The batch stage is done — mark all its stems complete so their datasets can settle.
        emit("fetch", "Saved fund data.", active=[], completed=stems)


def _read_source(data_dir):
    # type: (str) -> dict
    try:
        with open(os.path.join(data_dir, "kpi.json")) as fh:
            return (json.load(fh) or {}).get("source") or {}
    except (OSError, ValueError):
        raise RefreshError("This firm's cache is missing or unreadable; relaunch it "
                           "from Claude before refreshing.", needs_human=True)


def run_fetch(data_dir, emit, stems=None, claude_bin=None, model=None, on_session=None):
    # type: (str, Callable, Optional[object], Optional[str], Optional[str], Optional[Callable]) -> dict
    """Fetch this firm's Carta data into the raw dir; emit streams progress. stems=None
    (or "all") refreshes everything; a list of dataset keys refreshes only those. Writes
    ONLY raw ndjson (never kpi.json/firms.json/portfolio.json), so the app stays usable —
    run_build does the rebuild+swap. Returns {ok, warnings} or raises RefreshError.

    emit(phase, message, **extra) phase strings are a client contract (UpdateDataButton.jsx):
    preflight, fetch, build, issue.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    emit("preflight", "Checking your Carta connection…")
    src = _read_source(data_dir)
    firm_uuid = src.get("firmUuid")
    if not firm_uuid:
        raise RefreshError("This cache predates firm-id tracking, so an in-app refresh "
                           "can't target it. Ask Claude to “Refresh KPI data” once.",
                           needs_human=True)
    since = src.get("since")
    prefer_nonprod = (src.get("cartaEnvironment") == "nonprod")

    if stems in (None, "all"):
        target = None
    else:
        try:
            target = _datasets.stems_for(list(stems))
        except ValueError as e:
            raise RefreshError(str(e), needs_human=True)

    slug = os.path.basename(os.path.normpath(data_dir))
    raw_dir = str(fm_paths.raw_dir(slug))
    os.makedirs(raw_dir, exist_ok=True)
    warnings = []

    session = chat_session.ChatSession(
        cwd=raw_dir, add_dirs=[raw_dir], claude_bin=claude_bin,
        model=model or chat_session.DEFAULT_MODEL,
        allowed_tools=bootstrap_allowed_tools(prefer_nonprod),
        system_prompt=REFRESH_SYSTEM_PROMPT,
        event_log=os.path.join(raw_dir, EVENT_LOG))
    try:
        session.start()
    except Exception:
        raise RefreshError("Couldn't start a Claude session to run the refresh.", needs_human=True)
    if on_session:
        on_session(session)

    # 'call' is the resolved mcp__<prefix>__call_tool name, None until the first turn.
    call_box = {"call": None, "firm_uuid": firm_uuid}
    try:
        if target is None:
            # The batch resolves the prefix (first turn); every paged stem after it is
            # optional — its failure warns rather than aborting the whole refresh.
            _fetch_batch(session, script_dir, raw_dir, call_box, since, emit, warnings)
            for stem in _PAGED_STEMS:
                _fetch_optional_stem(session, script_dir, raw_dir, call_box, stem, since, emit, warnings)
        else:
            # The FIRST targeted stem runs the welcome/set_context turn and resolves the
            # prefix, so its failure is fatal; the rest are optional (warn + continue).
            for idx, stem in enumerate(target):
                if idx == 0:
                    _fetch_single_stem(session, script_dir, raw_dir, call_box, stem, since, emit)
                else:
                    _fetch_optional_stem(session, script_dir, raw_dir, call_box, stem, since, emit, warnings)
    finally:
        session.close()
        if on_session:
            on_session(None)

    return {"ok": True, "warnings": warnings}


def _ensure_meta(raw_dir, kpi):
    # type: (str, dict) -> str
    """Reuse the build's persisted meta.json; reconstruct it from kpi.json when gone."""
    meta_path = os.path.join(raw_dir, "meta.json")
    try:
        with open(meta_path) as fh:
            if isinstance(json.load(fh), dict):
                return meta_path
    except (OSError, ValueError):
        pass
    src = (kpi or {}).get("source") or {}
    name = (kpi.get("branding") or {}).get("firmName") or src.get("firm") or ""
    meta = {
        "name": name,
        "slug": os.path.basename(os.path.normpath(raw_dir)),
        "currency": src.get("currency"),
        "mark": (kpi.get("branding") or {}).get("mark"),
        "firmId": src.get("firmId"),
        "firmUuid": src.get("firmUuid"),
        "cartaEnvironment": src.get("cartaEnvironment") or "production",
    }
    with open(meta_path, "w") as fh:
        json.dump(meta, fh)
    return meta_path


def run_build(data_dir, emit, build_lock=None):
    # type: (str, Callable, Optional[object]) -> dict
    """Rebuild kpi.json/firms.json from the fetched raw dir and swap it in atomically —
    a non-zero build wrote nothing, so live data is untouched. Returns {ok, builtAt}."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    slug = os.path.basename(os.path.normpath(data_dir))
    raw_dir = str(fm_paths.raw_dir(slug))
    try:
        with open(os.path.join(data_dir, "kpi.json")) as fh:
            kpi = json.load(fh) or {}
    except (OSError, ValueError):
        kpi = {}
    since = ((kpi.get("source") or {}).get("since"))

    with (build_lock if build_lock is not None else contextlib.nullcontext()):
        emit("build", "Rebuilding your dashboard…")
        meta_path = _ensure_meta(raw_dir, kpi)
        args = ["build_kpi_datadir.py", "--raw", raw_dir, "--out", data_dir, "--meta", meta_path]
        if since:
            args += ["--since", since]
        r = _py(script_dir, *args, timeout=300)
        if r.returncode != 0:
            raise RefreshError("The dashboard rebuild failed and your existing data was "
                               "left in place: %s" % (r.stderr.strip()[:400] or "unknown error"),
                               needs_human=True)
        built_at = None
        try:
            with open(os.path.join(data_dir, "kpi.json")) as fh:
                built_at = (json.load(fh).get("source") or {}).get("builtAt")
        except (OSError, ValueError):
            pass
        return {"ok": True, "builtAt": built_at}


def run_refresh(data_dir, emit, stems=None, claude_bin=None, model=None, build_lock=None):
    # type: (str, Callable, Optional[object], Optional[str], Optional[str], Optional[object]) -> dict
    fetched = run_fetch(data_dir, emit, stems=stems, claude_bin=claude_bin, model=model)
    built = run_build(data_dir, emit, build_lock=build_lock)
    return {"ok": True, "builtAt": built.get("builtAt"), "warnings": fetched.get("warnings", [])}
