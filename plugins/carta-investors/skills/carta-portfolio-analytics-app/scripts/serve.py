#!/usr/bin/env python3
"""
Carta Portfolio Analytics local server (React source tree + Fund Admin JSON).

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
"""

import argparse
import hashlib
import http.client
import http.server
import importlib.util as _ilu
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


def _sibling(name):
    """Load a sibling script by absolute path — never via sys.path, so a same-named
    script from another skill can't shadow it."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = _ilu.spec_from_file_location("_pa_" + name, p)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_datasets = _sibling("datasets")
refresh = _sibling("refresh")

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
_portfolio_lock = threading.Lock()

# Single-flight background refresh: _refresh_lock guards the raw-only fetch; _build_lock
# guards the rebuild+swap and blocks portfolio PUT for that stretch. _refresh_state is polled.
_refresh_lock = threading.Lock()
_build_lock = threading.Lock()
_refresh_state = {"status": "idle"}
_refresh_state_lock = threading.Lock()
_refresh_session = None

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
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


def _kpi_source():
    """This firm's kpi.json source dict, or {} — read per call so a refresh is reflected."""
    try:
        with open(DATA_DIR / "kpi.json") as fh:
            return (json.load(fh) or {}).get("source") or {}
    except (OSError, ValueError):
        return {}


def _refresh_supported():
    """The in-app refresh can run only with a claude binary on PATH and a firm-id'd cache."""
    claude_bin = os.environ.get("PORTFOLIO_ANALYTICS_CLAUDE_BIN", "claude")
    return shutil.which(claude_bin) is not None and bool(_kpi_source().get("firmUuid"))


_SINCE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# A refresh filter can name at most this many companies; the picker never sends more,
# and the cap keeps a hostile body from queuing an oversized resolution.
_MAX_COMPANIES = 2000
# kpi.json company ids are short opaque keys; anything longer is not one of ours.
_MAX_COMPANY_ID_LEN = 200


def _parse_filters(body):
    """(since, companies, error) from a refresh body. `since` is a YYYY-MM-DD string or
    None; `companies` is a list of kpi.json company ids or None — refresh.py resolves
    them to warehouse identity values, so no user string ever reaches SQL. `error` is a
    non-empty error code when the body is malformed (the values are then meaningless)."""
    since = body.get("since")
    if since is not None and (not isinstance(since, str) or not _SINCE_RE.match(since)):
        return None, None, "bad_since"
    raw = body.get("companies")
    if raw is None:
        return since, None, None
    if not isinstance(raw, dict) or not isinstance(raw.get("ids", []), list):
        return None, None, "bad_companies"
    ids = raw.get("ids") or []
    if not all(isinstance(v, str) and 0 < len(v) <= _MAX_COMPANY_ID_LEN for v in ids):
        return None, None, "bad_companies"
    if len(ids) > _MAX_COMPANIES:
        return None, None, "too_many_companies"
    return since, (ids or None), None


def _set_refresh_state(**fields):
    with _refresh_state_lock:
        _refresh_state.update(fields)


def _refresh_progress(phase, message, **extra):
    """emit() for a background refresh: fold progress into _refresh_state (polled by the
    browser) and touch the heartbeat so a long fetch isn't reaped as idle."""
    with _refresh_state_lock:
        _refresh_state["phase"] = phase
        _refresh_state["progress"] = message
        if phase == "issue":
            _refresh_state.setdefault("warnings", []).append(message)
        if "step" in extra:
            _refresh_state["step"] = extra["step"]
        if "total" in extra:
            _refresh_state["total"] = extra["total"]
        # Per-stem staging: which stems are fetching now, and which have finished, so the
        # client can settle each dataset independently during a refresh-all.
        if "active" in extra:
            _refresh_state["activeStems"] = list(extra["active"])
        for s in extra.get("completed", []):
            done = _refresh_state.setdefault("doneStems", [])
            if s not in done:
                done.append(s)
    _touch_heartbeat()


def _track_refresh_session(session):
    global _refresh_session
    with _refresh_state_lock:
        _refresh_session = session


