#!/usr/bin/env python3
"""
investor-dashboard local server.

A self-contained stdlib HTTP server (no third-party deps). It serves the static
web app and the baseline/company JSON the skill wrote to a data dir, and provides
read+write endpoints for saving/reloading scenarios and an on-demand tearsheet
request queue (fulfilled by the skill, not the browser).

Security:
  - binds 127.0.0.1 only
  - a random per-launch token gates every /api/* request; the opened URL carries
    ?t=<token>, the page stores it and sends it as the X-Dash-Token header.
  - all data stays under the data dir; nothing is written elsewhere.

The browser NEVER calls the Carta MCP — it only reads JSON the skill produced.

Usage:
  python3 serve.py --data-dir /path/to/data [--web-dir /path/to/web] [--no-open]
"""

import argparse
import http.server
import json
import os
import secrets
import socketserver
import threading
import time
import webbrowser
from pathlib import Path
from urllib.parse import urlparse, parse_qs

DATA_DIR = None
WEB_DIR = None
TOKEN = None
HEARTBEAT_TIMEOUT = 1800  # 30 min idle -> shut down
_last_heartbeat = time.time()
_hb_lock = threading.Lock()

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def _touch_heartbeat():
    global _last_heartbeat
    with _hb_lock:
        _last_heartbeat = time.time()


def _watchdog(httpd):
    while True:
        time.sleep(10)
        with _hb_lock:
            idle = time.time() - _last_heartbeat
        if idle > HEARTBEAT_TIMEOUT:
            print("[serve] idle %ds — shutting down" % int(idle), flush=True)
            httpd.shutdown()
            os._exit(0)


def _safe_join(base: Path, rel: str):
    """Join + ensure the result stays under base (prevent path traversal)."""
    target = (base / rel.lstrip("/")).resolve()
    base_r = base.resolve()
    if base_r == target or base_r in target.parents:
        return target
    return None


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    # ---- helpers ----
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

    def _send_file(self, path: Path):
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
        """Serve a JSON file from the data dir, or {} not-ready if missing."""
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

        # static app (token not required to load the shell; the shell then
        # authenticates API calls with the token it received in the URL)
        if path == "/" or path == "/index.html":
            return self._send_file(WEB_DIR / "index.html")
        if not path.startswith("/api/"):
            p = _safe_join(WEB_DIR, path)
            if p is None or not p.exists() or p.is_dir():
                return self._send(404, {"error": "not_found"})
            return self._send_file(p)

        # ---- API (token-gated) ----
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})

        if path == "/api/heartbeat":
            _touch_heartbeat()
            return self._send(200, {"ok": True})
        if path == "/api/meta.json":
            return self._data_json("meta.json")
        if path.startswith("/api/baseline/"):
            name = path[len("/api/baseline/"):]
            return self._data_json("baseline/" + name)
        if path.startswith("/api/company/"):
            name = path[len("/api/company/"):]
            return self._data_json("company/" + name)
        if path == "/api/scenarios":
            return self._send(200, self._list_scenarios())
        if path.startswith("/api/scenario/"):
            sid = path[len("/api/scenario/"):]
            return self._load_scenario(sid)
        if path == "/api/tearsheet-status":
            cid = qs.get("company_id", [""])[0]
            return self._tearsheet_status(cid)
        if path.startswith("/api/tearsheet/"):
            # serve a generated PDF
            name = path[len("/api/tearsheet/"):]
            return self._data_json_or_file("tearsheets/" + name)
        return self._send(404, {"error": "not_found"})

    def _data_json_or_file(self, rel):
        p = _safe_join(DATA_DIR, rel)
        if p is None or not p.exists():
            return self._send(404, {"error": "not_found"})
        return self._send_file(p)

    # ---- POST ----
    def do_POST(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        if not self._token_ok(qs):
            return self._send(401, {"error": "unauthorized"})
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except ValueError:
            return self._send(400, {"error": "bad_json"})

        if u.path == "/api/scenario":
            return self._save_scenario(payload)
        if u.path == "/api/tearsheet-request":
            return self._tearsheet_request(payload)
        return self._send(404, {"error": "not_found"})

    def do_HEAD(self):
        self.do_GET()

    # ---- scenarios ----
    def _scenarios_dir(self):
        d = DATA_DIR / "scenarios"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _list_scenarios(self):
        out = []
        for f in sorted(self._scenarios_dir().glob("*.json")):
            try:
                obj = json.loads(f.read_text())
                out.append({
                    "id": f.stem,
                    "name": obj.get("name", f.stem),
                    "savedAt": obj.get("savedAt"),
                    "fundId": obj.get("fundId"),
                    "schemaVersion": obj.get("schemaVersion"),
                })
            except ValueError:
                continue
        return {"scenarios": out}

    def _load_scenario(self, sid):
        p = _safe_join(self._scenarios_dir(), sid + ".json")
        if p is None or not p.exists():
            return self._send(404, {"error": "not_found"})
        return self._send_file(p)

    def _save_scenario(self, payload):
        name = (payload.get("name") or "scenario").strip()
        # filesystem-safe id
        sid = "".join(c if (c.isalnum() or c in "-_") else "-" for c in name).strip("-").lower() or "scenario"
        payload.setdefault("schemaVersion", 1)
        payload["name"] = name
        payload["savedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        p = self._scenarios_dir() / (sid + ".json")
        p.write_text(json.dumps(payload, indent=2))
        return self._send(200, {"ok": True, "id": sid, "savedAt": payload["savedAt"]})

    # ---- tearsheet queue (fulfilled by the skill) ----
    def _queue_dir(self):
        d = DATA_DIR / "tearsheet-queue"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _tearsheet_request(self, payload):
        cid = str(payload.get("company_id", "")).strip()
        if not cid:
            return self._send(400, {"error": "company_id required"})
        safe = "".join(c if (c.isalnum() or c in "-_") else "-" for c in cid)
        req = self._queue_dir() / (safe + ".json")
        req.write_text(json.dumps({
            "company_id": cid,
            "status": "queued",
            "requestedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }))
        return self._send(200, {"status": "queued", "company_id": cid})

    def _tearsheet_status(self, cid):
        safe = "".join(c if (c.isalnum() or c in "-_") else "-" for c in (cid or ""))
        req = self._queue_dir() / (safe + ".json")
        if not req.exists():
            return self._send(200, {"status": "none"})
        try:
            return self._send(200, json.loads(req.read_text()))
        except ValueError:
            return self._send(200, {"status": "none"})


class _Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    global DATA_DIR, WEB_DIR, TOKEN
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir", default=str(Path(__file__).resolve().parent.parent / "web"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", "0")))
    ap.add_argument("--no-open", action="store_true")
    args = ap.parse_args()

    DATA_DIR = Path(args.data_dir).resolve()
    WEB_DIR = Path(args.web_dir).resolve()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN = secrets.token_urlsafe(18)

    httpd = _Server(("127.0.0.1", args.port), Handler)
    port = httpd.server_address[1]
    (DATA_DIR / ".port").write_text(str(port))
    (DATA_DIR / ".token").write_text(TOKEN)

    url = "http://127.0.0.1:%d/?t=%s" % (port, TOKEN)
    print("[serve] investor-dashboard at %s" % url, flush=True)
    print("[serve] data-dir: %s" % DATA_DIR, flush=True)

    threading.Thread(target=_watchdog, args=(httpd,), daemon=True).start()
    if not args.no_open:
        try:
            webbrowser.open(url)
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[serve] stopped", flush=True)


if __name__ == "__main__":
    main()
