"""Button-driven data refresh for the fund-modeling console (mirrors SKILL.md Steps 1–3).

serve.py owns the orchestration; the headless `claude` session only issues the Carta
MCP calls it's told to, and serve.py reads each DWH result off the event stream — so
the session needs no Bash and no Write, just welcome / set_context / call_tool.

The carta MCP tools can be *deferred* on a many-MCP machine (resolved via ToolSearch,
absent from the init tool list), so there is no up-front prefix detection: the first
turn asks the model to use the carta tools by role, and serve.py reads the real
`mcp__<prefix>__call_tool` off that turn's tool_use to drive later turns explicitly.

Python-stdlib only, 3.9-safe.
"""
import contextlib
import json
import os
import re
import subprocess
import sys
from typing import Callable, List, Optional

import chat_session
import fm_paths

# §0 firm entity enumeration — mirrors references/queries.md §0 (SPV-excluded firm
# directory). Kept here because a refresh runs it directly, not through emit_stem_sql
# (which fills fund-scoped IN-lists from the fund_uuids.txt this query produces).
ENUMERATE_SQL = (
    "SELECT DISTINCT fund_uuid, fund_name, entity_type_name "
    "FROM FUND_ADMIN.MONTHLY_NAV_CALCULATIONS "
    "WHERE firm_id = '{firm_uuid}' AND is_firm_rollup = FALSE "
    "AND entity_type_name NOT ILIKE '%SPV%' "
    "ORDER BY entity_type_name, fund_name"
)

REFRESH_SYSTEM_PROMPT = (
    "You are a data-fetch executor for a fund-modeling refresh. You have a Carta MCP "
    "server (from the carta-investors plugin) whose tools are named mcp__<server>__welcome, "
    "mcp__<server>__set_context, and mcp__<server>__call_tool. If they are not immediately "
    "visible, search for them first — they may be deferred. Do ONLY the tool calls the user "
    "message specifies, in the given order, with exactly the given arguments. Never author or "
    "alter SQL, never call any other tool, never change the firm context. When the specified "
    "calls have returned, reply with exactly: DONE."
)

TURN_TIMEOUT = 300  # per fetch turn; server-side DWH batches can be slow
# The DWH clamps every query to 10,000 rows and signals more via next_offset. The
# batch is page 1 (offset 0); we page 2..5, then escalate — a stem past 50,000 rows
# isn't a shape the schema expects (mirrors SKILL.md Step 2's cap).
MAX_PAGES = 5
# Re-fetch a stem that errored in the batch — a per-stem DWH fault is often a transient
# blip. Capped so a genuinely-broken stem can't thrash.
MAX_STEM_RETRIES = 1

# Candidate carta prefixes to allowlist at spawn — the exact one is unknown up front (may be
# deferred). The model resolves whichever exists; serve.py learns the real one from tool_use.
_PREFIXES_PROD = ("claude_ai_carta", "claude_ai_Carta", "carta", "carta_production")
_PREFIXES_NONPROD = ("Carta_Sandbox", "claude_ai_Carta_Sandbox", "carta_sandbox",
                     "carta_test", "carta_demo", "carta_preprod")
_TOOLNAME_RE = re.compile(r"^mcp__(.+)__[a-z_]+$")


def bootstrap_allowed_tools(prefer_nonprod=False):
    # type: (bool) -> str
    prefixes = _PREFIXES_PROD + (_PREFIXES_NONPROD if prefer_nonprod else ())
    return ",".join("mcp__%s__%s" % (p, t)
                    for p in prefixes for t in ("welcome", "set_context", "call_tool"))


def prefix_from_toolname(name):
    # type: (Optional[str]) -> Optional[str]
    """The <server> segment of an mcp__<server>__<tool> name, e.g.
    'mcp__claude_ai_carta__call_tool' -> 'claude_ai_carta'."""
    m = _TOOLNAME_RE.match(name or "")
    return m.group(1) if m else None


def _flatten(content):
    # type: (object) -> str
    """A tool_result `content` is a string or a list of {type:text,text} blocks."""
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


