#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Publish staged KPI corrections to Carta FinancialsV2 (ADR 020, inline KPI corrections).

serve.py owns the HTTP side; this module turns the browser's staged edits into
financials__mutate__store_kpis calls and issues them through the same sandboxed headless
`claude` session the in-app refresh uses — allowed only the Carta MCP's welcome /
set_context / list_accounts / call_tool, no Bash, no Write. One store call per
company-and-currency group, one attempt each; a rejected call fails its edits and the
user decides whether to retry. Stdlib-only, 3.9-safe.
"""
import datetime as _dt
import importlib.util as _ilu
import json
import math
import os
import re
from typing import Callable, List, Optional, Tuple


def _sibling(name):
    """Load a sibling script by absolute path — never via sys.path, so a same-named
    script from another skill can't shadow it."""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), name + ".py")
    spec = _ilu.spec_from_file_location("_pa_" + name, p)
    mod = _ilu.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


chat_session = _sibling("chat_session")
refresh = _sibling("refresh")

# Warehouse unit_type -> FinancialsV2 UnitType. Anything else is not correctable here.
UNIT_TYPE = {"Dollar": "UNIT_TYPE_DOLLAR", "Number": "UNIT_TYPE_NUMBER",
             "Percentage": "UNIT_TYPE_PERCENTAGE", "Percent": "UNIT_TYPE_PERCENTAGE",
             "Ratio": "UNIT_TYPE_RATIO"}
# Build cadence letter -> FinancialsV2 FrequencyType.
FREQUENCY_TYPE = {"M": "FREQUENCY_TYPE_MONTH", "Q": "FREQUENCY_TYPE_QUARTER",
                  "S": "FREQUENCY_TYPE_SEMI_ANNUAL", "A": "FREQUENCY_TYPE_ANNUAL"}
MAX_KPIS_PER_CALL = 500          # StoreKpisRequest.kpis max_items
STORE_TOOL = "financials__mutate__store_kpis"
TURN_TIMEOUT = 180
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_ORG_PK_RE = re.compile(r"organization_pk:(\d+)")


class PublishError(Exception):
    def __init__(self, message, needs_human=False, detail=None):
        super(PublishError, self).__init__(message)
        self.needs_human = needs_human
        self.detail = detail


def _fail(edit_id, why):
    # type: (str, str) -> dict
    return {"id": edit_id, "status": "failed", "error": why}


_NUMERIC_ID_RE = re.compile(r"^[0-9]+$")


def publish_target(company):
    # type: (dict) -> Optional[dict]
    """The Carta entity a correction is stored against, from the identity faces the build
    stamps. Leaf-node rule: corporation/LLC leaves always beat the FA-issuer root; the
    root is the target only for a standalone issuer. Financials addresses a CORPORATION
    by its numeric carta-web pk (LLC/FA_ISSUER by uuid), so a corporation without
    cartaCorporationId — including corp:-keyed uuid-only companies — has no writable
    target and returns None; it never falls back to the FA root. Mirrors
    pendingEdits.publishTarget(); keep the two identical."""
    if not company:
        return None
    corp_pk = company.get("cartaCorporationId")
    if corp_pk is not None and _NUMERIC_ID_RE.match(str(corp_pk)):
        return {"id": str(corp_pk), "type": "CORPORATION"}
    if company.get("cartaCorporationUuid") or company.get("keyType") == "corporation":
        return None
    cid = str(company.get("id") or "")
    kt = company.get("keyType")
    if kt == "llc" and cid.startswith("llc:"):
        return {"id": cid[4:], "type": "LLC"}
    gl = company.get("glIssuerId")
    if gl:
        return {"id": str(gl), "type": "FA_ISSUER"}
    if kt == "gl_issuer" and cid.startswith("gl:"):
        return {"id": cid[3:], "type": "FA_ISSUER"}
    return None


def _proto_date(iso):
    # type: (str) -> dict
    """carta.proto.common.v1.Date JSON shape — the transcoder rejects ISO strings."""
    y, m, d = (int(x) for x in str(iso).split("-"))
    return {"year": y, "month": m, "day": d}


def _reading(metric, edit):
    # type: (dict, dict) -> dict
    return {
        "mnemonicName": metric.get("mnemonic") or "",
        "displayName": metric.get("label") or metric.get("key"),
        "unitType": UNIT_TYPE[metric["unit"]],
        "numericValue": float(edit["value"]),
        "fromDate": _proto_date(edit["fromDate"]),
        "toDate": _proto_date(edit["period"]),
        "frequencyType": FREQUENCY_TYPE[edit["freq"]],
        "isForecast": False,
    }


