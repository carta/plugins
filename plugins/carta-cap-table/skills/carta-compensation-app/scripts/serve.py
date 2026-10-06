#!/usr/bin/env python3
"""
ctc-dashboard local server (React source tree + Carta Total Compensation JSON).

Serves the committed app shell (--web-dir, webapp/) plus the canonical source tree
(--src-dir, ../app/src) at /src/* — transpiled in-browser by a service worker — and
the JSON the skill wrote to a data dir, plus an editable scenarios document
(GET with ETag / PUT with If-Match).
Python stdlib only — no third-party deps — so it runs for non-developers at runtime.

Also fetches a Benchmarks location on demand: POST /api/location runs the one
read-only export for a location the build didn't sweep, through headless `claude`
sessions on the user's own Carta MCP connection (see location_fetch.py). The page
names only a location from the build's catalog and a peer group the build
offers; the command and every other argument are fixed server-side.

Also hosts the ask box: POST /api/ask streams a `claude` subprocess's stream-json
output back as SSE so the user can modify the console from inside it ("add an
interpolated P60") without leaving for their Claude session. See chat_session.py —
the subprocess gets no Bash and no MCP, so this stays read-only w.r.t. Carta.

Security:
  - binds 127.0.0.1 only
  - a token gates every /api/* request (URL carries ?t=<token>, the page sends it
    as the X-Dash-Token header). The token is generated once (randomly) on first
    launch and then persisted in the data dir and reused across relaunches of the
    same corp, so the URL stays stable. The data dir already holds the confidential
    JSON, so storing the token alongside it adds no meaningful exposure.
  - all reads/writes stay under the data dir / web dir (path-traversal guarded)

Stable URL: the port and token are remembered in the corp's data dir (.port /
.token) and reused on relaunch, so relaunching the same corp reopens the same
http://127.0.0.1:<port>/?t=<token>. An explicit --port / PORT env still wins.

The browser never calls the Carta MCP itself. It reads JSON the skill produced,
and can ask this server for a location's benchmarks, which it fetches with one
fixed read-only command. This app is READ-ONLY with respect to Carta: the sole
write path is the local scenarios save (PUT /api/scenarios), which never leaves
this machine.

Ported from carta-fund-modeling/scripts/serve.py, minus its chat/SSE layer.

Usage:
  uv run serve.py --data-dir <dir> [--web-dir <webapp>] [--port N] [--no-open]
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
import shutil
import socketserver
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

import chat_session
import desktop_handoff
import location_fetch
import predicate_session
import preflight_claude

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
CLAUDE_BIN = None

# Whether the ask box and cohort filter can run. "checking" until the startup
# probe finishes; the browser treats only "unavailable" as a reason to disable
# them. Specific causes go to CHAT_LOG, never to the page.
_CLAUDE_STATUS = {"state": "checking", "reason": None}
_claude_lock = threading.Lock()
CHAT_LOG = "chat-errors.log"
CHAT_UNAVAILABLE = "claude_unavailable"
IDLE_TIMEOUT_DEFAULT = 28800  # 8h backstop; should never fire during active use
# Watchdog cadence, and the slack above it that distinguishes a real suspend
# (laptop sleep) from ordinary scheduling jitter — a gap beyond the sum is sleep.
WATCHDOG_INTERVAL = 10
SUSPEND_GAP_SLACK = 55
_last_heartbeat = time.time()

SRC_FINGERPRINT_FILE = ".ctc-src-fingerprint"
SRC_BACKUPS_KEPT = 3


def _tree_fingerprint(root):
    # type: (Path) -> str
    """SHA-256 over every file's relative path and bytes, ignoring our own stamp."""
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if not p.is_file() or p.name in (SRC_FINGERPRINT_FILE, ".DS_Store"):
            continue
        h.update(p.relative_to(root).as_posix().encode())
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return h.hexdigest()


def _backup_working_src(copy):
    # type: (Path) -> Path
    backup = copy.with_name("%s.bak-%s" % (copy.name, time.strftime("%Y%m%d-%H%M%S")))
    copy.rename(backup)
    olds = sorted(copy.parent.glob(copy.name + ".bak-*"))
    for old in olds[:-SRC_BACKUPS_KEPT]:
        shutil.rmtree(str(old), ignore_errors=True)
    return backup