def _close_refresh_session():
    """Reap an in-flight refresh subprocess so idle shutdown doesn't orphan it."""
    with _refresh_state_lock:
        session = _refresh_session
    if session is not None:
        try:
            session.close()
        except Exception:  # noqa: BLE001 — best-effort on the way out
            pass


def _run_refresh_bg():
    """Fetch into the raw dir on a daemon thread; the build+swap waits for /api/refresh/apply.
    Releases _refresh_lock in finally — its only other release path."""
    try:
        with _refresh_state_lock:
            target = _refresh_state.get("target")  # dataset keys, or None for all
            since = _refresh_state.get("since")
            companies = _refresh_state.get("companies")
        result = refresh.run_fetch(str(DATA_DIR), _refresh_progress, stems=target,
                                   on_session=_track_refresh_session,
                                   since_override=since, companies=companies)
        _set_refresh_state(status="fetched", progress=None, warnings=result.get("warnings", []),
                           companyWarnings=result.get("companyWarnings", []),
                           selectedCount=result.get("selectedCount"),
                           filterSince=result.get("filterSince"))
    except refresh.RefreshError as e:
        _set_refresh_state(status="error", progress=None, message=str(e),
                           detail=e.detail, needs_human=e.needs_human)
    except Exception as e:  # noqa: BLE001 — a bg thread must never crash silently
        _set_refresh_state(status="error", progress=None,
                           message="The refresh didn't finish.", detail=str(e), needs_human=True)
    finally:
        _refresh_lock.release()


