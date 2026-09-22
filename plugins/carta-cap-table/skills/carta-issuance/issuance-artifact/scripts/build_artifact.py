# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the self-contained issuance live artifact from its source parts.

long-comment-ok: the build contract — which file feeds which marker, and why the
HTML never passes through a model's context.

Inlines the CSS and the three JS parts into one HTML file the Artifact tool
publishes by path, so the ~90KB of markup is never read or written by a model. To
change the form, edit resources/issuance.form.js; to change how the page reaches
Carta, edit resources/issuance.transport.js; then re-run this.

Source parts (all in the skill's resources/ dir):
  issuance.template.html   — page skeleton + injection markers
  issuance.css             — styles            (marker: /* __ISSUANCE_CSS__ */)
  issuance.transport.js    — host transport    (marker: /* __ISSUANCE_TRANSPORT_JS__ */)
  issuance.form.js         — form logic        (marker: /* __ISSUANCE_FORM_JS__ */)
  issuance.boot.js         — bring-up          (marker: /* __ISSUANCE_BOOT_JS__ */)

One built page serves one company and one security type. `--seed` takes a PATH to a
JSON file, never an inline payload. The seed is what the *prompt* supplied — names,
quantity, issue date, or rows from the import sub-skill — so the page can prefill the
form on first paint and resolve those names against the cap table itself. An absent or
empty seed is fine: the page then opens with one blank recipient row.

`--preview` builds a development page instead: all three types, their review stages
and the validation-error state on one page, with every Carta write refused in the
transport. It adds resources/issuance.preview.{js,css} and nothing else; without the
flag the output is byte-for-byte the production page.

Usage:
  uv run scripts/build_artifact.py --corporation-id <corporation_id> \
      --company-name "<company legal name>" --security-type option_grant \
      --seed <path>/seed.json --out <path>/issuance-<slug>-option-grant.html

  uv run scripts/build_artifact.py --corporation-id <corporation_id> \
      --company-name "<company legal name>" --preview \
      --out <path>/issuance-<slug>-preview.html
"""
import argparse
import hashlib
import json
import re
import sys
from html import escape
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RES = SKILL_DIR / "resources"

TEMPLATE = "issuance.template.html"

# Injected in this order; the JS parts land in one <script>, so the transport's
# helpers are defined before the form calls them and before boot runs.
MARKERS = [
    ("issuance.css", r"/\*\s*__ISSUANCE_CSS__\s*\*/"),
    ("issuance.transport.js", r"/\*\s*__ISSUANCE_TRANSPORT_JS__\s*\*/"),
    ("issuance.form.js", r"/\*\s*__ISSUANCE_FORM_JS__\s*\*/"),
    ("issuance.boot.js", r"/\*\s*__ISSUANCE_BOOT_JS__\s*\*/"),
]
MARKER_TOKENS = ("__ISSUANCE_CSS__", "__ISSUANCE_TRANSPORT_JS__",
                 "__ISSUANCE_FORM_JS__", "__ISSUANCE_BOOT_JS__")

# --preview only: appended to the part named on the left, so the template keeps its
# four markers and a production build stays byte-for-byte what it was.
PREVIEW_PARTS = (("issuance.css", "issuance.preview.css"),
                 ("issuance.boot.js", "issuance.preview.js"))
# The type a preview page opens on; its toolbar switches to the other two itself.
PREVIEW_FIRST_TYPE = "option_grant"

TOKENS = ("CORPORATION_ID", "COMPANY_NAME_JSON", "SECURITY_TYPE", "SEED_JSON",
          "PAGE_TITLE", "BUILD_ID")
TOKEN_RE = re.compile(r"\{\{([A-Z][A-Z0-9_]*)\}\}")

SECURITY_TYPES = ("option_grant", "certificate", "piu")

# Everything the seed may carry — the prompt's own knowns, per
# skills/carta-issuance/references/artifact-surface.md. Not a server payload.
SEED_KEYS = ("stakeholders", "quantity", "issue_date", "rows", "draft_set_id")

# The published artifact's name, and what SKILL.md matches on to find this company's
# existing page. One page per company and type, so one title per pair.
TITLE_VERB = {
    "option_grant": "Issue Option Grants",
    "certificate": "Issue Certificates",
    "piu": "Issue Profits Interest Units",
}

# A preview page holds every type, and its title must not match a real page's — that
# match is how SKILL.md finds the company's own page to republish.
PREVIEW_TITLE_VERB = "Issuance Form Preview"

CORP_ID_PREFIX = "corporation_pk:"
DIGITS_RE = re.compile(r"^\d+$")


def page_title(company_name, security_type, preview=False):
    """The `<title>` text, which names the published artifact.

    Escapes only the three characters that would end the tag or start an entity — a
    company named `Smith & Sons <Holdings>` otherwise produces malformed HTML. Quotes
    are left alone: this is element text, not an attribute.
    """
    verb = PREVIEW_TITLE_VERB if preview else TITLE_VERB[security_type]
    text = "{} — {}".format(verb, company_name)
    return escape(text, quote=False)


def js_json(value):
    """JSON for a value that lands inside one inline `<script>`.

    `</` has to be broken: a company name or a seed string containing `</script>`
    would otherwise close the block and kill every line after it.
    """
    return json.dumps(value).replace("</", "<\\/")


def corporation_id_js(raw):
    """The corporation id as a JS literal — a bare number when it is one, a quoted
    string otherwise, so an integer pk and a uuid pk both reach the wire unchanged.
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
    return value if DIGITS_RE.match(value) else js_json(value)


def read_seed(path):
    """The bootstrap payload, read from a file so it never travels as an argument.

    A missing file is a warning rather than a failure: the page works with no seed,
    and refusing to build would be worse than building one that loads its own data.
    """
    if not path:
        return {}
    p = Path(path)
    if not p.exists():
        print("WARNING: --seed {} does not exist — building a page that loads "
              "everything itself".format(p), file=sys.stderr)
        return {}
    text = p.read_text().strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except ValueError as exc:
        sys.exit("ERROR: --seed {} is not valid JSON: {}".format(p, exc))
    if not isinstance(data, dict):
        sys.exit("ERROR: --seed {} must hold a JSON object, got {}".format(
            p, type(data).__name__))
    return data


def compute_build_id(template, parts):
    """Short content hash of every source part, so a visible `build <id>` makes it
    obvious whether a published page is showing the latest build."""
    h = hashlib.sha256()
    h.update(template.encode("utf-8"))
    for name in sorted(parts):
        h.update(name.encode("utf-8"))
        h.update(parts[name].encode("utf-8"))
    return h.hexdigest()[:8]


def check_seed_shape(seed):
    """The seed holds what the prompt supplied and nothing else.

    An unknown key is usually a server payload pasted in by mistake, which would open a
    blank form and make the user retype what they already said. Name it and fail here.
    """
    unknown = sorted(k for k in seed if k not in SEED_KEYS)
    if unknown:
        sys.exit("ERROR: unknown seed key(s): {} — the seed holds only {}".format(
            ", ".join(unknown), ", ".join(SEED_KEYS)))
    names = seed.get("stakeholders")
    if names is not None and not (isinstance(names, list)
                                  and all(isinstance(n, str) for n in names)):
        sys.exit("ERROR: seed 'stakeholders' must be a list of name strings")
    rows = seed.get("rows")
    if rows is not None and not (isinstance(rows, list)
                                 and all(isinstance(r, dict) for r in rows)):
        sys.exit("ERROR: seed 'rows' must be a list of row objects")
    if not isinstance(seed.get("quantity", ""), (str, int, float)):
        sys.exit("ERROR: seed 'quantity' must be a number or a string")
    if not isinstance(seed.get("issue_date", ""), str):
        sys.exit("ERROR: seed 'issue_date' must be a YYYY-MM-DD string")
    # A draft_pk only means anything inside its own set. Without the set id the save
    # mints a second draft set of the same rows.
    pks = [r for r in (rows or []) if r.get("draft_pk") is not None]
    if pks and seed.get("draft_set_id") in (None, ""):
        sys.exit("ERROR: seed rows carry 'draft_pk' but the seed has no 'draft_set_id' — "
                 "a resume needs both, or the save creates a second draft set")


def build(corporation_id, company_name, security_type, seed, preview=False):
    if security_type not in SECURITY_TYPES:
        sys.exit("ERROR: --security-type must be one of {}".format(
            ", ".join(SECURITY_TYPES)))
    check_seed_shape(seed)

    template = (RES / TEMPLATE).read_text()
    parts = {name: (RES / name).read_text() for name, _ in MARKERS}
    if preview:
        for base, extra in PREVIEW_PARTS:
            path = RES / extra
            if not path.exists():
                sys.exit("ERROR: --preview needs {}, which is missing".format(path))
            parts[base] = parts[base] + "\n" + path.read_text()
    # After the preview parts land, so a preview page stamps its own id.
    build_id = compute_build_id(template, parts)

    out = template
    for name, marker in MARKERS:
        if not re.search(marker, out):
            sys.exit("ERROR: marker for {} missing from {}".format(name, TEMPLATE))
        # A function replacement keeps `$`-refs and backslashes in the content literal.
        out = re.sub(marker, lambda _m, c=parts[name]: c, out, count=1)

    for token in MARKER_TOKENS:
        if token in out:
            sys.exit("ERROR: unresolved marker {} after assembly".format(token))

    # Run before any content lands, so this reports what the sources ask for rather
    # than tripping over a `{{...}}` that arrived inside a company name or a seed.
    unknown = sorted(set(TOKEN_RE.findall(out)) - set(TOKENS))
    if unknown:
        sys.exit("ERROR: source asks for unknown token(s): {}".format(
            ", ".join("{{%s}}" % t for t in unknown)))

    values = {
        "CORPORATION_ID": corporation_id_js(corporation_id),
        "COMPANY_NAME_JSON": js_json(company_name),
        "SECURITY_TYPE": security_type,
        "SEED_JSON": js_json(seed),
        "PAGE_TITLE": page_title(company_name, security_type, preview),
        "BUILD_ID": build_id,
    }
    for token in TOKENS:
        placeholder = "{{%s}}" % token
        out = out.replace(placeholder, values[token])
        if placeholder in out:
            sys.exit("ERROR: {} still present after substitution".format(placeholder))

    return out, build_id


def main():
    ap = argparse.ArgumentParser(description="Assemble the issuance live artifact.")
    ap.add_argument("--corporation-id", required=True,
                    help="bare corporation pk this page is built for (no corporation_pk: prefix)")
    ap.add_argument("--company-name", required=True,
                    help="company display name — shown on the page and, with the "
                         "security type, in the <title> and so the published "
                         "artifact's name")
    ap.add_argument("--security-type", choices=list(SECURITY_TYPES),
                    help="which issuance form this page renders; required unless "
                         "--preview, where the page switches type itself")
    ap.add_argument("--preview", action="store_true",
                    help="build the development preview: one page holding all three "
                         "security types, their review stages and the validation-error "
                         "state, with every write to Carta refused in the transport")
    ap.add_argument("--seed",
                    help="PATH to a JSON file holding what the prompt supplied: "
                         "stakeholders (names verbatim), quantity, issue_date, rows, and "
                         "draft_set_id on a resume. Omit it when the prompt named nobody "
                         "and no terms")
    ap.add_argument("--out", required=True, help="output HTML path")
    args = ap.parse_args()

    company_name = args.company_name.strip()
    if not company_name:
        sys.exit("ERROR: --company-name is empty")

    security_type = args.security_type
    if not security_type:
        if not args.preview:
            ap.error("--security-type is required unless --preview is given")
        security_type = PREVIEW_FIRST_TYPE

    html, build_id = build(args.corporation_id, company_name, security_type,
                           read_seed(args.seed), args.preview)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html)
    verb = PREVIEW_TITLE_VERB if args.preview else TITLE_VERB[security_type]
    print('wrote {} ({} bytes) — build {} — publishes as "{} — {}"'.format(
        out_path, len(html.encode("utf-8")), build_id, verb, company_name))


if __name__ == "__main__":
    main()
