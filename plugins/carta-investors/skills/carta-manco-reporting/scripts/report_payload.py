"""Checks a shared report's payload against version 1 of the canonical budget model.

The same rules Carta applies when it stores a shared report; keep the two in
step. The skill runs them before sharing, so the operator sees a
plain message instead of a server error, and on pull, so a malformed report is
refused rather than rendered with wrong numbers.

The hosted Worker runs no Python, so server/reportPayload.js ports validate(),
check_name(), check_snapshot_basis() and compact() for it. Both sides read every limit,
enum member and key name from payload_contract.json, beside this file. The hosted Worker
picks up an edit to it only when it is redeployed (DEPLOY.md); a behavioral edit (not
just a shape one) still needs the matching code change on the other side.
Most of validate()'s own accept/reject cases live once too, in server/__fixtures__/
share-payload.json's "cases" array: tests/carta-investors/test_manco_report_store.py's
test_shared_cases and reportPayload.test.js's matching test.each run each case against
both implementations. Only what JSON can't hold (NaN, a too-large-for-float amount) or
express as a plain field set (the duplicate-node-key append) stays written out per language.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import datetime
import json
import math
import re
from pathlib import Path
from typing import Any, Dict, List

from shapes.canonical import SCHEMA_VERSION  # noqa: F401  (the model version these rules check; sent with each share)

_CONTRACT = json.loads((Path(__file__).parent / "payload_contract.json").read_text())

MAX_PAYLOAD_BYTES = _CONTRACT["limits"]["max_payload_bytes"]
MAX_NODES = _CONTRACT["limits"]["max_nodes"]
MAX_FACTS_PER_NODE = _CONTRACT["limits"]["max_facts_per_node"]
MAX_KEY_LENGTH = _CONTRACT["limits"]["max_key_length"]
MAX_LABEL_LENGTH = _CONTRACT["limits"]["max_label_length"]
MAX_COMMENT_LENGTH = _CONTRACT["limits"]["max_comment_length"]
MAX_DEPTH = _CONTRACT["limits"]["max_depth"]
MAX_VALUE_ALIASES = _CONTRACT["limits"]["max_value_aliases"]
MAX_NAME_LENGTH = _CONTRACT["limits"]["max_name_length"]
MAX_SOURCE_CLIENT_LENGTH = _CONTRACT["limits"]["max_source_client_length"]
MAX_SOURCE_VERSION_LENGTH = _CONTRACT["limits"]["max_source_version_length"]
MAX_VIEW_BYTES = _CONTRACT["limits"]["max_view_bytes"]
MAX_VARIANCE_BY_CATEGORY_BYTES = _CONTRACT["limits"]["max_variance_by_category_bytes"]

NODE_KINDS = frozenset(_CONTRACT["node_kinds"])
VIEW_KINDS = frozenset(_CONTRACT["view_kinds"])
GRANULARITIES = frozenset(_CONTRACT["granularities"])
PERIOD_KINDS = frozenset(_CONTRACT["period_kinds"])
DERIVED_RULES = frozenset(_CONTRACT["derived_rules"])

REQUIRED_PAYLOAD_KEYS = frozenset(_CONTRACT["payload_keys"]["required"])
PAYLOAD_KEYS = REQUIRED_PAYLOAD_KEYS | frozenset(_CONTRACT["payload_keys"]["optional"])
BUDGET_KEYS = frozenset(_CONTRACT["budget_keys"])
REQUIRED_NODE_KEYS = frozenset(_CONTRACT["node_keys"]["required"])
NODE_KEYS = REQUIRED_NODE_KEYS | frozenset(_CONTRACT["node_keys"]["optional"])
FACT_KEYS = frozenset(_CONTRACT["fact_keys"])
SCOPE_KEYS = frozenset(_CONTRACT["scope_keys"])
REQUIRED_SNAPSHOT_BASIS_KEYS = frozenset(_CONTRACT["snapshot_basis_keys"]["required"])
SNAPSHOT_BASIS_KEYS = REQUIRED_SNAPSHOT_BASIS_KEYS | frozenset(_CONTRACT["snapshot_basis_keys"]["optional"])
REQUIRED_SOURCE_KEYS = frozenset(_CONTRACT["source_keys"]["required"])
SOURCE_KEYS = REQUIRED_SOURCE_KEYS | frozenset(_CONTRACT["source_keys"]["optional"])

_PERIOD = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class PayloadError(ValueError):
    """The payload breaks the contract. The message names the first field that does."""


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_one_of(value: Any, allowed: frozenset) -> bool:
    """Membership the way Carta checks it: a non-string hashable (an int, a list
    wrapped in a tuple) must not pass just because it happens to equal a member by value —
    and a genuinely unhashable value (a list, a dict) must not raise instead of
    failing this check."""
    return isinstance(value, str) and value in allowed


def _keys(obj: Any, path: str, allowed: frozenset, required: frozenset) -> Dict[str, Any]:
    if not isinstance(obj, dict):
        raise PayloadError("%s must be a JSON object" % path)
    unknown = set(obj) - allowed
    if unknown:
        raise PayloadError("%s has unknown keys: %s" % (path, sorted(unknown)))
    missing = required - set(obj)
    if missing:
        raise PayloadError("%s is missing keys: %s" % (path, sorted(missing)))
    return obj


def _text(value: Any, path: str, max_length: int, nullable: bool = False) -> None:
    if value is None and nullable:
        return
    if not isinstance(value, str):
        raise PayloadError("%s must be a string" % path)
    if len(value) > max_length:
        raise PayloadError("%s is longer than %d characters" % (path, max_length))


def validate(payload: Any) -> None:
    """:raises PayloadError: naming the first field that breaks the contract."""
    payload = _keys(payload, "payload", PAYLOAD_KEYS, REQUIRED_PAYLOAD_KEYS)
    size = len(json.dumps(payload).encode("utf-8"))
    if size > MAX_PAYLOAD_BYTES:
        raise PayloadError("this report is %d KB, over the %d KB limit" % (size // 1024, MAX_PAYLOAD_BYTES // 1024))
    year = payload["period_year"]
    if not _is_int(year) or not 1900 <= year <= 2200:
        raise PayloadError("payload.period_year must be a year")
    if payload["period_granularity"] is not None and not _is_one_of(payload["period_granularity"], GRANULARITIES):
        raise PayloadError("payload.period_granularity must be one of %s or null" % sorted(GRANULARITIES))
    currency = payload["currency"]
    if not isinstance(currency, str) or not _CURRENCY.fullmatch(currency):
        raise PayloadError("this report has no currency; refresh the Carta data and try again")
    if not _is_one_of(payload["native_view_kind"], VIEW_KINDS):
        raise PayloadError("payload.native_view_kind must be one of %s" % sorted(VIEW_KINDS))
    if "period_kind" in payload and not _is_one_of(payload["period_kind"], PERIOD_KINDS):
        raise PayloadError("payload.period_kind must be one of %s" % sorted(PERIOD_KINDS))
    if "value_aliases" in payload:
        _check_value_aliases(payload["value_aliases"])
    if "view" in payload:
        check_view(payload["view"])
    if "variance_by_category" in payload:
        check_variance_by_category(payload["variance_by_category"])
    budget = _keys(payload["budget"], "payload.budget", BUDGET_KEYS, BUDGET_KEYS)
    dimensions = budget["dimensions"]
    if not isinstance(dimensions, list) or not all(isinstance(d, str) and d for d in dimensions):
        raise PayloadError("payload.budget.dimensions must be a list of names")
    nodes = budget["nodes"]
    if not isinstance(nodes, list) or not nodes:
        raise PayloadError("payload.budget.nodes must be a non-empty list")
    if len(nodes) > MAX_NODES:
        raise PayloadError("payload.budget.nodes has more than %d nodes" % MAX_NODES)
    for i, node in enumerate(nodes):
        _check_node(node, "payload.budget.nodes[%d]" % i, scoped=bool(dimensions))
    _check_references(nodes)


def _check_value_aliases(aliases: Any) -> None:
    if not isinstance(aliases, dict) or len(aliases) > MAX_VALUE_ALIASES:
        raise PayloadError("payload.value_aliases must be an object with at most %d entries" % MAX_VALUE_ALIASES)
    for value, tags in aliases.items():
        _text(value, "payload.value_aliases key", MAX_LABEL_LENGTH)
        if not isinstance(tags, list):
            raise PayloadError("payload.value_aliases[%r] must be a list of tags" % value)
        for tag in tags:
            _text(tag, "payload.value_aliases[%r]" % value, MAX_LABEL_LENGTH)


def check_view(view: Any) -> None:
    """``view``: the sharer's own Budget vs Actuals filters, for the recipient to open the
    report as the sharer saw it. Carta stores it without reading it, so only its type and
    size are checked."""
    if not isinstance(view, dict):
        raise PayloadError("payload.view must be a JSON object")
    if len(json.dumps(view).encode("utf-8")) > MAX_VIEW_BYTES:
        raise PayloadError("payload.view is over %d bytes" % MAX_VIEW_BYTES)


def check_variance_by_category(variance_by_category: Any) -> None:
    """``variance_by_category``: the client's own ranking of its budget categories by how
    far actuals ran from plan, for a reader with no way to rebuild it (the ranking needs
    the client's own GL mapping and workbook categories, not just this payload's nodes).
    Carta stores it without reading it, so only its type and size are checked."""
    if not isinstance(variance_by_category, dict):
        raise PayloadError("payload.variance_by_category must be a JSON object")
    if len(json.dumps(variance_by_category).encode("utf-8")) > MAX_VARIANCE_BY_CATEGORY_BYTES:
        raise PayloadError("payload.variance_by_category is over %d bytes" % MAX_VARIANCE_BY_CATEGORY_BYTES)


def _check_node(node: Any, path: str, scoped: bool) -> None:
    node = _keys(node, path, NODE_KEYS, REQUIRED_NODE_KEYS)
    _text(node["key"], path + ".key", MAX_KEY_LENGTH)
    if not node["key"]:
        raise PayloadError("%s.key must not be empty" % path)
    if not _is_one_of(node["kind"], NODE_KINDS):
        raise PayloadError("%s.kind must be one of %s" % (path, sorted(NODE_KINDS)))
    _text(node["label"], path + ".label", MAX_LABEL_LENGTH, nullable=True)
    if not _is_int(node["depth"]) or not 0 <= node["depth"] <= MAX_DEPTH:
        raise PayloadError("%s.depth must be an integer from 0 to %d" % (path, MAX_DEPTH))
    if not _is_int(node["order"]) or node["order"] < 0:
        raise PayloadError("%s.order must be a non-negative integer" % path)
    gl = node["gl_codes"]
    if not isinstance(gl, list) or not all(_is_int(c) and c > 0 for c in gl):
        raise PayloadError("%s.gl_codes must be a list of positive integers" % path)
    if "section" in node:
        _text(node["section"], path + ".section", MAX_LABEL_LENGTH, nullable=True)
    if "derived" in node and not _is_one_of(node["derived"], DERIVED_RULES):
        raise PayloadError("%s.derived must be one of %s" % (path, sorted(DERIVED_RULES)))
    if "constituents" in node:
        c = node["constituents"]
        if not isinstance(c, list) or not all(isinstance(k, str) and k for k in c):
            raise PayloadError("%s.constituents must be a list of node keys" % path)
    if "comments" in node:
        comments = node["comments"]
        if not isinstance(comments, dict):
            raise PayloadError("%s.comments must be a JSON object" % path)
        for scope, text in comments.items():
            _text(scope, path + ".comments key", MAX_LABEL_LENGTH)
            _text(text, "%s.comments[%r]" % (path, scope), MAX_COMMENT_LENGTH)
    facts = node["facts"]
    if not isinstance(facts, list):
        raise PayloadError("%s.facts must be a list" % path)
    if len(facts) > MAX_FACTS_PER_NODE:
        raise PayloadError("%s.facts has more than %d facts" % (path, MAX_FACTS_PER_NODE))
    for j, fact in enumerate(facts):
        fpath = "%s.facts[%d]" % (path, j)
        fact = _keys(fact, fpath, FACT_KEYS, FACT_KEYS)
        period = fact["period"]
        if period is not None and (not isinstance(period, str) or not _PERIOD.fullmatch(period)):
            raise PayloadError("%s.period must be YYYY-MM or null" % fpath)
        if fact["scope"] is not None:
            if not scoped:
                raise PayloadError("%s.scope needs payload.budget.dimensions to name an axis" % fpath)
            scope = _keys(fact["scope"], fpath + ".scope", SCOPE_KEYS, SCOPE_KEYS)
            _text(scope["value"], fpath + ".scope.value", MAX_LABEL_LENGTH)
        amount = fact["amount"]
        if not _is_finite_number(amount):
            raise PayloadError("%s.amount must be a finite number" % fpath)


def _check_references(nodes: List[dict]) -> None:
    keys: set = set()
    for node in nodes:
        if node["key"] in keys:
            raise PayloadError("node key %r is used more than once" % node["key"])
        keys.add(node["key"])
    edges = {n["key"]: n.get("constituents") or [] for n in nodes}
    for key, parts in edges.items():
        for part in parts:
            if part not in keys:
                raise PayloadError("node %r lists constituent %r, which is not a node" % (key, part))
    done: set = set()
    for start in edges:
        if start in done:
            continue
        on_path = {start}
        stack = [(start, 0)]
        while stack:
            key, i = stack[-1]
            children = edges[key]
            if i == len(children):
                stack.pop()
                on_path.discard(key)
                done.add(key)
                continue
            stack[-1] = (key, i + 1)
            child = children[i]
            if child in on_path:
                raise PayloadError("node %r is its own constituent" % child)
            if child not in done:
                on_path.add(child)
                stack.append((child, 0))


def check_name(name: Any) -> None:
    """A report's name: 1-255 characters after stripping, Carta's limit. Call
    before share() and before rename() — both reach the same stored name."""
    if not isinstance(name, str) or not name.strip():
        raise PayloadError("a report needs a name")
    if len(name.strip()) > MAX_NAME_LENGTH:
        raise PayloadError("a report's name can't be over %d characters" % MAX_NAME_LENGTH)


def check_snapshot_basis(basis: Any) -> None:
    """``{as_of: YYYY-MM-DD, fetched_at?}`` — the drift banner's data date.
    ``as_of`` must be a real calendar date, not just the right shape."""
    basis = _keys(basis, "snapshot_basis", SNAPSHOT_BASIS_KEYS, REQUIRED_SNAPSHOT_BASIS_KEYS)
    as_of = basis["as_of"]
    if not isinstance(as_of, str) or not _DATE.fullmatch(as_of):
        raise PayloadError("snapshot_basis.as_of must be YYYY-MM-DD")
    try:
        datetime.date.fromisoformat(as_of)
    except ValueError:
        raise PayloadError("snapshot_basis.as_of is not a real date")
    if "fetched_at" in basis:
        try:
            datetime.datetime.fromisoformat(basis["fetched_at"])
        except (TypeError, ValueError):
            raise PayloadError("snapshot_basis.fetched_at must be an ISO timestamp")


def check_source(source: Any) -> None:
    """``{client, client_version?}`` — informational only, but still bounded:
    Carta keeps client to 64 characters and client_version to 32."""
    if source is None:
        return
    source = _keys(source, "source", SOURCE_KEYS, REQUIRED_SOURCE_KEYS)
    _text(source["client"], "source.client", MAX_SOURCE_CLIENT_LENGTH)
    if "client_version" in source:
        _text(source["client_version"], "source.client_version", MAX_SOURCE_VERSION_LENGTH)


def compact(payload: Dict[str, Any]) -> Dict[str, Any]:
    """The compact wire form the Carta connector expands back to this exact payload.

    A share travels through a model's tool call, where every character is
    generated output, so each node's facts become 12 monthly amounts (``m``)
    when they are unscoped months of ``period_year``, or ``[period, amount,
    scope?]`` rows (``f``) otherwise; an empty ``gl_codes`` is left out.
    """
    year = payload.get("period_year")
    prefix = "%s-" % year
    nodes = []
    for node in (payload.get("budget") or {}).get("nodes") or []:
        out = {k: v for k, v in node.items() if k != "facts" and not (k == "gl_codes" and v == [])}
        facts = node.get("facts") or []
        periods = [f.get("period") for f in facts]
        monthly = (
            isinstance(year, int) and facts and len(set(periods)) == len(periods)
            and all(f.get("scope") is None and isinstance(f.get("period"), str)
                    and len(f["period"]) == 7 and f["period"].startswith(prefix)
                    and f["period"][5:7].isdigit() and 1 <= int(f["period"][5:7]) <= 12 for f in facts)
        )
        if monthly:
            months: List[Any] = [None] * 12
            for f in facts:
                months[int(f["period"][5:7]) - 1] = f["amount"]
            out["m"] = months
        elif facts:
            out["f"] = [[f["period"], f["amount"]] + ([f["scope"]] if f.get("scope") is not None else [])
                        for f in facts]
        nodes.append(out)
    return dict(payload, budget=dict(payload.get("budget") or {}, nodes=nodes))


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        # A JSON integer has no upper bound; one too large for a float is not an amount.
        return False
