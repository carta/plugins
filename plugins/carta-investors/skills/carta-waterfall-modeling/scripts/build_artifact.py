# /// script
# requires-python = ">=3.9"
# ///
"""Assemble the waterfall results page for ONE run from its source parts.

Everything the page shows is baked in here: the run's identity, the inputs the pre-run
review showed, and each entity's results as the skill's fetch loop returned them.

Source parts (all in the skill's resources/ dir):
  waterfall-results.template.html — page skeleton + injection markers
  waterfall-results.css           — styles        (marker: /* __WF_CSS__ */)
  app/core.js, views.js, main.js  — page logic, concatenated in that order
                                    (marker: /* __WF_APP_JS__ */)
  app/demo-data.js                — canned data, prepended only with --demo
                                    (marker: /* __WF_DEMO_JS__ */)

The run's values are JSON-encoded into the page, never pasted into HTML or JS by hand, and
`<`, `>` and `&` are escaped so a name that contains `</script>` cannot end the script.

Usage (the skill's path): every run value as one JSON object on stdin, through a quoted
heredoc, so no API-sourced text (a name with an apostrophe, a `$`, a backtick) is ever
parsed by the shell:
  uv run scripts/build_artifact.py --config - --out <path>.html <<'WF_CONFIG_EOF'
  {"owner_kind": "FIRM", ..., "entities": [...]}
  WF_CONFIG_EOF

Or, field by field (tests and local use):
  uv run scripts/build_artifact.py \
      --owner-kind FIRM --owner-id <org_pk> \
      --target-kind <kind> --target-id <id> --execution-id <id> \
      --get-command <get_command> \
      --target-name "<name>" --root-name "<root name>" [--multi-entity] \
      --inputs '[{"label": "...", "display_value": "..."}]' \
      --equity-value <decimal> --waterfall-date <YYYY-MM-DD> [--currency GBP] \
      --entities '[{"display_name": ..., "is_root": true, "allocations": [...], ...}]' \
      --out <path>.html [--demo]

Prints the output path. Exits non-zero, writing nothing, when any value is invalid.

--demo is for local review only — never publish one. It swaps in canned results; pick a
state with `?demo=` (single, multi, core).
"""
import argparse
import json
import re
import sys
from decimal import Decimal, InvalidOperation
from html import escape
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RES = SKILL_DIR / "resources"

TEMPLATE = "waterfall-results.template.html"
CSS = "waterfall-results.css"
APP_JS_PARTS = ["app/core.js", "app/views.js", "app/main.js"]
DEMO_JS_PART = "app/demo-data.js"

KIND_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,39}$")
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:\-]{0,99}$")
CURRENCY_RE = re.compile(r"^[A-Z]{3}$")
DECIMAL_RE = re.compile(r"^-?\d{1,30}(\.\d{1,12})?$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
# domain:get:noun, and only the two nouns the page knows how to draw.
GET_COMMAND_RE = re.compile(r"^[a-z_]+:get:(niagara_results|core_results)$")
# The Carta web app's own address, as get_current_user reports it, in any environment.
BASE_URL_RE = re.compile(r"^https://app(\.[a-z0-9-]+)*\.carta\.(com|team|rocks)$")
UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)
MAX_NAME = 200
MAX_INPUTS = 20
MAX_INPUT_TEXT = 200
MAX_ENTITIES = 50
ENTITY_KEYS = {"display_name", "is_root", "allocations", "breakpoints", "grand_totals"}

DEMO_VALUES = {
    "owner_kind": "FIRM", "owner_id": "1001",
    "target_kind": "LLC_INTEREST_ISSUER", "target_id": "demo-target-1",
    "execution_id": "demo-exec-1",
    "get_command": "waterfall_modeling:get:niagara_results",
    "target_name": "Northwind Holdings LLC", "root_name": "Northwind Holdings LLC",
    "inputs": [{"label": "Equity value", "display_value": "10,000,000.00"}],
    "equity_value": "10000000.00", "waterfall_date": "2026-06-30",
    "entities": [{"display_name": "Northwind Holdings LLC", "is_root": True, "allocations": [],
                  "breakpoints": None, "grand_totals": None}],
}


