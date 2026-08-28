# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the self-contained carta-workhub Cowork artifact from its source parts.

Inlines the CSS + config + app JS into the template and substitutes the Carta MCP
server id, producing ONE self-contained HTML file ready for create_artifact /
update_artifact. The model never has to read the large HTML: to change the composer
tiles, edit resources/carta-workhub.config.js; to change logic, edit the app JS under
resources/; then re-run this.

Source parts (all in the skill's resources/ dir):
  carta-workhub.template.html  — HTML skeleton + <style>/<script> injection markers
  carta-workhub.css            — styles          (marker: /* __CARTA_WORKHUB_CSS__ */)
  carta-workhub.tracker.js     — Snowplow UI tracker bundle (marker: /* __CARTA_WORKHUB_TRACKER_JS__ */)
  carta-workhub.config.js      — TASK_PRESETS    (marker: /* __CARTA_WORKHUB_CONFIG_JS__ */)
  carta-workhub.app.js         — app logic       (marker: /* __CARTA_WORKHUB_APP_JS__ */)
  vendor/pdf*.min.js           — pdf.js renderer (marker: /* __PDFJS_VENDOR_JS__ */)

The artifact's version comes from the plugin's skill-versions registry, keyed by this
skill (placeholder: {{ARTIFACT_VERSION}}). It lives there rather than beside the skill
because carta-mcp serves it to the running artifact from the published carta/plugins
mirror, and a skill that has not opted into publishing never reaches that mirror —
whereas .claude-plugin/ is plugin-level metadata and is always published.

The `{{CARTA_MCP_SERVER}}` placeholder (throughout the template + app) is replaced with
the Carta connector's display name — what the artifact runtime's mcp capability
addresses a connector by. `{{FIRM}}` is left intact — it is a RUNTIME placeholder the
artifact fills in from list_contexts.

Usage:
  uv run scripts/build_artifact.py --mcp-server <connector-display-name> --out <path>/carta-workhub.html
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
# order into the single __CARTA_WORKHUB_APP_JS__ slot below. Concatenation order
# doesn't matter functionally today (function/let declarations, no cross-file
# execution-order dependencies) — list shared/core logic first by convention.
# Add new feature files here as carta-workhub.app.js gets split further.
APP_JS_PARTS = [
    "carta-workhub.app.js",
    "app/fund-admin-requests.js",
    "app/capital-call-review.js",
    "app/version-check.js",
]

MARKERS = {
    "carta-workhub.css": r"/\*\s*__CARTA_WORKHUB_CSS__\s*\*/",
    "carta-workhub.tracker.js": r"/\*\s*__CARTA_WORKHUB_TRACKER_JS__\s*\*/",
    "carta-workhub.config.js": r"/\*\s*__CARTA_WORKHUB_CONFIG_JS__\s*\*/",
}
APP_JS_MARKER = r"/\*\s*__CARTA_WORKHUB_APP_JS__\s*\*/"

# pdf.js renders the notice PDF in the capital call review panel. Vendored because
# the artifact's CSP blocks every external host — see resources/vendor/README.md.
# The worker bundle goes first: it defines globalThis.pdfjsWorker, which the library
# looks for when asked to parse.
PDFJS_PARTS = ["vendor/pdf.worker.min.js", "vendor/pdf.min.js"]
PDFJS_MARKER = r"/\*\s*__PDFJS_VENDOR_JS__\s*\*/"


def close_script_safe(js):
    """Neutralize any `</script` inside inlined JS, which would end the block early."""
    return js.replace("</script", "<\\/script")


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


def build(mcp_server, ccr_fund_uuid="", ccr_activity_id=""):
    template = (RES / "carta-workhub.template.html").read_text()
    parts = {name: (RES / name).read_text() for name in MARKERS}
    parts.update({name: (RES / name).read_text() for name in APP_JS_PARTS})
    parts.update({name: (RES / name).read_text() for name in PDFJS_PARTS})
    build_id = compute_build_id(template, parts)

    out = template
    for filename, marker in MARKERS.items():
        content = parts[filename]
        if not re.search(marker, out):
            sys.exit("ERROR: marker for {} missing from template".format(filename))
        # Use a function replacement so backslashes / $-refs in the content are literal.
        out = re.sub(marker, lambda _m, c=content: c, out, count=1)

    pdfjs = "\n".join(close_script_safe(parts[name]) for name in PDFJS_PARTS)
    if not re.search(PDFJS_MARKER, out):
        sys.exit("ERROR: marker for pdf.js missing from template")
    out = re.sub(PDFJS_MARKER, lambda _m, c=pdfjs: c, out, count=1)

    app_js = "\n\n".join(parts[name] for name in APP_JS_PARTS)
    if not re.search(APP_JS_MARKER, out):
        sys.exit("ERROR: marker for app JS missing from template")
    out = re.sub(APP_JS_MARKER, lambda _m, c=app_js: c, out, count=1)

    # Leftover build-time markers would mean an incomplete assembly — fail loudly.
    for token in ("__CARTA_WORKHUB_CSS__", "__CARTA_WORKHUB_TRACKER_JS__", "__CARTA_WORKHUB_CONFIG_JS__", "__CARTA_WORKHUB_APP_JS__", "__PDFJS_VENDOR_JS__"):
        if token in out:
            sys.exit("ERROR: unresolved marker {} after assembly".format(token))

    out = out.replace("{{CARTA_MCP_SERVER}}", mcp_server)
    if "{{CARTA_MCP_SERVER}}" in out:
        sys.exit("ERROR: {{CARTA_MCP_SERVER}} still present after substitution")

    # Empty is the normal case: the panel then opens only from a task card.
    out = out.replace("{{CCR_FUND_UUID}}", ccr_fund_uuid or "")
    out = out.replace("{{CCR_ACTIVITY_ID}}", ccr_activity_id or "")

    out = out.replace("{{BUILD_ID}}", build_id)

    version = read_version()
    out = out.replace("{{ARTIFACT_VERSION}}", version)
    if "{{ARTIFACT_VERSION}}" in out:
        sys.exit("ERROR: {{ARTIFACT_VERSION}} still present after substitution")

    return out, build_id, version


def main():
    ap = argparse.ArgumentParser(description="Assemble the carta-workhub artifact.")
    ap.add_argument("--mcp-server", required=True,
                    help="Carta connector display name (the {{CARTA_MCP_SERVER}} value)")
    ap.add_argument("--ccr-fund-uuid", default="",
                    help="seed the capital call review panel with this fund UUID")
    ap.add_argument("--ccr-activity-id", default="",
                    help="seed the capital call review panel with this activity ShortUUID")
    ap.add_argument("--out", required=True, help="output HTML path")
    args = ap.parse_args()

    html, build_id, version = build(
        args.mcp_server, args.ccr_fund_uuid, args.ccr_activity_id
    )
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
