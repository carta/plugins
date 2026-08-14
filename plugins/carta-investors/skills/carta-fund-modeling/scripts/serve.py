#!/usr/bin/env python3
"""
fund-modeling local server (React source tree + Fund Admin JSON).

Serves the built app shell (--web-dir, webapp/) plus the canonical source tree
(--src-dir, ../app/src) at /src/* — transpiled in-browser by a service worker — and
the JSON the skill wrote to a data dir, plus an editable portfolio document
(GET with ETag / PUT with If-Match).
Python stdlib only — no third-party deps — so it runs for non-developers at runtime.

Security:
  - binds 127.0.0.1 only
  - a token gates every /api/* request (URL carries ?t=<token>, the page sends it
    as the X-Dash-Token header). The token is generated once (randomly) on first
    launch and then persisted in the data dir and reused across relaunches of the
    same firm, so the URL stays stable. The data dir already holds the confidential
    JSON, so storing the token alongside it adds no meaningful exposure.
  - all reads/writes stay under the data dir / web dir (path-traversal guarded)

Stable URL: the port and token are remembered in the firm's data dir (.port /
.token) and reused on relaunch, so relaunching the same firm reopens the same
http://127.0.0.1:<port>/?t=<token>. An explicit --port / PORT env still wins.

The browser NEVER calls the Carta MCP — it only reads JSON the skill produced.

Usage:
  uv run serve.py --data-dir <dir> [--web-dir <webapp>] [--port N] [--no-open]
                  [--user-id <carta_user_id>]
"""

import argparse
import atexit
import hashlib
import http.client
import http.server
import json
import os
import re
import secrets
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import chat_session
import fm_paths
import refresh
import share

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
_CHAT_SESSIONS = {}   # sessionId -> {"session": chat_session.ChatSession, "lock": threading.Lock()}
# The in-flight refresh's ChatSession, tracked so _close_all_sessions reaps it on shutdown —
# it lives in a daemon thread whose own finally may not run when the process exits mid-fetch.
_refresh_session = None
_SESSIONS_LOCK = threading.Lock()  # guards _CHAT_SESSIONS get-or-create / eviction and _refresh_session
IDLE_TIMEOUT_DEFAULT = 28800  # 8h backstop; should never fire during active use
# Watchdog cadence, and the slack above it that distinguishes a real suspend
# (laptop sleep) from ordinary scheduling jitter — a gap beyond the sum is sleep.
WATCHDOG_INTERVAL = 10
SUSPEND_GAP_SLACK = 55
_last_heartbeat = time.time()
_hb_lock = threading.Lock()
_portfolio_lock = threading.Lock()
# Single-flight guard for a background refresh (409 if one is already running). Held for
# the whole run but does NOT gate edits — the fetch writes only raw files, so the app
# stays usable throughout.
_refresh_lock = threading.Lock()
# Held only for the few seconds build_datadir rewrites the served dir; a portfolio PUT in
# that window 409s (the client reloads truth). The minutes-long fetch stays ungated.
_build_lock = threading.Lock()
# Snapshot of the in-flight (or last-finished) background refresh, polled by the browser
# via GET /api/refresh/status. Guarded by _refresh_state_lock.
_refresh_state = {"status": "idle"}
_refresh_state_lock = threading.Lock()
# Single-flight guard for a background publish/pull. Its MCP calls don't touch firm context
# (fa commands are firm_uuid-param-scoped), so it may run alongside a refresh fetch; the two
# serialize only at the portfolio.json write, which share takes _portfolio_lock for.
_share_lock = threading.Lock()
_share_state = {"status": "idle"}
_share_state_lock = threading.Lock()
_share_session = None  # live warm-share ChatSession, reported by the pool, reaped by _close_all_sessions
_warm_share = None     # reusable share session (pool of one); its subprocess is _share_session
_share_prewarm_disabled = False  # set once a load-time warm sees not_enabled — don't respawn-and-fail each load
_share_prewarm_inflight = False  # a load-time warm is spawning; dedupe concurrent prewarm pings

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".pdf": "application/pdf", ".png": "image/png",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
}