class ConfigError(ValueError):
    """A baked value failed validation. The message names the argument."""


def _need(cond, message):
    if not cond:
        raise ConfigError(message)


def _text(cfg, key, flag):
    value = cfg.get(key)
    _need(isinstance(value, str) and value.strip() != "", "{} is required".format(flag))
    _need(len(value) <= MAX_NAME, "{} is longer than {} characters".format(flag, MAX_NAME))
    _need(not re.search(r"[\x00-\x1f\x7f]", value), "{} contains a control character".format(flag))
    return value


def validate(cfg):
    """Return the validated config dict that is baked into the page, or raise ConfigError."""
    out = {}
    for key, flag, rx in (
        ("owner_kind", "--owner-kind", KIND_RE), ("target_kind", "--target-kind", KIND_RE),
        ("owner_id", "--owner-id", ID_RE), ("target_id", "--target-id", ID_RE),
        ("execution_id", "--execution-id", ID_RE),
    ):
        value = cfg.get(key)
        _need(isinstance(value, str) and rx.match(value),
              "{} is not a valid value: {!r}".format(flag, value))
        out[key] = value
    command = cfg.get("get_command")
    _need(isinstance(command, str) and GET_COMMAND_RE.match(command),
          "--get-command must be <domain>:get:niagara_results or <domain>:get:core_results; "
          "got {!r}".format(command))
    out["get_command"] = command
    out["target_name"] = _text(cfg, "target_name", "--target-name")
    out["root_name"] = _text(cfg, "root_name", "--root-name")
    out["is_multi_entity"] = bool(cfg.get("is_multi_entity"))

    inputs = cfg.get("inputs")
    _need(isinstance(inputs, list) and 0 < len(inputs) <= MAX_INPUTS,
          "--inputs must be a JSON list of 1 to {} {{label, display_value}} objects".format(MAX_INPUTS))
    clean = []
    for item in inputs:
        _need(isinstance(item, dict) and set(item) == {"label", "display_value"}
              and all(isinstance(item[k], str) and 0 < len(item[k]) <= MAX_INPUT_TEXT for k in item),
              "--inputs entries must be {{label, display_value}} with non-empty text; got {!r}".format(item))
        clean.append({"label": item["label"], "display_value": item["display_value"]})
    out["inputs"] = clean

    equity = cfg.get("equity_value")
    _need(isinstance(equity, str) and DECIMAL_RE.match(equity),
          "--equity-value must be a raw decimal string; got {!r}".format(equity))
    out["equity_value"] = equity
    date = cfg.get("waterfall_date")
    _need(isinstance(date, str) and DATE_RE.match(date),
          "--waterfall-date must be YYYY-MM-DD; got {!r}".format(date))
    out["waterfall_date"] = date
    # A run whose options carry no currency is USD.
    currency = cfg.get("currency") or "USD"
    _need(isinstance(currency, str) and CURRENCY_RE.match(currency),
          "--currency must be an ISO 4217 code like USD; got {!r}".format(currency))
    out["currency"] = currency
    out["carta_url"] = carta_url(cfg.get("base_url"), out)
    out["entities"] = entities(cfg.get("entities"))
    return out


def entities(value):
    """Each entity's results, root first, in the results doc's per-entity shape."""
    _need(isinstance(value, list) and 0 < len(value) <= MAX_ENTITIES,
          "--entities must be a JSON list of 1 to {} entities".format(MAX_ENTITIES))
    clean = []
    for i, e in enumerate(value):
        _need(isinstance(e, dict) and set(e) == ENTITY_KEYS,
              "--entities[{}] must have exactly the keys {}".format(i, sorted(ENTITY_KEYS)))
        name = e["display_name"]
        _need(name is None or (isinstance(name, str) and len(name) <= MAX_NAME
                               and not re.search(r"[\x00-\x1f\x7f]", name)),
              "--entities[{}].display_name must be text or null".format(i))
        _need(e["is_root"] is (i == 0),
              "--entities must list the root first and only once; entity {} has is_root={!r}".format(i, e["is_root"]))
        _need(isinstance(e["allocations"], list) and all(isinstance(r, dict) for r in e["allocations"]),
              "--entities[{}].allocations must be a list of rows".format(i))
        _need(e["breakpoints"] is None or (isinstance(e["breakpoints"], list)
                                           and all(isinstance(b, dict) for b in e["breakpoints"])),
              "--entities[{}].breakpoints must be a list of tiers or null".format(i))
        _need(e["grand_totals"] is None or isinstance(e["grand_totals"], dict),
              "--entities[{}].grand_totals must be an object or null".format(i))
        clean.append({k: e[k] for k in ENTITY_KEYS})
    return clean