def _start_refresh_bg(target, since=None, companies=None):
    with _refresh_state_lock:
        _refresh_state.clear()
        _refresh_state.update({"status": "running", "phase": "preflight",
                               "startedAt": time.time(), "target": target, "warnings": [],
                               "since": since, "companies": companies,
                               "activeStems": [], "doneStems": []})
    threading.Thread(target=_run_refresh_bg, daemon=True).start()


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
        with _hb_lock:
            idle = now - _last_heartbeat
        if idle > timeout:
            print("[serve] idle %ds - shutting down" % int(idle), flush=True)
            _close_refresh_session()
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

        # static app shell (token gates the data, not the shell)
        if path == "/" or path == "/index.html" or path == "":
            return self._send_file(WEB_DIR / "index.html")
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
                # extensionless navigation routes (e.g. /firm/<slug>/).
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
        if path == "/api/telemetry-context":
            # Read per request, not at startup: a refresh rewrites kpi.json, and a
            # firmId it resolves late should reach the tracker without a relaunch.
            return self._send(
                200,
                {
                    "environment": _read_carta_environment(DATA_DIR),
                    "firmId": _read_firm_id(DATA_DIR),
                    "userId": _read_user_id(DATA_DIR),
                },
            )
        if path == "/api/refresh/status":
            with _refresh_state_lock:
                return self._send(200, dict(_refresh_state))
        if path == "/api/capabilities":
            return self._send(200, {"refresh": _refresh_supported()})
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
        if _build_lock.locked():  # a rebuild is swapping kpi.json — don't race a portfolio save
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

    # ---- POST (refresh control) ----
    def do_POST(self):
        u = urlparse(self.path)
        if not self._token_ok(parse_qs(u.query)):
            return self._send(401, {"error": "unauthorized"})
        _touch_heartbeat()
        if u.path == "/api/refresh":
            return self._refresh()
        if u.path == "/api/refresh/apply":
            return self._refresh_apply()
        return self._send(404, {"error": "not_found"})

    def _body_json(self):
        """Parse the (size-capped) request body as JSON, or {} when empty/invalid."""
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > 1 * 1024 * 1024:
            return None
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return None

    def _refresh(self):
        """Start a background fetch (single-flight) and return 202; the browser polls
        GET /api/refresh/status. Body {} refreshes all datasets; {"datasets":[keys]} a subset."""
        body = self._body_json()
        if body is None or not isinstance(body, dict):
            return self._send(400, {"error": "bad_json"})
        target = body.get("datasets")
        if target is not None:
            if not isinstance(target, list) or not target or \
                    any(k not in _datasets._KEYS for k in target):
                return self._send(400, {"error": "unknown_dataset"})
        since, companies, err = _parse_filters(body)
        if err:
            return self._send(400, {"error": err})
        if _build_lock.locked():
            return self._send(409, {"error": "apply_in_progress"})
        if not _refresh_lock.acquire(blocking=False):
            return self._send(409, {"error": "refresh_in_progress"})
        # A staged-but-unloaded fetch must not be clobbered by a new one. Check state (not a
        # lock peek) so it can't race _refresh_apply's status->build_lock transition.
        with _refresh_state_lock:
            staged = _refresh_state.get("status") == "fetched"
        if staged:
            _refresh_lock.release()
            return self._send(409, {"error": "refresh_in_progress"})
        try:
            _start_refresh_bg(target, since, companies)
        except Exception as e:  # noqa: BLE001 — release the lock or every later refresh 409s
            _refresh_lock.release()
            _set_refresh_state(status="error", progress=None,
                               message="Couldn't start the refresh: %s" % e, needs_human=True)
            return self._send(500, {"error": "refresh_start_failed"})
        return self._send(202, {"ok": True})

    def _refresh_apply(self):
        """Build + swap the staged raw into kpi.json (the user's "Load new data"). _build_lock
        blocks portfolio PUT for the build."""
        with _refresh_state_lock:
            ready = _refresh_state.get("status") == "fetched"
        if not ready:
            return self._send(409, {"error": "nothing_to_apply"})
        if _refresh_lock.locked():  # a fetch is rewriting raw — building it would tear
            return self._send(409, {"error": "refresh_in_progress"})
        if not _build_lock.acquire(blocking=False):
            return self._send(409, {"error": "apply_in_progress"})
        try:
            result = refresh.run_build(str(DATA_DIR), lambda *a, **k: _touch_heartbeat(),
                                       build_lock=None)  # _build_lock already held here
            _set_refresh_state(status="idle")
            return self._send(200, {"ok": True, "builtAt": result.get("builtAt")})
        except refresh.RefreshError as e:
            return self._send(500, {"error": "build_failed", "message": str(e),
                                    "detail": e.detail, "needs_human": e.needs_human})
        except Exception as e:  # noqa: BLE001
            return self._send(500, {"error": "build_failed", "message": "The rebuild didn't finish.",
                                    "detail": str(e), "needs_human": True})
        finally:
            _build_lock.release()

    # ---- portfolio GET with ETag ----
    def _get_portfolio(self):
        p = DATA_DIR / "portfolio.json"
        if not p.exists():
            return self._send(200, {"error": "not_ready"})
        data = p.read_bytes()
        return self._send_file(p, extra={"ETag": _etag(data)})


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
    """This firm's cached kpi.json source.cartaEnvironment ("production" or
    "nonprod"), served to the browser so the tracker knows which Snowplow
    collector to use. Defaults to "production" on any read/parse failure or on an
    older cache built before this field existed — this is a customer-facing
    plugin, so an unclassified build is far more likely real production usage
    than a staff test session; staff noise is filterable downstream."""
    try:
        data = json.loads((data_dir / "kpi.json").read_text())
        return (data.get("source") or {}).get("cartaEnvironment") or "production"
    except (OSError, ValueError):
        return "production"


def _read_firm_id(data_dir):
    """Served to the browser so Snowplow events key on the real Carta id, not a slugified firm
    name. None when the cache has no usable id — the context is dropped, never faked."""
    try:
        data = json.loads((data_dir / "kpi.json").read_text())
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
    ap.add_argument("--user-id", default=None,
                    help="launching user's integer Carta id, recorded for telemetry (.user-id)")
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
        print("[serve] portfolio-analytics already running at %s" % url, flush=True)
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
    print("[serve] portfolio-analytics at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)
    print("[serve] web-dir:  %s%s" % (WEB_DIR, "" if (WEB_DIR / "vendor").exists() else "  (vendor missing — webapp/vendor/* are checked-in prebuilt files; restore them from source control)"), flush=True)
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
