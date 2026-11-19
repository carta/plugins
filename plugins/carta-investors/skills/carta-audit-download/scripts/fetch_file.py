#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Save one file from a Carta download link into the audit download folder.

Usage: fetch_file.py <https url> <output path>

Only https links are followed (redirects included), and the file is written only inside
the audit download folder, so a link in a response cannot point the skill at another
address or path.
The body is saved beside the target and moved into place only once all of it has arrived,
so a file at the output path is always complete and a failed fetch leaves it as it was.
"""
import http.client
import os
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

FOLDER = "carta-audit-documents"
ALLOWED_ROOTS = [Path("/tmp") / FOLDER, Path(tempfile.gettempdir()) / FOLDER]
TIMEOUT_SECONDS = 300


class _HttpsOnly(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlparse(newurl).scheme != "https":
            raise urllib.error.URLError("redirect to a non-https address")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_HttpsOnly)


def _inside_download_folder(out: Path) -> bool:
    resolved = out.resolve()
    return any(root.resolve() in resolved.parents for root in ALLOWED_ROOTS)


def main(argv: list) -> int:
    if len(argv) != 3:
        print("error: usage: fetch_file.py <https url> <output path>")
        return 2
    url, out = argv[1], Path(argv[2])
    if urlparse(url).scheme != "https":
        print("error: only https links are fetched")
        return 2
    if not _inside_download_folder(out):
        print("error: the output path must be inside the %s folder" % FOLDER)
        return 2
    out.parent.mkdir(parents=True, exist_ok=True)
    part = out.with_name(out.name + ".part")
    try:
        with _OPENER.open(url, timeout=TIMEOUT_SECONDS) as response, open(part, "wb") as handle:
            size = 0
            for chunk in iter(lambda: response.read(1 << 20), b""):
                handle.write(chunk)
                size += len(chunk)
            declared = response.headers.get("Content-Length")
            if declared is not None and size != int(declared):
                raise OSError("the download stopped after %d of %s bytes" % (size, declared))
        os.replace(part, out)
    except (urllib.error.URLError, http.client.HTTPException, OSError, ValueError) as exc:
        try:
            part.unlink()
        except OSError:
            pass
        print("error: could not fetch the file (%s)" % exc)
        return 1
    print("%s (%d bytes)" % (out, size))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
