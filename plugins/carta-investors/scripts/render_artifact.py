#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Shared artifact renderer for the carta-investors Cowork artifact skills
(carta-loan-overview, carta-loan-dashboard, carta-lp-summary, and siblings).

Replaces each skill's Step-7 deterministic escape + substitute block. The
executing model assembles the small data object (Step 6) and writes it to
<workdir>/<in>; this script reads the skill's bundled template (passed via
--template, so the ~16 KB template NEVER enters the model's context or output),
JSON-encodes the data, applies the XSS-safe \\uXXXX escaping, substitutes the
single __LOAN_DATA__ token and, when present, the single __ARTIFACT_TITLE__ token
from the data's "artifact_title" (HTML-escaped), and writes the finished HTML to
<workdir>/<out>.

stdout = the absolute path of the written HTML (the contract the skill reads next).
stderr = progress, every line prefixed "[render]" so the skill suppresses by prefix.
The skill branches on the EXIT CODE; it never re-derives the escaping or substitution.
"""

import argparse
import html as html_lib
import json
import re
import sys
from pathlib import Path

EXIT_OK = 0          # success: HTML written; absolute path printed to stdout
EXIT_INPUT = 1       # missing / bad input data or args
EXIT_TEMPLATE = 4    # template path could not be read
EXIT_SCHEMA = 14     # template token count is wrong: not exactly one __LOAN_DATA__, or more than one __ARTIFACT_TITLE__ (drift)

PREFIX = "[render]"

# Build the JSON unicode-escape sequences from chr(92) so this source file contains
# no literal "\\u" that a JSON/transport layer could silently collapse to the bare char.
_BS = chr(92)
TOKEN = "__LOAN_DATA__"
# Optional: a template whose published title names the firm carries this token in its
# <title>, because the Artifact tool reads the title from the file and finds the page
# to refresh by it. The title comes from the input JSON's "artifact_title", like every
# other value, so a firm name never passes through the shell.
TITLE_PLACEHOLDER = "__ARTIFACT_TITLE__"


def log(msg):
    print(PREFIX + " " + msg, file=sys.stderr, flush=True)


def escape_for_script_block(raw):
    """Escape a JSON string so it is safe inside a raw <script> block.

    A literal </script> (or other markup) inside any warehouse string value would
    otherwise close the block early and inject HTML (stored XSS). \\uXXXX is used
    (NOT HTML entities): a <script> block is raw text where entities are not decoded,
    while JSON.parse decodes \\uXXXX back to the original char, so the data is unchanged.
    """
    return (
        raw.replace("&", _BS + "u0026")
        .replace("<", _BS + "u003c")
        .replace(">", _BS + "u003e")
        .replace("'", _BS + "u0027")
    )


# Optional: a template inlines one of the plugin's vendored scripts (plugins/carta-investors/vendor/)
# with a /* __VENDOR_JS:<file>__ */ marker inside a <script> block. The artifact CSP blocks every
# external script, so a CDN tag would load nothing; inlining here also keeps the bundle out of
# the model's context.
VENDOR_DIR = Path(__file__).resolve().parent.parent / "vendor"
VENDOR_MARKER = re.compile(r"/\*\s*__VENDOR_JS:([A-Za-z0-9._-]+)__\s*\*/")


def inline_vendor_scripts(template):
    """The template with each vendor marker replaced by that file, or (None, reason)."""
    def bundle(name):
        path = VENDOR_DIR / name
        if not path.is_file():
            raise LookupError("vendored script not found: " + str(path))
        code = path.read_text(encoding="utf-8")
        if re.search(r"</script", code, re.IGNORECASE):
            raise LookupError("vendored script " + name + " contains </script and would end its block early")
        return code
    try:
        return VENDOR_MARKER.sub(lambda m: bundle(m.group(1)), template), None
    except LookupError as e:
        return None, str(e)


def main(argv):
    ap = argparse.ArgumentParser(description="Render a carta-investors loan artifact HTML.")
    ap.add_argument("--workdir", required=True, help="workspace dir for input + output files")
    ap.add_argument("--template", required=True, help="absolute path to the skill's artifact template")
    ap.add_argument("--in", dest="infile", default="loan-data.json", help="input data JSON filename")
    ap.add_argument("--out", dest="outfile", default="artifact.html", help="output HTML filename")
    args = ap.parse_args(argv)

    workdir = Path(args.workdir)
    src = workdir / args.infile
    if not src.is_file():
        log("input data not found: " + str(src))
        return EXIT_INPUT
    try:
        data = json.loads(src.read_text(encoding="utf-8"))
    except (ValueError, OSError) as e:
        log("input data is not valid JSON: " + str(e))
        return EXIT_INPUT

    tpl = Path(args.template)
    if not tpl.is_file():
        log("template not found at " + str(tpl))
        return EXIT_TEMPLATE
    template = tpl.read_text(encoding="utf-8")
    # Vendored code first, so a data value that happens to look like a marker stays as-is.
    template, vendor_error = inline_vendor_scripts(template)
    if vendor_error:
        log(vendor_error)
        return EXIT_TEMPLATE
    count = template.count(TOKEN)
    if count != 1:
        log("template must contain exactly one " + TOKEN + " token, found " + str(count) + " (schema drift)")
        return EXIT_SCHEMA
    title_count = template.count(TITLE_PLACEHOLDER)
    if title_count > 1:
        log("template must contain at most one " + TITLE_PLACEHOLDER + " token, found " + str(title_count) + " (schema drift)")
        return EXIT_SCHEMA
    title = data.get("artifact_title") if isinstance(data, dict) else None
    if title_count == 1 and not (isinstance(title, str) and title.strip()):
        log("this template needs a non-empty \"artifact_title\" in the input data")
        return EXIT_INPUT

    compact = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    escaped = escape_for_script_block(compact)
    # Title first, so a data value that happens to contain the title token stays as-is.
    if title_count == 1:
        template = template.replace(TITLE_PLACEHOLDER, html_lib.escape(title.strip(), quote=True))
    html = template.replace(TOKEN, escaped)

    out = workdir / args.outfile
    out.write_text(html, encoding="utf-8")
    log("wrote " + str(len(html)) + " bytes to " + out.name)
    print(str(out.resolve()))
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
