"""Shared validation/escaping helpers for Live Artifact render-artifact.py scripts."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)
# Connector display names are viewer-facing text, so reject only what would escape
# the JS string literal they land in.
MCP_SERVER_RE = re.compile(r"^[^\r\n\'\"<>\\]{1,120}$")
ARTIFACT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")
CARTA_ID_RE = re.compile(r"^[0-9]{1,19}$")
# The page concatenates this into an href, so a quote or javascript: scheme would
# land inside the link. Require a plain https origin.
BASE_URL_RE = re.compile(r"^https://[A-Za-z0-9.\-]+(:[0-9]{1,5})?$")


def js_safe_json(obj) -> str:
    """JSON-encode for embedding in a <script> block.

    A <script type="application/json"> block closes on the first </script> in its
    content, so an unescaped name could close the block early and leak its tail.
    """
    return (
        json.dumps(obj, ensure_ascii=False)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("'", "\\u0027")
    )


def check_path_under_cwd(p: Path, label: str):
    """Resolve p, or return None if it escapes CWD.

    A prompt-injected LLM could pass an arbitrary path; this is the enforcement.
    """
    resolved = p.resolve()
    if not resolved.is_relative_to(Path.cwd().resolve()):
        print(f"error: {label} must be under the current working directory: {resolved}", file=sys.stderr)
        return None
    return resolved
