#!/usr/bin/env python3
"""
manco-reporting local server (React app shell + live source + JSON data dir).

Serves three things: the app shell and vendored runtime from --web-dir (webapp/),
a React source tree from --src-dir at /src/*, transpiled in the browser by
webapp/sw.js, and whatever JSON the owning skill wrote to a data dir.
Python stdlib only — no third-party deps — so it runs for non-developers at
runtime with no install step.

--src-dir always defaults to this firm's own per-firm copy, <data-dir>/src —
never the plugin's own app/src. app/src is the shared template every firm's
copy is seeded from; it is never served and never edited directly, so an edit
made against one firm's dashboard can't be lost on the next plugin update or
leak into another firm's dashboard. See `_default_src_dir`.

Security:
  - binds 127.0.0.1 only
  - a token gates every /api/* request (URL carries ?t=<token>, the page sends it as
    the X-Dash-Token header). The token is generated once (randomly) on first launch
    and persisted in the data dir, reused across relaunches so the URL stays stable.
  - all reads/writes stay under the data dir / web dir (path-traversal guarded)

Stable URL: the port and token are remembered in the data dir (.port / .token) and
reused on relaunch. An explicit --port / PORT env still wins.

The browser NEVER calls Carta MCP directly — it only reads JSON the owning skill
already wrote to the data dir.

Usage:
  python3 serve.py --data-dir <dir> [--web-dir <webapp>] [--src-dir <per-firm src>]
                   [--port N] [--no-open]

Customizing for your microapp:
  - Add fixed-name routes to chat_session.DATA_FILE_ROUTES (e.g. "/api/snapshot":
    "snapshot.json") for files your app always expects — _FILE_ROUTES below is built
    from it, since those are also the only files the in-app chat session may read
    outside its own view-source tree (see chat_session.scoped_allowed_tools).
  - For anything else, the generic `/api/report/<name>.json` route already serves any
    safe `<name>.json` your skill writes to the data dir — most microapps don't need
    fixed routes at all beyond that. A file served only through this route is NOT
    readable by the in-app chat session (scoped_allowed_tools only grants
    DATA_FILE_ROUTES) — give a file the chat must explain a fixed-name route instead.
  - If your app needs a writable document (e.g. a saved scenario/portfolio file with
    optimistic-concurrency PUT), see the `do_PUT`/`_get_portfolio`-style pattern in
    carta-investors' fund-modeling or investor-dashboard `scripts/serve.py` for a
    worked ETag example — this template ships read-only routes only.
"""

import argparse
import atexit
import functools
import http.server
import json
import os
import queue
import re
import secrets
import socketserver
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import chat_session
import manco_paths
import own_sync
import preflight_claude
import report_store
import share_bridge
import share_ops
import sync_src

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
SHARE_MCP_SERVER = None  # --share-mcp-server / MANCO_SHARE_MCP_SERVER: the one Carta connector sharing may use
CLAUDE_BIN = None  # --claude-bin, or found by preflight_claude at startup; see _refresh_claude_status
MAX_BODY_BYTES = 1024 * 1024
REBUILD_TIMEOUT = 600

# One rebuild at a time: a change rewrites reports.json, then the build turns it
# into snapshot.json. Share operations run one at a time in the background; the
# app polls /api/reports/share-status?job=<id> for the outcome of the one it
# started. Finished jobs are kept a while, so a caller whose job was followed by
# another (a second tab, a share queued behind a people lookup) still gets its own.
_rebuild_lock = threading.Lock()
_share_lock = threading.Lock()
_share_state_lock = threading.Lock()
_share_state = {"status": "idle"}
_finished_share_jobs = {}  # job id -> its final state, oldest first
FINISHED_SHARE_JOBS_KEPT = 20
_bridge = None
_bridge_override = None  # which .share-mcp-server pin the cached _bridge was built with
_bridge_lock = threading.Lock()
# Whether the `claude` CLI that report sharing needs can run. Checked (and
# refreshed) before a share op rather than gating the dashboard itself — browsing
# reports needs none of this, only sharing does.
_claude_lock = threading.Lock()
STATE_CHECKING = "checking"    # no probe has landed yet
STATE_AVAILABLE = "available"
STATE_UNAVAILABLE = "unavailable"
_CLAUDE_STATUS = {"state": STATE_CHECKING, "reason": None}
# One message template per reason preflight_claude can name, shared by report
# sharing and chat — the two features that need the `claude` CLI, both reading
# this module's one _CLAUDE_STATUS probe — instead of letting a call that
# actually needs Carta/claude run and fail with a generic "unreachable". These
# two are known in advance, from the same probe /api/claude-status reads, so
# there is nothing to gain by trying the real thing first. Any other reason
# (just "ok", or the probe never having run) falls through to a real attempt.
# This never gates a "users" lookup a fresh saved list can already answer --
# see _run_share_op.
_CLAUDE_FIX_MESSAGE_TEMPLATES = {
    preflight_claude.REASON_NOT_INSTALLED:
        "{feature} needs the Claude Code CLI installed on this computer.",
    preflight_claude.REASON_NOT_LOGGED_IN:
        "{feature} needs you signed in to Claude Code.",
}


def _claude_fix_message(feature, reason):
    """The operator-facing message for why `feature` ("Report sharing" / "Chat")
    can't use claude right now, or None when `reason` isn't one of the two
    known in advance (just "ok", or no probe has run yet)."""
    template = _CLAUDE_FIX_MESSAGE_TEMPLATES.get(reason)
    return template.format(feature=feature) if template else None


