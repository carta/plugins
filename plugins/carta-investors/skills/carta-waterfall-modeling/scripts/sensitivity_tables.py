# /// script
# requires-python = ">=3.9"
# ///
"""Compare a batch of waterfall runs — one company, one date, several exit values.

Reads one JSON object (a file the Write tool creates) holding each entity's runs as the results
doc's fetch loop returned them, and prints the sensitivity tables of
`references/rendering.<get_command noun>.md` §Sensitivity tables as markdown, or with `--out`
builds the sensitivity page from the results page's own template:

  {"get_command", "target_name", "root_name", "is_multi_entity", "waterfall_date", "currency",
   "entities": [{"display_name", "is_root",
                 "runs": [{"equity_value", "allocations", "breakpoints", "proceeds", "grand_totals"}]}]}

Usage:
  uv run scripts/sensitivity_tables.py --config <path>.json [--out <path>.html]

Prints the tables, or the output path. Exits non-zero, writing nothing, when any value is invalid.
"""
import argparse
import json
import sys
from decimal import Decimal, InvalidOperation
from html import escape
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_artifact as page  # noqa: E402

DASH = "—"
SYMBOLS = {"USD": "$", "GBP": "£", "EUR": "€"}
ENTITY_KEYS = {"display_name", "is_root", "runs"}
RUN_KEYS = {"equity_value", "allocations", "breakpoints", "proceeds", "grand_totals"}

# Where each results shape keeps the fields the sensitivity tables read.
FIELDS = {
    "niagara_results": {
        "holder": lambda a: a.get("group_name"),
        "payout": lambda a: (a.get("allocated_proceeds") or {}).get("proceeds"),
        "total": lambda run: run.get("proceeds"),
        "tier": ("name", "from", "to", "proceeds_in_tier"),
    },
    "core_results": {
        "holder": lambda a: a.get("organization_name"),
        "payout": lambda a: a.get("value_of_holdings"),
        "total": lambda run: (run.get("grand_totals") or {}).get("value_of_holdings"),
        "tier": ("description", "from_value", "to_value", "value_in_tier"),
    },
}


def _dec(value):
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except InvalidOperation:
        raise page.ConfigError("not a number: {!r}".format(value))


def _str(value):
    return None if value is None else str(value)


def validate(cfg):
    """Return the validated config, each entity's runs sorted by exit value, or raise ConfigError."""
    page._need(isinstance(cfg, dict), "--config must be one JSON object")
    command = cfg.get("get_command")
    page._need(isinstance(command, str) and page.GET_COMMAND_RE.match(command),
               "get_command must be <domain>:get:niagara_results or <domain>:get:core_results; "
               "got {!r}".format(command))
    date = cfg.get("waterfall_date")
    page._need(isinstance(date, str) and page.DATE_RE.match(date),
               "waterfall_date must be YYYY-MM-DD; got {!r}".format(date))
    # A run whose options carry no currency is USD.
    currency = cfg.get("currency") or "USD"
    page._need(isinstance(currency, str) and page.CURRENCY_RE.match(currency),
               "currency must be an ISO 4217 code like USD; got {!r}".format(currency))
    entities = cfg.get("entities")
    page._need(isinstance(entities, list) and 0 < len(entities) <= page.MAX_ENTITIES,
               "entities must be a JSON list of 1 to {} entities".format(page.MAX_ENTITIES))
    clean, exit_values = [], None
    for i, e in enumerate(entities):
        page._need(isinstance(e, dict) and set(e) == ENTITY_KEYS,
                   "entities[{}] must have exactly the keys {}".format(i, sorted(ENTITY_KEYS)))
        page._need(e["is_root"] is (i == 0),
                   "entities must list the root first and only once; entity {} has is_root={!r}".format(i, e["is_root"]))
        runs = e["runs"]
        page._need(isinstance(runs, list) and all(isinstance(r, dict) and set(r) == RUN_KEYS for r in runs),
                   "entities[{}].runs must be runs with exactly the keys {}".format(i, sorted(RUN_KEYS)))
        for r in runs:
            page._need(isinstance(r["equity_value"], str) and page.DECIMAL_RE.match(r["equity_value"]),
                       "entities[{}] equity_value must be a raw decimal string; got {!r}".format(i, r["equity_value"]))
            page._need(isinstance(r["allocations"], list)
                       and (r["breakpoints"] is None or isinstance(r["breakpoints"], list)),
                       "entities[{}] runs need allocations as a list and breakpoints as a list or null".format(i))
        runs = sorted(runs, key=lambda r: Decimal(r["equity_value"]))
        values = [Decimal(r["equity_value"]) for r in runs]
        page._need(len(values) >= 2 and len(set(values)) == len(values),
                   "entities[{}] needs two or more runs, each at a different exit value".format(i))
        page._need(exit_values is None or values == exit_values, "every entity must carry the same exit values")
        exit_values = values
        clean.append({"display_name": e["display_name"], "is_root": e["is_root"], "runs": runs})
    return {
        "noun": command.split(":")[-1], "get_command": command,
        "target_name": page._text(cfg, "target_name", "target_name"),
        "root_name": page._text(cfg, "root_name", "root_name"),
        "is_multi_entity": bool(cfg.get("is_multi_entity")),
        "waterfall_date": date, "currency": currency, "entities": clean,
    }


