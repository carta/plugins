# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the self-contained captable-home live artifact from its source parts.

Inlines the body, CSS and JS parts into the template and fills its config block, producing ONE self-contained HTML file the Artifact tool publishes
by path. The model never has to read the large HTML: to change what the
directory shows, edit resources/captable-home.config.js; to change logic, edit
resources/captable-home.app.js; then re-run this.

Source parts: resources/bundle.json lists the body HTML, CSS and JS parts in load order, as
paths inside the skill as carta-mcp serves it (`vendor/` is the plugin's vendor/ here). The
body and the CSS fill their own markers. The JS parts fill /* __CAPTABLE_HOME_JS__ */ as one
script, joined in list order the way the shell's loader joins them. carta-mcp serves the same
parts, in the same order, to the small shell page (resources/captable-home.shell.html) that
loads them at open.

The Skill Directory's entries come from the plugin's .claude-plugin/skill-directory.json
(placeholder: {{SKILL_DIRECTORY_JSON}}), baked in as the fallback for the published copy
the page reads from carta-mcp at open time.

The artifact's version comes from the plugin's skill-versions registry, keyed by this
skill (placeholder: {{ARTIFACT_VERSION}}). It lives there rather than beside the skill
because carta-mcp serves it to the running artifact from the published carta/plugins
mirror, and a skill that has not opted into publishing never reaches that mirror —
whereas .claude-plugin/ is plugin-level metadata and is always published.

The `{{CARTA_MCP_SERVER_JSON}}` placeholder (in the template's config block) is replaced with
the Carta connector's display name, as JSON — what the artifact runtime's mcp capability
addresses a connector by. Every per-company and per-build value sits in that one config
block (`window.CAPTABLE_HOME`), never in a JS part, so the parts are the same for every page.

One built page serves one company: `{{CORPORATION_ID}}`, `{{COMPANY_NAME_JSON}}` and
`{{PAGE_TITLE}}` are baked in, and the artifact is published as "Carta Home - <company>".
Build again to serve another company.

The title has to come from the file. The Artifact tool reads `<title>` out of the HTML and
only falls back to its own `title` parameter when the file carries none — so a template
with a fixed title publishes every company's page under that one name.

Usage:
  uv run scripts/build_artifact.py --mcp-server <connector-display-name> \
      --corporation-id <corporation_id> --company-name "<company legal name>" \
      --out <path>/captable-home-<slug>.html
  uv run scripts/build_artifact.py --write-shell
"""
import argparse
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from html import escape
from pathlib import Path

# The plugin's shared lib/ sits above the skill; walk up so this runs standalone under `uv run`.
for _root in Path(__file__).resolve().parents:
    if (_root / "lib" / "script_json.py").is_file():
        sys.path.insert(0, str(_root / "lib"))
        break
from script_json import script_json  # noqa: E402

SKILL_DIR = Path(__file__).resolve().parent.parent
RES = SKILL_DIR / "resources"
VENDOR_DIR = SKILL_DIR.parent.parent / "vendor"  # plugin root / vendor/

SKILL_NAME = SKILL_DIR.name
VERSIONS_FILE = SKILL_DIR.parent.parent / ".claude-plugin" / "skill-versions.json"
# The Skill Directory's entries, keyed by skill. Baked in as the page's fallback; the
# page asks carta-mcp for the published copy of the same file when it opens.
DIRECTORY_FILE = SKILL_DIR.parent.parent / ".claude-plugin" / "skill-directory.json"
SKILLS_ROOT = SKILL_DIR.parent
# A built artifact can never update itself, so it carries its version with it and
# compares against the published one at runtime. Strict major.minor.patch.
SEMVER_RE = re.compile(r"^\d+\.\d+\.\d+$")

BUNDLE_FILE = RES / "bundle.json"
SHELL_FILE = RES / "captable-home.shell.html"
LOADER_FILE = RES / "captable-home.loader.js"

# The body and CSS parts, each with its marker in the template.
MARKERS = {
    "resources/captable-home.body.html": r"<!--\s*__CAPTABLE_HOME_BODY_HTML__\s*-->\n",
    "resources/captable-home.css": r"/\*\s*__CAPTABLE_HOME_CSS__\s*\*/",
}
# Every JS part, in bundle.json order, as one script. chart.js v4.5.1 is one of them: replace
# vendor/chart.umd.min.js to upgrade.
JS_MARKER = r"/\*\s*__CAPTABLE_HOME_JS__\s*\*/"
# The loader's join: a part that ends without a semicolon cannot run into the next one.
JS_JOIN = "\n;\n"
# A <script> or <style> element that holds only build markers: the shell drops each one and
# puts the loader in the JS slot.
MARKER_ELEMENT = re.compile(r"[ \t]*<(script|style)>\s*(?:/\*\s*__CAPTABLE_HOME_\w+__\s*\*/\s*)+</\1>\n")
HTML_COMMENT = re.compile(r"[ \t]*<!--.*?-->\n?", re.DOTALL)
# The model writes the shell out token by token, so it carries no indent.
INDENT = re.compile(r"^[ \t]+", re.MULTILINE)
# The shell has no build. It reads the published Skill Directory, and the loader sets the
# version and build id from carta-mcp's answer. No build time turns the update check off: the
# shell always runs the newest parts.
SHELL_VALUES = {
    "SKILL_DIRECTORY_JSON": "[]", "SKILL_OPT_OUTS_JSON": "[]", "BUILD_ID": "", "ARTIFACT_VERSION": "", "BUILT_AT": "",
}


def read_bundle():
    """Return resources/bundle.json: {"version", "html": [path], "css": [path], "js": [path]},
    in load order."""
    bundle = json.loads(BUNDLE_FILE.read_text())
    listed = bundle_paths(bundle)
    missing = [path for path in MARKERS if path not in listed]
    if missing:
        sys.exit("ERROR: {} does not list {}".format(BUNDLE_FILE.name, ", ".join(missing)))
    unplaced = [path for path in bundle["html"] + bundle["css"] if path not in MARKERS]
    if unplaced:
        sys.exit("ERROR: the template has no marker for {}".format(", ".join(unplaced)))
    return bundle


def bundle_paths(bundle):
    """Every part bundle.json lists, in load order."""
    return bundle["html"] + bundle["css"] + bundle["js"]


def part_file(path):
    """The local file of a bundle path: `vendor/` sits at the plugin root here."""
    if path.startswith("vendor/"):
        return VENDOR_DIR / path[len("vendor/"):]
    return SKILL_DIR / path


def build_shell():
    """The shell page: the template's head and config block, with the loader as its whole
    body, and only the placeholders the model fills by hand left in the config block."""
    loader = LOADER_FILE.read_text()
    out = MARKER_ELEMENT.sub(
        lambda m: "<script>\n" + loader + "</script>\n" if re.search(JS_MARKER, m.group(0)) else "",
        (RES / "captable-home.template.html").read_text(),
    )
    out = INDENT.sub("", HTML_COMMENT.sub("", out))
    return re.sub(r"\{\{(" + "|".join(SHELL_VALUES) + r")\}\}", lambda m: SHELL_VALUES[m.group(1)], out)


CORP_ID_PREFIX = "corporation_pk:"

# The published artifact's name, and the key SKILL.md Step 2 matches on to find this
# company's existing page. One company per page, so one title per company.
TITLE_PREFIX = "Carta Home - "


def page_title(company_name):
    """The `<title>` text for this company's page.

    Escapes only the three characters that would end the tag or start an entity —
    a company named `Smith & Sons <Holdings>` otherwise produces malformed HTML.
    Quotes are left alone: this is element text, not an attribute.
    """
    return escape(TITLE_PREFIX + company_name, quote=False)


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

    Fails the build rather than defaulting: a wrong version is worse than no build.
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


def read_skill_directory():
    """Return the baked Skill Directory: a list of {skill, category, name, order, prompts},
    plus `tag`, `whatsNew` and `whatsNewCopy` where an entry sets them.

    Opt-outs (null) are dropped, and so is any skill this install does not carry: the
    file is plugin-level and always published, but a skill without `publish: true` never
    reaches a customer's install, and its prompts would route nowhere. Fails the build on
    a missing or unreadable file, like the version registry.
    """
    if not DIRECTORY_FILE.exists():
        sys.exit("ERROR: {} is missing".format(DIRECTORY_FILE))
    try:
        data = json.loads(DIRECTORY_FILE.read_text())
    except ValueError as exc:
        sys.exit("ERROR: {} is not valid JSON: {}".format(DIRECTORY_FILE.name, exc))
    if not isinstance(data, dict):
        sys.exit("ERROR: {} must be an object keyed by skill".format(DIRECTORY_FILE.name))
    entries = []
    for skill, entry in sorted(data.items()):
        if entry is None or not (SKILLS_ROOT / skill / "SKILL.md").exists():
            continue
        baked = {
            "skill": skill,
            "category": entry["category"],
            "name": entry["name"],
            "order": entry.get("order", 0),
            "prompts": entry["prompts"],
        }
        baked.update({k: entry[k] for k in ("tag", "whatsNew", "whatsNewCopy") if k in entry})
        entries.append(baked)
    return entries


def read_skill_opt_outs():
    """Return the skills the directory file opts out with null, that this install carries.

    The bake drops them from the list, but the published list the page reads from
    plugin:list:skills can lag this file and still carry one of them, so What's new keeps
    these out by name.
    """
    data = json.loads(DIRECTORY_FILE.read_text())
    return sorted(
        skill for skill, entry in data.items()
        if entry is None and (SKILLS_ROOT / skill / "SKILL.md").exists()
    )


def directory_json(entries):
    """JSON for inlining into the page's one <script>; no prompt can close the tag early."""
    return script_json(entries)


def normalize_corporation_id(raw):
    """Reject an id that still carries list_accounts' `corporation_pk:` prefix.

    Every cap_table command wants the bare pk, and a prefixed one fails at runtime
    inside a published page — far from here. Fail at build time instead.
    """
    value = (raw or "").strip()
    if not value:
        sys.exit("ERROR: --corporation-id is empty")
    if value.startswith(CORP_ID_PREFIX):
        sys.exit(
            "ERROR: --corporation-id must be the bare pk, not {!r} — strip the {!r} prefix".format(
                value, CORP_ID_PREFIX
            )
        )
    return value


def build(mcp_server, corporation_id, company_name):
    template = (RES / "captable-home.template.html").read_text()
    bundle = read_bundle()
    parts = {path: part_file(path).read_text() for path in bundle_paths(bundle)}
    skill_directory = directory_json(read_skill_directory())
    skill_opt_outs = directory_json(read_skill_opt_outs())
    # The directory is content like any source part, so it moves the build id too.
    build_id = compute_build_id(
        template, {**parts, DIRECTORY_FILE.name: skill_directory + skill_opt_outs}
    )

    out = template
    for path, marker in MARKERS.items():
        if not re.search(marker, out):
            sys.exit("ERROR: marker for {} missing from template".format(path))
        # Use a function replacement so backslashes / $-refs in the content are literal.
        out = re.sub(marker, lambda _m, c=parts[path]: c, out, count=1)

    js = JS_JOIN.join(parts[path] for path in bundle["js"])
    if not re.search(JS_MARKER, out):
        sys.exit("ERROR: marker for the JS missing from template")
    out = re.sub(JS_MARKER, lambda _m, c=js: c, out, count=1)

    # A leftover build-time marker means an incomplete assembly: fail loudly.
    leftover = re.search(r"__CAPTABLE_HOME_\w+__", out)
    if leftover:
        sys.exit("ERROR: unresolved marker {} after assembly".format(leftover.group(0)))

    # One pass over the assembled page, so a substituted value (a company name that spells
    # out another marker) is never scanned again.
    version = read_version()
    values = {
        # Both names land as JS values in the config block's <script>: a quote or backslash
        # would be a SyntaxError killing every card, and `</script>` or `<!--` would end
        # or derail the script.
        "CARTA_MCP_SERVER_JSON": script_json(mcp_server),
        "CORPORATION_ID": corporation_id,
        "COMPANY_NAME_JSON": script_json(company_name),
        "SKILL_DIRECTORY_JSON": skill_directory,
        "SKILL_OPT_OUTS_JSON": skill_opt_outs,
        "PAGE_TITLE": page_title(company_name),
        "BUILD_ID": build_id,
        # The update banner stays quiet for a week after this time (see app/version-check.js).
        "BUILT_AT": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "ARTIFACT_VERSION": version,
    }
    out = re.sub(r"\{\{(" + "|".join(values) + r")\}\}", lambda m: values[m.group(1)], out)

    return out, build_id, version


def main():
    ap = argparse.ArgumentParser(description="Assemble the captable-home artifact.")
    ap.add_argument("--write-shell", action="store_true",
                    help="write resources/captable-home.shell.html from the template and loader, then stop")
    ap.add_argument("--mcp-server",
                    help="Carta connector display name (the {{CARTA_MCP_SERVER_JSON}} value)")
    ap.add_argument("--corporation-id",
                    help="bare corporation pk this page is built for (no corporation_pk: prefix)")
    ap.add_argument("--company-name",
                    help="company display name — shown on the page and, as "
                         "'Carta Home - <name>', in the page's <title> and so the "
                         "published artifact's name")
    ap.add_argument("--out", help="output HTML path")
    args = ap.parse_args()

    if args.write_shell:
        shell = build_shell()
        SHELL_FILE.write_text(shell)
        print("wrote {} ({} bytes)".format(SHELL_FILE, len(shell.encode("utf-8"))))
        return
    missing = [flag for flag, value in (("--mcp-server", args.mcp_server), ("--corporation-id", args.corporation_id),
                                        ("--company-name", args.company_name), ("--out", args.out)) if value is None]
    if missing:
        ap.error("the following arguments are required: " + ", ".join(missing))

    company_name = args.company_name.strip()
    if not company_name:
        sys.exit("ERROR: --company-name is empty")

    html, build_id, version = build(
        args.mcp_server, normalize_corporation_id(args.corporation_id), company_name
    )
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    print(
        'wrote {} ({} bytes) — v{} build {} — publishes as "{}{}"'.format(
            out_path, len(html.encode("utf-8")), version, build_id,
            TITLE_PREFIX, company_name,
        )
    )


if __name__ == "__main__":
    main()
