# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
import argparse, os, http.server, socketserver, tempfile, threading, time

IDLE_TIMEOUT_SECS = 3 * 60 * 60  # 3 hours

parser = argparse.ArgumentParser()
parser.add_argument('--serve-dir', default=tempfile.gettempdir())
args = parser.parse_args()

os.chdir(args.serve_dir)
PORT = int(os.environ.get("PORT", 8000))

last_request_at = time.monotonic()


class Handler(http.server.SimpleHTTPRequestHandler):
    def handle(self):
        global last_request_at
        last_request_at = time.monotonic()
        super().handle()

    def log_message(self, *args):
        pass  # suppress access log noise


with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    def _watchdog():
        while True:
            time.sleep(60)
            if time.monotonic() - last_request_at > IDLE_TIMEOUT_SECS:
                httpd.shutdown()
                break

    t = threading.Thread(target=_watchdog, daemon=True)
    t.start()
    httpd.serve_forever()
