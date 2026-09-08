#!/usr/bin/env python3
"""
manco-reporting local server (React app shell + live source + JSON data dir).

Serves three things: the app shell and vendored runtime from --web-dir (webapp/),
the canonical React source from --src-dir (app/src) at /src/*, transpiled in the
browser by webapp/sw.js, and whatever JSON the owning skill wrote to a data dir.
Python stdlib only — no third-party deps — so it runs for non-developers at
runtime with no install step.

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
  python3 serve.py --data-dir <dir> [--web-dir <webapp>] [--src-dir <app/src>]
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

DATA_DIR = None
WEB_DIR = None
SRC_DIR = None
TOKEN = None
HEARTBEAT_TIMEOUT = 1800
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


def _watchdog(httpd):
    last_tick = time.time()
    while True:
        time.sleep(WATCHDOG_INTERVAL)
        now = time.time()
        if now - last_tick > WATCHDOG_INTERVAL + SUSPEND_GAP_SLACK:
            _touch_heartbeat()
            last_tick = now
            continue
        last_tick = now
        with _hb_lock:
            idle = now - _last_heartbeat
        if idle > HEARTBEAT_TIMEOUT:
            print("[serve] idle %ds - shutting down" % int(idle), flush=True)
            httpd.shutdown()
            os._exit(0)


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
    "nonprod"), served to the tracker. Defaults to "production" on any
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


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _token_ok(self, qs):
        supplied = self.headers.get("X-Dash-Token") or (qs.get("t", [None])[0])
        return supplied == TOKEN

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
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
            # makes an edit to app/src visible on a refresh, with no build step that
            # could be forgotten and leave the page correct-looking but stale.
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


def _bind(preferred_port):
    try:
        return _Server(("127.0.0.1", preferred_port), Handler), False
    except OSError:
        if preferred_port:
            print("[serve] port %d busy - using a random port" % preferred_port, flush=True)
            return _Server(("127.0.0.1", 0), Handler), True
        raise


def main():
    global DATA_DIR, WEB_DIR, SRC_DIR, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir", default=str(Path(__file__).resolve().parent.parent / "webapp"))
    ap.add_argument(
        "--src-dir",
        default=None,
        help="canonical source tree served at /src/* (default: <web-dir>/../app/src)",
    )
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "0")))
    ap.add_argument("--no-open", action="store_true")
    # Not type=int: a malformed id must degrade to "no user", not fail the launch.
    ap.add_argument(
        "--user-id",
        default=None,
        help="integer Carta id of the launching user, for the browser's Snowplow tracker; "
        "omit when unknown",
    )
    args = ap.parse_args()

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    SRC_DIR = Path(args.src_dir).resolve() if args.src_dir else (WEB_DIR.parent / "app" / "src")
    DATA_DIR.mkdir(parents=True, exist_ok=True)
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

    url = "http://127.0.0.1:%d/?t=%s" % (port, TOKEN)
    print("[serve] manco-reporting at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)
    print("[serve] web-dir:  %s%s" % (WEB_DIR, "" if (WEB_DIR / "vendor").exists() else "  (vendor missing — run `npm run build` in app/)"), flush=True)
    # An unknown path falls through to the SPA shell, so a missing tracker answers 200
    # with HTML and the browser silently drops every UI event.
    if not (WEB_DIR / "vendor" / "mcp-ui-tracker.global.js").exists():
        print("[serve] WARNING: vendor/mcp-ui-tracker.global.js missing — no telemetry will be sent", flush=True)
    print("[serve] src-dir:  %s%s" % (SRC_DIR, "" if SRC_DIR.exists() else "  (missing)"), flush=True)

    threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
    _maybe_open_browser(url, args.no_open)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
