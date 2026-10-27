# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Save one firm document from its signed download link into ~/Downloads.

long-comment-ok: argument and output contract the skill reads
Usage:
    uv run save_to_downloads.py <url> <filename> <title>

Prints one JSON line: {"status": 200, "path": ..., "bytes": ...} when saved,
{"status": <http status>} when the link answered with an error,
{"error": "refused", "reason": ...} when the link or folder is not one this
script may use (nothing is fetched), or {"error": "connection"}. The skill
pre-approves this script instead of curl, so the link check, the safe name and
the never-overwrite rule live here.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

_LIB = next(p for p in Path(__file__).resolve().parents if (p / "lib" / "carta_storage.py").is_file()) / "lib"
sys.path.insert(0, str(_LIB))

from carta_storage import is_carta_bucket  # noqa: E402

UNSAFE = re.compile(r'[/\\:*?"<>|\x00-\x1f\x7f]')


def link_refusal(url: str) -> str | None:
    parts = urlsplit(url)
    if parts.scheme != "https" or not (is_carta_bucket(parts) or parts.hostname == "documents.carta.com"):
        return "link is not Carta's document storage"
    return None


def safe_name(filename: str, title: str) -> str:
    """The filename with path and control characters removed and leading dots
    and spaces trimmed; the title, cleaned the same way, when nothing is left."""
    for candidate in (filename, title):
        name = UNSAFE.sub("", candidate or "").lstrip(". ")
        if name:
            return name
    return "document"


def free_path(folder: Path, name: str) -> Path:
    """`name` in `folder`, or `name (1)`, `name (2)`, … when it is taken."""
    target = folder / name
    stem, dot, ext = name.rpartition(".")
    if not stem:
        stem, dot, ext = name, "", ""
    n = 1
    while target.exists():
        target = folder / f"{stem} ({n}){dot}{ext}"
        n += 1
    return target


def save(url: str, filename: str, title: str, folder: Path) -> dict:
    reason = link_refusal(url)
    if reason:
        return {"error": "refused", "reason": reason}
    if not folder.is_dir():
        return {"error": "refused", "reason": "no Downloads folder"}
    target = free_path(folder, safe_name(filename, title))
    done = subprocess.run(
        ["curl", "--proto", "=https", "--tlsv1.2", "-sS", "-f", "-o", str(target), "-w", "%{http_code}", url],
        capture_output=True, text=True,
    )
    code = done.stdout.strip()
    if done.returncode != 0 or code != "200":
        # A failed or partial download must not look like a saved file.
        if target.exists():
            target.unlink()
        # A 200 here means the body broke off mid-transfer or could not be
        # written; reporting it as a status would read as saved.
        if not code.isdigit() or code in ("000", "200"):
            return {"error": "connection"}
        return {"status": int(code)}
    return {"status": 200, "path": str(target), "bytes": target.stat().st_size}


def main(argv: list[str]) -> int:
    if len(argv) != 4:
        print(json.dumps({"error": "refused", "reason": "usage: <url> <filename> <title>"}))
        return 2
    print(json.dumps(save(argv[1], argv[2], argv[3], Path.home() / "Downloads")))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