def carta_url(base, out):
    """The deal-group page that opens this exact run, or None.

    Only a deal group has a page that takes a run id (`?graphId=`). A base address that is
    present but not Carta's fails the build; ids of the wrong shape just mean no link."""
    if base in (None, ""):
        return None
    _need(isinstance(base, str) and BASE_URL_RE.match(base.rstrip("/")),
          "--base-url must be the Carta app address, like https://app.carta.com; got {!r}".format(base))
    if out["target_kind"] != "CORPORATION_DEAL_GROUP":
        return None
    if not (out["owner_id"].isdigit() and UUID_RE.match(out["target_id"]) and UUID_RE.match(out["execution_id"])):
        return None
    return "{}/investors/firm/{}/portfolio/deal-group/{}/waterfall-modeling?graphId={}".format(
        base.rstrip("/"), out["owner_id"], out["target_id"], out["execution_id"])


def page_title(cfg):
    """`<title>` text. The Artifact tool names the published page from it, and every run
    gets its own page, so the title carries the amount and date that tell runs apart."""
    try:
        amount = "{:,f}".format(Decimal(cfg["equity_value"]))
        if "." in amount:
            amount = amount.rstrip("0").rstrip(".")
    except InvalidOperation:
        amount = cfg["equity_value"]
    return escape("{} waterfall, {} {} on {}".format(
        cfg["target_name"], cfg["currency"], amount, cfg["waterfall_date"]), quote=False)


def config_json(cfg):
    """JSON for a `var X = ...;` line inside the page's one <script>.

    ASCII-only plus `<`, `>` and `&` escaped, so no value can close the script tag, open an
    HTML comment, or carry a line terminator that JavaScript would read as a break."""
    text = json.dumps(cfg, ensure_ascii=True, separators=(",", ":"))
    return text.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")


EXTERNAL_SCRIPT_RE = re.compile(r"<script\b[^>]*\bsrc\s*=", re.IGNORECASE)
EXTERNAL_LINK_RE = re.compile(r"<link\b[^>]*\bhref\s*=\s*[\"']?\s*(?:https?:)?//", re.IGNORECASE)
EXTERNAL_IMG_RE = re.compile(r"<(?:img|source|iframe)\b[^>]*\bsrc\s*=\s*[\"']?\s*(?:https?:)?//", re.IGNORECASE)
CSS_IMPORT_RE = re.compile(r"@import|url\(\s*[\"']?\s*(?:https?:)?//", re.IGNORECASE)
LEFTOVER_RE = re.compile(r"__WF_[A-Z_]+__|\{\{[A-Z_]+\}\}")