def build_groups(kpi, edits):
    # type: (dict, List[dict]) -> Tuple[List[dict], List[dict]]
    """Turn staged edits into store_kpis groups: one per (company, currency), chunked at
    MAX_KPIS_PER_CALL. Edits that can't become a reading come back in `failed` with the
    reason, so one bad cell never blocks the rest of the batch."""
    metrics = {m["key"]: m for m in kpi.get("metrics") or []}
    companies = {c["id"]: c for c in kpi.get("companies") or []}
    firm_currency = (kpi.get("source") or {}).get("currency")
    buckets = {}   # (companyId, currency) -> {"entity", "companyName", "editIds", "kpis"}
    failed = []
    for e in edits:
        eid = str(e.get("id") or "")
        co = companies.get(e.get("companyId"))
        if co is None:
            failed.append(_fail(eid, "This company is not in the current dashboard data."))
            continue
        entity = publish_target(co)
        if entity is None:
            if co.get("keyType") == "name":
                failed.append(_fail(eid, "This company is matched by name only — there is no Carta record to write a correction to."))
            elif co.get("cartaCorporationUuid") or co.get("keyType") == "corporation":
                failed.append(_fail(eid, "This company's Carta corporation id is missing from the dashboard data. Refresh Operating KPIs, then publish again."))
            else:
                failed.append(_fail(eid, "This dashboard predates company identity tracking. Refresh Operating KPIs, then publish again."))
            continue
        m = metrics.get(e.get("metricKey"))
        if m is None or m.get("custom") or m.get("kind") or m.get("derivedFrom") or m.get("unit") not in UNIT_TYPE:
            failed.append(_fail(eid, "This metric can't be corrected in Carta from here."))
            continue
        # Statement line items live outside the KPI collection store_kpis writes to;
        # the server refuses their mnemonics ("Unknown standard KPI mnemonic").
        if m.get("reportType") != "KPI":
            failed.append(_fail(eid, "This is a financial-statement line item, not a Data Collection KPI — it can't be corrected from here."))
            continue
        if e.get("freq") not in FREQUENCY_TYPE or not _DATE_RE.match(str(e.get("fromDate") or "")) \
                or not _DATE_RE.match(str(e.get("period") or "")):
            failed.append(_fail(eid, "This cell has no single reported period behind it."))
            continue
        try:
            value = float(e.get("value"))
        except (TypeError, ValueError):
            value = float("nan")
        if not math.isfinite(value):
            failed.append(_fail(eid, "The corrected value is not a number."))
            continue
        point = next((p for p in (co.get("series") or {}).get(m["key"], []) if p.get("d") == e.get("period")), None)
        # An addition has no cached point; its edit carries the currency the app
        # inferred from the company's neighboring readings (model inferCur).
        currency = (point or {}).get("cur") or e.get("cur") or firm_currency
        if not currency or len(str(currency)) != 3:
            failed.append(_fail(eid, "No currency is recorded for this reading, so it can't be stored."))
            continue
        key = (co["id"], str(currency))
        b = buckets.setdefault(key, {"companyId": co["id"], "companyName": co.get("name") or co["id"],
                                     "entity": entity, "currency": str(currency), "editIds": [], "kpis": []})
        b["editIds"].append(eid)
        b["kpis"].append(_reading(m, dict(e, value=value)))
    groups = []
    for b in buckets.values():
        for i in range(0, len(b["kpis"]), MAX_KPIS_PER_CALL):
            groups.append(dict(b, editIds=b["editIds"][i:i + MAX_KPIS_PER_CALL],
                               kpis=b["kpis"][i:i + MAX_KPIS_PER_CALL]))
    return groups, failed


PUBLISH_SYSTEM_PROMPT = (
    "You are a write executor for portfolio-analytics KPI corrections. You have a Carta MCP "
    "server (from the carta-investors plugin) whose tools are named mcp__<server>__welcome, "
    "mcp__<server>__set_context, mcp__<server>__list_accounts and mcp__<server>__call_tool. "
    "If they are not immediately visible, search for them first — they may be deferred. "
    "Do ONLY the tool calls the user message specifies, in the given order, with exactly the "
    "given arguments. Never alter a value, never add or drop a reading, never call any other "
    "tool, never change the firm context, and never retry a call that returned an error — "
    "report it by replying DONE. "
    "CRITICAL: pass each tool call's parameters as native JSON objects, NOT as a quoted "
    "string — `arguments`, `kpis` and `_instrumentation_v2` are objects. Copy every value "
    "byte-for-byte from the user message. "
    "When the specified calls have returned, reply with exactly: DONE."
)