IDLE_TIMEOUT_DEFAULT = 86400  # 24h backstop; should never fire during active use
WATCHDOG_INTERVAL = 10
SUSPEND_GAP_SLACK = 55
_last_heartbeat = time.time()
_hb_lock = threading.Lock()
# sessionId -> {"session": chat_session.ChatSession, "lock": threading.Lock(),
# "last_used": float}. A chat turn is single-flight per session: its lock is
# claimed inside the SAME _CHAT_SESSIONS_LOCK critical section that looks the
# entry up or creates it, so an entry the registry shows unlocked under that
# lock truly has no request about to claim it, and a request can never resume
# a session that has been (or is about to be) evicted and closed out from
# under it — see _chat and _evict_lru_chat_session_locked. Unlike _bridge (one
# shared relay session), each browser tab gets its own interactive
# conversation and its own subprocess, held to at most MAX_CHAT_SESSIONS live
# at once (oldest idle one evicted first) — except while every slot has a turn
# in flight, when a new one is let through anyway and the registry stays over
# the cap until the next new session is created after a slot frees up (a
# reused session never triggers eviction, only a brand new one does).
_CHAT_SESSIONS = {}
_CHAT_SESSIONS_LOCK = threading.Lock()
MAX_CHAT_SESSIONS = 4

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    # .jsx is served as JavaScript: the service worker transpiles it before the
    # module loader sees it, but a browser that fell back to a direct fetch must
    # still get a JS MIME type rather than an opaque download.
    ".jsx": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
    ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
}

# Fixed-name GET endpoints -> file under the data dir. Built from
# chat_session.DATA_FILE_ROUTES, the single source of truth for which files
# both this route table and the in-app chat session's scoped_allowed_tools
# name — add your app's known files there, not here; anything else falls
# through to the generic /api/report/<name>.json route.
_FILE_ROUTES = dict(chat_session.DATA_FILE_ROUTES)


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


def _evict_lru_chat_session_locked():
    """Caller must already hold _CHAT_SESSIONS_LOCK. Removes and returns ONE
    least-recently-used chat session whose turn lock is free — call it in a
    loop (see _chat) to work the registry back down to MAX_CHAT_SESSIONS when
    it has grown past that. Returns None when every registered session has a
    turn in flight right now (nothing safe to evict); the caller then stops
    looping and lets the registry stay over the cap until the next brand new
    session is created after a slot frees up (reusing an existing session
    never calls this), so a request is never refused merely because every slot
    happens to be busy."""
    idle = [(sid, e) for sid, e in _CHAT_SESSIONS.items() if not e["lock"].locked()]
    if not idle:
        return None
    sid, entry = min(idle, key=lambda kv: kv[1]["last_used"])
    del _CHAT_SESSIONS[sid]
    return entry["session"]


def _close_all_chat_sessions():
    """Reap every registered chat session so its claude subprocess is never
    orphaned. Called on both shutdown paths (normal atexit and the watchdog's
    os._exit)."""
    with _CHAT_SESSIONS_LOCK:
        sessions = [e["session"] for e in _CHAT_SESSIONS.values()]
        _CHAT_SESSIONS.clear()
    for s in sessions:
        try:
            s.close()
        except Exception:
            pass


def _watchdog(httpd, timeout):
    last_tick = time.time()
    while True:
        time.sleep(WATCHDOG_INTERVAL)
        now = time.time()
        # A large jump means the host slept, not real idleness — forgive it and
        # let the reopened tab resume before reaping.
        if now - last_tick > WATCHDOG_INTERVAL + SUSPEND_GAP_SLACK:
            _touch_heartbeat()
            last_tick = now
            continue
        last_tick = now
        if timeout <= 0:
            continue
        with _hb_lock:
            idle = now - _last_heartbeat
        if idle > timeout:
            print("[serve] idle %ds - shutting down" % int(idle), flush=True)
            httpd.shutdown()
            _close_all_chat_sessions()   # os._exit below skips atexit — reap explicitly first
            os._exit(0)


def _detach_or_warn():
    """Daemonize so the server outlives the process that launched it. No-op (warns)
    where os.fork is unavailable."""
    if os.name != "posix" or not hasattr(os, "fork"):
        print("[serve] --detach unsupported on os=%s; staying in foreground" % os.name, flush=True)
        return
    if os.fork() > 0:
        os._exit(0)
    os.setsid()  # own session, so a process-group signal to the launcher can't reach us
    if os.fork() > 0:
        os._exit(0)
    devnull = os.open(os.devnull, os.O_RDWR)
    for fd in (0, 1, 2):
        os.dup2(devnull, fd)


def _safe_join(base, rel):
    target = (base / rel.lstrip("/")).resolve()
    base_r = base.resolve()
    if base_r == target or base_r in target.parents:
        return target
    return None


def _read_firm_id(data_dir):
    """Served to the browser so usage-tracking events key on the real Carta
    firm id, not a slugified firm name. None when the cache has no usable
    id — the context is dropped, never faked."""
    try:
        data = json.loads((data_dir / "snapshot.json").read_text())
        firm_id = int((data.get("cartaIds") or {}).get("firm"))
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    return firm_id if firm_id > 0 else None


def _rebuild():
    """Re-run the build the way the skill last ran it → (ok, message), one at a time."""
    import build_manco_datadir  # only needed for writes; keeps a read-only launch light
    with _rebuild_lock:
        return build_manco_datadir.rebuild(DATA_DIR, timeout=REBUILD_TIMEOUT)


def _carta_budget_entry():
    """Carta's own budget as the last build recorded it in the snapshot, or None."""
    try:
        snapshot = json.loads((DATA_DIR / "snapshot.json").read_text())
    except (OSError, ValueError):
        return None
    return (snapshot.get("budget") or {}).get(report_store.CARTA_BUDGET_ID)


def _reports_listing():
    store = report_store.ReportStore(DATA_DIR)
    doc = store.load()
    return {
        "reports": [dict(report_store.ReportStore.metadata(r), hidden=bool(r.get("hidden")))
                    for r in doc["reports"]],
        "share_target": share_bridge.describe_target(manco_paths.read_carta_environment(DATA_DIR),
                                                       manco_paths.read_share_mcp_server(DATA_DIR)),
    }, store.etag()