def build(cfg, demo=False):
    """Return the assembled HTML for a validated-or-raw config. Raises ConfigError."""
    cfg = validate(cfg)
    template = (RES / TEMPLATE).read_text(encoding="utf-8")
    css = (RES / CSS).read_text(encoding="utf-8")
    app_js = "\n\n".join((RES / name).read_text(encoding="utf-8") for name in APP_JS_PARTS)
    demo_js = (RES / DEMO_JS_PART).read_text(encoding="utf-8") if demo else ""

    out = template
    for marker, content in (("/* __WF_CSS__ */", css), ("/* __WF_DEMO_JS__ */", demo_js),
                            ("/* __WF_APP_JS__ */", app_js)):
        if marker not in out:
            raise ConfigError("template is missing {}".format(marker))
        out = out.replace(marker, content, 1)

    # Only the two run-specific slots may remain. They are filled in one pass below, so a
    # value that happens to contain placeholder-looking text is never expanded or flagged.
    leftover = [m for m in LEFTOVER_RE.findall(out) if m not in ("{{PAGE_TITLE}}", "{{CONFIG_JSON}}")]
    if leftover:
        raise ConfigError("unresolved placeholder(s) after assembly: {}".format(sorted(set(leftover))))

    values = {"{{PAGE_TITLE}}": page_title(cfg), "{{CONFIG_JSON}}": config_json(cfg)}
    out = re.sub(r"\{\{PAGE_TITLE\}\}|\{\{CONFIG_JSON\}\}", lambda m: values[m.group(0)], out)

    for rx, what in ((EXTERNAL_SCRIPT_RE, "<script src=>"), (EXTERNAL_LINK_RE, "an external <link href>"),
                     (EXTERNAL_IMG_RE, "an external image or frame"), (CSS_IMPORT_RE, "a CSS @import or external url()")):
        if rx.search(out):
            raise ConfigError("the page would load {}; the runtime blocks it".format(what))

    if demo:
        # Local review only: the skeleton the Artifact tool would otherwise add.
        out = ('<!doctype html>\n<meta charset="utf-8">\n'
               '<meta name="viewport" content="width=device-width, initial-scale=1">\n') + out
    return out


def _parser():
    ap = argparse.ArgumentParser(description="Assemble the waterfall results page for one run.")
    ap.add_argument("--config", help="'-' to read every run value as one JSON object from stdin")
    ap.add_argument("--owner-kind")
    ap.add_argument("--owner-id")
    ap.add_argument("--target-kind")
    ap.add_argument("--target-id")
    ap.add_argument("--execution-id")
    ap.add_argument("--get-command")
    ap.add_argument("--target-name")
    ap.add_argument("--root-name")
    ap.add_argument("--multi-entity", action="store_true")
    ap.add_argument("--inputs", help="JSON list of {label, display_value}")
    ap.add_argument("--equity-value")
    ap.add_argument("--waterfall-date")
    ap.add_argument("--currency")
    ap.add_argument("--base-url", help="Carta app address from get_current_user; deal groups get an Open in Carta link")
    ap.add_argument("--entities", help="JSON list of each entity's results, root first")
    ap.add_argument("--out", required=True)
    ap.add_argument("--demo", action="store_true",
                    help="swap in canned demo results; every run value becomes optional. NEVER publish.")
    return ap


def main(argv=None):
    args = _parser().parse_args(argv)
    cfg = {
        "owner_kind": args.owner_kind, "owner_id": args.owner_id,
        "target_kind": args.target_kind, "target_id": args.target_id,
        "execution_id": args.execution_id, "get_command": args.get_command,
        "target_name": args.target_name, "root_name": args.root_name,
        "is_multi_entity": args.multi_entity or None, "equity_value": args.equity_value,
        "waterfall_date": args.waterfall_date, "currency": args.currency,
        "base_url": args.base_url,
    }
    try:
        if args.config is not None:
            if args.config != "-":
                raise ConfigError("--config only accepts '-' (read the JSON object from stdin)")
            try:
                loaded = json.loads(sys.stdin.read())
            except ValueError as exc:
                raise ConfigError("--config is not valid JSON: {}".format(exc))
            if not isinstance(loaded, dict):
                raise ConfigError("--config must be one JSON object")
            for key, value in loaded.items():
                if cfg.get(key) is None:
                    cfg[key] = value
        for flag in ("inputs", "entities"):
            raw = getattr(args, flag)
            if raw is not None:
                try:
                    cfg[flag] = json.loads(raw)
                except ValueError as exc:
                    raise ConfigError("--{} is not valid JSON: {}".format(flag, exc))
        if args.demo:
            for key, value in DEMO_VALUES.items():
                if cfg.get(key) is None:
                    cfg[key] = value
        html = build(cfg, demo=args.demo)
    except ConfigError as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return 1
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(html, encoding="utf-8")
    if args.demo:
        print("[DEMO DATA — DO NOT PUBLISH]", file=sys.stderr)
    print(out_path.resolve())
    return 0


if __name__ == "__main__":
    sys.exit(main())
