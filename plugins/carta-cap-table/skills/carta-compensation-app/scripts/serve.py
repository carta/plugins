#!/usr/bin/env python3
"""
ctc-dashboard local server (React source tree + Carta Total Compensation JSON).

Serves the committed app shell (--web-dir, webapp/) plus the canonical source tree
(--src-dir, ../app/src) at /src/* — transpiled in-browser by a service worker — and
the JSON the skill wrote to a data dir, plus an editable scenarios document
(GET with ETag / PUT with If-Match).
Python stdlib only — no third-party deps — so it runs for non-developers at runtime.

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

The browser NEVER calls the Carta MCP — it only reads JSON the skill produced.
This app is READ-ONLY with respect to Carta: the sole write path is the local
scenarios save (PUT /api/scenarios), which never leaves this machine.

Ported from carta-fund-modeling/scripts/serve.py, minus its chat/SSE layer.

Usage:
  uv run serve.py --data-dir <dir> [--web-dir <webapp>] [--port N] [--no-open]
"""

import argparse
import hashlib
import http.client
import http.server
import json
import os
import re
import secrets
import socketserver
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
IDLE_TIMEOUT_DEFAULT = 28800  # 8h backstop; should never fire during active use
# Watchdog cadence, and the slack above it that distinguishes a real suspend
# (laptop sleep) from ordinary scheduling jitter — a gap beyond the sum is sleep.
WATCHDOG_INTERVAL = 10
SUSPEND_GAP_SLACK = 55
_last_heartbeat = time.time()
_hb_lock = threading.Lock()
_scenarios_lock = threading.Lock()

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
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


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
        if path == "/api/scenarios":
            return self._get_scenarios()
        if path in _FILE_ROUTES:
            return self._data_json(_FILE_ROUTES[path])
        return self._send(404, {"error": "not_found"})

    def do_HEAD(self):
        self.do_GET()

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
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN
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
    args = ap.parse_args()

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    SRC_DIR = Path(args.src_dir).resolve() if args.src_dir else (WEB_DIR.parent / "app" / "src")
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

    threading.Thread(target=_watchdog, args=(httpd, idle_timeout), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
