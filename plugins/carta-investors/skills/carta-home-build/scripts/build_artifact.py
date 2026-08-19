# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the self-contained carta-home Cowork artifact from its source parts.

Inlines the CSS + config + app JS into the template and substitutes the Carta MCP
server id, producing ONE self-contained HTML file ready for create_artifact /
update_artifact. The model never has to read the large HTML: to change what the
directory shows, edit resources/carta-home.config.js; to change logic, edit
resources/carta-home.app.js; then re-run this.

Source parts (all in the skill's resources/ dir):
  carta-home.template.html  — HTML skeleton + <style>/<script> injection markers
  carta-home.css            — styles          (marker: /* __CARTA_HOME_CSS__ */)
  carta-home.tracker.js     — Snowplow UI tracker bundle (marker: /* __CARTA_HOME_TRACKER_JS__ */)
  carta-home.config.js      — DIR_CATEGORIES  (marker: /* __CARTA_HOME_CONFIG_JS__ */)
  carta-home.app.js         — app logic       (marker: /* __CARTA_HOME_APP_JS__ */)

The artifact's version comes from the plugin's skill-versions registry, keyed by this
skill (placeholder: {{ARTIFACT_VERSION}}). It lives there rather than beside the skill
because carta-mcp serves it to the running artifact from the published carta/plugins
mirror, and a skill that has not opted into publishing never reaches that mirror —
whereas .claude-plugin/ is plugin-level metadata and is always published.

The `{{CARTA_MCP_ID}}` placeholder (throughout the template + app) is replaced with
the real Carta MCP server UUID. `{{FIRM}}` is left intact — it is a RUNTIME
placeholder the artifact fills in from list_contexts.

Usage:
  uv run scripts/build_artifact.py --mcp-id <uuid> --out <path>/carta-home-updated.html
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RES = SKILL_DIR / "resources"

SKILL_NAME = SKILL_DIR.name
VERSIONS_FILE = SKILL_DIR.parent.parent / ".claude-plugin" / "skill-versions.json"
# A built artifact can never update itself, so it carries its version with it and
# compares against the published one at runtime. Strict major.minor.patch: the
# comparison is semver, and the banner fires on major/minor only.
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

# App-layer JS is assembled from multiple source files, concatenated in this
# order into the single __CARTA_HOME_APP_JS__ slot below. Concatenation order
# doesn't matter functionally today (function/let declarations, no cross-file
# execution-order dependencies) — list shared/core logic first by convention.
# Add new feature files here as carta-home.app.js gets split further.
APP_JS_PARTS = [
    "carta-home.app.js",
    "app/capital-activity.js",
    "app/version-check.js",
    "app/live-content.js",
]

MARKERS = {
    "carta-home.css": r"/\*\s*__CARTA_HOME_CSS__\s*\*/",
    "carta-home.tracker.js": r"/\*\s*__CARTA_HOME_TRACKER_JS__\s*\*/",
    "carta-home.config.js": r"/\*\s*__CARTA_HOME_CONFIG_JS__\s*\*/",
}
APP_JS_MARKER = r"/\*\s*__CARTA_HOME_APP_JS__\s*\*/"


def compute_build_id(template, parts):
    """Short content hash of all source parts — changes only when a source changes,
    so a visible `build <id>` makes it obvious whether a panel shows the latest build."""
    h = hashlib.sha256()
    h.update(template.encode("utf-8"))
    for name in sorted(parts):
        h.update(name.encode("utf-8"))
        h.update(parts[name].encode("utf-8"))
    return h.hexdigest()[:8]


def read_version():
    """Return this skill's version from the plugin's skill-versions registry.

    Fails the build rather than defaulting: a wrong version is worse than no build,
    because it either suppresses a real update banner forever or shows one that can
    never be satisfied.
    """
    label = "{}[{}]".format(VERSIONS_FILE.name, SKILL_NAME)
    if not VERSIONS_FILE.exists():
        sys.exit("ERROR: {} is missing".format(VERSIONS_FILE))
    try:
        data = json.loads(VERSIONS_FILE.read_text())
    except ValueError as exc:
        sys.exit("ERROR: {} is not valid JSON: {}".format(VERSIONS_FILE.name, exc))
    entry = data.get(SKILL_NAME)
    if not isinstance(entry, dict):
        sys.exit('ERROR: {} needs an entry like {{"version": "1.2.3"}}'.format(label))
    version = entry.get("version")
    if not isinstance(version, str) or not SEMVER_RE.match(version):
        sys.exit('ERROR: {} needs a "version" like "1.2.3", got {!r}'.format(label, version))
    return version


def build(mcp_id):
    template = (RES / "carta-home.template.html").read_text()
    parts = {name: (RES / name).read_text() for name in MARKERS}
    parts.update({name: (RES / name).read_text() for name in APP_JS_PARTS})
    build_id = compute_build_id(template, parts)

    out = template
    for filename, marker in MARKERS.items():
        content = parts[filename]
        if not re.search(marker, out):
            sys.exit("ERROR: marker for {} missing from template".format(filename))
        # Use a function replacement so backslashes / $-refs in the content are literal.
        out = re.sub(marker, lambda _m, c=content: c, out, count=1)

    app_js = "\n\n".join(parts[name] for name in APP_JS_PARTS)
    if not re.search(APP_JS_MARKER, out):
        sys.exit("ERROR: marker for app JS missing from template")
    out = re.sub(APP_JS_MARKER, lambda _m, c=app_js: c, out, count=1)

    # Leftover build-time markers would mean an incomplete assembly — fail loudly.
    for token in ("__CARTA_HOME_CSS__", "__CARTA_HOME_TRACKER_JS__", "__CARTA_HOME_CONFIG_JS__", "__CARTA_HOME_APP_JS__"):
        if token in out:
            sys.exit("ERROR: unresolved marker {} after assembly".format(token))

    out = out.replace("{{CARTA_MCP_ID}}", mcp_id)
    if "{{CARTA_MCP_ID}}" in out:
        sys.exit("ERROR: {{CARTA_MCP_ID}} still present after substitution")

    out = out.replace("{{BUILD_ID}}", build_id)

    version = read_version()
    out = out.replace("{{ARTIFACT_VERSION}}", version)
    if "{{ARTIFACT_VERSION}}" in out:
        sys.exit("ERROR: {{ARTIFACT_VERSION}} still present after substitution")

    return out, build_id, version


def main():
    ap = argparse.ArgumentParser(description="Assemble the carta-home artifact.")
    ap.add_argument("--mcp-id", required=True,
                    help="Carta MCP server UUID (the {{CARTA_MCP_ID}} value)")
    ap.add_argument("--out", required=True, help="output HTML path")
    args = ap.parse_args()

    html, build_id, version = build(args.mcp_id)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    print(
        "wrote {} ({} bytes) — v{} build {}".format(
            out_path, len(html.encode("utf-8")), version, build_id
        )
    )


if __name__ == "__main__":
    main()