def _get_bridge():
    """The live daemon's cached Bridge, rebuilt whenever .share-mcp-server's pin
    has moved since it was built — a relaunch can change or clear the pin while
    this server keeps running, and a stale Bridge would keep pushing/forgetting
    through the connector the *previous* launch was pinned to."""
    global _bridge, _bridge_override
    with _bridge_lock:
        pin = manco_paths.read_share_mcp_server(DATA_DIR)
        if _bridge is not None and pin != _bridge_override:
            # Its session is a long-lived `claude -p` subprocess: dropping the
            # reference alone would leave it running until the idle timeout.
            # Closed on its own thread so this call never waits out a share
            # already using it.
            threading.Thread(target=_bridge.close, daemon=True).start()
            _bridge = None
        if _bridge is None:
            _bridge = share_bridge.Bridge(str(DATA_DIR), manco_paths.read_carta_environment(DATA_DIR),
                                          override=pin, claude_bin=CLAUDE_BIN)
            _bridge_override = pin
        return _bridge


def _claude_unavailable():
    with _claude_lock:
        return _CLAUDE_STATUS["state"] == STATE_UNAVAILABLE


def _refresh_claude_status():
    """Re-find the claude binary and check its login. True when sharing can run.

    Runs once at startup, and again before a share op whenever the last check left
    sharing marked unavailable (the operator may have installed or signed in since)
    or a share just failed to reach Carta (they may have signed out mid-session).
    A binary path that changed — a Claude Code auto-update can move or delete it
    while the dashboard stays up — drops the cached Bridge/Session so the next
    share op picks up the new path instead of spawning a dead one.
    """
    global CLAUDE_BIN, _bridge
    result = preflight_claude.probe(CLAUDE_BIN)
    ok = result["reason"] == preflight_claude.REASON_OK
    bin_changed = False
    with _claude_lock:
        if result["bin"] and result["bin"] != CLAUDE_BIN:
            CLAUDE_BIN = result["bin"]
            bin_changed = True
        _CLAUDE_STATUS.update(state=STATE_AVAILABLE if ok else STATE_UNAVAILABLE, reason=result["reason"])
    if bin_changed:
        old_bridge = None
        with _bridge_lock:
            old_bridge, _bridge = _bridge, None
        if old_bridge is not None:
            # Its session is a long-lived `claude -p` subprocess: dropping the
            # reference alone would leave it running (nothing closes stdin, so it
            # never sees EOF) until serve.py's own idle timeout, hours later. Closed
            # on its own thread so this probe never waits out a call already using it.
            threading.Thread(target=old_bridge.close, daemon=True).start()
    if not ok:
        print("[serve] claude CLI unavailable for sharing: %s" % result["reason"],
              file=sys.stderr, flush=True)
    return ok


def _refresh_claude_status_later():
    threading.Thread(target=_refresh_claude_status, daemon=True).start()


def _startup_claude_probe():
    """Resolve and print the claude CLI's status once at launch, in the background so
    a slow `claude auth status` never delays the printed dashboard URL. Once sharing
    is confirmed available, also settles every own-synced report's name against
    Carta right away — own_sync.sweep() does the same before every build's push, but
    this brings a rename made on the hosted app while the dashboard was closed onto
    it at launch, without waiting on the next build's sweep to get around to it."""
    ok = _refresh_claude_status()
    with _claude_lock:
        bin_path, reason = CLAUDE_BIN, _CLAUDE_STATUS["reason"]
    if bin_path is None:
        print("[serve] claude CLI: not found — report sharing needs it", flush=True)
        return
    state = ("logged in" if ok else
            "logged out" if reason == preflight_claude.REASON_NOT_LOGGED_IN else "sign-in unknown")
    print("[serve] claude CLI: %s (%s)" % (bin_path, state), flush=True)
    if ok:
        _reconcile_own_sync_names_at_startup()


def _reconcile_own_sync_names_at_startup():
    try:
        own_sync.reconcile_names(report_store.ReportStore(DATA_DIR), DATA_DIR, _get_bridge())
    except Exception as e:
        print("[serve] own-sync name reconcile skipped: %r" % e, file=sys.stderr, flush=True)


# ── Sign-in to Claude (POST /api/claude-signin) ──
# `claude auth login` prints its sign-in URL within a second or two, then blocks
# reading a paste-back code from stdin — it only completes on its own once the
# browser's OAuth redirect reaches it locally. That read is what keeps the process
# alive long enough for the redirect to arrive, so stdin is a pipe this never
# writes to or closes, not DEVNULL (which would answer the read with EOF at once
# and exit the CLI before any redirect can land). The dashboard opens the
# returned URL itself (`ClaudeSignIn`'s `window.open`) and polls
# GET /api/claude-status, whose re-probe (while marked unavailable) is what
# later notices sign-in actually worked.
_SIGNIN_URL_TIMEOUT = 15  # seconds to wait for the CLI to print its sign-in URL
_SIGNIN_WINDOW = 600  # seconds one `claude auth login` is left alive waiting for
                      # the browser's redirect, before this kills it itself
_SIGNIN_URL_RE = re.compile(r"https://\S+")
_signin_lock = threading.Lock()
_signin_proc = None  # the one `claude auth login` process alive right now, if any


