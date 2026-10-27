# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Send one local file to the presigned storage URL Carta returned for it.

long-comment-ok: argument and output contract the skill reads
Usage:
    uv run send_to_storage.py <url> <fields_json> <file_path>

Prints one JSON line: {"status": <http status>} when storage answered,
{"error": "refused", "reason": ...} when the URL, fields or file is not one
this script may send (nothing is sent; `reason` starts with `url`, `fields` or
`file`, which the skill reads), or {"error": "connection"} when storage
could not be reached. The skill pre-approves this script instead of curl, so
the URL check lives here: an approved curl wildcard could post a file anywhere.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "carta_storage.py").is_file()) / "lib"
sys.path.insert(0, str(_LIB))

from carta_storage import is_carta_bucket  # noqa: E402


def refusal(url: str, fields: object, file_path: str) -> str | None:
    """Why this send must not run, or None."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not is_carta_bucket(parts):
        return "url is not Carta's document storage"
    if not isinstance(fields, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in fields.items()
    ):
        return "fields is not an object of strings"
    if not os.path.isfile(file_path):
        return "file is missing or not a regular file"
    return None


def curl_args(url: str, fields: dict, file_path: str) -> list[str]:
    """Every field as a literal form string, then the file last: storage
    ignores any part after the file."""
    args = [
        "curl", "--proto", "=https", "--tlsv1.2", "-sS",
        "-o", os.devnull, "-w", "%{http_code}", "-X", "POST", url,
    ]
    for name, value in fields.items():
        args += ["--form-string", f"{name}={value}"]
    # Quoted, so curl reads `;` and `,` in the path as part of the name.
    quoted = file_path.replace("\\", "\\\\").replace('"', '\\"')
    args += ["-F", f'file=@"{quoted}"']
    return args


def send(url: str, fields_json: str, file_path: str) -> dict:
    try:
        fields = json.loads(fields_json)
    except ValueError:
        return {"error": "refused", "reason": "fields is not JSON"}
    reason = refusal(url, fields, file_path)
    if reason:
        return {"error": "refused", "reason": reason}
    done = subprocess.run(curl_args(url, fields, file_path), capture_output=True, text=True)
    code = done.stdout.strip()
    if not code.isdigit() or code == "000":
        return {"error": "connection"}
    return {"status": int(code)}


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(json.dumps({"error": "refused", "reason": "usage: <url> <fields_json> <file_path>"}))
        return 2
    print(json.dumps(send(argv[1], argv[2], argv[3])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
