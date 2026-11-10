#!/usr/bin/env python3
"""manco_mapping_store.py — budget-mapping.json: the recorded-decision store
carta-manco-reporting's build reads and writes (row/account/inference/fund
answers, row addressing, and who gave each answer).
"""

import json
import os
import sys
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path

try:
    import fcntl
except ImportError:  # Windows has no fcntl; msvcrt locks the same byte range.
    fcntl = None
    import msvcrt

sys.path.insert(0, str(Path(__file__).resolve().parent))
import report_store
from manco_labels import _norm_label


VOID = "void"
REMOVED = "removed"
# An inference's answer, and an account's.
CONFIRMED = "confirmed"
REJECTED = "rejected"
NOT_EXPECTED = "not_expected"


def read_budget_mapping(dashboard_dir):
    """Per-row mapping decisions the client made, keyed by budget row key.

    Keyed by `row_address` — a row's own key where it has one, otherwise
    its section/subsection/label path.

        {"rows": {"r7": {"fund": "<a fund the firm has>"},
                  "r9": {"gl_codes": [7110, 7105]},
                  "r11": {"scope": {"source": "reporting_tag",
                                    "category": "TAGS",
                                    "value": "<a tag value>"}},
                  "r12": {"status": "void"},
                  "r13": {"status": "removed"}}}

    Written by the skill's resolution gate. Similarity between a workbook's
    wording and Carta's is a hint, not an answer — one near miss puts one
    fund's fees on another — so an unresolved row is asked about and the
    answer recorded here rather than inferred again on every build.
    """
    return mapping_section(_read_mapping_or_empty(dashboard_dir), ("rows",))


def copy_budget_mapping(dashboard_dir, rows, src_id, dst_id):
    """Record the mapping answers for a budget's rows under a copy's id too.

    Both copies get every answer re-recorded under their own budget-prefixed
    address: once two budgets share a bare address ("r17"), a decision keyed by
    it alone is ambiguous and applies to neither (see apply_budget_mapping).

    Each row gets exactly the decision the last build applied to it. The
    ambiguous bare addresses are worked out here, from the report inputs of
    your own visible budgets that build read, so no caller can leave them out
    and turn a bare answer the build ignored into a prefixed one.
    Returns the number of answers recorded.
    """
    ambiguous = ambiguous_bare_addrs(_last_build_own_budgets(dashboard_dir))
    src_rows = [dict(r) for r in rows]
    dst_rows = [dict(r) for r in rows]
    assign_row_addresses(src_rows, budget_id=src_id)
    assign_row_addresses(dst_rows, budget_id=dst_id)

    # Read inside the write's lock, so an answer recorded meanwhile is the
    # one copied.
    def copies(payload):
        decisions = mapping_section(payload, ("rows",))
        answers = {}
        for src, dst in zip(src_rows, dst_rows):
            decision = _recorded_decision(decisions, src, ambiguous)
            # An empty decision still counts: it is what kept a bare answer
            # off the source row, and the copy must not pick that answer up
            # later.
            if decision is not None:
                answers[src["addr"]] = decision
                answers[dst["addr"]] = decision
        return answers

    try:
        return update_mapping(dashboard_dir, ("rows",), copies)
    except RuntimeError:
        return 0


def _last_build_own_budgets(dashboard_dir):
    """The budgets of your own the last build read; none before a first build."""
    return [b for b in report_store.ReportStore(dashboard_dir).last_inputs() if not b.get("read_only")]




def row_address(row):
    """How a recorded decision names a row.

    `key` covers the line rows the adapters number. Everything else — the
    subtotals and totals a workbook builds its own sections from — has no
    key, and those are exactly the rows a client picks when asked which
    line reports a value. Position is not an address: a row inserted above
    would silently re-point every answer below it.
    """
    if row.get("key"):
        return row["key"]
    parts = [row.get("section"), row.get("subsection"), row.get("label")]
    return "/".join(_norm_label(x) for x in parts if _norm_label(x))


def assign_row_addresses(rows, budget_id=None):
    """Give every row an address, unique within its budget.

    Every shape adapter numbers rows from 1 per parse, so two different
    budgets can produce the same `bare_addr` ("r17") for unrelated lines.
    `addr` adds a `budget_id` prefix to disambiguate; `bare_addr` (no
    prefix) survives alongside it so a decision recorded before this
    prefix existed still resolves — see `apply_budget_mapping`.
    """
    seen = {}
    for row in rows or []:
        base = row_address(row)
        seen[base] = seen.get(base, 0) + 1
        bare = base if seen[base] == 1 else f"{base}#{seen[base]}"
        row["bare_addr"] = bare
        row["addr"] = f"{budget_id}::{bare}" if budget_id else bare
    return rows


def ambiguous_bare_addrs(own_budgets):
    """Bare addresses ("r17") more than one of your own budgets has.

    A decision recorded under one before addresses were budget-prefixed
    can't be told which budget it was for, so it applies to neither (see
    apply_budget_mapping). Gives each budget's rows their bare addresses.
    """
    budgets_by_addr = defaultdict(set)
    for budget in own_budgets:
        assign_row_addresses(budget.get("rows") or [])
        for row in budget.get("rows") or []:
            budgets_by_addr[row["bare_addr"]].add(budget.get("id") or "primary")
    return {a for a, ids in budgets_by_addr.items() if len(ids) > 1}