def _prepare_working_src(canonical, data_dir):
    # type: (Path, Path) -> Path
    """The source tree the ask box edits: a per-corp copy beside the data dir.

    The installed plugin is not editable in place: under Claude Code it lives in
    ~/.claude/, which headless `claude -p` may not write, and an update wipes edits
    anyway. The copy refreshes when the plugin's source changes; one holding Claude's
    edits is moved to a .bak-* first. Any failure falls back to the install.
    """
    copy = data_dir.parent / (data_dir.name + ".app-src")
    if not canonical.is_dir():
        return canonical
    try:
        want = _tree_fingerprint(canonical)
        stamp = copy / SRC_FINGERPRINT_FILE
        if copy.is_dir() and stamp.is_file():
            base = stamp.read_text().strip()
            if base == want:
                return copy
            if _tree_fingerprint(copy) != base:
                print("[serve] app source updated; earlier edits kept in %s"
                      % _backup_working_src(copy), flush=True)
            else:
                shutil.rmtree(str(copy))
        elif copy.exists():
            print("[serve] unrecognised %s moved to %s" % (copy, _backup_working_src(copy)),
                  flush=True)
        tmp = copy.with_name(copy.name + ".tmp")
        if tmp.exists():
            shutil.rmtree(str(tmp))
        shutil.copytree(str(canonical), str(tmp))
        (tmp / SRC_FINGERPRINT_FILE).write_text(want)
        tmp.rename(copy)
        return copy
    except OSError as e:
        print("[serve] could not prepare an editable copy of the app (%s); the ask box "
              "will edit the installed plugin" % e, flush=True)
        return canonical


_hb_lock = threading.Lock()
_scenarios_lock = threading.Lock()

# Ask-box sessions, keyed by sessionId: {"session": ChatSession, "lock": Lock}.
# The lock is per-session single-flight (one in-flight turn each); _SESSIONS_LOCK
# guards the registry itself, never a turn, so an interrupt is never blocked by
# the turn it is trying to stop.
_CHAT_SESSIONS = {}
_SESSIONS_LOCK = threading.Lock()

# One location sweep at a time: each is 4 `claude` sessions. A second request
# waits, then usually finds the first one's result in the cache.
_LOCATION_LOCK = threading.Lock()

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".jsx": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".pdf": "application/pdf", ".png": "image/png",
    ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".map": "application/json",
}