# Simple GET endpoints -> file under the data dir (firm query param is ignored;
# one firm per launch). Portfolio is special (ETag + PUT); company is parametric.
_FILE_ROUTES = {
    "/api/firms": "firms.json",
    "/api/snapshot": "snapshot.json",
    "/api/pacing": "pacing.json",
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


def _set_refresh_state(**fields):
    with _refresh_state_lock:
        _refresh_state.update(fields)


def _refresh_progress(phase, message, **extra):
    """emit() for a background refresh: fold progress into _refresh_state (polled by the
    browser) and touch the heartbeat so the watchdog can't reap a long fetch."""
    _touch_heartbeat()
    with _refresh_state_lock:
        _refresh_state["phase"] = phase
        _refresh_state["progress"] = message
        if phase == "issue":
            _refresh_state.setdefault("warnings", []).append(message)
            return
        if "step" in extra:
            _refresh_state["step"] = extra["step"]
        if "total" in extra:
            _refresh_state["total"] = extra["total"]


def _track_refresh_session(session):
    """run_fetch's on_session hook: publish the live session (or None) for _close_all_sessions."""
    global _refresh_session
    with _SESSIONS_LOCK:
        _refresh_session = session


def _run_refresh_bg():
    """Daemon-thread body: run the fetch decoupled from the POST, record the outcome, release
    the single-flight lock. The build+swap is deferred to POST /api/refresh/apply."""
    try:
        result = refresh.run_fetch(str(DATA_DIR), _refresh_progress,
                                   on_session=_track_refresh_session)
        _set_refresh_state(status="fetched", progress=None,
                           warnings=result.get("warnings") or [])
    except refresh.RefreshError as e:
        _set_refresh_state(status="error", progress=None, message=str(e),
                           needs_human=e.needs_human)
    except Exception as e:  # never leave the button spinning on an unexpected fault
        _set_refresh_state(status="error", progress=None,
                           message="Refresh failed: %s" % e, needs_human=True)
    finally:
        _refresh_lock.release()


def _start_refresh_bg():
    with _refresh_state_lock:
        _refresh_state.clear()
        _refresh_state.update({"status": "running", "phase": "preflight",
                               "progress": "Checking your Carta connection…", "warnings": [],
                               # server-anchored so the browser timer survives a reload
                               "started_at": time.time()})
    threading.Thread(target=_run_refresh_bg, daemon=True).start()


def _set_share_state(**fields):
    with _share_state_lock:
        _share_state.update(fields)


def _share_progress(phase, message, **extra):
    """emit() for a background publish/pull: fold progress into _share_state (polled by the
    browser) and touch the heartbeat so the watchdog can't reap a long pull."""
    _touch_heartbeat()
    with _share_state_lock:
        _share_state["phase"] = phase
        _share_state["progress"] = message
        for k in ("step", "total"):
            if k in extra:
                _share_state[k] = extra[k]


def _track_share_session(session):
    """The warm pool's on_session hook: publish the live subprocess (or None) so
    _close_all_sessions reaps it on shutdown, exactly as the per-op session was tracked."""
    global _share_session
    with _SESSIONS_LOCK:
        _share_session = session


def _get_warm_share():
    """Lazily create the pooled warm session (object only — no spawn; warm() spawns on first use)."""
    global _warm_share
    with _SESSIONS_LOCK:
        if _warm_share is None:
            _warm_share = share.WarmShareSession(str(DATA_DIR), on_session=_track_share_session)
        return _warm_share


def _run_share_bg(kind, params):
    """Daemon-thread body: run publish/pull decoupled from the POST, record the outcome, release
    the single-flight lock. Reuses the pooled warm session so only the first op pays spawn+welcome."""
    warm = _get_warm_share()
    try:
        if kind == "publish":
            result = share.run_publish(str(DATA_DIR), params["sliceId"], _share_progress,
                                       _portfolio_lock, warm, force=params.get("force", False),
                                       as_new=params.get("as_new", False))
        elif kind == "delete":
            result = share.run_delete(str(DATA_DIR), params["sliceId"], _share_progress,
                                      _portfolio_lock, warm)
        else:
            result = share.run_pull(str(DATA_DIR), _share_progress, _portfolio_lock, warm,
                                    override_uuids=set(params.get("overrideUuids") or []))
        _set_share_state(status="done", progress=None, result=result)
    except share.ShareError as e:
        raw = getattr(e, "raw", None)
        if raw:  # keep the classified message user-facing; log the raw tool error for diagnosis
            print("[share] %s error (raw: %s)" % (e.code, str(raw)[:300]), flush=True)
        _set_share_state(status="error", progress=None, code=e.code,
                         message=str(e), needs_human=e.needs_human)
    except Exception as e:  # never leave the button spinning on an unexpected fault
        _set_share_state(status="error", progress=None, code="failed",
                         message="Sharing failed: %s" % e, needs_human=True)
    finally:
        _share_lock.release()


def _start_share_bg(kind, params):
    with _share_state_lock:
        _share_state.clear()
        _share_state.update({"status": "running", "phase": "preflight",
                             "progress": "Checking your Carta connection…",
                             "started_at": time.time()})
    threading.Thread(target=_run_share_bg, args=(kind, params), daemon=True).start()


def _prewarm_share_bg():
    """Silently bootstrap the pooled share session so the first user op is fast. Takes no
    _share_lock and does no pull/write; a firm without sharing is remembered to avoid re-spawning."""
    global _share_prewarm_disabled, _share_prewarm_inflight
    try:
        if _share_lock.locked():
            return  # an op is already warming the pool
        warm = _get_warm_share()
        try:
            firm_uuid, prefer_nonprod, _, _ = share._load_context(str(DATA_DIR))
            warm.warm(firm_uuid, prefer_nonprod, lambda *a, **k: None)
        except share.ShareError as e:
            if e.code == "not_enabled":
                with _SESSIONS_LOCK:
                    _share_prewarm_disabled = True
        except Exception:
            pass
    finally:
        with _SESSIONS_LOCK:
            _share_prewarm_inflight = False


def _maybe_prewarm_share():
    """Fire-and-forget the load-time warm, deduped: skip if sharing is known-off, a warm is
    already spawning, or the pool is already warm."""
    global _share_prewarm_inflight
    with _SESSIONS_LOCK:
        if _share_prewarm_disabled or _share_prewarm_inflight:
            return
        if _warm_share is not None and _warm_share.is_warm():
            return
        _share_prewarm_inflight = True
    try:
        threading.Thread(target=_prewarm_share_bg, daemon=True).start()
    except Exception:
        # A failed spawn would otherwise leave the flag stuck and disable prewarm for good.
        with _SESSIONS_LOCK:
            _share_prewarm_inflight = False


def _close_all_sessions():
    """Reap every registered chat session AND the in-flight refresh/share sessions. Called on
    both shutdown paths (normal atexit and the watchdog's os._exit) so subprocesses are never
    orphaned."""
    global _refresh_session, _share_session, _warm_share
    with _SESSIONS_LOCK:
        sessions = [e["session"] for e in _CHAT_SESSIONS.values()]
        _CHAT_SESSIONS.clear()
        if _refresh_session is not None:
            sessions.append(_refresh_session)
            _refresh_session = None
        if _share_session is not None:
            sessions.append(_share_session)  # the warm pool's live subprocess
            _share_session = None
        _warm_share = None  # drop the wrapper; its subprocess is reaped via _share_session above
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
        # A jump this large means the host slept (the tab was frozen too, so its
        # heartbeat lapsed — not real idleness). Forgive it: reset and let the
        # reopened tab resume before we consider reaping.
        if now - last_tick > WATCHDOG_INTERVAL + SUSPEND_GAP_SLACK:
            _touch_heartbeat()
            last_tick = now
            continue
        last_tick = now
        if timeout <= 0:
            continue
        if _refresh_lock.locked() or _build_lock.locked() or _share_lock.locked():
            continue  # never reap mid-fetch/build/share (all go quiet between events)
        with _hb_lock:
            idle = now - _last_heartbeat
        if idle > timeout:
            print("[serve] idle %ds - shutting down" % int(idle), flush=True)
            httpd.shutdown()
            _close_all_sessions()   # os._exit below skips atexit — reap explicitly first
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


def _etag(b):
    return '"' + hashlib.md5(b).hexdigest() + '"'


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    # ---- helpers ----
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
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, path, extra=None):
        try:
            data = path.read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            return self._send(404, {"error": "not_found"})
        ctype = _CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def _shell(self, qs):
        # Shell (index.html) and app share the /firm/<slug>/<page> path; only the
        # iframe's own document carries ?frame=1, so it alone gets app.html. Not a
        # security boundary — the token gates /api data, not the shell.
        name = "app.html" if qs.get("frame") == ["1"] else "index.html"
        return self._send_file(WEB_DIR / name)

    def _data_json(self, rel):
        p = _safe_join(DATA_DIR, rel)
        if p is None:
            return self._send(403, {"error": "forbidden"})
        if not p.exists():
            return self._send(200, {"error": "not_ready"})
        return self._send_file(p)

    # ---- GET ----
    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        path = u.path

        # static shells (token gates the data, not the shell). /app is the legacy
        # explicit app-bootstrap path; root and every deep link resolve their shell
        # via ?frame= (see _shell).
        if path == "/app" or path == "/app.html":
            return self._send_file(WEB_DIR / "app.html")
        if path == "/" or path == "/index.html" or path == "":
            return self._shell(qs)
        if not path.startswith("/api/"):
            # /src/* is the canonical source tree (served directly, transpiled in
            # the browser); everything else is a built artifact under WEB_DIR.
            if path.startswith("/src/"):
                base, rel = SRC_DIR, path[len("/src"):]
            else:
                base, rel = WEB_DIR, path
            p = _safe_join(base, rel)
            if p is None or not p.exists() or p.is_dir():
                # A request for a file that has an extension but doesn't exist gets a
                # real 404 (so the browser sees a genuine module/asset error, not
                # HTML-parsed-as-a-module garbage). SPA fallback is only for
                # extensionless navigation routes (e.g. /firm/<slug>/<page>).
                if "." in path.rsplit("/", 1)[-1]:
                    return self._send(404, {"error": "not_found"})
                return self._shell(qs)
            return self._send_file(p)

        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        # Any authenticated API activity keeps the server alive, not just the ping.
        _touch_heartbeat()
        if path == "/api/heartbeat":
            return self._send(200, {"ok": True})
        if path == "/api/telemetry-context":
            # Read per request, not at startup: a refresh rewrites snapshot.json, and a
            # firmId it resolves late should reach the tracker without a relaunch.
            return self._send(
                200,
                {
                    "environment": _read_carta_environment(DATA_DIR),
                    "firmId": _read_firm_id(DATA_DIR),
                    "userId": _read_user_id(DATA_DIR),
                },
            )
        if path == "/api/models":
            return self._send(200, {"models": chat_session.CLAUDE_MODELS,
                                    "default": chat_session.DEFAULT_MODEL})
        if path == "/api/refresh/status":
            with _refresh_state_lock:
                return self._send(200, dict(_refresh_state))
        if path == "/api/scenarios/share-status":
            if qs.get("warm"):  # load-time ping: warm the share pool in the background (idempotent)
                _maybe_prewarm_share()
            with _share_state_lock:
                return self._send(200, dict(_share_state))
        if path == "/api/portfolio":
            return self._get_portfolio()
        if path in _FILE_ROUTES:
            return self._data_json(_FILE_ROUTES[path])
        # generic report files (e.g. company-ownership.json): serve any safe
        # <name>.json the skill wrote to the data dir, no per-file route
        if path.startswith("/api/report/"):
            name = path[len("/api/report/"):]
            if not re.fullmatch(r"[a-z0-9_-]+\.json", name):
                return self._send(404, {"error": "not_found"})
            return self._data_json(name)
        return self._send(404, {"error": "not_found"})

    def do_HEAD(self):
        self.do_GET()

    # ---- PUT (portfolio save) ----
    def do_PUT(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        if u.path != "/api/portfolio":
            return self._send(404, {"error": "not_found"})
        # Only blocked for the build+swap seconds, not the whole fetch. A save that lands
        # in that window 409s and the client reloads the reconciled truth.
        if _build_lock.locked():
            return self._send(409, {"error": "refresh_in_progress"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 8 * 1024 * 1024:
            return self._send(413, {"error": "payload_too_large"})
        raw = self.rfile.read(length) if length else b"{}"
        try:
            json.loads(raw.decode("utf-8"))  # validate
        except ValueError:
            return self._send(400, {"error": "bad_json"})
        with _portfolio_lock:
            p = DATA_DIR / "portfolio.json"
            if_match = self.headers.get("If-Match")
            if if_match and p.exists():
                current = _etag(p.read_bytes())
                if if_match.strip() != current:
                    return self._send(409, {"error": "conflict"})
            tmp = p.with_suffix(".json.tmp")
            tmp.write_bytes(raw)
            os.replace(tmp, p)
            return self._send(200, {"ok": True}, extra={"ETag": _etag(raw)})

    # ---- portfolio GET with ETag ----
    def _get_portfolio(self):
        p = DATA_DIR / "portfolio.json"
        if not p.exists():
            return self._send(200, {"error": "not_ready"})
        data = p.read_bytes()
        return self._send_file(p, extra={"ETag": _etag(data)})

    # ---- SSE (chat) ----
    def _sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True   # ensure the client's read() terminates at stream end

    def _read_json_body(self):
        """Parsed request body, or None when it isn't JSON (caller sends the 400)."""
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return None

    def _chat_interrupt(self, u):
        """Stop the turn in flight without tearing the session down.

        Deliberately does NOT take the session's turn lock: that lock is held for
        the entire in-flight turn, so waiting on it would block in exactly the
        case this endpoint exists to serve. It only needs the registry, which is
        guarded briefly.
        """
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "bad_json"})
        sid = body.get("sessionId") or "default"
        with _SESSIONS_LOCK:
            entry = _CHAT_SESSIONS.get(sid)
        # A turn that ended between the click and this request has already been
        # evicted, so there is nothing to stop and nothing went wrong.
        if entry is None:
            return self._send(404, {"error": "no_session"})
        if not entry["session"].interrupt():
            return self._send(409, {"error": "not_interruptible"})
        return self._send(200, {"ok": True})

    def _refresh(self, u):
        """Start a background fetch (single-flight via _refresh_lock) and return 202; the
        browser polls GET /api/refresh/status. Background, not SSE, so the app stays usable
        and a dropped client can't abort it. The build+swap waits for /api/refresh/apply."""
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        if _build_lock.locked():  # a build is swapping raw→served; don't rewrite raw under it
            return self._send(409, {"error": "apply_in_progress"})
        if not _refresh_lock.acquire(blocking=False):
            return self._send(409, {"error": "refresh_in_progress"})
        # A staged-but-unloaded fetch ("fetched") must not be clobbered by a new one, which
        # could also tear a concurrent apply's raw read. Check the state (not a lock peek) so
        # it can't race _refresh_apply's status→build_lock transition.
        with _refresh_state_lock:
            staged = _refresh_state.get("status") == "fetched"
        if staged:
            _refresh_lock.release()
            return self._send(409, {"error": "refresh_in_progress"})
        # The thread's finally is the lock's only other release — if it can't start, release
        # here or every later refresh 409s until restart.
        try:
            _start_refresh_bg()
        except Exception as e:
            _refresh_lock.release()
            _set_refresh_state(status="error", progress=None,
                               message="Couldn't start the refresh: %s" % e, needs_human=True)
            return self._send(500, {"error": "refresh_start_failed"})
        return self._send(202, {"ok": True})

    def _refresh_apply(self, u):
        """Build + swap the fetched raw into the served dir (the user's "Load new data").
        Reads the CURRENT portfolio.json — the client flushes edits first, so the reconcile
        picks up the latest scenarios. _build_lock blocks portfolio PUT for the build."""
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        with _refresh_state_lock:
            ready = _refresh_state.get("status") == "fetched"
        if not ready:
            return self._send(409, {"error": "nothing_to_apply"})
        if _refresh_lock.locked():  # a fetch is rewriting raw — building it would tear
            return self._send(409, {"error": "refresh_in_progress"})
        if not _build_lock.acquire(blocking=False):
            return self._send(409, {"error": "apply_in_progress"})
        try:
            # build_lock already held here, so pass None (threading.Lock isn't reentrant).
            result = refresh.run_build(str(DATA_DIR), lambda *a, **k: _touch_heartbeat(),
                                       build_lock=None)
            _set_refresh_state(status="idle")
            return self._send(200, {"ok": True, "asOf": result.get("asOf"),
                                    "funds": result.get("funds"), "companies": result.get("companies")})
        except refresh.RefreshError as e:
            return self._send(500, {"error": "build_failed", "message": str(e),
                                    "needs_human": e.needs_human})
        except Exception as e:
            return self._send(500, {"error": "build_failed",
                                    "message": "Rebuild failed: %s" % e, "needs_human": True})
        finally:
            _build_lock.release()

    def _share_start(self, u, kind):
        """Start a background publish/pull (single-flight via _share_lock) and return 202; the
        browser polls GET /api/scenarios/share-status. Publish needs a sliceId (+ optional force
        to override the staleness guard); pull takes no body."""
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        params = {}
        if kind in ("publish", "delete"):
            body = self._read_json_body()
            if body is None:
                return self._send(400, {"error": "bad_json"})
            slice_id = body.get("sliceId")
            if not slice_id:
                return self._send(400, {"error": "missing_slice"})
            params = {"sliceId": slice_id, "force": bool(body.get("force")),
                      "as_new": bool(body.get("asNew"))}
        elif kind == "pull":
            # Optional: overwrite one locally-dirty scenario ("load theirs" on a conflict).
            ov = (self._read_json_body() or {}).get("overrideUuid")
            params = {"overrideUuids": [ov]} if ov else {}
        if not _share_lock.acquire(blocking=False):
            return self._send(409, {"error": "share_in_progress"})
        # The thread's finally is the lock's only other release — release here if it can't start.
        try:
            _start_share_bg(kind, params)
        except Exception as e:
            _share_lock.release()
            _set_share_state(status="error", progress=None, code="failed",
                             message="Couldn't start sharing: %s" % e, needs_human=True)
            return self._send(500, {"error": "share_start_failed"})
        return self._send(202, {"ok": True})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/chat/interrupt":
            return self._chat_interrupt(u)
        if u.path == "/api/refresh":
            return self._refresh(u)
        if u.path == "/api/refresh/apply":
            return self._refresh_apply(u)
        if u.path == "/api/scenarios/publish":
            return self._share_start(u, "publish")
        if u.path == "/api/scenarios/pull":
            return self._share_start(u, "pull")
        if u.path == "/api/scenarios/delete":
            return self._share_start(u, "delete")
        if u.path != "/api/chat":
            return self._send(404, {"error": "not_found"})
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        # Chat is NOT gated on a running refresh: the refresh and chat sessions are
        # separate claude subprocesses with no shared state.
        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "bad_json"})
        prompt = body.get("prompt")
        prompt = str(prompt).strip() if prompt is not None else ""
        sid = body.get("sessionId") or "default"
        if not prompt:
            return self._send(400, {"error": "empty_prompt"})

        model = body.get("model")
        if model is not None and model not in chat_session.ALLOWED_MODEL_VALUES:
            return self._send(400, {"error": "invalid_model"})

        anchor = body.get("anchor")
        if anchor:
            preamble = chat_session.anchor_preamble(anchor)
            if preamble:
                prompt = preamble + "\n\n" + prompt

        # Guarded get-or-create: registry access is synchronized, and a failed
        # start() is evicted and reported as a clean JSON error before any SSE
        # headers go out (a 500 after headers would corrupt the SSE stream).
        with _SESSIONS_LOCK:
            entry = _CHAT_SESSIONS.get(sid)
            if entry is None:
                sess = chat_session.ChatSession(
                    cwd=str(SRC_DIR), add_dirs=[str(SRC_DIR), str(DATA_DIR)],
                    model=model or chat_session.DEFAULT_MODEL)
                try:
                    sess.start()
                except Exception:
                    return self._send(500, {"error": "claude_unavailable"})
                entry = {"session": sess, "lock": threading.Lock()}
                _CHAT_SESSIONS[sid] = entry

        # Single-flight per session: only one in-flight turn at a time.
        if not entry["lock"].acquire(blocking=False):
            return self._send(409, {"error": "turn_in_progress"})
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
            entry["lock"].release()
            if not saw_result:
                # Timeout, EOF-without-result, or an exception above: the session
                # is untrustworthy (late/buffered events could bleed into the next
                # turn) — evict it so the next request for this sid starts fresh.
                sess = entry["session"]
                with _SESSIONS_LOCK:
                    if _CHAT_SESSIONS.get(sid) is entry:
                        del _CHAT_SESSIONS[sid]
                sess.close()