def _read_signin_url(proc, timeout):
    """The first https:// URL `claude auth login` prints, or None past `timeout`.
    Runs the read on its own thread so a CLI that never prints anything (or never
    exits) can't block the caller past `timeout` -- `select` would, but doesn't
    work on a Windows pipe, which this dashboard also has to run on."""
    q = queue.Queue(maxsize=1)

    def reader():
        try:
            for line in proc.stdout:
                found = _SIGNIN_URL_RE.search(line)
                if found:
                    q.put(found.group(0))
                    return
        except (OSError, ValueError):
            pass
        q.put(None)

    threading.Thread(target=reader, daemon=True).start()
    try:
        return q.get(timeout=timeout)
    except queue.Empty:
        return None


def _reap_signin(proc):
    """Wait out the sign-in window, killing the process if the operator (or the
    browser's redirect) never finishes it, then free the slot for a new attempt --
    whether that happens here or `_start_signin` kills it first for lack of a URL."""
    global _signin_proc
    try:
        proc.wait(timeout=_SIGNIN_WINDOW)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
    with _signin_lock:
        if _signin_proc is proc:
            _signin_proc = None


def _start_signin():
    """Start `claude auth login` and return {"url": ...} or {"error": ...}. Refuses
    a second attempt for as long as the first's process is alive — not just while
    this call is reading its URL — since only one sign-in may run at a time. The
    check and the start happen under one hold of _signin_lock: two requests that
    both arrive while the slot is empty (two tabs, or ShareDialog showing two
    ClaudeSignIn buttons at once) must not both find it empty and both start a
    login -- find_claude() and Popen return quickly, so holding the lock this long
    blocks nothing real."""
    global _signin_proc
    with _signin_lock:
        if _signin_proc is not None and _signin_proc.poll() is None:
            return {"error": "signin_in_progress"}
        claude_bin = CLAUDE_BIN or preflight_claude.find_claude()
        if not claude_bin:
            return {"error": preflight_claude.REASON_NOT_INSTALLED}
        try:
            proc = subprocess.Popen([claude_bin, "auth", "login"], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        except OSError as e:
            return {"error": "failed", "message": str(e)}
        _signin_proc = proc
    threading.Thread(target=_reap_signin, args=(proc,), daemon=True).start()
    url = _read_signin_url(proc, _SIGNIN_URL_TIMEOUT)
    if url is None:
        proc.kill()  # never printed a URL — nothing for the operator to open
        return {"error": "no_url"}
    return {"url": url}


def _set_share_state(**fields):
    with _share_state_lock:
        _share_state.update(fields)


def _finish_share_state(**fields):
    """Record a job's outcome, and keep it under its id once the next job replaces it."""
    with _share_state_lock:
        _share_state.update(fields)
        _finished_share_jobs[_share_state["job"]] = dict(_share_state)
        while len(_finished_share_jobs) > FINISHED_SHARE_JOBS_KEPT:
            del _finished_share_jobs[next(iter(_finished_share_jobs))]


def _share_job_state(job):
    """The state of one job, running or finished; None if it is unknown or long gone."""
    with _share_state_lock:
        if _share_state.get("job") == job:
            return dict(_share_state)
        finished = _finished_share_jobs.get(job)
        return dict(finished) if finished else None


SHARE_OPS = ("users", "share", "publish-as-new", "delete", "pull")


def _run_share_op(op, params):
    """Background: one share operation, then a rebuild when it changed the reports."""
    def emit(message):
        _set_share_state(progress=message)
    try:
        if op == "users" and not params.get("refresh"):
            # A fresh saved list answers this without any Carta call -- so without
            # needing the `claude` CLI at all. Checked first: the Claude check below
            # is only for ops that are actually about to call Carta.
            cached = share_ops.cached_shareable_users(DATA_DIR)
            if cached is not None:
                _finish_share_state(status="done", result={"status": "ok", **cached}, error=None)
                return
        if _claude_unavailable():
            # Checking afresh here (not just trusting the cached state) means an
            # operator who just installed or signed in doesn't have to restart the
            # server to get as far as actually trying the share.
            _refresh_claude_status()
        with _claude_lock:
            reason = _CLAUDE_STATUS["reason"]
        fix_message = _claude_fix_message("Report sharing", reason)
        if fix_message:
            raise share_bridge.ShareError(fix_message, reason)
        bridge = _get_bridge()
        store = report_store.ReportStore(DATA_DIR)
        if op == "users":
            result = {"status": "ok", **share_ops.shareable_users(bridge, DATA_DIR, emit,
                                                                 refresh=bool(params.get("refresh")))}
        elif op == "share":
            result = share_ops.share(bridge, store, DATA_DIR, params["report_id"],
                                     params.get("shared_with"), emit, force=bool(params.get("force")),
                                     people=params.get("people"), updating=bool(params.get("updating")),
                                     view=params.get("view"))
        elif op == "publish-as-new":
            result = share_ops.publish_as_new(bridge, store, DATA_DIR, params["report_id"],
                                              params.get("shared_with"), emit, people=params.get("people"),
                                              view=params.get("view"))
        elif op == "delete":
            result = share_ops.delete(bridge, store, DATA_DIR, params["report_id"], emit)
        else:
            result = share_ops.pull(bridge, store, DATA_DIR, emit)
        if op != "users" and result.get("status") == "ok":
            emit("Updating the dashboard…")
            ok, message = _rebuild()
            result["rebuilt"] = ok
            if not ok:
                result["rebuild_error"] = message
        _finish_share_state(status="done", result=result, error=None)
    except share_bridge.ShareError as e:
        if e.code == "unreachable":
            # Covers both "claude isn't installed" and "signed out" — refresh now so
            # /api/claude-status (and the next share attempt) reflect it without
            # waiting for the next time something happens to trigger a recheck.
            _refresh_claude_status_later()
        if e.raw:
            print("[serve] share %s failed: %s" % (op, e.raw[:500]), file=sys.stderr, flush=True)
        _finish_share_state(status="error", error={"code": e.code, "message": str(e)})
    except report_store.ReportEditError as e:
        _finish_share_state(status="error", error={"code": e.code, "message": str(e)})
    except Exception as e:  # never leave the app polling a job that died silently
        print("[serve] share %s crashed: %r" % (op, e), file=sys.stderr, flush=True)
        _finish_share_state(status="error", error={
            "code": "failed", "message": "Couldn't finish — try again, or run it from Claude."})
    finally:
        _share_lock.release()


def _start_share_op(op, params):
    """Start one share op in the background and return its job id. None if one is
    already running; raises (with the lock released and the job recorded as an error)
    if the thread can't start."""
    if not _share_lock.acquire(blocking=False):
        return None
    job = secrets.token_hex(8)
    try:
        with _share_state_lock:
            _share_state.clear()
            _share_state.update({"job": job, "status": "running", "op": op,
                                 "report_id": params.get("report_id"),
                                 "progress": "Checking your Carta connection…", "started_at": time.time()})
        threading.Thread(target=_run_share_op, args=(op, params), daemon=True).start()
    except Exception:
        _finish_share_state(status="error", error={
            "code": "failed", "message": "Couldn't start that — try again, or run it from Claude."})
        _share_lock.release()
        raise
    return job


_REPORT_ACTION_RE = re.compile(r"^/api/reports/([A-Za-z0-9_.-]{1,160})/(rename|duplicate|derive|edit|hide|unlink|remove)$")


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _token_ok(self, qs):
        supplied = self.headers.get("X-Dash-Token") or (qs.get("t", [None])[0])
        return supplied == TOKEN

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (extra or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True   # ensure the client's read() terminates at stream end

    def _send_file(self, path):
        try:
            data = path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            return self._send(404, {"error": "not_found"})
        ctype = _CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _data_json(self, rel):
        p = _safe_join(DATA_DIR, rel)
        if p is None:
            return self._send(403, {"error": "forbidden"})
        if not p.exists():
            return self._send(200, {"error": "not_ready"})
        return self._send_file(p)

    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        path = u.path

        # static app shell (token gates the data, not the shell)
        if path == "/" or path == "/index.html" or path == "":
            return self._send_file(WEB_DIR / "index.html")
        if not path.startswith("/api/"):
            # /src/* is the canonical source tree, served straight from disk and
            # transpiled in the browser by webapp/sw.js. Everything else is part of
            # the shell under WEB_DIR (index.html, sw.js, vendor/, fonts/).
            #
            # Serving source rather than a compiled bundle is deliberate: it is what
            # makes an edit to SRC_DIR (this firm's own copy) visible on a refresh,
            # with no build step that could be forgotten and leave the page
            # correct-looking but stale.
            if path.startswith("/src/"):
                base, rel = SRC_DIR, path[len("/src"):]
            else:
                base, rel = WEB_DIR, path
            p = _safe_join(base, rel)
            if p is None or not p.exists() or p.is_dir():
                # A missing .jsx must 404 rather than fall through to the SPA shell:
                # handing index.html to a module import fails with an opaque MIME
                # error instead of naming the file that is actually missing.
                if path.startswith("/src/"):
                    return self._send(404, {"error": "not_found", "path": path})
                return self._send_file(WEB_DIR / "index.html")  # SPA fallback
            return self._send_file(p)

        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        if path == "/api/heartbeat":
            return self._send(200, {"ok": True})
        if path == "/api/telemetry-context":
            # Read per request, not at startup: a refresh rewrites
            # snapshot.json, and a firmId it resolves late should reach the
            # tracker without a relaunch.
            return self._send(200, {
                "firmId": _read_firm_id(DATA_DIR),
                "environment": manco_paths.read_carta_environment(DATA_DIR),
                "userId": manco_paths.read_user_id(DATA_DIR),
            })
        if path == "/api/reports":
            listing, etag = _reports_listing()
            return self._send(200, listing, extra={"ETag": etag})
        if path == "/api/models":
            return self._send(200, {"models": chat_session.CLAUDE_MODELS,
                                    "default": chat_session.DEFAULT_MODEL})
        if path == "/api/claude-status":
            # Re-probes when the last check left sharing unavailable, so a caller
            # that polls this before offering to share sees an install/sign-in
            # that happened since without needing a relaunch.
            if _claude_unavailable():
                _refresh_claude_status()
            with _claude_lock:
                state, reason = _CLAUDE_STATUS["state"], _CLAUDE_STATUS["reason"]
            return self._send(200, {"available": state != STATE_UNAVAILABLE,
                                    "state": state, "reason": reason})
        if path == "/api/reports/share-status":
            job = (qs.get("job") or [None])[0]
            if job is None:
                with _share_state_lock:
                    return self._send(200, dict(_share_state))
            state = _share_job_state(job)
            if state is None:
                return self._send(404, {"error": "unknown_job"})
            return self._send(200, state)
        if path in _FILE_ROUTES:
            return self._data_json(_FILE_ROUTES[path])
        # generic path-safe route: serves any safe <name>.json the skill wrote to the
        # data dir, so most microapps never need a fixed-name route at all.
        if path.startswith("/api/report/"):
            name = path[len("/api/report/"):]
            if not re.fullmatch(r"[a-z0-9_-]+\.json", name):
                return self._send(404, {"error": "not_found"})
            return self._data_json(name)
        return self._send(404, {"error": "not_found"})

    def do_HEAD(self):
        self.do_GET()

    def _read_json_body(self):
        """Parsed JSON object body → (body, error status or None)."""
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > MAX_BODY_BYTES:
            return None, 413
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return None, 400
        return (body, None) if isinstance(body, dict) else (None, 400)

    def do_POST(self):
        u = urlparse(self.path)
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        body, bad = self._read_json_body()
        if bad:
            return self._send(bad, {"error": "payload_too_large" if bad == 413 else "bad_json"})
        if u.path == "/api/reports/share-op":
            return self._share_op(body)
        if u.path == "/api/claude-signin":
            result = _start_signin()
            status = 202 if "url" in result else (409 if result.get("error") == "signin_in_progress" else 400)
            return self._send(status, result)
        if u.path == "/api/chat/interrupt":
            return self._chat_interrupt(body)
        if u.path == "/api/chat":
            return self._chat(body)
        m = _REPORT_ACTION_RE.match(u.path)
        if not m:
            return self._send(404, {"error": "not_found"})
        return self._report_action(m.group(1), m.group(2), body)

    def _share_op(self, body):
        op = body.get("op")
        if op not in SHARE_OPS:
            return self._send(400, {"error": "unknown_op"})
        if op in ("share", "publish-as-new", "delete") and not isinstance(body.get("report_id"), str):
            return self._send(400, {"error": "report_id_required"})
        shared_with = body.get("shared_with")
        if shared_with is not None and not (isinstance(shared_with, list) and all(
                isinstance(v, int) and not isinstance(v, bool) for v in shared_with)):
            return self._send(400, {"error": "bad_recipients"})
        people = body.get("people")
        if people is not None and not (isinstance(people, list) and len(people) <= 500
                                       and all(isinstance(p, dict) for p in people)):
            return self._send(400, {"error": "bad_people"})
        try:
            job = _start_share_op(op, body)
        except Exception as e:
            print("[serve] share %s couldn't start: %r" % (op, e), file=sys.stderr, flush=True)
            return self._send(500, {"error": "share_start_failed"})
        if job is None:
            return self._send(409, {"error": "share_in_progress"})
        return self._send(202, {"status": "started", "job": job})

    def _chat_interrupt(self, body):
        """Stop the turn in flight without tearing the session down.

        Deliberately does NOT take the session's turn lock: that lock is held for
        the entire in-flight turn, so waiting on it would block in exactly the
        case this endpoint exists to serve. It only needs the registry, which is
        guarded briefly.

        An interrupt reaches the subprocess only while a turn actually holds the
        turn lock. A session with no turn in flight is idle, not interruptible,
        even though its subprocess is still alive: signalling an idle session
        would write a `control_request` the CLI answers right away, and that
        stray `control_response` would sit in the next turn's event queue ahead
        of its real reply — the exact "late events bleed into the next turn"
        risk `_chat`'s own eviction handling guards against below.
        """
        sid = body.get("sessionId") or "default"
        with _CHAT_SESSIONS_LOCK:
            entry = _CHAT_SESSIONS.get(sid)
        # A 404 here means the session is gone: its turn failed (see _chat),
        # it was evicted as the least-recently-used idle session, or this sid
        # was never registered. A turn that ended normally and is still
        # registered reaches the 409 below instead.
        if entry is None:
            return self._send(404, {"error": "no_session"})
        if not entry["lock"].locked() or not entry["session"].interrupt():
            return self._send(409, {"error": "not_interruptible"})
        return self._send(200, {"ok": True})

    def _chat(self, body):
        # Chat is NOT gated on a running rebuild/share: it is a separate claude
        # subprocess with no shared state with those.
        prompt = body.get("prompt")
        prompt = str(prompt).strip() if prompt is not None else ""
        sid = body.get("sessionId") or "default"
        if not prompt:
            return self._send(400, {"error": "empty_prompt"})

        model = body.get("model")
        if model is not None and model not in chat_session.ALLOWED_MODEL_VALUES:
            return self._send(400, {"error": "invalid_model"})

        if _claude_unavailable():
            # Checking afresh here (not just trusting the cached state) means an
            # operator who just installed or signed in doesn't have to restart
            # the server to get as far as actually trying chat — same as the
            # share-op worker above.
            _refresh_claude_status()
        with _claude_lock:
            reason = _CLAUDE_STATUS["reason"]
        fix_message = _claude_fix_message("Chat", reason)
        if fix_message:
            return self._send(503, {"error": "claude_unavailable", "message": fix_message})

        anchor = body.get("anchor")
        if anchor:
            preamble = chat_session.anchor_preamble(anchor)
            if preamble:
                prompt = preamble + "\n\n" + prompt

        # Guarded get-or-create: registry access is synchronized, and a failed
        # start() is reported as a clean JSON error, with the registry
        # untouched, before any SSE headers go out (a 500 after headers would
        # corrupt the SSE stream).
        # A 200 promises the turn actually ran on the requested model, so a
        # request naming a different model than the session it would reuse
        # already started on is refused rather than silently answered on the
        # wrong one — the client is expected to start a new sessionId instead.
        #
        # The turn lock is claimed in this same critical section, right after
        # get-or-create, so any entry the registry shows unlocked under this
        # lock has no request about to claim it, and an evicted entry can never
        # be claimed.
        evicted = []
        with _CHAT_SESSIONS_LOCK:
            entry = _CHAT_SESSIONS.get(sid)
            if entry is not None and model is not None and model != entry["session"].model:
                return self._send(409, {"error": "model_mismatch"})
            if entry is None:
                sess = chat_session.ChatSession(
                    cwd=str(SRC_DIR), add_dirs=[str(SRC_DIR)],
                    claude_bin=CLAUDE_BIN, model=model or chat_session.DEFAULT_MODEL,
                    allowed_tools=chat_session.scoped_allowed_tools(SRC_DIR, DATA_DIR),
                    system_prompt=chat_session.manco_app_note_for(DATA_DIR))
                try:
                    sess.start()
                except Exception:
                    return self._send(500, {"error": "claude_unavailable"})
                # Only once the new subprocess is actually running do we make
                # room for it: evicting first and then failing to start would
                # both leak the victim's subprocess (nothing left in the
                # registry to close it) and lose a slot for nothing. Looping
                # (not a single evict) catches the registry back up to the cap
                # when it grew past it earlier because every slot was busy.
                while len(_CHAT_SESSIONS) >= MAX_CHAT_SESSIONS:
                    victim = _evict_lru_chat_session_locked()
                    if victim is None:
                        break
                    evicted.append(victim)
                entry = {"session": sess, "lock": threading.Lock(), "last_used": time.time()}
                _CHAT_SESSIONS[sid] = entry
            else:
                entry["last_used"] = time.time()
            # Single-flight per session: only one in-flight turn at a time.
            if not entry["lock"].acquire(blocking=False):
                return self._send(409, {"error": "turn_in_progress"})
        for v in evicted:
            v.close()

        saw_result = False
        try:
            sess = entry["session"]
            self._sse_headers()
            try:
                sess.send(prompt)
                for ev in sess.events(timeout=120):
                    self.wfile.write(("data: " + json.dumps(ev) + "\n\n").encode())
                    self.wfile.flush()
                    if chat_session.is_turn_end(ev):
                        saw_result = True
            except Exception:
                # Poisoned session or a client that vanished mid-stream: evict so
                # the next request for this sid starts fresh, don't bleed stale
                # events into a future turn.
                saw_result = False
        finally:
            # Evict (while still holding the turn lock) before releasing it, so no
            # other request can acquire this entry's lock in the gap and start a
            # turn on a session this thread is about to close out from under it.
            if not saw_result:
                # Timeout, EOF-without-result, or an exception above: the session
                # is untrustworthy (late/buffered events could bleed into the next
                # turn) — evict it so the next request for this sid starts fresh.
                sess = entry["session"]
                with _CHAT_SESSIONS_LOCK:
                    if _CHAT_SESSIONS.get(sid) is entry:
                        del _CHAT_SESSIONS[sid]
                sess.close()
            entry["lock"].release()

    def _report_action(self, report_id, action, body):
        """One change to a local report, then a rebuild so the app shows it."""
        import build_manco_datadir  # only needed for writes; keeps a read-only launch light
        store = report_store.ReportStore(DATA_DIR)
        expected = self.headers.get("If-Match")
        copy_mapping = functools.partial(build_manco_datadir.copy_budget_mapping, DATA_DIR)
        try:
            if action == "rename":
                result = store.rename(report_id, body.get("name"), expected_etag=expected)
            elif action == "duplicate":
                result = store.duplicate(report_id, copy_mapping=copy_mapping, expected_etag=expected)
            elif action in ("derive", "edit"):
                custom = dict(carta_budget=_carta_budget_entry, copy_mapping=copy_mapping, expected_etag=expected)
                fields = (body.get("name"), body.get("pivot"), body.get("gl_codes"))
                if action == "derive":
                    result = store.derive(report_id, *fields, **custom)
                else:
                    result = store.edit_custom(report_id, *fields, source_id=body.get("from"), **custom)
            elif action == "hide":
                result = store.set_hidden(report_id, bool(body.get("hidden", True)), expected_etag=expected)
            elif action == "unlink":
                result = store.clear_shared(report_id, expected_etag=expected)
            else:
                # own_sync.forget is the one way to remove a report that may have been
                # synced: report_store.ReportStore.remove alone would leave an orphaned
                # mirror live in Carta forever. It only touches Carta (and so only needs
                # the bridge) when this report actually has one.
                own_sync.forget(_get_bridge(), store, DATA_DIR, report_id, lambda m: None,
                                expected_etag=expected)
                result = {"id": report_id, "removed": True}
        except report_store.ReportEditError as e:
            status = {"conflict": 409, "not_found": 404, "read_only": 403, "busy": 409}.get(e.code, 400)
            return self._send(status, {"error": e.code, "message": str(e)})
        except share_bridge.ShareError as e:
            # The local removal never ran (forget checks removability before touching
            # Carta, and bails before store.remove on a real Carta failure) — the report
            # is untouched, so the operator can just retry once Carta/Claude is reachable.
            return self._send(502, {"error": e.code, "message": str(e)})
        ok, message = _rebuild()
        listing, etag = _reports_listing()
        return self._send(200, {"report": result, "rebuilt": ok, "message": message,
                                "reports": listing["reports"]}, extra={"ETag": etag})


class _Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _load_or_make_token(token_file):
    try:
        prev = token_file.read_text().strip()
        if prev:
            return prev
    except OSError:
        pass
    return secrets.token_urlsafe(18)


def _maybe_open_browser(url, no_open):
    """Open the dashboard URL in the user's default browser — unless `--no-open`
    was passed, or `detect_surface()` reports a sandboxed runtime (Cowork, or a
    Claude Code cloud session). Gate 0 in firm-resolution.md is meant to stop the
    skill before it ever gets here, but this is the defense-in-depth backstop for
    a direct/manual invocation of serve.py.

    In a sandboxed surface there is no local browser that could reach 127.0.0.1
    anyway: the URL printed above is only live inside this container and is dead
    from the user's own machine. Skip the open and say so, rather than leaving the
    invoking model or user to guess why nothing happened.
    """
    surface, _signals = manco_paths.detect_surface()
    if surface == "sandboxed":
        print(
            "[serve] sandboxed session detected (Cowork, or a Claude Code cloud "
            "session) - the URL above is only live inside this container, not on "
            "your local machine, so no browser will be opened here. Re-run this "
            "skill from a local Claude Code session (a terminal, or Claude Desktop "
            "set to run locally) to reach the dashboard.",
            file=sys.stderr, flush=True)
        return
    if no_open:
        return
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _default_src_dir(data_dir, web_dir):
    """The single source of truth for --src-dir when the caller omits it.

    The per-firm copy, <data_dir>/src, is always what gets served and edited —
    this plugin's own app/src is the shared template every firm's copy is
    seeded from, never the tree a session serves or patches. When the per-firm
    copy doesn't exist yet (e.g. a launch that skipped Step 4.8's sync_src
    init), it is seeded here via sync_src.init so the dashboard still renders
    with the same snapshot/version stamp a normal init would leave — not a
    bare copy that `sync_src check` can't attribute on the next sync — but the
    copy returned, and every subsequent read or write, is always the per-firm
    one.
    """
    user_src = sync_src.user_src_dir(data_dir)
    if not user_src.exists():
        skill_dir = web_dir.parent
        if (skill_dir / "app" / "src").exists():
            sync_src.init(skill_dir, data_dir)  # writes src, .plugin-src-snapshot and .version
        else:
            user_src.mkdir(parents=True, exist_ok=True)
    return user_src


def _bind(preferred_port):
    try:
        return _Server(("127.0.0.1", preferred_port), Handler), False
    except OSError:
        if preferred_port:
            print("[serve] port %d busy - using a random port" % preferred_port, flush=True)
            return _Server(("127.0.0.1", 0), Handler), True
        raise


def main():
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN, SHARE_MCP_SERVER, CLAUDE_BIN
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir", default=str(Path(__file__).resolve().parent.parent / "webapp"))
    ap.add_argument(
        "--src-dir",
        default=None,
        help="source tree served at /src/* (default: <data-dir>/src, this firm's own "
        "copy — never the plugin's app/src; see _default_src_dir)",
    )
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "0")))
    ap.add_argument("--no-open", action="store_true")
    ap.add_argument(
        "--share-mcp-server",
        default=None,
        help="the one Carta MCP server name report sharing may use (e.g. a test connector); "
        "default: the connectors for the dashboard's own Carta environment",
    )
    # Not type=int: a malformed id must degrade to "no user", not fail the launch.
    ap.add_argument(
        "--user-id",
        default=None,
        help="integer Carta id of the launching user, for the browser's Snowplow tracker; "
        "omit when unknown",
    )
    ap.add_argument(
        "--detach", action="store_true",
        help="Run as a background daemon that outlives the launching process and returns "
             "immediately. Cleanup is the idle timeout. No-op (warns) where os.fork is "
             "unavailable.")
    ap.add_argument(
        "--idle-timeout", type=int,
        default=int(os.environ.get("IDLE_TIMEOUT", str(IDLE_TIMEOUT_DEFAULT))),
        help="seconds of API inactivity before the server self-terminates (0 = never)",
    )
    ap.add_argument(
        "--claude-bin", default=None,
        help="absolute path to the claude CLI binary report sharing uses (default: found "
        "the same way as preflight_claude.py, including the launching Claude Code "
        "session's own binary); used only while it still exists, so a path removed "
        "by a later auto-update falls back to a fresh search",
    )
    args = ap.parse_args()
    SHARE_MCP_SERVER = args.share_mcp_server or os.environ.get(share_bridge.SERVER_ENV)
    CLAUDE_BIN = args.claude_bin

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SRC_DIR = Path(args.src_dir).resolve() if args.src_dir else _default_src_dir(DATA_DIR, WEB_DIR)
    # Before the reuse probe: a relaunch onto a live daemon must still refresh the id it serves.
    manco_paths.write_user_id(DATA_DIR, args.user_id)
    # Same reason: own_sync.py's detached sweep reads this pin too, so a test
    # connector this launch is scoped to also covers that sweep's pushes.
    manco_paths.write_share_mcp_server(DATA_DIR, SHARE_MCP_SERVER)

    port_file = DATA_DIR / ".port"
    token_file = DATA_DIR / ".token"

    TOKEN = _load_or_make_token(token_file)
    preferred = args.port
    if not preferred and port_file.exists():
        try:
            preferred = int(port_file.read_text().strip())
        except (ValueError, OSError):
            preferred = 0

    httpd, on_fallback = _bind(preferred)
    port = httpd.server_address[1]
    if not on_fallback:
        port_file.write_text(str(port))
    token_file.write_text(TOKEN)
    try:
        os.chmod(token_file, 0o600)
    except OSError:
        pass

    idle_timeout = max(0, args.idle_timeout)
    url = "http://127.0.0.1:%d/?t=%s" % (port, TOKEN)
    print("[serve] manco-reporting at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)
    print("[serve] web-dir:  %s%s" % (WEB_DIR, "" if (WEB_DIR / "vendor").exists() else "  (vendor missing — run `npm run build` in app/)"), flush=True)
    # An unknown path falls through to the SPA shell, so a missing tracker answers 200
    # with HTML and the browser silently drops every UI event.
    if not (WEB_DIR / "vendor" / "mcp-ui-tracker.global.js").exists():
        print("[serve] WARNING: vendor/mcp-ui-tracker.global.js missing — no telemetry will be sent", flush=True)
    print("[serve] src-dir:  %s%s" % (SRC_DIR, "" if SRC_DIR.exists() else "  (missing)"), flush=True)
    print("[serve] idle-timeout: %s" % ("disabled" if idle_timeout <= 0 else "%ds" % idle_timeout), flush=True)

    _maybe_open_browser(url, args.no_open)

    # Fork before starting the watchdog thread — threads don't survive fork.
    if args.detach:
        _detach_or_warn()

    targets = share_bridge.candidate_servers(manco_paths.read_carta_environment(DATA_DIR), SHARE_MCP_SERVER)
    print("[serve] report sharing uses Carta connector(s): %s%s" % (
        ", ".join(targets), " (pinned)" if SHARE_MCP_SERVER else ""), flush=True)
    atexit.register(_close_all_chat_sessions)
    threading.Thread(target=_watchdog, args=(httpd, idle_timeout), daemon=True).start()
    # Also after the fork, for the same reason as the watchdog above.
    threading.Thread(target=_startup_claude_probe, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