def compare(entity, noun):
    """One entity's sensitivity tables: payout per holder and proceeds per breakpoint, by exit value."""
    f = FIELDS[noun]
    runs = entity["runs"]
    names, payouts = [], []
    for run in runs:
        by_holder = {}
        for a in run["allocations"]:
            name, value = f["holder"](a), _dec(f["payout"](a))
            if name not in names:
                names.append(name)
            if value is not None:
                by_holder[name] = by_holder.get(name, Decimal(0)) + value
        payouts.append(by_holder)
    top = payouts[-1]
    names.sort(key=lambda n: top.get(n, Decimal("-Infinity")), reverse=True)
    payout = {
        "rows": [{"name": n, "values": [_str(p.get(n)) for p in payouts]} for n in names],
        "totals": [_str(_dec(f["total"](run))) for run in runs],
    }
    name_k, from_k, to_k, proceeds_k = f["tier"]
    breakpoints = None
    if runs[-1]["breakpoints"]:
        breakpoints = []
        for i, tier in enumerate(runs[-1]["breakpoints"]):
            row = {
                "name": tier.get(name_k), "from": tier.get(from_k), "to": tier.get(to_k),
                "values": [_str(_dec(run["breakpoints"][i].get(proceeds_k)))
                           if i < len(run["breakpoints"] or []) else None for run in runs],
            }
            if isinstance(tier.get("allocations"), list):
                row["allocations"] = tier["allocations"]
            breakpoints.append(row)
    return {"display_name": entity["display_name"], "is_root": entity["is_root"],
            "payout": payout, "breakpoints": breakpoints}


def money(value, currency):
    if value is None:
        return DASH
    text = "{:,.2f}".format(Decimal(str(value)))
    return SYMBOLS[currency] + text if currency in SYMBOLS else "{} {}".format(currency, text)


def _table(header, rows):
    lines = [header, ["---"] * len(header)] + rows
    return "\n".join("| " + " | ".join(cells) + " |" for cells in lines)


def markdown(cfg):
    currency = cfg["currency"]
    heads = [money(r["equity_value"], currency) for r in cfg["entities"][0]["runs"]]
    parts = []
    for i, entity in enumerate(cfg["entities"]):
        c = compare(entity, cfg["noun"])
        if len(cfg["entities"]) > 1:
            parts.append("### " + (entity["display_name"] or "Entity {}".format(i + 1)))
        rows = [[r["name"] or DASH] + [money(v, currency) for v in r["values"]] for r in c["payout"]["rows"]]
        rows.append(["**Total**"] + ["**{}**".format(money(v, currency)) for v in c["payout"]["totals"]])
        parts += ["**Payout by exit value**", _table(["Stakeholder"] + heads, rows)]
        if c["breakpoints"]:
            rows = [[bp["name"] or DASH, money(bp["from"], currency), money(bp["to"], currency)]
                    + [money(v, currency) for v in bp["values"]] for bp in c["breakpoints"]]
            parts += ["**Breakpoints by exit value**", _table(["Breakpoint", "From", "To"] + heads, rows)]
    return "\n\n".join(parts) + "\n"


def build_page(cfg):
    """The sensitivity page: the results page's template, with a Payout and a Breakpoints tab."""
    currency = cfg["currency"]
    exit_values = [r["equity_value"] for r in cfg["entities"][0]["runs"]]
    baked = {
        "mode": "sensitivity", "get_command": cfg["get_command"],
        "target_name": cfg["target_name"], "root_name": cfg["root_name"],
        "is_multi_entity": cfg["is_multi_entity"], "currency": currency, "carta_url": None,
        "inputs": [
            {"label": "Exit values", "display_value": ", ".join(money(v, currency) for v in exit_values)},
            {"label": "Waterfall date", "display_value": cfg["waterfall_date"]},
        ],
        "exit_values": exit_values,
        "entities": [compare(e, cfg["noun"]) for e in cfg["entities"]],
    }
    title = escape("{} sensitivity analysis on {}".format(cfg["target_name"], cfg["waterfall_date"]), quote=False)
    return page.assemble(baked, title)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Compare a batch of waterfall runs across exit values.")
    ap.add_argument("--config", required=True, help="path to the JSON config, or '-' for stdin")
    ap.add_argument("--out", help="build the sensitivity page at this path instead of printing the tables")
    args = ap.parse_args(argv)
    try:
        try:
            raw = sys.stdin.read() if args.config == "-" else Path(args.config).read_text(encoding="utf-8")
            loaded = json.loads(raw)
        except OSError as exc:
            raise page.ConfigError("--config file could not be read: {}".format(exc))
        except ValueError as exc:
            raise page.ConfigError("--config is not valid JSON: {}".format(exc))
        cfg = validate(loaded)
        output = build_page(cfg) if args.out else markdown(cfg)
    except page.ConfigError as exc:
        print("error: {}".format(exc), file=sys.stderr)
        return 1
    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(output, encoding="utf-8")
        print(out_path.resolve())
    else:
        sys.stdout.write(output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