# Match the persisted-result path up to its extension, so a trailing period
# ("saved to <path>.txt.") or a run-on JSON payload ("<path>.bin{...}") is excluded.
_SAVED_PATH_RE = re.compile(r"saved to[:\s]+(/\S+?\.(?:txt|bin|json|ndjson))", re.I)


def _capture_src(text, dest_raw):
    # type: (str, str) -> str
    """Where the save helper should read this result from. A DWH tool_result prefixes
    a human description ("… saved to <path>.bin") before the actual {"result": …}
    payload (rows inline, or a base64 blob). The helpers parse the payload, not the
    prose — so slice to the JSON when present, else the persisted file it names."""
    text = text or ""
    i = text.find('{"result"')
    if i > 0:
        text = text[i:]
    elif i < 0:
        m = _SAVED_PATH_RE.search(text)
        if m and os.path.exists(m.group(1)):
            return m.group(1)
    with open(dest_raw, "w") as fh:
        fh.write(text)
    return dest_raw


def _run_turn(session, prompt, capture_suffix=None, on_step=None, timeout=TURN_TIMEOUT):
    """Run one prompt to turn end. Returns (ok, captured, error, tool_name): captured is
    the flattened result of the last tool call whose name ends with `capture_suffix`, and
    tool_name is that call's real name — so the caller learns the resolved carta prefix.
    on_step('issued'|'received') fires for liveness."""
    session.send(prompt)
    pending = {}   # tool_use_id -> tool name
    captured = None
    err = None
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
                if capture_suffix and not (name or "").endswith(capture_suffix):
                    continue
                if on_step:
                    on_step("received")
                matched = name
                text = _flatten(b.get("content"))
                if b.get("is_error"):
                    err = text
                elif capture_suffix:
                    captured = text
        elif t == "result":
            return (not ev.get("is_error"), captured, err, matched)
    return (False, captured, err or "session ended without a result", matched)


_STEM_ERR_RE = re.compile(r"ERROR stem=(\S+?):?\s+(.*)")
_TRUNC_BATCH_RE = re.compile(r"TRUNCATED stem=(\S+)\s+next_offset=(\d+)")
_TRUNC_SINGLE_RE = re.compile(r"TRUNCATED next_offset=(\d+)")


def _truncated_stems(out):
    # type: (str) -> List[tuple]
    """(stem, next_offset) for each stem save_batch_result flagged as incomplete."""
    return [(m.group(1), int(m.group(2))) for m in _TRUNC_BATCH_RE.finditer(out or "")]


def _stem_errors(out):
    # type: (str) -> List[tuple]
    """(stem, detail) for each stem save_batch_result flagged as errored inside an
    otherwise-OK batch. Such a stem means some data is missing, not that the whole
    refresh failed — the caller retries it, then surfaces any that still fail."""
    return [(m.group(1), (m.group(2) or "").strip())
            for m in (_STEM_ERR_RE.search(l) for l in (out or "").splitlines()) if m]


