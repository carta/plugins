"""Checks a shared report's payload against version 1 of the canonical budget model.

The same rules Carta applies when it stores a shared report; keep the two in
step. The skill runs them before sharing, so the operator sees a
plain message instead of a server error, and on pull, so a malformed report is
refused rather than rendered with wrong numbers.

Python-stdlib only, 3.9-safe.
"""
from __future__ import annotations

import datetime
import json
import math
import re
from typing import Any, Dict, List

from shapes.canonical import SCHEMA_VERSION  # noqa: F401  (the model version these rules check; sent with each share)

MAX_PAYLOAD_BYTES = 256 * 1024
MAX_NODES = 5000
MAX_FACTS_PER_NODE = 1000
MAX_KEY_LENGTH = 128
MAX_LABEL_LENGTH = 500
MAX_COMMENT_LENGTH = 2000
MAX_DEPTH = 20
MAX_VALUE_ALIASES = 1000
MAX_NAME_LENGTH = 255
MAX_SOURCE_CLIENT_LENGTH = 64
MAX_SOURCE_VERSION_LENGTH = 32

NODE_KINDS = frozenset({"line", "section_header", "subsection_header", "subtotal", "summary", "total"})
VIEW_KINDS = frozenset({"by-account", "by-line-item", "by-tag-crosstab"})
GRANULARITIES = frozenset({"monthly", "quarterly"})
PERIOD_KINDS = frozenset({"annual", "ytd_through_as_of"})
DERIVED_RULES = frozenset({"net_income", "expression"})

REQUIRED_PAYLOAD_KEYS = frozenset({"period_year", "period_granularity", "currency", "native_view_kind", "budget"})
PAYLOAD_KEYS = REQUIRED_PAYLOAD_KEYS | {"period_kind", "value_aliases"}
BUDGET_KEYS = frozenset({"dimensions", "nodes"})
NODE_KEYS = frozenset({"key", "kind", "label", "depth", "order", "gl_codes", "facts",
                       "section", "constituents", "comments", "derived"})
REQUIRED_NODE_KEYS = frozenset({"key", "kind", "label", "depth", "order", "gl_codes", "facts"})
FACT_KEYS = frozenset({"period", "scope", "amount"})
SNAPSHOT_BASIS_KEYS = frozenset({"as_of", "fetched_at"})
SOURCE_KEYS = frozenset({"client", "client_version"})

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
            scope = _keys(fact["scope"], fpath + ".scope", frozenset({"value"}), frozenset({"value"}))
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
    basis = _keys(basis, "snapshot_basis", SNAPSHOT_BASIS_KEYS, frozenset({"as_of"}))
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
    source = _keys(source, "source", SOURCE_KEYS, frozenset({"client"}))
    _text(source["client"], "source.client", MAX_SOURCE_CLIENT_LENGTH)
    if "client_version" in source:
        _text(source["client_version"], "source.client_version", MAX_SOURCE_VERSION_LENGTH)


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        # A JSON integer has no upper bound; one too large for a float is not an amount.
        return False