def allowed_tools(prefer_nonprod=False):
    # type: (bool) -> str
    # Same one-environment rule as refresh.bootstrap_allowed_tools.
    prefixes = refresh._PREFIXES_NONPROD if prefer_nonprod else refresh._PREFIXES_PROD
    extra = ",".join("mcp__%s__list_accounts" % p for p in prefixes)
    return refresh.bootstrap_allowed_tools(prefer_nonprod) + "," + extra


def _store_args(owner_pk, group):
    # type: (int, dict) -> dict
    return {
        "target_id": group["entity"]["id"],
        "target_type": "ENTITY_TYPE_%s" % group["entity"]["type"].upper(),
        "owner_id": str(owner_pk),
        "owner_type": "ENTITY_TYPE_ORGANIZATION",
        "currency_code": group["currency"],
        # Without this the store stamps as_of_date = period_end and the correction
        # loses the warehouse dedup to the original filing (Global Constraints).
        "reported_as_of_date": _dt.date.today().isoformat(),
        "kpis": group["kpis"],
    }


def _accounts_from(text):
    # type: (str) -> Optional[list]
    """list_accounts' ``accounts`` array. The captured result nests the tool's JSON
    inside {"result": "<json-string>"} envelopes, one per gateway hop — unwrap them."""
    for _ in range(3):
        try:
            data = json.loads(text or "")
        except (TypeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        if isinstance(data.get("accounts"), list):
            return data["accounts"]
        if isinstance(data.get("result"), str):
            text = data["result"]
            continue
        return None
    return None


def parse_owner_pk(text, firm_name):
    # type: (str, str) -> Optional[int]
    """The organization_pk whose account name equals the firm name (case-insensitive).
    None when no account or more than one matches — the caller escalates, never guesses."""
    want = " ".join((firm_name or "").split()).lower()
    if not want:
        return None
    hits = []
    accounts = _accounts_from(text)
    if accounts is not None:
        for a in accounts:
            name = " ".join(str((a or {}).get("name") or "").split()).lower()
            m = _ORG_PK_RE.search(str((a or {}).get("id") or ""))
            if name == want and m:
                hits.append(int(m.group(1)))
    else:
        # Prose fallback: "<name> ... organization_pk:<n>" on one line. Every pk on a
        # matching line counts — several accounts on one line must read as ambiguity.
        for line in (text or "").splitlines():
            if want in line.lower():
                hits.extend(int(m.group(1)) for m in _ORG_PK_RE.finditer(line))
    hits = sorted(set(hits))
    return hits[0] if len(hits) == 1 else None


def _list_accounts_first_turn(firm_uuid, firm_name):
    # type: (str, str) -> str
    """Same _instrumentation_v2 stamp + phrasing convention as refresh._first_turn_prompt —
    unstamped calls are rejected server-side, so every call here needs it too."""
    inst = json.dumps(refresh._INSTRUMENTATION)
    return (
        "Do these three tool calls in order, then reply DONE:\n"
        "1. Call the Carta MCP welcome tool with {\"_instrumentation_v2\": %s}.\n"
        "2. Call the Carta MCP set_context tool with {\"firm_id\": \"%s\", \"_instrumentation_v2\": %s}.\n"
        "3. Call the Carta MCP list_accounts tool with {\"search\": %s, \"detail\": \"full\", "
        "\"_instrumentation_v2\": %s}."
        % (inst, firm_uuid, inst, json.dumps(firm_name), inst)
    )


def _error_text(err, captured):
    # type: (Optional[str], Optional[str]) -> str
    return ((err or captured or "Carta returned no result.").strip() or "Carta returned no result.")[:300]


def _captured_error(captured):
    # type: (Optional[str]) -> Optional[str]
    """Defensive check: a captured result the MCP marked is_error=False can still carry a
    top-level {"error": ...} — narrow on purpose; anything else (empty, non-JSON, no such
    key) stays a success."""
    if not captured:
        return None
    try:
        parsed = json.loads(captured)
    except ValueError:
        return None
    if isinstance(parsed, dict) and "error" in parsed:
        return _error_text(str(parsed["error"]), None)
    return None


def run_publish(data_dir, edits, emit, claude_bin=None, model=None, on_session=None):
    # type: (str, List[dict], Callable, Optional[str], Optional[str], Optional[Callable]) -> dict
    """Publish staged edits. Returns {results: [{id, status, error?}], warnings: []}. Raises
    PublishError for a whole-run failure (nothing was written). Each store_kpis call gets
    exactly one attempt; its edits are published or failed by its outcome.

    emit(phase, message) phases are a client contract (PublishEditsButton.jsx):
    preflight, resolve, store."""
    emit("preflight", "Checking your Carta connection…")
    try:
        with open(os.path.join(data_dir, "kpi.json")) as fh:
            kpi = json.load(fh) or {}
    except (OSError, ValueError):
        raise PublishError("This firm's cache is missing or unreadable; relaunch it from Claude "
                           "before publishing.", needs_human=True)
    src = kpi.get("source") or {}
    firm_uuid = src.get("firmUuid")
    if not firm_uuid:
        raise PublishError("This cache predates firm-id tracking, so corrections can't be "
                           "published from it. Ask Claude to “Refresh KPI data” once.", needs_human=True)
    groups, failed = build_groups(kpi, edits)
    results = list(failed)
    if not groups:
        return {"results": results, "warnings": []}

    prefer_nonprod = (src.get("cartaEnvironment") == "nonprod")
    session = chat_session.ChatSession(
        cwd=data_dir, add_dirs=[data_dir], claude_bin=claude_bin,
        model=model or chat_session.DEFAULT_MODEL,
        allowed_tools=allowed_tools(prefer_nonprod), system_prompt=PUBLISH_SYSTEM_PROMPT)
    try:
        session.start()
    except Exception:
        raise PublishError("Couldn't start a Claude session to publish the corrections.", needs_human=True)
    if on_session:
        on_session(session)

    call = None   # "mcp__<prefix>__call_tool", read off the first turn
    try:
        owner_pk = src.get("firmId")
        try:
            owner_pk = int(owner_pk) if owner_pk else None
        except (TypeError, ValueError):
            owner_pk = None
        if owner_pk is None:
            # One search, then stop: a guessed owner writes another firm's books.
            emit("resolve", "Finding your firm in Carta…")
            firm_name = (kpi.get("branding") or {}).get("firmName") or src.get("firm") or ""
            ok, captured, err, matched = refresh._run_turn(
                session, _list_accounts_first_turn(firm_uuid, firm_name),
                capture_suffix="__list_accounts", timeout=TURN_TIMEOUT)
            prefix = refresh.prefix_from_toolname(matched)
            owner_pk = parse_owner_pk(captured, firm_name) if ok else None
            if owner_pk is None or not prefix:
                raise PublishError(
                    "Couldn't identify this firm's Carta organization, so nothing was published. "
                    "Ask Claude to “Refresh KPI data” once (it records the firm id), then publish again.",
                    needs_human=True, detail=err or captured)
            call = "mcp__%s__call_tool" % prefix

        for i, g in enumerate(groups):
            emit("store", "Publishing %d correction(s) for %s…" % (len(g["kpis"]), g["companyName"]))
            args = _store_args(owner_pk, g)
            if call is None:
                prompt = refresh._first_turn_prompt(firm_uuid, STORE_TOOL, args)
            else:
                prompt = refresh._single_call_prompt(call, STORE_TOOL, args)
            ok, captured, err, matched = refresh._run_turn(session, prompt, capture_suffix="__call_tool",
                                                           timeout=TURN_TIMEOUT)
            if call is None:
                prefix = refresh.prefix_from_toolname(matched)
                if not prefix:
                    raise PublishError("Couldn't reach the Carta MCP in the publish session; nothing was "
                                       "published.", needs_human=True, detail=err or captured)
                call = "mcp__%s__call_tool" % prefix
            captured_err = _captured_error(captured) if (ok and err is None and matched) else None
            if ok and err is None and matched and captured_err is None:
                results.extend({"id": eid, "status": "published"} for eid in g["editIds"])
            else:
                why = captured_err or _error_text(err, captured if not ok else None)
                results.extend({"id": eid, "status": "failed", "error": why} for eid in g["editIds"])
    finally:
        session.close()
        if on_session:
            on_session(None)
    return {"results": results, "warnings": []}