def _recorded_decision(mapping, row, ambiguous_bare_addrs):
    """The recorded decision that applies to an addressed row, or None.

    The budget-prefixed address first; the bare address or key only when
    nothing is recorded under it and no other budget of yours shares that
    bare address.
    """
    decision = mapping.get(row["addr"])
    if decision is None and row["bare_addr"] not in (ambiguous_bare_addrs or ()):
        decision = mapping.get(row["bare_addr"]) or mapping.get(row.get("key"))
    return decision


def _mapping_path(dashboard_dir):
    return Path(dashboard_dir) / "budget-mapping.json"


def read_mapping_file(dashboard_dir):
    """The whole of `budget-mapping.json`, `{}` when there is none yet.

    An unreadable file is not an empty one: it raises rather than letting a
    caller start a fresh one over the top of it.
    """
    path = _mapping_path(dashboard_dir)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text()) or {}
        if not isinstance(payload, dict):
            raise ValueError("not a JSON object")
    except Exception:
        raise RuntimeError(f"{path} exists but could not be read; "
                           f"not overwriting it")
    return payload


def _read_mapping_or_empty(dashboard_dir):
    """`read_mapping_file` for the build's readers: an unreadable file applies
    no answers, the same as no file at all."""
    try:
        return read_mapping_file(dashboard_dir)
    except RuntimeError:
        return {}


def mapping_section(mapping, section):
    """The answers under `section`, a key path into budget-mapping.json
    (`("rows",)`, `("fund_attribution", "by_memo")`); `{}` when absent."""
    answers = mapping
    for key in section:
        answers = (answers or {}).get(key) or {}
    return answers


@contextmanager
def _mapping_lock(dashboard_dir):
    """Held from the read to the write of budget-mapping.json, so two writers
    running at once can't each merge into the same old copy and drop the
    other's answer."""
    lock_path = _mapping_path(dashboard_dir).with_suffix(".json.lock")
    with open(lock_path, "a+") as fh:
        if fcntl is not None:
            fcntl.flock(fh, fcntl.LOCK_EX)
        else:
            fh.seek(0)
            msvcrt.locking(fh.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            if fcntl is not None:
                fcntl.flock(fh, fcntl.LOCK_UN)
            else:
                fh.seek(0)
                msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)


def update_mapping(dashboard_dir, section, compute):
    """Merge `compute(mapping)`'s answers into `section`, under the lock.

    `compute` reads the file as it stands inside the lock and returns
    `{key: answer}` to merge — or nothing, which writes nothing. The file is
    replaced whole only after the new copy is fully written, so a failed
    write never leaves a partial one. Returns the number of answers added
    or changed.
    """
    path = _mapping_path(dashboard_dir)
    with _mapping_lock(dashboard_dir):
        payload = read_mapping_file(dashboard_dir)
        answers = compute(payload) or {}
        if not answers:
            return 0
        target = payload
        for key in section:
            target = target.setdefault(key, {})
        changed = sum(1 for k, v in answers.items() if target.get(k) != v)
        target.update(answers)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        os.replace(str(tmp), str(path))
        return changed


def record_budget_mapping(dashboard_dir, answers, section=("rows",)):
    """Merge answers into the dir's mapping file, never replacing it.

    This file is the only record of decisions a client made — which fund a
    fee line means, which account a category covers, what is budget-only.
    Nothing else holds them, and they cost a conversation each. Write the
    whole file and one careless run erases work nobody can reconstruct.

    `section` is the key path the answers merge under — one of
    `_PROVENANCE_SECTIONS`. Every other section is left as found.

    Returns the number of answers added or changed.
    """
    return update_mapping(dashboard_dir, section, lambda _mapping: answers)


# Who gave a recorded answer: the operator themselves, or the model on their
# behalf. `record_mapping.py` stamps one of these on every answer it writes.
SOURCE_OPERATOR = "operator"
SOURCE_DELEGATED = "operator-delegated"
MAPPING_SOURCES = (SOURCE_OPERATOR, SOURCE_DELEGATED)

# The sections of budget-mapping.json that hold answers, as key paths.
_PROVENANCE_SECTIONS = (("rows",), ("inferences",), ("accounts",),
                        ("fund_attribution", "by_id"), ("fund_attribution", "by_memo"))


def mapping_provenance(mapping):
    """Who gave each recorded answer, from its `source` stamp.

    `delegated` lists the answers the model made on the operator's behalf
    ("do your best"); `unattributed` lists the answers with no stamp at all —
    written before record_mapping.py stamped one, or written around it. A
    `fund_attribution` answer recorded as a bare fund uuid has no stamp.
    """
    out = {"delegated": [], "unattributed": []}
    for section in _PROVENANCE_SECTIONS:
        for key, value in mapping_section(mapping, section).items():
            source = value.get("source") if isinstance(value, dict) else None
            ref = {"section": ".".join(section), "key": key}
            if source == SOURCE_DELEGATED:
                out["delegated"].append(ref)
            elif source not in MAPPING_SOURCES:
                out["unattributed"].append(ref)
    return out

