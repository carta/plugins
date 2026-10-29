"""Shared validation/escaping helpers for Live Artifact render-artifact.py scripts."""
from __future__ import annotations

import datetime
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
# A published Claude artifact, as the Artifact tool returns it. Lands in an href too.
CLAUDE_ARTIFACT_URL_RE = re.compile(r"^https://claude\.ai/(?:code/)?artifact/[A-Za-z0-9-]+$")


# Strict major.minor.patch: the update banner compares semver and fires on major/minor.
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_skill_version(skill_dir: Path) -> str:
    """Return the skill's version from its plugin's .claude-plugin/skill-versions.json.

    Fails the build rather than defaulting: a wrong version either suppresses a real
    update banner forever, or shows one that can never be satisfied.
    """
    skill_dir = Path(skill_dir)
    versions_file = skill_dir.parent.parent / ".claude-plugin" / "skill-versions.json"
    label = "{}[{}]".format(versions_file.name, skill_dir.name)
    if not versions_file.exists():
        sys.exit("ERROR: {} is missing".format(versions_file))
    try:
        data = json.loads(versions_file.read_text())
    except ValueError as exc:
        sys.exit("ERROR: {} is not valid JSON: {}".format(versions_file.name, exc))
    entry = data.get(skill_dir.name)
    if not isinstance(entry, dict):
        sys.exit('ERROR: {} needs an entry like {{"version": "1.2.3"}}'.format(label))
    version = entry.get("version")
    if not isinstance(version, str) or not SEMVER_RE.match(version):
        sys.exit('ERROR: {} needs a "version" like "1.2.3", got {!r}'.format(label, version))
    return version


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


# Where the LP Documents template takes the config lp_docs_config builds.
LP_DOCS_CONFIG_PLACEHOLDER = "__LP_DOCS_CONFIG__"


def lp_docs_config(server: str, title: str) -> dict:
    """The LP Documents page's config block, for its own page and for the LP Dashboard's
    Documents tab alike."""
    return {"server": server, "title": title, "generated": datetime.date.today().isoformat()}


def check_path_under_cwd(p: Path, label: str):
    """Resolve p, or return None if it escapes CWD.

    A prompt-injected LLM could pass an arbitrary path; this is the enforcement.
    """
    resolved = p.resolve()
    if not resolved.is_relative_to(Path.cwd().resolve()):
        print(f"error: {label} must be under the current working directory: {resolved}", file=sys.stderr)
        return None
    return resolved


TRACKER_MARKER = "/* __MCP_UI_TRACKER_JS__ */"
TRACKER_BUNDLE = Path(__file__).with_name("mcp-ui-tracker.js")
TRACKER_HELPERS = Path(__file__).with_name("ui-tracking.js")
SKILL_PLACEHOLDER = "__MCP_UI_SKILL__"


def inline_tracker(content: str, skill: str) -> str:
    """Put the tracker bundle, stamped with `carta-investors:<skill>`, and the page helpers at the marker.

    A missing bundle inlines only the helpers, which then no-op, so the page still renders.
    """
    bundle = TRACKER_BUNDLE.read_text(encoding="utf-8") if TRACKER_BUNDLE.is_file() else ""
    js = bundle.replace(SKILL_PLACEHOLDER, "carta-investors:" + skill) + TRACKER_HELPERS.read_text(encoding="utf-8")
    return content.replace(TRACKER_MARKER, js, 1)