class _Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def _load_or_make_token(token_file):
    """Reuse this firm's persisted token so relaunches keep the same URL.

    Falls back to a fresh random token on first launch or an unreadable file.
    """
    try:
        prev = token_file.read_text().strip()
        if prev:
            return prev
    except OSError:
        pass
    return secrets.token_urlsafe(18)


def _read_carta_environment(data_dir):
    """This firm's cached snapshot.source.cartaEnvironment ("production" or
    "nonprod"), served to the browser so the tracker knows which Snowplow
    collector to use. Defaults to "production" on any
    read/parse failure or on an older cache built before this field existed —
    this is a customer-facing plugin, so an unclassified build is far more
    likely real production usage than a staff test session; staff noise is
    filterable downstream."""
    try:
        data = json.loads((data_dir / "snapshot.json").read_text())
        return data.get("source", {}).get("cartaEnvironment") or "production"
    except (OSError, ValueError):
        return "production"


def _read_firm_id(data_dir):
    """Served to the browser so Snowplow events key on the real Carta id, not a slugified firm
    name. None when the cache has no usable id — the context is dropped, never faked."""
    try:
        data = json.loads((data_dir / "snapshot.json").read_text())
        firm_id = int((data.get("source") or {}).get("firmId"))
    except (OSError, ValueError, TypeError, AttributeError):
        return None
    return firm_id if firm_id > 0 else None


