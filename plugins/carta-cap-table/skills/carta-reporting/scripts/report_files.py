# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""
report_files.py — move report files in and out of carta-reporting/ without curl, mv or Write.

Usage (each prints one JSON object):
    report_files.py download --url <presigned_url> --out <path>
        https only, host must be in the allowed list (lib/report_hosts.py). Writes <path>.part,
        then renames it, so <path> only ever appears complete. On failure writes
        {"error": "download failed"} to <path> the same way and exits 1.
    report_files.py error --out <path> --message <text>
        Writes {"error": "<text>"} to <path> the same way.
    report_files.py wait --path <file> [--attempts N] [--interval S]
        Blocks until <file> exists. Prints {"ready": true, "error": <the file's "error" or null>},
        or {"ready": false} after N checks (default 12) spaced S seconds apart (default 5).

The folder holding --out is created with a `.gitignore` of `*` when missing, so report data is
never committed.
"""

import argparse
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

# The plugin's shared lib/ sits above the skill; walk up so this runs standalone under `uv run`.
for _root in Path(__file__).resolve().parents:
    if (_root / "lib" / "report_hosts.py").is_file():
        sys.path.insert(0, str(_root / "lib"))
        break
from report_hosts import DOWNLOAD_TIMEOUT_SECONDS, check_download_url  # noqa: E402

CHUNK_BYTES = 1 << 20


def _prepare_folder(out):
    folder = out.parent
    folder.mkdir(parents=True, exist_ok=True)
    ignore = folder / ".gitignore"
    if not ignore.exists():
        ignore.write_text("*\n")


def _write_atomic(out, data):
    _prepare_folder(out)
    part = out.with_name(out.name + ".part")
    part.write_bytes(data)
    os.replace(str(part), str(out))


def _write_error(out, message):
    _write_atomic(out, json.dumps({"error": message}).encode("utf-8"))


def cmd_download(args):
    out = Path(args.out)
    try:
        check_download_url(args.url)
        _prepare_folder(out)
        part = out.with_name(out.name + ".part")
        with urllib.request.urlopen(args.url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as response:
            with open(str(part), "wb") as handle:
                while True:
                    chunk = response.read(CHUNK_BYTES)
                    if not chunk:
                        break
                    handle.write(chunk)
        os.replace(str(part), str(out))
    except Exception as exc:  # any failure must leave an error file for the waiting main thread
        _write_error(out, "download failed")
        print(json.dumps({"error": "download failed", "detail": str(exc)}))
        return 1
    print(json.dumps({"path": str(out), "bytes": out.stat().st_size}))
    return 0


def cmd_error(args):
    _write_error(Path(args.out), args.message)
    print(json.dumps({"path": args.out, "error": args.message}))
    return 0


def _error_in(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return None
    return data.get("error") if isinstance(data, dict) else None


def cmd_wait(args):
    path = Path(args.path)
    for attempt in range(args.attempts):
        if path.exists():
            print(json.dumps({"ready": True, "error": _error_in(path)}))
            return 0
        if attempt < args.attempts - 1:
            time.sleep(args.interval)
    print(json.dumps({"ready": False}))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    download = sub.add_parser("download")
    download.add_argument("--url", required=True)
    download.add_argument("--out", required=True)
    download.set_defaults(func=cmd_download)

    error = sub.add_parser("error")
    error.add_argument("--out", required=True)
    error.add_argument("--message", required=True)
    error.set_defaults(func=cmd_error)

    wait = sub.add_parser("wait")
    wait.add_argument("--path", required=True)
    wait.add_argument("--attempts", type=int, default=12)
    wait.add_argument("--interval", type=float, default=5)
    wait.set_defaults(func=cmd_wait)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
