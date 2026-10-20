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
  - Add fixed-name routes to _FILE_ROUTES (e.g. "/api/snapshot": "snapshot.json") for
    files your app always expects.
  - For anything else, the generic `/api/report/<name>.json` route already serves any
    safe `<name>.json` your skill writes to the data dir — most microapps don't need
    fixed routes at all beyond that.
  - If your app needs a writable document (e.g. a saved scenario/portfolio file with
    optimistic-concurrency PUT), see the `do_PUT`/`_get_portfolio`-style pattern in
    carta-investors' fund-modeling or investor-dashboard `scripts/serve.py` for a
    worked ETag example — this template ships read-only routes only.
"""

import argparse
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

import manco_paths
import report_store
import share_bridge
import share_ops
import sync_src

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
SHARE_MCP_SERVER = None  # --share-mcp-server / MANCO_SHARE_MCP_SERVER: the one Carta connector sharing may use
# Budget reports and sharing (/api/reports*) answer unless MANCO_REPORT_SHARING=0.
# Off, those routes 404 and the app shows no report controls.
REPORT_SHARING_ENV = "MANCO_REPORT_SHARING"
REPORT_SHARING = True
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
_bridge_lock = threading.Lock()
IDLE_TIMEOUT_DEFAULT = 86400  # 24h backstop; should never fire during active use
WATCHDOG_INTERVAL = 10
SUSPEND_GAP_SLACK = 55
_last_heartbeat = time.time()
_hb_lock = threading.Lock()

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

# Fixed-name GET endpoints -> file under the data dir. Add your app's known files
# here; anything else falls through to the generic /api/report/<name>.json route.
_FILE_ROUTES = {
    "/api/snapshot": "snapshot.json",
    "/api/accounts": "accounts.json",
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


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


def _read_carta_environment(data_dir):
    """This firm's cached snapshot.cartaEnvironment ("production" or
    "nonprod"), served to the tracker and deciding which Carta connectors
    report sharing may use. Defaults to "production" on any
    read/parse failure or a pre-upgrade cache built before this field
    existed — an unclassified build is far more likely real production
    usage than a staff test session."""
    try:
        data = json.loads((data_dir / "snapshot.json").read_text())
        return data.get("cartaEnvironment") or "production"
    except (OSError, ValueError):
        return "production"


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


def _rebuild():
    """Re-run the build the way the skill last ran it → (ok, message), one at a time."""
    import build_manco_datadir  # only needed for writes; keeps a read-only launch light
    with _rebuild_lock:
        return build_manco_datadir.rebuild(DATA_DIR, timeout=REBUILD_TIMEOUT)


def _reports_listing():
    store = report_store.ReportStore(DATA_DIR)
    doc = store.load()
    return {
        "reports": [dict(report_store.ReportStore.metadata(r), hidden=bool(r.get("hidden")))
                    for r in doc["reports"]],
        "share_target": share_bridge.describe_target(_read_carta_environment(DATA_DIR), SHARE_MCP_SERVER),
    }, store.etag()


def _get_bridge():
    global _bridge
    with _bridge_lock:
        if _bridge is None:
            _bridge = share_bridge.Bridge(str(DATA_DIR), _read_carta_environment(DATA_DIR), override=SHARE_MCP_SERVER)
        return _bridge


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
        bridge = _get_bridge()
        store = report_store.ReportStore(DATA_DIR)
        if op == "users":
            result = {"status": "ok", **share_ops.shareable_users(bridge, DATA_DIR, emit,
                                                                 refresh=bool(params.get("refresh")))}
        elif op == "share":
            result = share_ops.share(bridge, store, DATA_DIR, params["report_id"],
                                     params.get("shared_with"), emit, force=bool(params.get("force")),
                                     people=params.get("people"), updating=bool(params.get("updating")))
        elif op == "publish-as-new":
            result = share_ops.publish_as_new(bridge, store, DATA_DIR, params["report_id"],
                                              params.get("shared_with"), emit, people=params.get("people"))
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


_REPORT_ACTION_RE = re.compile(r"^/api/reports/([A-Za-z0-9_.-]{1,160})/(rename|duplicate|hide|unlink|remove)$")


def report_sharing_enabled(environ):
    return environ.get(REPORT_SHARING_ENV, "1") != "0"


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
                "environment": _read_carta_environment(DATA_DIR),
                "userId": _read_user_id(DATA_DIR),
            })
        if path == "/api/reports" and REPORT_SHARING:
            listing, etag = _reports_listing()
            return self._send(200, listing, extra={"ETag": etag})
        if path == "/api/reports/share-status" and REPORT_SHARING:
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
        if not REPORT_SHARING:
            return self._send(404, {"error": "not_found"})
        body, bad = self._read_json_body()
        if bad:
            return self._send(bad, {"error": "payload_too_large" if bad == 413 else "bad_json"})
        if u.path == "/api/reports/share-op":
            return self._share_op(body)
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

    def _report_action(self, report_id, action, body):
        """One change to a local report, then a rebuild so the app shows it."""
        import build_manco_datadir  # only needed for writes; keeps a read-only launch light
        store = report_store.ReportStore(DATA_DIR)
        expected = self.headers.get("If-Match")
        try:
            if action == "rename":
                result = store.rename(report_id, body.get("name"), expected_etag=expected)
            elif action == "duplicate":
                result = store.duplicate(
                    report_id,
                    copy_mapping=lambda rows, src, dst: build_manco_datadir.copy_budget_mapping(
                        DATA_DIR, rows, src, dst),
                    expected_etag=expected)
            elif action == "hide":
                result = store.set_hidden(report_id, bool(body.get("hidden", True)), expected_etag=expected)
            elif action == "unlink":
                result = store.clear_shared(report_id, expected_etag=expected)
            else:
                store.remove(report_id, expected_etag=expected)
                result = {"id": report_id, "removed": True}
        except report_store.ReportEditError as e:
            status = {"conflict": 409, "not_found": 404, "read_only": 403, "busy": 409}.get(e.code, 400)
            return self._send(status, {"error": e.code, "message": str(e)})
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
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN, SHARE_MCP_SERVER, REPORT_SHARING
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
    args = ap.parse_args()
    SHARE_MCP_SERVER = args.share_mcp_server or os.environ.get(share_bridge.SERVER_ENV)
    REPORT_SHARING = report_sharing_enabled(os.environ)

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SRC_DIR = Path(args.src_dir).resolve() if args.src_dir else _default_src_dir(DATA_DIR, WEB_DIR)
    # Before the reuse probe: a relaunch onto a live daemon must still refresh the id it serves.
    _write_user_id(DATA_DIR, args.user_id)

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

    if REPORT_SHARING:
        targets = share_bridge.candidate_servers(_read_carta_environment(DATA_DIR), SHARE_MCP_SERVER)
        print("[serve] report sharing uses Carta connector(s): %s%s" % (
            ", ".join(targets), " (pinned)" if SHARE_MCP_SERVER else ""), flush=True)
    threading.Thread(target=_watchdog, args=(httpd, idle_timeout), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