def _user_id_file(data_dir):
    return data_dir / ".user-id"


def _read_user_id(data_dir):
    """The launching user's integer Carta id, so events name a person rather than a device."""
    try:
        user_id = int(_user_id_file(data_dir).read_text().strip())
    except (OSError, ValueError):
        return None
    return user_id if user_id > 0 else None


def _write_user_id(data_dir, raw):
    """Record the launching user. No id means no MCP, not a new person — so keep the last one."""
    try:
        user_id = int(str(raw).strip())
    except (TypeError, ValueError):
        return
    if user_id <= 0:
        return
    try:
        _user_id_file(data_dir).write_text(str(user_id))
    except OSError:
        pass


def _get_previously_used_port(port_file):
    """The port this firm last bound (persisted in its data dir), or 0 if none/unreadable/out of range."""
    try:
        port = int(port_file.read_text().strip())
    except (ValueError, OSError):
        return 0
    if port and not (1 <= port <= 65535):
        print("[serve] ignoring out-of-range remembered port %d" % port, flush=True)
        return 0
    return port


def _build_dashboard_url(port, token):
    return "http://127.0.0.1:%d/?t=%s" % (port, token)


def _probe_instance(port, token):
    """True if a firm's server already answers on `port` (token-gated heartbeat)."""
    if not port:
        return False
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.5)
    try:
        conn.request("GET", "/api/heartbeat", headers={"X-Dash-Token": token})
        resp = conn.getresponse()
        # our heartbeat body is tiny; cap so a foreign 200 can't stream unbounded
        return resp.status == 200 and json.loads(resp.read(64).decode("utf-8")).get("ok") is True
    except Exception:
        return False
    finally:
        conn.close()