def _py(script_dir, name, *args, **kwargs):
    # type: (str, str, str) -> subprocess.CompletedProcess
    """Run a pipeline script with serve.py's own interpreter (uv-provisioned). A hang
    would block the request thread that holds _refresh_lock — every chat turn and save
    then 409s until restart — so bound it and surface a timeout as needs_human."""
    timeout = kwargs.pop("timeout", 120)
    try:
        return subprocess.run(
            [sys.executable, os.path.join(script_dir, name)] + list(args),
            capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RefreshError("%s timed out after %ds; the refresh couldn't finish."
                           % (name, timeout), needs_human=True)


def _ci_get(row, key):
    # type: (dict, str) -> object
    """Case-insensitive column read. The DWH uppercases unquoted identifiers, so a
    row keys on FUND_UUID / MONTH_END_DATE, not the lowercase names in our SQL."""
    if key in row:
        return row[key]
    ku = key.upper()
    if ku in row:
        return row[ku]
    for k, v in row.items():
        if isinstance(k, str) and k.lower() == key:
            return v
    return None


def _nav_as_of(nav_ndjson):
    # type: (str) -> Optional[str]
    """Latest month_end_date across nav_latest rows — drives snapshot.source.navAsOf."""
    best = None
    try:
        with open(nav_ndjson) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                d = str(_ci_get(json.loads(line), "month_end_date") or "")[:10]
                if d and (best is None or d > best):
                    best = d
    except (OSError, ValueError):
        return None
    return best


def _write_meta(raw_dir, snapshot, nav_as_of):
    # type: (str, dict, str) -> str
    """Refresh navAsOf on the build's persisted meta.json; fall back to reconstructing
    it from the cached snapshot when that file is gone."""
    meta_path = os.path.join(raw_dir, "meta.json")
    meta = None
    try:
        with open(meta_path) as fh:
            meta = json.load(fh)
    except (OSError, ValueError):
        meta = None
    if not isinstance(meta, dict):
        src = snapshot.get("source") or {}
        name = (snapshot.get("branding") or {}).get("firmName") or src.get("firm") or ""
        initials = "".join(w[0] for w in name.split()[:3]).upper() or "FM"
        meta = {
            "name": name,
            "slug": os.path.basename(raw_dir),
            "mark": {"text": initials, "bg": "#1f2937", "fg": "#ffffff"},
            "firmId": src.get("firmId"),
            "firmUuid": src.get("firmUuid"),
            "cartaEnvironment": src.get("cartaEnvironment") or "production",
        }
    meta["navAsOf"] = nav_as_of
    with open(meta_path, "w") as fh:
        json.dump(meta, fh)
    return meta_path


class RefreshError(Exception):
    def __init__(self, message, needs_human=False):
        super(RefreshError, self).__init__(message)
        self.needs_human = needs_human


def _paginate(session, script_dir, raw_dir, call, stem, next_off, emit):
    # type: (object, str, str, str, str, int, Callable) -> None
    """Page one truncated stem via single-query offset fetches, exactly as SKILL.md
    Step 2 does: re-fetch the stem at `offset`, append, repeat until the marker
    clears. The batch already fetched page 1 (offset 0); escalate before a 6th page
    (>50,000 rows)."""
    r = _py(script_dir, "emit_stem_sql.py", "--raw", raw_dir, "--stem", stem)
    if r.returncode != 0:
        raise RefreshError("Couldn't build the page query for %s: %s"
                           % (stem, r.stderr.strip()), needs_human=True)
    base_args = json.loads(r.stdout)
    dest = os.path.join(raw_dir, "%s.ndjson" % stem)
    pages = 1
    while next_off is not None:
        if pages >= MAX_PAGES:
            raise RefreshError("This firm's %s data exceeds 50,000 rows, which an in-app "
                               "refresh can't page through. Run “refresh Carta holdings” "
                               "from Claude for a full rebuild." % stem, needs_human=True)
        emit("fetch", "Fetching more %s rows…" % stem, page=pages + 1)
        args = dict(base_args)
        args["offset"] = next_off
        prompt = ("Run exactly one tool call, then reply DONE:\n%s {\"name\": "
                  "\"dwh__execute__query\", \"arguments\": %s}" % (call, json.dumps(args)))
        ok, captured, err, _name = _run_turn(session, prompt, capture_suffix="__call_tool")
        if not ok or not captured:
            raise RefreshError("Paging %s failed: %s" % (stem, err or "no result"),
                               needs_human=True)
        src = _capture_src(captured, os.path.join(raw_dir, "%s_p%d.raw" % (stem, next_off)))
        r = _py(script_dir, "save_query_result.py", src, dest, "--append")
        if r.returncode != 0:
            raise RefreshError("Couldn't append a %s page: %s"
                               % (stem, r.stderr.strip() or "no rows"), needs_human=True)
        pages += 1
        m = _TRUNC_SINGLE_RE.search((r.stdout or "") + (r.stderr or ""))
        next_off = int(m.group(1)) if m else None


def _retry_stem(session, script_dir, raw_dir, call, stem, emit):
    # type: (object, str, str, str, str, Callable) -> bool
    """Re-fetch one errored stem as a single dwh__execute__query, so a transient fault
    doesn't silently blank data the dashboard needs (fund_metrics → currency/vintage/MOIC/fees).
    Returns True if it recovered rows (paging the rest if the stem is large)."""
    for _ in range(MAX_STEM_RETRIES):
        emit("fetch", "Retrying %s…" % stem)
        r = _py(script_dir, "emit_stem_sql.py", "--raw", raw_dir, "--stem", stem)
        if r.returncode != 0:
            continue
        args = json.loads(r.stdout)
        prompt = ("Run exactly one tool call, then reply DONE:\n%s {\"name\": "
                  "\"dwh__execute__query\", \"arguments\": %s}" % (call, json.dumps(args)))
        ok, captured, _err, _name = _run_turn(session, prompt, capture_suffix="__call_tool")
        if not ok or not captured:
            continue
        dest = os.path.join(raw_dir, "%s.ndjson" % stem)
        src = _capture_src(captured, os.path.join(raw_dir, "%s_retry.raw" % stem))
        r = _py(script_dir, "save_query_result.py", src, dest)
        if r.returncode != 0:
            continue
        m = _TRUNC_SINGLE_RE.search((r.stdout or "") + (r.stderr or ""))
        if m:
            _paginate(session, script_dir, raw_dir, call, stem, int(m.group(1)), emit)
        return True
    return False


def run_fetch(data_dir, emit, claude_bin=None, model=None, on_session=None):
    # type: (str, Callable, Optional[str], Optional[str], Optional[Callable]) -> dict
    """Fetch this firm's Carta data into the raw dir; `emit` streams progress. Returns
    {ok, warnings} or raises RefreshError. Writes ONLY raw ndjson (never the served dir or
    portfolio.json), so it's safe while the user edits — run_build does the reconcile+swap.
    `on_session(session)` (then None) lets the caller reap the subprocess on a mid-fetch exit."""
    claude_bin = claude_bin or os.environ.get("FM_CLAUDE_BIN", "claude")
    script_dir = os.path.dirname(os.path.abspath(__file__))

    # emit phase strings are a client contract — UpdateDataButton.jsx maps them to progress
    # steps: preflight, enumerate, fetch, build, issue. A rename here must land there too.
    emit("preflight", "Checking your Carta connection…")
    try:
        with open(os.path.join(data_dir, "snapshot.json")) as fh:
            snapshot = json.load(fh)
    except (OSError, ValueError):
        raise RefreshError("This firm's cache is missing or unreadable; relaunch it "
                           "from Claude before refreshing.", needs_human=True)
    src = snapshot.get("source") or {}
    firm_uuid = src.get("firmUuid")
    if not firm_uuid:
        raise RefreshError("This cache predates firm-id tracking, so an in-app refresh "
                           "can't target it. Re-run “refresh Carta holdings” from Claude once.",
                           needs_human=True)
    prefer_nonprod = (src.get("cartaEnvironment") == "nonprod")

    slug = os.path.basename(os.path.normpath(data_dir))
    raw_dir = str(fm_paths.raw_dir(slug))
    os.makedirs(raw_dir, exist_ok=True)
    warnings = []

    session = chat_session.ChatSession(
        cwd=raw_dir, add_dirs=[raw_dir], claude_bin=claude_bin,
        model=model or chat_session.DEFAULT_MODEL,
        allowed_tools=bootstrap_allowed_tools(prefer_nonprod),
        system_prompt=REFRESH_SYSTEM_PROMPT)
    try:
        session.start()
    except Exception:
        raise RefreshError("Couldn't start a Claude session to run the refresh.",
                           needs_human=True)
    if on_session:
        on_session(session)

    try:
        # Role-based first turn: the model resolves the (possibly deferred) carta tools,
        # and we read the real prefix from its reply.
        emit("enumerate", "Finding this firm's funds…")
        enum_sql = ENUMERATE_SQL.format(firm_uuid=firm_uuid)
        enum_prompt = (
            "Do these three tool calls in order, then reply DONE:\n"
            "1. Call the Carta MCP welcome tool with {}.\n"
            "2. Call the Carta MCP set_context tool with {\"firm_id\": \"%s\"}.\n"
            "3. Call the Carta MCP call_tool tool with {\"name\": \"dwh__execute__query\", "
            "\"arguments\": {\"sql\": %s, \"format\": \"ndjson\", \"limit\": 2000}}."
            % (firm_uuid, json.dumps(enum_sql))
        )
        ok, captured, err, matched = _run_turn(
            session, enum_prompt, capture_suffix="__call_tool",
            on_step=lambda k: emit("enumerate",
                                   "Reading the fund directory…" if k == "issued"
                                   else "Got the fund directory."))
        if not ok or not captured:
            raise RefreshError("Couldn't reach the Carta data warehouse: %s"
                               % (err or "no result"), needs_human=True)
        prefix = prefix_from_toolname(matched)
        if not prefix:
            raise RefreshError("Couldn't identify the Carta MCP tools in this session. "
                               "Run “refresh Carta holdings” from Claude instead.",
                               needs_human=True)
        call = "mcp__%s__call_tool" % prefix

        enum_ndjson = os.path.join(raw_dir, "_enumerate.ndjson")
        src_path = _capture_src(captured, os.path.join(raw_dir, "_enumerate.raw"))
        r = _py(script_dir, "save_query_result.py", src_path, enum_ndjson)
        if r.returncode != 0:
            raise RefreshError("Couldn't read the firm's fund list: %s"
                               % (r.stderr.strip() or "empty result"), needs_human=True)
        fund_uuids = _read_fund_uuids(enum_ndjson)
        if not fund_uuids:
            raise RefreshError("Carta returned no funds for this firm.", needs_human=True)
        with open(os.path.join(raw_dir, "fund_uuids.txt"), "w") as fh:
            fh.write("\n".join(fund_uuids) + "\n")

        # Reuse the original gp_carry opt-in: include it only if the cache already holds its data.
        gp = os.path.join(raw_dir, "gp_carry.ndjson")
        skip = [] if (os.path.exists(gp) and os.path.getsize(gp) > 0) else ["--skip", "gp_carry"]
        r = _py(script_dir, "emit_stem_sql.py", "--raw", raw_dir, "--batch", *skip)
        if r.returncode != 0:
            raise RefreshError("Couldn't build the fetch queries: %s" % r.stderr.strip())
        batches = json.loads(r.stdout)

        total = len(batches)
        for i, batch in enumerate(batches, 1):
            emit("fetch", "Fetching fund data from Carta…", step=i, total=total)
            stems = batch["stems"]
            args = {"queries": batch["queries"], "limit": batch.get("limit", 10000),
                    "format": batch.get("format", "ndjson")}
            prompt = ("Run exactly one tool call, then reply DONE:\n%s {\"name\": "
                      "\"dwh__execute__queries\", \"arguments\": %s}"
                      % (call, json.dumps(args)))

            def step(kind, i=i):
                emit("fetch", "Waiting on Carta…" if kind == "issued"
                     else "Saving fetched data…", step=i, total=total)
            ok, captured, err, _n = _run_turn(session, prompt, capture_suffix="__call_tool",
                                              on_step=step)
            if not ok or not captured:
                raise RefreshError("A data fetch failed on batch %d of %d: %s"
                                   % (i, total, err or "no result"), needs_human=True)
            src_path = _capture_src(captured, os.path.join(raw_dir, "batch%d.raw" % i))
            r = _py(script_dir, "save_batch_result.py", src_path, raw_dir,
                    "--stems", ",".join(stems))
            out = (r.stdout or "") + (r.stderr or "")
            if r.returncode != 0:
                raise RefreshError("Couldn't parse batch %d of %d: %s"
                                   % (i, total, r.stderr.strip() or "envelope mismatch"),
                                   needs_human=True)
            for stem_name, next_off in _truncated_stems(out):
                _paginate(session, script_dir, raw_dir, call, stem_name, next_off, emit)
            for stem_name, detail in _stem_errors(out):
                if _retry_stem(session, script_dir, raw_dir, call, stem_name, emit):
                    continue
                issue = "Couldn't load %s data (%s)." % (stem_name, detail[:200])
                warnings.append(issue)
                emit("issue", issue)
    finally:
        session.close()
        if on_session:
            on_session(None)

    return {"ok": True, "warnings": warnings}


def run_build(data_dir, emit, build_lock=None):
    # type: (str, Callable, Optional[object]) -> dict
    """Transform the fetched raw dir into the served dir and swap it in. Reads the CURRENT
    portfolio.json — reconciles the user's latest saved scenarios onto the fresh baseline
    (run only after flushing edits). `build_lock`, if given, gates portfolio saves for this
    stretch. Returns {ok, asOf, funds, companies} or raises RefreshError."""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    slug = os.path.basename(os.path.normpath(data_dir))
    raw_dir = str(fm_paths.raw_dir(slug))
    try:
        with open(os.path.join(data_dir, "snapshot.json")) as fh:
            snapshot = json.load(fh)
    except (OSError, ValueError):
        snapshot = {}

    # build_datadir writes atomically; a non-zero exit wrote nothing, so live data is untouched.
    with (build_lock if build_lock is not None else contextlib.nullcontext()):
        emit("build", "Rebuilding your dashboard…")
        nav_as_of = _nav_as_of(os.path.join(raw_dir, "nav_latest.ndjson"))
        if not nav_as_of:
            raise RefreshError("The refreshed data has no NAV date; not rebuilding.",
                               needs_human=True)
        meta_path = _write_meta(raw_dir, snapshot, nav_as_of)
        # build_datadir scales with firm size (transforms all raw ndjson + reconciles), so
        # give it a fetch-turn's headroom — a false timeout here wastes the whole fetch.
        r = _py(script_dir, "build_datadir.py", "--raw", raw_dir, "--out", data_dir,
                "--meta", meta_path, timeout=300)
        if r.returncode != 0:
            raise RefreshError("The dashboard rebuild failed and your existing data was "
                               "left in place: %s" % (r.stderr.strip()[:400] or "unknown error"),
                               needs_human=True)
        summary = _last_json_line(r.stdout) or {}
        return {"ok": True, "asOf": nav_as_of,
                "funds": summary.get("funds"), "companies": summary.get("companies")}


def run_refresh(data_dir, emit, claude_bin=None, model=None, build_lock=None):
    # type: (str, Callable, Optional[str], Optional[str], Optional[object]) -> dict
    """Fetch then build in one call (raw fetch → reconcile + swap). Returns
    {ok, asOf, funds, companies, warnings} or raises RefreshError."""
    fetched = run_fetch(data_dir, emit, claude_bin=claude_bin, model=model)
    built = run_build(data_dir, emit, build_lock=build_lock)
    return {"ok": True, "asOf": built.get("asOf"), "warnings": fetched.get("warnings", []),
            "funds": built.get("funds"), "companies": built.get("companies")}


def _read_fund_uuids(ndjson_path):
    # type: (str) -> List[str]
    seen, out = set(), []
    try:
        with open(ndjson_path) as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                u = _ci_get(json.loads(line), "fund_uuid")
                if u and u not in seen:
                    seen.add(u)
                    out.append(u)
    except (OSError, ValueError):
        return []
    return out


def _last_json_line(text):
    # type: (str) -> Optional[dict]
    """The last line's JSON object, tolerating a prefix — build_datadir emits
    '[build_datadir] {"funds":…}'."""
    for line in reversed((text or "").splitlines()):
        i = line.find("{")
        if i < 0:
            continue
        try:
            return json.loads(line[i:])
        except ValueError:
            continue
    return None
