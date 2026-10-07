# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Local preview server for the portfolio valuations dashboard (Claude Code Desktop).

Renders the dashboard HTML on demand from a small pre-classified JSON payload
file and exposes a POST /run endpoint so the in-panel "Run valuations" button
can hand a company selection back to the Claude session. The runner is shown as
a widget (see references/cowork-artifact.md) on both Cowork and Code Desktop, so
it is no longer served here.

Claude writes the raw portfolio_valuations:list:portfolio_dashboard response to
dashboard-data.json.  The server calls build_payload() to classify it and
fill_template() to render HTML on each request, so Claude never needs to
pre-classify or pre-build static HTML files.  After every run or chat-driven
mutation Claude rewrites dashboard-data.json and calls window.location.reload()
so the panel reflects the latest state.

Binds to 127.0.0.1 only — intended for local dev sessions. Shuts itself down
after an idle period so it never lingers as an orphaned process.

Conventions (all resolved relative to the process cwd, which is the project root
when launched via .claude/launch.json):
  - reads   .claude/preview/dashboard-data.json  (raw API response written by Claude)
  - writes  .claude/preview/run-request.json     (on button click)

Env:
  PORT  port to bind. Injected by the Claude Preview host when launch.json sets
        `autoPort: true` (the host picks a free port). Falls back to PV_PREVIEW_PORT,
        then 7459, for manual / non-Desktop runs.
"""
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_artifact import fill_template  # noqa: E402

# Template paths — resolved once at startup.
_SCRIPTS_DIR   = Path(__file__).resolve().parent
_TEMPLATES_DIR = _SCRIPTS_DIR.parent / "templates"
_DASHBOARD_TMPL = _TEMPLATES_DIR / "dashboard.html"
_SHARED_CSS    = _TEMPLATES_DIR / "shared.css"

PORT = int(os.environ.get("PORT") or os.environ.get("PV_PREVIEW_PORT") or "7459")
IDLE_TIMEOUT_SECS = 3 * 60 * 60  # 3 hours

PREVIEW_DIR      = Path(".claude/preview")
DATA_FILE        = PREVIEW_DIR / "dashboard-data.json"
RUN_REQUEST_FILE = PREVIEW_DIR / "run-request.json"
RUN_STATUS_FILE  = PREVIEW_DIR / "run-status.json"

_last_request_at = time.monotonic()

# Simple in-process cache: invalidated whenever DATA_FILE's or the template's
# mtime changes. Both matter during skill development — editing dashboard.html
# (or shared.css, inlined into it) with no corresponding data write must still
# bust the cache, or the server keeps serving HTML built from the old template.
_html_cache: dict[str, bytes] = {}
_html_cache_key: "tuple[float, float] | None" = None


def _render_html(template_path: Path) -> bytes:
    """Render dashboard or runner HTML from the classified payload file.

    Caches the result until DATA_FILE or template_path changes on disk.
    Returns an error page if the data file is missing so the panel shows a
    useful message rather than a blank screen.
    """
    global _html_cache, _html_cache_key
    try:
        data_mtime = DATA_FILE.stat().st_mtime
    except FileNotFoundError:
        return b"<p>Dashboard data not ready. Re-open the skill to rebuild.</p>"
    template_mtime = template_path.stat().st_mtime
    css_mtime = _SHARED_CSS.stat().st_mtime if _SHARED_CSS.exists() else 0.0

    cache_key = str(template_path)
    mtimes = (data_mtime, template_mtime, css_mtime)
    if mtimes != _html_cache_key:
        _html_cache = {}
        _html_cache_key = mtimes

    if cache_key not in _html_cache:
        try:
            data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
            _html_cache[cache_key] = fill_template(template_path, data).encode("utf-8")
        except Exception:  # noqa: BLE001
            return b"<p>Failed to render dashboard. Check dashboard-data.json.</p>"

    return _html_cache[cache_key]


def _data_json() -> str:
    """Return the classified payload JSON for the /data endpoint."""
    try:
        return DATA_FILE.read_text(encoding="utf-8")
    except FileNotFoundError:
        return "null"


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes = b"", ctype: str = "text/html; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        global _last_request_at
        _last_request_at = time.monotonic()
        if self.path in ("/", "/index.html"):
            self._send(200, _render_html(_DASHBOARD_TMPL))
        elif self.path == "/status":
            try:
                body = RUN_STATUS_FILE.read_bytes()
            except FileNotFoundError:
                body = b'{"state":"idle"}'
            self._send(200, body, "application/json")
        elif self.path == "/data":
            self._send(200, _data_json().encode("utf-8"), "application/json")
        else:
            self._send(404, b"Not found")

    def do_POST(self):
        global _last_request_at
        _last_request_at = time.monotonic()
        if self.path != "/run":
            self._send(404, b"Not found")
            return
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            self._send(400, b'{"ok":false,"error":"invalid json"}', "application/json")
            return
        PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
        RUN_REQUEST_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        # Seed an immediate status so the panel shows "queued" until Claude
        # picks up the request and starts writing its own progress updates.
        count = len(payload.get("selection", []))
        RUN_STATUS_FILE.write_text(
            json.dumps({
                "state": "queued",
                "message": "Waiting for Claude to pick up the run…",
                "completed": 0,
                "total": count,
            }),
            encoding="utf-8",
        )
        self._send(200, b'{"ok":true}', "application/json")

    def log_message(self, *args):  # suppress access-log noise
        pass


def _watchdog(server: HTTPServer):
    while True:
        time.sleep(60)
        if time.monotonic() - _last_request_at > IDLE_TIMEOUT_SECS:
            server.shutdown()
            break


if __name__ == "__main__":
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    # Clear any stale run request/status left over from a prior session.
    RUN_REQUEST_FILE.unlink(missing_ok=True)
    RUN_STATUS_FILE.unlink(missing_ok=True)
    httpd = HTTPServer(("127.0.0.1", PORT), Handler)
    threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
    print(f"Portfolio valuations preview server on http://127.0.0.1:{PORT}", flush=True)
    httpd.serve_forever()