# Simple GET endpoints -> file under the data dir. Scenarios is special (ETag + PUT).
_FILE_ROUTES = {
    "/api/snapshot": "snapshot.json",
    "/api/benchmarks": "benchmarks.json",
    "/api/taxonomy": "taxonomy.json",
    # Absent from a benchmarks-only data dir; the handler 404s and the Scorecard tab
    # simply does not appear. Same token gate and path-traversal guard as the rest.
    "/api/roster": "roster.json",
    # The equity refresh report. Absent until that sweep has run, and the Refresh
    # planner tab is gated on it the same way.
    "/api/planner": "planner.json",
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


def _close_all_sessions():
    """Reap every ask-box subprocess. Registered on BOTH shutdown paths — normal
    atexit and the watchdog's os._exit, which skips atexit handlers — because a
    missed reap orphans a `claude` process for as long as the machine is up."""
    with _SESSIONS_LOCK:
        sessions = [e["session"] for e in _CHAT_SESSIONS.values()]
        _CHAT_SESSIONS.clear()
    for s in sessions:
        try:
            s.close()
        except Exception:
            pass


def _log_chat_problem(reason, detail=""):
    """Record why a Claude feature failed. The page only ever shows one generic
    message, so this file is where the actual cause can be found later. Never log
    the user's prompt: it can name employees."""
    line = "%s %s%s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), reason,
                        ": " + detail if detail else "")
    print("[serve] claude chat problem — %s" % line, flush=True)
    if DATA_DIR is None:
        return
    try:
        with open(DATA_DIR / CHAT_LOG, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def _set_claude_state(state, reason):
    with _claude_lock:
        _CLAUDE_STATUS.update(state=state, reason=reason)


def _claude_unavailable():
    with _claude_lock:
        return _CLAUDE_STATUS["state"] == "unavailable"


def _refresh_claude_status():
    """Re-find the claude binary and check its login. True when usable.

    Runs at startup, again whenever a feature is asked for while marked
    unavailable (the user may have installed or logged in since), and after a
    failure that might mean they logged out.
    """
    global CLAUDE_BIN
    result = preflight_claude.probe(CLAUDE_BIN)
    ok = result["reason"] == preflight_claude.REASON_OK
    with _claude_lock:
        if result["bin"]:
            CLAUDE_BIN = result["bin"]
        _CLAUDE_STATUS.update(state="available" if ok else "unavailable",
                              reason=result["reason"])
    if not ok:
        _log_chat_problem(result["reason"])
    return ok


def _refresh_claude_status_later():
    threading.Thread(target=_refresh_claude_status, daemon=True).start()


def _start_session(**kwargs):
    """Start a ChatSession, or None if claude cannot be started.

    Retries once after re-finding the binary: a long-lived server can outlive the
    path it was given, because a Claude Code auto-update deletes old versions.
    """
    for attempt in (0, 1):
        sess = chat_session.ChatSession(claude_bin=CLAUDE_BIN, **kwargs)
        try:
            sess.start()
            return sess
        except (OSError, ValueError) as exc:
            if attempt == 0 and _refresh_claude_status():
                continue
            _log_chat_problem("start_failed", str(exc))
            _set_claude_state("unavailable", "start_failed")
            return None
    return None


def _watchdog(httpd, timeout):
    """Self-terminate after `timeout` seconds without API activity (0 = never)."""
    last_tick = time.time()
    while True:
        time.sleep(WATCHDOG_INTERVAL)
        now = time.time()
        # A gap far beyond the sleep interval means the host suspended (laptop
        # sleep), not that the user went idle — the heartbeat simply couldn't be
        # sent. Forgive it: reset and let the next real interval judge idleness.
        if now - last_tick > WATCHDOG_INTERVAL + SUSPEND_GAP_SLACK:
            _touch_heartbeat()
        last_tick = now
        if timeout <= 0:
            continue
        with _hb_lock:
            idle = now - _last_heartbeat
        if idle > timeout:
            print("[serve] idle %ds - shutting down" % int(idle), flush=True)
            _close_all_sessions()  # ask-box subprocesses outlive httpd.shutdown() otherwise
            httpd.shutdown()
            return


def _etag(data):
    return '"%s"' % hashlib.sha1(data).hexdigest()[:16]


def _safe_join(base, rel):
    """Resolve `rel` under `base`, or None if it escapes (path-traversal guard)."""
    p = (base / rel.lstrip("/")).resolve()
    try:
        p.relative_to(base.resolve())
    except ValueError:
        return None
    return p


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "ctc-dashboard"

    def log_message(self, fmt, *args):
        pass  # quiet: the skill surfaces the URL, per-request noise is not useful

    def _token_ok(self, qs):
        supplied = self.headers.get("X-Dash-Token") or (qs.get("t") or [None])[0]
        return bool(TOKEN) and supplied == TOKEN

    def _send(self, code, obj, extra=None):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_file(self, path, extra=None):
        try:
            data = path.read_bytes()
        except OSError:
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

    def _data_json(self, rel):
        p = _safe_join(DATA_DIR, rel)
        if p is None:
            return self._send(403, {"error": "forbidden"})
        if not p.exists():
            # "not_ready" (not 404): a stem the build hasn't published yet is a
            # normal empty state the UI renders as "not available", not an error.
            return self._send(200, {"error": "not_ready"})
        return self._send_file(p)

    # ---- GET ----
    def do_GET(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        path = u.path

        # Static shell (the token gates the data, not the shell).
        if path in ("/", "", "/index.html"):
            return self._send_file(WEB_DIR / "index.html")
        if not path.startswith("/api/"):
            # /src/* is the canonical source tree (served directly, transpiled in
            # the browser); everything else is a committed asset under WEB_DIR.
            if path.startswith("/src/"):
                base, rel = SRC_DIR, path[len("/src"):]
            else:
                base, rel = WEB_DIR, path
            p = _safe_join(base, rel)
            if p is None or not p.exists() or p.is_dir():
                # A request for a file that has an extension but doesn't exist gets a
                # real 404 (so the browser sees a genuine module/asset error, not
                # HTML-parsed-as-a-module garbage). SPA fallback is only for
                # extensionless navigation routes.
                if "." in path.rsplit("/", 1)[-1]:
                    return self._send(404, {"error": "not_found"})
                return self._send_file(WEB_DIR / "index.html")
            return self._send_file(p)

        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        # Any authenticated API activity keeps the server alive, not just the ping.
        _touch_heartbeat()
        if path == "/api/heartbeat":
            return self._send(200, {"ok": True})
        if path == "/api/claude-status":
            with _claude_lock:
                state, reason = _CLAUDE_STATUS["state"], _CLAUDE_STATUS["reason"]
            return self._send(200, {"available": state != "unavailable",
                                    "state": state, "reason": reason})
        if path == "/api/scenarios":
            return self._get_scenarios()
        if path in _FILE_ROUTES:
            return self._data_json(_FILE_ROUTES[path])
        return self._send(404, {"error": "not_found"})

    def do_HEAD(self):
        self.do_GET()

    # ---- SSE (ask box) ----
    def _sse_headers(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        self.close_connection = True  # so the client's read() terminates at stream end

    def _read_json_body(self):
        """Parsed request body, or None when it isn't JSON (caller sends the 400)."""
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 1024 * 1024:
            return None
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return None

    def _ask_interrupt(self, u):
        """Stop the turn in flight without tearing the session down.

        Deliberately does NOT take the session's turn lock: that lock is held for
        the whole in-flight turn, so waiting on it would block in exactly the case
        this endpoint exists to serve. It only needs the registry.
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
        # A turn that ended between the click and this request is already evicted:
        # nothing to stop, and nothing went wrong.
        if entry is None:
            return self._send(404, {"error": "no_session"})
        if not entry["session"].interrupt():
            return self._send(409, {"error": "not_interruptible"})
        return self._send(200, {"ok": True})

    def _ask(self, u):
        """Run one ask-box turn, streaming the subprocess's events back as SSE."""
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        body = self._read_json_body()
        if body is None:
            return self._send(400, {"error": "bad_json"})
        prompt = body.get("prompt")
        prompt = str(prompt).strip() if prompt is not None else ""
        if not prompt:
            return self._send(400, {"error": "empty_prompt"})
        sid = body.get("sessionId") or "default"
        page = body.get("page")

        # Known-broken setup: answer before spawning anything. Re-probe first, in
        # case the user installed or logged in since the page loaded.
        if _claude_unavailable() and not _refresh_claude_status():
            return self._send(503, {"error": CHAT_UNAVAILABLE})

        # Guarded get-or-create. A failed start() is reported as clean JSON
        # *before* any SSE headers go out — a 500 after headers would corrupt the
        # stream and the box would show a parse error instead of the message.
        with _SESSIONS_LOCK:
            entry = _CHAT_SESSIONS.get(sid)
            if entry is None:
                sess = _start_session(cwd=str(SRC_DIR),
                                      add_dirs=[str(SRC_DIR), str(DATA_DIR)])
                if sess is None:
                    return self._send(503, {"error": CHAT_UNAVAILABLE})
                entry = {"session": sess, "lock": threading.Lock()}
                _CHAT_SESSIONS[sid] = entry

        # Single-flight per session: one in-flight turn at a time.
        if not entry["lock"].acquire(blocking=False):
            return self._send(409, {"error": "turn_in_progress"})
        saw_result = False
        edited = False
        client_gone = False
        problem = "no_result"
        try:
            sess = entry["session"]
            self._sse_headers()
            try:
                hint = chat_session.page_hint_for(page)
                sess.send(hint + "\n\n" + prompt if hint else prompt)
                for ev in sess.events(timeout=120):
                    # The browser reloads only after a turn that changed source, so
                    # the flag rides on the terminal frame rather than making the
                    # client re-derive it from the tool_use events.
                    if chat_session.touched_app_source(ev):
                        edited = True
                    if chat_session.is_turn_end(ev):
                        saw_result = True
                        ev = dict(ev, ctcReload=edited)
                        if ev.get("is_error"):
                            # e.g. "Not logged in". The page shows its generic
                            # message; the cause is kept here, and the status is
                            # re-checked so the next page load can say so up front.
                            _log_chat_problem("turn_error", str(ev.get("result") or "")[:300])
                            _refresh_claude_status_later()
                    self.wfile.write(("data: " + json.dumps(ev) + "\n\n").encode())
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                client_gone = True
            except Exception as exc:  # noqa: BLE001 — reported to the page below
                # A poisoned session: the subprocess died before or during the turn.
                saw_result = False
                problem = "turn_failed: %s" % exc
            if not saw_result and not client_gone:
                # Crash, timeout, or EOF without a result frame. Without this the
                # stream just ends and the box would wait on "Working…" forever.
                _log_chat_problem(problem)
                try:
                    self.wfile.write(("data: " + json.dumps(
                        {"type": "ctc_error", "error": CHAT_UNAVAILABLE}) + "\n\n").encode())
                    self.wfile.flush()
                except OSError:
                    pass
        finally:
            entry["lock"].release()
            if not saw_result:
                # Timeout, EOF-without-result, or an exception above: late buffered
                # events could bleed into the next turn, so evict rather than reuse.
                sess = entry["session"]
                with _SESSIONS_LOCK:
                    if _CHAT_SESSIONS.get(sid) is entry:
                        del _CHAT_SESSIONS[sid]
                sess.close()

    # ---- POST (ask box, desktop handoff) ----
    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/ask":
            return self._ask(u)
        if u.path == "/api/ask/interrupt":
            return self._ask_interrupt(u)
        if u.path == "/api/handoff":
            return self._handoff(u)
        if u.path == "/api/filter":
            return self._filter(u)
        if u.path == "/api/location":
            return self._location(u)
        return self._send(404, {"error": "not_found"})

    def _location(self, u):
        """One location's benchmarks: from the cache, or fetched from Carta now.

        Every failure is a 200 with {"error": <reason>}, like /api/filter: the page
        says the location couldn't be fetched and keeps showing what it had.
        """
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        body = self._read_json_body()
        if not isinstance(body, dict) or not isinstance(body.get("location"), str):
            return self._send(400, {"error": "bad_json"})
        try:
            config = json.loads((DATA_DIR / "location_fetch.json").read_text("utf-8"))
            bench = json.loads((DATA_DIR / "benchmarks.json").read_text("utf-8"))
        except (OSError, ValueError):
            return self._send(200, {"error": "not_supported"})

        # Only what the build offered: a catalog location and a known peer group.
        entry = next((c for c in bench.get("locationCatalog") or []
                      if c.get("location") == body["location"]), None)
        if entry is None:
            return self._send(400, {"error": "unknown_location"})
        own = config.get("ownPeerGroup")
        peer = body.get("peerGroup") or own
        bucket_param = (config.get("peerGroups") or {}).get(peer)
        if not bucket_param:
            return self._send(400, {"error": "unknown_peer_group"})
        # A US location has nothing to convert; one cache entry serves both.
        local = bool(body.get("localCurrency")) and bool(entry.get("international"))
        key = location_fetch.cache_key(entry["location"], local)
        if peer != own:
            key += "--" + location_fetch.cache_key(peer, False)

        hit = location_fetch.cached(DATA_DIR, key)
        if hit is not None:
            return self._send(200, hit)
        if _claude_unavailable() and not _refresh_claude_status():
            return self._send(200, {"error": CHAT_UNAVAILABLE})
        with _LOCATION_LOCK:
            hit = location_fetch.cached(DATA_DIR, key)
            if hit is not None:
                return self._send(200, hit)
            fetch_config = dict(config, bucketParam=bucket_param, bucketCode=peer)
            try:
                result = location_fetch.fetch(DATA_DIR, CLAUDE_BIN, fetch_config, entry,
                                              local, key=key)
            except location_fetch.FetchError as exc:
                if exc.reason == "start_failed":
                    _refresh_claude_status_later()
                return self._send(200, {"error": exc.reason})
            except Exception as exc:  # noqa: BLE001 — reported to the page as a failure
                location_fetch.log(DATA_DIR, "failed %s: %s" % (entry["location"], exc))
                return self._send(200, {"error": "fetch_failed"})
        return self._send(200, result)

    def _filter(self, u):
        """Ask Claude for a cohort predicate. Returns JSON, never a stream.

        Unlike /api/ask this is one question with one answer, so there is nothing
        to stream and no session to keep: the subprocess is started, asked, and
        reaped. It also gets NO TOOLS — it only has to emit a JSON object, and a
        session that cannot read a file cannot leak one.

        The reply is a candidate, not a filter. model/predicate.js validates it in
        the browser before anything is evaluated, so a malformed predicate is
        refused rather than applied.
        """
        qs = parse_qs(u.query)
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()

        body = self._read_json_body()
        if body is None or not isinstance(body, dict):
            return self._send(400, {"error": "bad_json"})
        phrase = body.get("phrase")
        if not isinstance(phrase, str) or not phrase.strip():
            return self._send(400, {"error": "empty_phrase"})

        vocabulary = body.get("vocabulary")
        if not isinstance(vocabulary, dict):
            vocabulary = {}

        # Every failure below is a 200 with {"error": CHAT_UNAVAILABLE}, not a 500:
        # the browser's job on any failure is to say nothing was filtered, and it
        # owns the wording. A refusal is different — Claude answered, but could
        # not express the phrase — and keeps its own message.
        if _claude_unavailable() and not _refresh_claude_status():
            return self._send(200, {"error": CHAT_UNAVAILABLE})
        session = _start_session(
            cwd=str(DATA_DIR),
            add_dirs=[],
            # An empty tool set, not the app-editing one.
            allowed_tools="",
            system_prompt=predicate_session.system_prompt(),
        )
        if session is None:
            return self._send(200, {"error": CHAT_UNAVAILABLE})
        try:
            session.send(predicate_session.build_request(phrase, vocabulary))
            text = []
            ended = failed = False
            for event in session.events(timeout=90):
                chunk = chat_session.event_text(event)
                if chunk:
                    text.append(chunk)
                if chat_session.is_turn_end(event):
                    ended = True
                    failed = bool(event.get("is_error"))
                    break
            if failed:
                # e.g. "Not logged in" — its text arrives as an ordinary assistant
                # message, so parsing it as a predicate would misreport the cause.
                _log_chat_problem("filter_turn_error", str(event.get("result") or "")[:300])
                _refresh_claude_status_later()
                return self._send(200, {"error": CHAT_UNAVAILABLE})
            if not ended:
                _log_chat_problem("filter_no_result")
                return self._send(200, {"error": CHAT_UNAVAILABLE})
            return self._send(200, predicate_session.parse_reply("".join(text)))
        except Exception as exc:  # noqa: BLE001 — reported to the page as unavailable
            _log_chat_problem("filter_failed", str(exc))
            return self._send(200, {"error": CHAT_UNAVAILABLE})
        finally:
            session.close()

    def _handoff(self, u):
        """Write the plan where Claude Desktop can read it, and open a session.

        The browser can do neither: it cannot write a file outside a download, and
        it cannot open a claude:// URL reliably from a fetch. So the console asks
        the server, which is already local and already trusted with the data dir.

        Every failure returns a reason rather than a bare 500, because the caller
        falls back to the clipboard and tells the user which route it took. A
        handoff that looks like it worked and did not is the one outcome worse than
        asking for a paste.
        """
        qs = parse_qs(u.query)
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()

        body = self._read_json_body()
        if body is None or not isinstance(body, dict):
            return self._send(400, {"error": "bad_json"})
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            return self._send(400, {"error": "empty_prompt"})

        try:
            result = desktop_handoff.hand_off(
                prompt,
                corporation=body.get("corporation"),
                employees=int(body.get("employees") or 0),
                total_shares=body.get("totalShares"),
            )
        except FileNotFoundError as exc:
            # Desktop is not configured for the file route on this machine. A normal
            # state on someone else's laptop, not an error worth a stack trace.
            return self._send(200, {"ok": False, "reason": "no_directory",
                                    "detail": str(exc)})
        except Exception as exc:  # noqa: BLE001 — the fallback needs a reason, not a crash
            return self._send(200, {"ok": False, "reason": "failed",
                                    "detail": str(exc)})
        return self._send(200, {"ok": True, **result})

    # ---- PUT (local scenario save) ----
    def do_PUT(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        if u.path != "/api/scenarios":
            return self._send(404, {"error": "not_found"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 8 * 1024 * 1024:
            return self._send(413, {"error": "payload_too_large"})
        raw = self.rfile.read(length) if length else b"{}"
        try:
            json.loads(raw.decode("utf-8"))  # validate
        except ValueError:
            return self._send(400, {"error": "bad_json"})
        with _scenarios_lock:
            p = DATA_DIR / "scenarios.json"
            if_match = self.headers.get("If-Match")
            if if_match and p.exists():
                current = _etag(p.read_bytes())
                if if_match.strip() != current:
                    # Another tab saved first — the client refetches and retries
                    # rather than silently clobbering that write.
                    return self._send(409, {"error": "conflict"})
            tmp = p.with_suffix(".json.tmp")
            tmp.write_bytes(raw)
            os.replace(tmp, p)  # atomic: a crash mid-write can't truncate the file
            return self._send(200, {"ok": True}, extra={"ETag": _etag(raw)})

    def _get_scenarios(self):
        p = DATA_DIR / "scenarios.json"
        if not p.exists():
            return self._send(200, {"error": "not_ready"})
        data = p.read_bytes()
        return self._send_file(p, extra={"ETag": _etag(data)})


class _Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def _load_or_make_token(token_file):
    """Reuse this corp's persisted token so relaunches keep the same URL.

    Falls back to a fresh random token on first launch or an unreadable file.
    """
    try:
        prev = token_file.read_text().strip()
        if prev:
            return prev
    except OSError:
        pass
    return secrets.token_urlsafe(18)


def _get_previously_used_port(port_file):
    """The port this corp last bound (persisted in its data dir), or 0 if unusable."""
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
    """True if a corp's server already answers on `port` (token-gated heartbeat)."""
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


def _detach_or_warn():
    """Daemonize so the server outlives the launching shell. No-op where unavailable."""
    if not hasattr(os, "fork"):
        print("[serve] --detach unsupported on this platform; staying in foreground", flush=True)
        return
    if os.fork() > 0:
        os._exit(0)  # parent returns immediately
    os.setsid()
    if os.fork() > 0:
        os._exit(0)  # ensure the daemon can never reacquire a controlling terminal


def main():
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN, CLAUDE_BIN
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir", default=str(Path(__file__).resolve().parent.parent / "webapp"))
    ap.add_argument("--src-dir", default=None,
                    help="canonical source tree served at /src/* (default: <web-dir>/../app/src)")
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "0")))
    ap.add_argument("--no-open", action="store_true")
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
        help="absolute path to the claude CLI binary for the ask box (default: found "
             "the same way as preflight_claude.py, including the launching Claude "
             "Code session's own binary)",
    )
    args = ap.parse_args()

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    canonical_src = WEB_DIR.parent / "app" / "src"
    CLAUDE_BIN = args.claude_bin
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    port_file = DATA_DIR / ".port"
    token_file = DATA_DIR / ".token"

    # Stable URL per corp: reuse the token + port remembered in this corp's data
    # dir so relaunching the same corp reopens the same URL. An explicit --port
    # (or PORT env) still wins over the remembered one.
    TOKEN = _load_or_make_token(token_file)
    preferred_port = args.port or _get_previously_used_port(port_file)

    # Reuse a corp's live daemon rather than start a duplicate sharing its scenarios.json.
    if not args.port and _probe_instance(preferred_port, TOKEN):
        url = _build_dashboard_url(preferred_port, TOKEN)
        print("[serve] ctc-dashboard already running at %s" % url, flush=True)
        if not args.no_open:
            _open_link_in_browser(url)
        return

    # After the reuse check: refreshing the copy under a live daemon could swap files
    # while its ask box is mid-edit.
    SRC_DIR = (Path(args.src_dir).resolve() if args.src_dir
               else _prepare_working_src(canonical_src, DATA_DIR))
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
    print("[serve] ctc-dashboard at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)
    print("[serve] web-dir:  %s%s" % (
        WEB_DIR, "" if (WEB_DIR / "vendor").exists() else "  (vendor missing — run `npm run build`)"), flush=True)
    print("[serve] src-dir:  %s%s" % (SRC_DIR, "" if SRC_DIR.exists() else "  (missing)"), flush=True)
    print("[serve] idle-timeout: %s" % ("disabled" if idle_timeout <= 0 else "%ds" % idle_timeout), flush=True)

    if not args.no_open:
        _open_link_in_browser(url)

    # Fork before starting the watchdog thread — threads don't survive fork.
    if args.detach:
        _detach_or_warn()

    # Registered after the fork: atexit handlers registered in the parent would
    # fire when the parent exits, reaping nothing and hiding the real one.
    atexit.register(_close_all_sessions)

    threading.Thread(target=_watchdog, args=(httpd, idle_timeout), daemon=True).start()
    # Also after the fork, for the same reason as the watchdog. In the background
    # so the page loads at once; it reads "checking" until this lands.
    _refresh_claude_status_later()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
