# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the self-contained carta-workhub Cowork artifact from its source parts.

Inlines the CSS + config + app JS into the template and substitutes the Carta MCP
server id, producing ONE self-contained HTML file ready for the Artifact tool's
publish action. The model never has to read the large HTML: to change the composer
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

# The part list, its order and the template markers are shared with the hosted Worker
# (app/server/worker.js), which assembles the same page at request time — one list, so
# the two surfaces cannot run different code. App parts are concatenated in order into
# the one app-JS slot; the pdf.js worker bundle goes first because it defines
# globalThis.pdfjsWorker, which the library looks for when asked to parse. pdf.js is
# vendored because the artifact's CSP blocks every external host — see
# resources/vendor/README.md.
PARTS = json.loads((SKILL_DIR / "scripts" / "artifact_parts.json").read_text())
APP_JS_PARTS = PARTS["app_js_parts"]
PDFJS_PARTS = PARTS["pdfjs_parts"]


def marker_re(token):
    return r"/\*\s*" + token + r"\s*\*/"


MARKERS = {name: marker_re(token) for name, token in PARTS["markers"].items()}
APP_JS_MARKER = marker_re(PARTS["app_js_marker"])
PDFJS_MARKER = marker_re(PARTS["pdfjs_marker"])
PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_]+\}\}")


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


def build(mcp_server, ccr_fund_uuid="", ccr_activity_id="", frt_seed_period=""):
    template = (RES / PARTS["template"]).read_text()
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
    for token in [*PARTS["markers"].values(), PARTS["app_js_marker"], PARTS["pdfjs_marker"]]:
        if token in out:
            sys.exit("ERROR: unresolved marker {} after assembly".format(token))

    # Every placeholder the template and parts carry is named in artifact_parts.json; the
    # hosted Worker fills the same list with its own values.
    values = {
        "{{CARTA_MCP_SERVER}}": mcp_server,
        # Empty is the normal case: the panel then opens only from a task card.
        "{{CCR_FUND_UUID}}": ccr_fund_uuid or "",
        "{{CCR_ACTIVITY_ID}}": ccr_activity_id or "",
        # Empty is the normal case: tracker cards then exist only for periods that need the GP.
        "{{FRT_SEED_PERIOD}}": frt_seed_period or "",
        "{{BUILD_ID}}": build_id,
    }
    version = read_version()
    values["{{ARTIFACT_VERSION}}"] = version
    for placeholder in PARTS["placeholders"]:
        if placeholder not in values:
            sys.exit("ERROR: no value for {} (listed in artifact_parts.json)".format(placeholder))
        out = out.replace(placeholder, values[placeholder])
    left = PLACEHOLDER_RE.search(out)
    if left:
        sys.exit("ERROR: {} still present after substitution".format(left.group(0)))

    return out, build_id, version


def main():
    ap = argparse.ArgumentParser(description="Assemble the carta-workhub artifact.")
    ap.add_argument("--mcp-server", required=True,
                    help="Carta connector display name (the {{CARTA_MCP_SERVER}} value)")
    ap.add_argument("--ccr-fund-uuid", default="",
                    help="seed the capital call review panel with this fund UUID")
    ap.add_argument("--ccr-activity-id", default="",
                    help="seed the capital call review panel with this activity ShortUUID")
    ap.add_argument("--frt-seed-period", default="",
                    help='seed one Financial Reporting Tracker card for this period, e.g. "Q2 2026"')
    ap.add_argument("--out", required=True, help="output HTML path")
    args = ap.parse_args()

    html, build_id, version = build(
        args.mcp_server, args.ccr_fund_uuid, args.ccr_activity_id, args.frt_seed_period
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