def _open_link_in_browser(url):
    try:
        webbrowser.open(url)
    except Exception:
        pass


def _bind(preferred_port):
    """Bind the remembered port when it's free; fall back to an ephemeral one."""
    try:
        return _Server(("127.0.0.1", preferred_port), Handler)
    except OSError:
        if preferred_port:
            print("[serve] port %d busy - using a random port" % preferred_port, flush=True)
            return _Server(("127.0.0.1", 0), Handler)
        raise


def main():
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir", default=str(Path(__file__).resolve().parent.parent / "webapp"))
    ap.add_argument("--src-dir", default=None, help="canonical source tree served at /src/* (default: <web-dir>/../app/src)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "0")))
    ap.add_argument("--no-open", action="store_true")
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
    args = ap.parse_args()

    # Defense-in-depth backstop for the SKILL.md Gate 0 surface check. serve.py
    # binds 127.0.0.1 and opens a local browser — neither reaches the user from a
    # sandboxed session (Cowork, or a Claude Code cloud session) — so refuse to
    # start rather than hand back a dead URL.
    surface, _signals = fm_paths.detect_surface()
    if surface == "sandboxed":
        print(
            "[serve] Fund Modeling runs a local web app (localhost server + browser) and only "
            "works in a Claude Code session running on your machine. It can't run in a sandboxed "
            "session (Cowork, or a Claude Code cloud session) — switch to a local session and re-run.",
            file=sys.stderr, flush=True)
        raise SystemExit(2)

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    SRC_DIR = Path(args.src_dir).resolve() if args.src_dir else (WEB_DIR.parent / "app" / "src")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    # Before the reuse probe: a relaunch onto a live daemon must still refresh the id it serves.
    _write_user_id(DATA_DIR, args.user_id)

    port_file = DATA_DIR / ".port"
    token_file = DATA_DIR / ".token"

    # Stable URL per firm: reuse the token + port remembered in this firm's data
    # dir so relaunching the same firm reopens the same URL. An explicit --port
    # (or PORT env) still wins over the remembered one.
    TOKEN = _load_or_make_token(token_file)
    preferred_port = args.port or _get_previously_used_port(port_file)

    # Reuse a firm's live daemon rather than start a duplicate sharing its portfolio.json.
    if not args.port and _probe_instance(preferred_port, TOKEN):
        url = _build_dashboard_url(preferred_port, TOKEN)
        print("[serve] fund-modeling already running at %s" % url, flush=True)
        if not args.no_open:
            _open_link_in_browser(url)
        return

    httpd = _bind(preferred_port)
    port = httpd.server_address[1]
    # Record the actual port even on fallback, so the reuse probe finds this daemon next launch.
    port_file.write_text(str(port))
    token_file.write_text(TOKEN)
    # Session bearer token — restrict to the owning user so other local accounts
    # can't read it and impersonate authenticated requests to the dev server.
    try:
        os.chmod(token_file, 0o600)
    except OSError:
        pass

    idle_timeout = max(0, args.idle_timeout)
    url = _build_dashboard_url(port, TOKEN)
    print("[serve] fund-modeling at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)
    print("[serve] web-dir:  %s%s" % (WEB_DIR, "" if (WEB_DIR / "vendor").exists() else "  (vendor missing — run `npm run build`)"), flush=True)
    print("[serve] src-dir:  %s%s" % (SRC_DIR, "" if SRC_DIR.exists() else "  (missing)"), flush=True)
    print("[serve] idle-timeout: %s" % ("disabled" if idle_timeout <= 0 else "%ds" % idle_timeout), flush=True)

    if not args.no_open:
        _open_link_in_browser(url)

    atexit.register(_close_all_sessions)

    # Fork before starting the watchdog thread — threads don't survive fork.
    if args.detach:
        _detach_or_warn()

    threading.Thread(target=_watchdog, args=(httpd, idle_timeout), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
