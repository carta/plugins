# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Field builders shared by the Code side panel and the Cowork `show_widget` form.

Both surfaces collect the identical field set (cowork-adapter.md § Fields) and must
stay interchangeable, so one implementation serves both. Docs: `docs/issuance-form.md`.

A wrong `*_SO_TYPES` set misreports a grant to a tax authority rather than failing
visibly, so the form JS gets those values from `so_type_js_constants()`, never a copy.
Python 3.9-safe: `uv` can resolve to macOS's system 3.9.
"""
from __future__ import annotations

import html
import json
from datetime import datetime
from typing import Any, Dict, List, Optional

# ── Jurisdiction → so_type buttons (carta-issuance Picklists). Primary first. ──
JURISDICTION_SO_TYPES = {
    "US": ["ISO", "NSO", "INTL"],
    "UK": ["EMI", "CSOP", "Unapproved"],
    "AU": ["Startup Concessions", "Non-Concessional", "ZEPO"],
}

# Full `issue_date_relationship` picklist (payload-reference.md), shared by
# the server-rendered block and the client-side "+ Add stakeholder" clone.
RELATIONSHIP_CHOICES = [
    "Advisor", "Ex-Advisor",
    "Board member", "Ex-Board member",
    "Consultant", "Ex-Consultant",
    "Employee", "Ex-Employee",
    "Executive",
    "Founder",
    "International Employee", "Ex-International Employee",
    "Investor",
    "Officer",
    "Other",
]

# so_types that unlock a conditional field group (payload-reference.md): EMI grants show
# HMRC-notified fields, the 3 AU types show the ATO-notified field. Every other so_type
# shows neither — these fields don't exist server-side for them.
HMRC_SO_TYPES = {"EMI"}
ATO_SO_TYPES = {"Startup Concessions", "Non-Concessional", "ZEPO"}
# Tri-state, not a flag: validate_drafts rejects an unanswered designation,
# but "No" is a valid answer.
EMPLOYMENT_RELATED_SO_TYPES = {"Unapproved"}

# data-value matches the MCP `stakeholder_kind` contract (payload-reference.md)
# — INDIVIDUAL/NON-INDIVIDUAL, not the raw Django enum's ORGANIZATION.
STAKEHOLDER_KIND_CHOICES = [("INDIVIDUAL", "Individual"), ("NON-INDIVIDUAL", "Non-individual")]

# `rule_144_difference_reason` picklist (payload-reference.md) — collected
# inline now instead of via a post-panel chat prompt.
RULE_144_REASON_CHOICES = [
    ("has_determined_144_date", "Has determined 144 date"),
    ("non_restricted_144", "Non-restricted 144"),
    ("relevance_provision", "Relevance provision"),
    ("affiliates", "Affiliates"),
    ("non_affiliates", "Non-affiliates"),
]

# `grant_reason` picklist (option grant only) — matches carta-web's own field
# (carta-modify-issuables/references/field-contract.md). Free text was never
# actually valid; the server field is choice-only.
GRANT_REASON_CHOICES = [
    "New Hire", "Merit", "Promotion", "Refresh", "Corporate transaction",
    "Relationship change", "Retention", "Advisor", "Consultant", "Board",
    "Performance bonus", "Boxcar grant",
]


class BuildError(RuntimeError):
    """Raised when inputs can't be parsed."""


def so_type_js_constants() -> str:
    """The three so_type gate sets as JS `const` declarations.

    The form JS re-toggles the HMRC / ATO / employment-related rows on every option-type
    change, so it needs these client-side. Emitting them keeps the browser's answer to
    "which types report to HMRC" identical to the server's. Sorted for deterministic output.
    """
    def _arr(values: Any) -> str:
        return json.dumps(sorted(values), separators=(",", ":"))

    return (
        "const HMRC_SO_TYPES = {hmrc};\n"
        "const ATO_SO_TYPES = {ato};\n"
        "const EMPLOYMENT_RELATED_SO_TYPES = {emp};"
    ).format(
        hmrc=_arr(HMRC_SO_TYPES),
        ato=_arr(ATO_SO_TYPES),
        emp=_arr(EMPLOYMENT_RELATED_SO_TYPES),
    )


# ── Loose JSON loading (unwrap the MCP result envelopes) ──

def _unwrap(obj: Any) -> Any:
    """Peel the common Carta MCP result envelopes down to the inner payload."""
    seen = 0
    while seen < 8:
        seen += 1
        if isinstance(obj, str):
            try:
                obj = json.loads(obj)
            except ValueError as exc:
                raise BuildError(f"could not parse nested JSON string in envelope: {exc}") from exc
            continue
        if isinstance(obj, dict):
            if "result" in obj and isinstance(obj["result"], (str, dict, list)):
                obj = obj["result"]
                continue
            if "text" in obj and isinstance(obj["text"], str):
                obj = obj["text"]
                continue
            return obj
        if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], dict) \
                and "text" in obj[0] and isinstance(obj[0]["text"], str):
            obj = obj[0]["text"]
            continue
        return obj
    return obj


def results(raw: Any) -> List[Dict[str, Any]]:
    """Unwrap an MCP payload and return its list of result dicts."""
    data = _unwrap(raw)
    if isinstance(data, dict) and "results" in data:
        data = data["results"]
    if isinstance(data, dict) and "stakeholders" in data:
        data = data["stakeholders"]
    if not isinstance(data, list):
        return []
    return [d for d in data if isinstance(d, dict)]


def esc(s: Any) -> str:
    return html.escape("" if s is None else str(s), quote=True)


def display_date(value: Any) -> str:
    """Render a date as MM/DD/YYYY, the format every user-facing surface uses.

    The valuation sections return ISO (`YYYY-MM-DD`); other payloads already use
    the display form. Anything unparseable passes through as-is rather than
    raising — a hint is not worth failing a form build over.
    """
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return text
    return parsed.strftime("%m/%d/%Y")


def sel(is_selected: bool) -> str:
    return " selected" if is_selected else ""


# ── Default-selection heuristics ──

def is_four_one_cliff(name: str) -> bool:
    """The conventional 4-year-with-cliff schedule, matched conservatively by name.
    Requires a real cliff ("no cliff" is rejected) and a 4-year signal — so
    "1/24 monthly, no cliff" does not match, while "4yr / 1yr cliff" and
    "1/48 monthly, 1 year cliff" do."""
    n = name.lower()
    if "cliff" not in n or "no cliff" in n:
        return False
    return "4" in n or "four" in n


def pick_default_vesting(
    templates: List[Dict[str, Any]], preferred_id: Optional[str] = None
) -> Optional[str]:
    """Id of the template to pre-select. The caller's preferred_id wins when it
    names a real template; otherwise the 4yr/1yr-cliff schedule; otherwise the
    first. (Default selection only; the user can change it in the form.)"""
    if preferred_id is not None:
        pid = str(preferred_id)
        if any(str(t.get("id")) == pid for t in templates):
            return pid
    for t in templates:
        if is_four_one_cliff(str(t.get("name", ""))):
            return str(t.get("id"))
    return str(templates[0].get("id")) if templates else None


def default_legend_id(legends: List[Dict[str, Any]], preferred_id: Optional[str] = None) -> Optional[str]:
    """Id of the legend to pre-select: the caller's preferred_id when it names a
    real legend; else the flagged default; else the only legend when there's just
    one. Shared by build_legends() (button selection) and the attestation-box
    renderer (needs the same id to look up the body) so they can't disagree."""
    if preferred_id is not None:
        pid = str(preferred_id)
        if any(str(lg.get("id")) == pid for lg in legends):
            return pid
    chosen = next((str(lg.get("id")) for lg in legends if lg.get("default") or lg.get("is_default")), None)
    if chosen is not None:
        return chosen
    if len(legends) == 1:
        return str(legends[0].get("id"))
    return None


# ── Exercise-price hint (source-agnostic FMV) ──

# Wire values from issuance_init's international_valuations rows, mapped to what
# an admin calls them. A US company sees "409A"; a UK one sees EMI or CSOP.
_FMV_SOURCE_LABELS = {
    "409A": "409A",
    "VALUATION_REPORT_409A": "409A",
    "EMI": "EMI",
    "EMI_VALUATION_REPORT": "EMI",
    "CSOP": "CSOP",
    "CSOP_VALUATION_REPORT": "CSOP",
    "SHARE_PRICE": "share price",
    "SHARE_PRICE_VALUATION_REPORT": "share price",
}

# AMV and UMV are the two prices an HMRC valuation produces, and which one an
# option is priced from changes the holder's tax position — so they are always
# spelled out rather than shown as bare acronyms.
_VALUATION_TYPE_LABELS = {
    "AMV": "AMV (actual market value)",
    "UMV": "UMV (unrestricted market value)",
    "FMV": "FMV",
    "SHARE_PRICE": "share price",
}


def _fmv_source_label(source: Any) -> str:
    key = str(source or "").strip().upper()
    return _FMV_SOURCE_LABELS.get(key, "")


def _fmv_option_label(option: Dict[str, Any], currency_fallback: str) -> str:
    """One line describing a single active valuation, for the picker."""
    vtype = str(option.get("valuation_type", "")).strip().upper()
    type_label = _VALUATION_TYPE_LABELS.get(vtype, vtype.title() if vtype else "")
    cur = str(option.get("currency") or currency_fallback or "").strip()
    price = str(option.get("price", "")).strip()
    amount = f"{cur} {price}".strip()
    parts = [p for p in (type_label, amount) if p]
    label = " — ".join(parts)
    effective = str(option.get("effective_date", "")).strip()
    if effective:
        label = f"{label} (effective {display_date(effective)})"
    return label


def sole_fmv_price(knowns: Dict[str, Any]) -> Optional[str]:
    """The price to prefill, but only when exactly one valuation is active.

    Returns None when there are none or several, so the caller falls through to
    its own default and an ambiguous batch never adopts one of two prices.
    """
    options = knowns.get("fmv_options") or []
    if not isinstance(options, list) or len(options) != 1:
        return None
    only = options[0]
    if not isinstance(only, dict):
        return None
    price = only.get("price")
    return None if price is None else str(price)


def build_exercise_price_hint(knowns: Dict[str, Any], currency: str) -> str:
    """Hint text under the exercise-price field.

    Four states, driven by what the company actually has on file rather than by
    whether a 409A exists — an international company prices grants from an EMI,
    CSOP or share-price valuation and has no 409A at all.

    A batch with more than one active valuation (an HMRC report yields both an
    AMV and a UMV) never auto-fills: nothing in the payload says which one an
    option is priced from, and guessing wrong has real tax consequences.
    """
    options = knowns.get("fmv_options") or []
    if not isinstance(options, list):
        options = []
    source = _fmv_source_label(knowns.get("fmv_source"))

    # Deprecated: has_409a + exercise_price_default was the pre-international
    # shape. Accepted for one release so a form rebuilt mid-conversation from
    # older knowns still renders a hint instead of falsely reading "no FMV".
    if not options and knowns.get("has_409a"):
        options = [{
            "valuation_type": "FMV",
            "price": knowns.get("exercise_price_default", ""),
            "currency": currency,
        }]
        source = source or "409A"

    if len(options) > 1:
        rendered = "; ".join(_fmv_option_label(o, currency) for o in options if isinstance(o, dict))
        prefix = f"This company has more than one active {source} valuation" if source else "This company has more than one active valuation"
        return f"{prefix} — choose the one this grant is priced from: {rendered}"

    if len(options) == 1 and isinstance(options[0], dict):
        opt = options[0]
        cur = str(opt.get("currency") or currency or "").strip()
        price = str(opt.get("price", "")).strip()
        vtype = str(opt.get("valuation_type", "")).strip().upper()
        # Name the source so the admin can tell an EMI-priced grant from a 409A one.
        descriptor = " ".join(p for p in (source, _VALUATION_TYPE_LABELS.get(vtype, "")) if p)
        descriptor = descriptor or "fair market value"
        effective = str(opt.get("effective_date", "")).strip()
        suffix = f" (effective {display_date(effective)})" if effective else ""
        return f"Prefilled with the current {descriptor} of {cur} {price}".rstrip() + suffix

    expired_on = str(knowns.get("fmv_expired_on", "")).strip()
    if expired_on:
        label = f"The most recent {source} valuation" if source else "The most recent valuation"
        return f"{label} expired on {display_date(expired_on)}. Enter an exercise price."

    # Deliberately not "No 409A on file": that reads as a missing US filing to a
    # company that never needed one.
    return "No active FMV on file"


# ── Button-group builders ──

def default_so_type(jurisdiction: str, rows: Optional[List[Dict[str, Any]]] = None, preferred: Optional[str] = None) -> str:
    """The so_type build_option_type() pre-selects — extracted so other callers
    (e.g. HMRC/ATO visibility) use the same logic instead of a drifting copy.

    Only the resolved jurisdiction's 3 types are candidates (per-corp scoping,
    not all 9 — showing another jurisdiction's types read as noise). Primary is
    the jurisdiction default, except a row whose only named grantee has a known
    non-employee relationship gets NSO instead (an unresolved relationship
    doesn't count, since they could still turn out to be an employee).
    ``preferred`` wins when it names one of the resolved types. UI default
    only — the server is the so_type authority (Hard rule 5)."""
    juris = (jurisdiction or "US").upper()
    types = JURISDICTION_SO_TYPES.get(juris, JURISDICTION_SO_TYPES["US"])
    primary = types[0]
    if juris == "US" and rows:
        named = [r for r in rows if isinstance(r, dict) and str(r.get("name", "")).strip()]
        relationships = [str(r.get("relationship", "")).strip() for r in named]
        if named and all(rel and rel != "Employee" for rel in relationships):
            primary = "NSO"
    if preferred and preferred in types:
        primary = preferred
    return primary


def build_option_type(
    jurisdiction: str, rows: Optional[List[Dict[str, Any]]] = None, preferred: Optional[str] = None,
    force_blank: bool = False,
) -> str:
    """Renders only the corp's own resolved jurisdiction's 3 so_types (not all 9
    grouped by jurisdiction) — a corp only ever issues one jurisdiction's types,
    so the rest is clutter. `jurisdiction` (`knowns.jurisdiction`, SKILL.md
    Phase 0.5) now gates which buttons render, not just which is pre-selected.

    ``force_blank`` selects nothing (see build_vesting) — when a file named an
    option type we couldn't match, falling back to the jurisdiction's primary
    would change the grant's tax treatment without saying so."""
    juris = (jurisdiction or "US").upper()
    types = JURISDICTION_SO_TYPES.get(juris, JURISDICTION_SO_TYPES["US"])
    primary = None if force_blank else default_so_type(jurisdiction, rows, preferred)
    btns = "".join(
        '<button type="button" class="toggle{s}" data-group="type" data-value="{v}" onclick="pickType(this)">{v}</button>'.format(
            s=sel(t == primary), v=esc(t)
        )
        for t in types
    )
    return f'<div class="toggle-row">{btns}</div>'


def build_vesting(
    templates: List[Dict[str, Any]], no_vesting: bool, preferred_id: Optional[str] = None,
    force_blank: bool = False,
) -> str:
    """``force_blank`` renders an empty placeholder as the selection instead of
    the 4yr/1yr-cliff heuristic. Used when an import couldn't resolve the file's
    vesting schedule: the heuristic default would otherwise silently issue terms
    the file never asked for, and unlike a bad quantity the server can't catch
    it. The empty value also makes ``missingFields()`` block **Review** until the
    admin picks one, which is the actual gate — an amber marker alone is
    ignorable."""
    if force_blank:
        opts = ['<option value="" selected>Select a vesting schedule…</option>']
        for t in templates:
            tid = str(t.get("id"))
            name = str(t.get("name", tid))
            opts.append('<option value="{v}" data-label="{l}">{l}</option>'.format(
                v=esc(tid), l=esc(name)))
        opts.append('<option value="__none__" data-label="No vesting">No vesting</option>')
        return "".join(opts)
    chosen = None if no_vesting else pick_default_vesting(templates, preferred_id)
    opts = []
    for t in templates:
        tid = str(t.get("id"))
        name = str(t.get("name", tid))
        opts.append(
            '<option value="{v}" data-label="{l}"{s}>{l}</option>'.format(
                s=" selected" if tid == chosen else "", v=esc(tid), l=esc(name)
            )
        )
    opts.append(
        '<option value="__none__" data-label="No vesting"{s}>No vesting</option>'.format(
            s=" selected" if no_vesting else ""
        )
    )
    return "".join(opts)


def build_acceleration(templates: List[Dict[str, Any]], preferred_id: Optional[str] = None) -> str:
    """`acceleration_template` (payload-reference.md) is optional and only shown
    when vesting is set. No 4yr/1yr-cliff-style convention to default to —
    "No acceleration" wins unless the row already carries a real one."""
    ids = [str(t.get("id")) for t in templates]
    chosen = str(preferred_id) if preferred_id is not None and str(preferred_id) in ids else None
    opts = [
        '<option value="__none__" data-label="No acceleration"{s}>No acceleration</option>'.format(
            s=sel(chosen is None)
        )
    ]
    for t in templates:
        tid = str(t.get("id"))
        name = str(t.get("name", tid))
        opts.append(
            '<option value="{v}" data-label="{l}"{s}>{l}</option>'.format(
                s=sel(tid == chosen), v=esc(tid), l=esc(name)
            )
        )
    return "".join(opts)


def build_docsets(sets: List[Dict[str, Any]], preferred_id: Optional[str] = None,
                  force_blank: bool = False) -> str:
    # Pre-select the caller's preferred id when it names a real set; else the only
    # set when there's exactly one (the common case). force_blank selects nothing
    # (see build_vesting) so missingFields() blocks Review.
    ids = [str(d.get("id")) for d in sets]
    if force_blank:
        chosen: Optional[str] = None
    elif preferred_id is not None and str(preferred_id) in ids:
        chosen = str(preferred_id)
    else:
        chosen = ids[0] if len(sets) == 1 else None
    btns = [
        '<button type="button" class="toggle{s}" data-group="docset" data-value="{v}" data-label="{l}" '
        'onclick="pick(this)">{l}</button>'.format(
            s=sel(str(d.get("id")) == chosen), v=esc(d.get("id")), l=esc(d.get("name", d.get("id")))
        )
        for d in sets
    ]
    return "".join(btns)


def build_share_classes(classes: List[Dict[str, Any]], prefill_prefix: Optional[str],
                        force_blank: bool = False) -> str:
    """Button text is `(<prefix>) <name>` (e.g. `(CS) Common`) — the bare name
    alone left the user guessing which prefix a class maps to when several
    classes share a name. Pre-selects the prompt-named class; else the most
    recently created one (no creation timestamp in the fetched list, so last
    entry by ascending `id` is the best available proxy); falls back to the
    only class when there's just one.

    ``force_blank`` selects nothing (see build_vesting) — "most recently
    created" is a reasonable guess for a prompt that named no class, and a
    dangerous one for a file that named a class we couldn't match."""
    only_prefix = str(classes[0].get("prefix", "")) if len(classes) == 1 else None
    latest_prefix = str(classes[-1].get("prefix", "")) if classes else None
    chosen_prefix = (
        None if force_blank
        else (prefill_prefix if prefill_prefix is not None else (only_prefix or latest_prefix))
    )
    btns = []
    for c in classes:
        prefix = str(c.get("prefix", ""))
        name = str(c.get("name", prefix))
        display = f"({prefix}) {name}" if prefix else name
        btns.append(
            '<button type="button" class="toggle{s}" data-group="shareclass" data-value="{v}" data-label="{l}" '
            'onclick="pick(this)">{disp}</button>'.format(
                s=sel(prefix == chosen_prefix), v=esc(prefix), l=esc(name), disp=esc(display)
            )
        )
    return "".join(btns)


def build_legends(legends: List[Dict[str, Any]], preferred_id: Optional[str] = None,
                  force_blank: bool = False) -> str:
    chosen = None if force_blank else default_legend_id(legends, preferred_id)
    btns = []
    for lg in legends:
        lid = str(lg.get("id"))
        name = str(lg.get("name", lid))
        body = lg.get("text") or lg.get("body") or ""
        btns.append(
            '<button type="button" class="toggle{s}" data-group="legend" data-value="{v}" data-label="{l}" '
            'data-body="{b}" onclick="pickLegend(this)">{l}</button>'.format(
                s=sel(lid == chosen), v=esc(lid), l=esc(name), b=esc(body)
            )
        )
    return "".join(btns)


def build_rule144_reason_select(reason: Optional[str]) -> str:
    opts = ['<option value="">Select a reason…</option>']
    for v, label in RULE_144_REASON_CHOICES:
        opts.append('<option value="{v}"{s}>{l}</option>'.format(v=v, s=sel(v == reason), l=esc(label)))
    return (
        '<select class="select-input block-rule144-reason" onchange="onStakeInput()">'
        + "".join(opts) + "</select>"
    )


def build_stakeholder_kind(kind: str, force_blank: bool = False) -> str:
    """``force_blank`` selects neither button (see build_vesting) — a file whose
    Holder Type we couldn't read must not default an entity to Individual."""
    kind = "" if force_blank else (kind or "INDIVIDUAL")
    return "".join(
        '<button type="button" class="toggle{s}" data-group="kind" data-value="{v}" onclick="pick(this)">{l}</button>'.format(
            s=sel(kind == v), v=v, l=label
        )
        for v, label in STAKEHOLDER_KIND_CHOICES
    )


def build_relationship_select(relationship: str) -> str:
    """Relationship is always required at issue time (`issue_date_relationship`);
    this used to render a contradictory "(optional)" placeholder.
    RELATIONSHIP_CHOICES is the full picklist (payload-reference.md) — a
    roster relationship outside the list is prepended as an extra selected
    option rather than dropped, so it's never silently lost."""
    rel = relationship or ""
    extra = [rel] if rel and rel not in RELATIONSHIP_CHOICES else []
    rel_options = "\n".join(
        '<option value="{v}"{s}>{v}</option>'.format(v=v, s=sel(v == rel))
        for v in extra + RELATIONSHIP_CHOICES
    )
    return (
        '<select class="stake-relationship" aria-label="Relationship" onchange="onStakeInput()">'
        '<option value=""{s}>Select relationship…</option>'
        '{opts}</select>'
    ).format(s=sel(not rel), opts=rel_options)


def build_grant_reason_select(reason: Optional[str]) -> str:
    opts = ['<option value="">Select a reason…</option>']
    extra = [reason] if reason and reason not in GRANT_REASON_CHOICES else []
    for v in extra + GRANT_REASON_CHOICES:
        opts.append('<option value="{v}"{s}>{v}</option>'.format(v=esc(v), s=sel(v == reason)))
    return (
        '<select class="select-input block-grant-reason" onchange="onStakeInput()">'
        + "".join(opts) + "</select>"
    )


# ── Per-row default-carry helpers (row's own value wins; else the batch-level
# ``knowns`` default; this is how a fresh prompt-only render — where no row
# specifies its own terms — reproduces today's single-shared-default behavior). ──

def row_no_vesting(row: Dict[str, Any], knowns: Dict[str, Any]) -> bool:
    v = row.get("vesting_template_id")
    if v is not None:
        return v == "__none__"
    return bool(knowns.get("no_vesting"))


def row_preferred_vesting(row: Dict[str, Any], knowns: Dict[str, Any]) -> Optional[str]:
    v = row.get("vesting_template_id")
    if v and v != "__none__":
        return v
    return knowns.get("default_vesting_id")


def cert_no_vesting(row: Dict[str, Any], knowns: Dict[str, Any]) -> bool:
    """Certificate vesting is opt-in (payload-reference.md: `vesting_template` |
    opt-in), the opposite default from grants (`vesting_template` | always). A
    cert row defaults to "No vesting" unless the row or the batch-level knowns
    default names a real template id."""
    v = row.get("vesting_template_id")
    if v is not None:
        return v == "__none__"
    return not knowns.get("default_vesting_id")


def kv_row(
    label: str, input_html: str, sectype: Optional[str] = None, required: bool = False,
    conditional_on: Optional[str] = None, hidden: bool = False,
    notes: Optional[List[Dict[str, Any]]] = None,
) -> str:
    """One "label | input" row in a stakeholder's key-value block (a flex pair,
    not a literal HTML <table>).

    ``required=True`` renders a ``*`` — only for rows that always render and
    always need a decision; never mark a sometimes-hidden row required.

    ``conditional_on`` tags the row ``data-conditional="<value>"``; with
    ``hidden=True`` it starts ``display:none``. The form's JS toggles every
    row sharing a `data-conditional` value together.

    ``notes`` are this field's ``import_notes`` (issuance-import), rendered as an
    inline marker under the input. Display-only — never collected on submit."""
    attr = f' data-sectype="{sectype}"' if sectype else ""
    if conditional_on:
        attr += f' data-conditional="{esc(conditional_on)}"'
    mark = ' <span class="req-mark" aria-hidden="true">*</span>' if required else ""
    style = ' style="display:none;"' if hidden else ""
    return (
        f'<div class="kv-row"{attr}{style}>'
        f'<div class="kv-label">{esc(label)}{mark}</div>'
        f'<div class="kv-input">{input_html}{build_import_note(notes)}</div>'
        f'</div>'
    )


def advanced_accordion(rows_html: List[str]) -> str:
    """Collapses low-priority fields into a native `<details>`, closed by
    default. Still fully in the DOM — `collectBlocks()` reads them regardless
    of open/closed state, so a value typed here isn't dropped."""
    return (
        '<details class="advanced-fields">'
        '<summary>More fields (optional)</summary>'
        f'<div class="kv-table">{"".join(rows_html)}</div>'
        '</details>'
    )


def advanced_accordion_grant(
    row: Dict[str, Any], accel_templates: List[Dict[str, Any]], no_vesting: bool,
    notes: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> str:
    notes = notes if notes is not None else {}
    return advanced_accordion([
        kv_row(
            "Custom label",
            f'<input class="text-input block-custom-label" type="text" '
            f'placeholder="Server auto-generates (e.g. ES-1) if left blank" '
            f'value="{esc(row.get("custom_label", ""))}" oninput="onStakeInput()"/>',
            notes=notes.pop("custom_label", None),
        ),
        kv_row(
            "Grant reason", build_grant_reason_select(row.get("grant_reason")),
            notes=notes.pop("grant_reason", None),
        ),
        kv_row(
            "Acceleration",
            f'<select class="select-input block-acceleration-select" onchange="onStakeInput()">'
            f'{build_acceleration(accel_templates, None if no_vesting else row.get("acceleration_template"))}</select>',
            conditional_on="vesting", hidden=no_vesting,
            notes=notes.pop("acceleration_template", None),
        ),
        kv_row(
            "Early exercise",
            f'<label class="pending-label"><input type="checkbox" class="block-early-exercise"'
            f'{" checked" if row.get("early_exercise") else ""} onchange="onStakeInput()"/> '
            f'Allow early exercise</label>',
            notes=notes.pop("early_exercise", None),
        ),
        kv_row(
            "Auto-exercise at vest",
            f'<label class="pending-label"><input type="checkbox" class="block-auto-exercise-at-vest"'
            f'{" checked" if row.get("auto_exercise_at_vest") else ""} onchange="onStakeInput()"/> '
            f'Auto-exercise at vest</label>',
            notes=notes.pop("auto_exercise_at_vest", None),
        ),
        kv_row(
            "Flexible issue date",
            f'<label class="pending-label"><input type="checkbox" class="block-flexible-issue-date"'
            f'{" checked" if row.get("is_flexible_issue_date") else ""} onchange="onStakeInput()"/> '
            f'Issue date is flexible</label>',
            notes=notes.pop("is_flexible_issue_date", None),
        ),
        kv_row(
            "Notes",
            f'<input class="text-input block-notes" type="text" placeholder="Optional" '
            f'value="{esc(row.get("notes", ""))}" oninput="onStakeInput()"/>',
            notes=notes.pop("notes", None),
        ),
    ])


def advanced_accordion_cert(
    row: Dict[str, Any], accel_templates: List[Dict[str, Any]], no_vesting: bool,
    notes: Optional[Dict[str, List[Dict[str, Any]]]] = None,
) -> str:
    notes = notes if notes is not None else {}
    field_rows = [
        kv_row(
            "Acceleration",
            f'<select class="select-input block-acceleration-select" onchange="onStakeInput()">'
            f'{build_acceleration(accel_templates, None if no_vesting else row.get("acceleration_template"))}</select>',
            conditional_on="vesting", hidden=no_vesting,
            notes=notes.pop("acceleration_template", None),
        ),
        kv_row(
            "Certificate number",
            f'<input class="text-input block-prefix-number" type="text" '
            f'placeholder="Server auto-numbers if left blank" '
            f'value="{esc(row.get("prefix_number", ""))}" oninput="onStakeInput()"/>',
            notes=notes.pop("prefix_number", None),
        ),
        kv_row(
            "Cash paid",
            f'<input class="text-input block-cash-paid" type="text" inputmode="decimal" placeholder="Optional" '
            f'value="{esc(row.get("cash_paid", ""))}" oninput="onStakeInput()"/>',
            notes=notes.pop("cash_paid", None),
        ),
        kv_row(
            "Debt canceled",
            f'<input class="text-input block-debt-canceled" type="text" inputmode="decimal" placeholder="Optional" '
            f'value="{esc(row.get("debt_canceled", ""))}" oninput="onStakeInput()"/>',
            notes=notes.pop("debt_canceled", None),
        ),
    ]
    field_rows.append(kv_row(
        "Notes",
        f'<input class="text-input block-notes" type="text" placeholder="Optional" '
        f'value="{esc(row.get("notes", ""))}" oninput="onStakeInput()"/>',
        notes=notes.pop("notes", None),
    ))
    return advanced_accordion(field_rows)


# ── Server-error banners (Phase 1.5's save+validate step) ──

def build_error_banner(errors: Optional[List[Any]], *, css_class: str, title: str) -> str:
    """Shared renderer for the block-level and form-level server-error
    banners. ``errors`` is a list of already human-readable,
    payload-key-translated strings (the orchestrator does that translation,
    SKILL.md's Voice & defaults table); this only renders them verbatim (Hard
    rule 5) or nothing when the list is empty."""
    msgs = [str(e).strip() for e in (errors or []) if str(e).strip()]
    if not msgs:
        return ""
    items = "".join(f"<li>{esc(m)}</li>" for m in msgs)
    return (
        f'<div class="{css_class}" role="alert">'
        f'<p class="{css_class}-title">{esc(title)}</p>'
        f'<ul>{items}</ul></div>'
    )


def build_block_error_banner(errors: Optional[List[Any]]) -> str:
    return build_error_banner(errors, css_class="block-error-banner", title="This stakeholder needs attention")


def build_batch_error_banner(errors: Optional[List[Any]]) -> str:
    return build_error_banner(errors, css_class="panel-error-banner", title="Some issues need attention before this can be saved")


# ── Import markers (issuance-import's `import_notes`) ──

def notes_by_field(row: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Group a row's ``import_notes`` by the field each one is about.

    Notes are display-only breadcrumbs from a spreadsheet/document import: what
    the file said, and why it couldn't be applied. Malformed entries are dropped
    here rather than crashing the form — a bad note must never cost the admin
    the whole form."""
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for note in row.get("import_notes") or []:
        if not isinstance(note, dict):
            continue
        field = str(note.get("field") or "").strip()
        if field:
            grouped.setdefault(field, []).append(note)
    return grouped


def _note_text(note: Dict[str, Any]) -> str:
    raw = str(note.get("raw_value") or "").strip()
    reason = str(note.get("reason") or "").strip()
    confidence = str(note.get("confidence") or "").strip().lower()
    parts = []
    if raw:
        parts.append(f'Your file said "{raw}"')
    if reason:
        parts.append(reason)
    if confidence == "low":
        # Document mode fills fields by reading prose, so every one of them is a
        # guess the admin has to confirm — say so rather than implying the file
        # stated it outright.
        parts.append("read from the document — confirm it")
    return " — ".join(parts) if parts else "Check this value."


def build_import_note(notes: Optional[List[Dict[str, Any]]]) -> str:
    """Inline amber marker under one field's input. ``""`` when there's nothing."""
    items = [_note_text(n) for n in (notes or []) if isinstance(n, dict)]
    if not items:
        return ""
    body = "".join(f"<span>{esc(t)}</span>" for t in items)
    return f'<div class="import-note" role="note">{body}</div>'


def build_import_leftover_banner(grouped: Dict[str, List[Dict[str, Any]]]) -> str:
    """Block-level marker for notes whose field has no visible row in this block.

    Without this, a note on a field the form doesn't render (a conditional row,
    or a field this security type doesn't have) would be silently dropped — the
    exact silent-loss the import contract forbids. Field names are humanized
    mechanically (SKILL.md Voice & defaults) so no raw snake_case reaches the
    admin."""
    items = []
    for field, notes in grouped.items():
        label = field.replace("_", " ").strip().capitalize()
        for note in notes:
            items.append(f"{label}: {_note_text(note)}")
    if not items:
        return ""
    body = "".join(f"<li>{esc(t)}</li>" for t in items)
    return (
        '<div class="import-banner" role="note">'
        '<p class="import-banner-title">From your file</p>'
        f'<ul>{body}</ul></div>'
    )


# ── One full key-value block per stakeholder ──

def board_approval_html(row: Dict[str, Any], today: str, security_type: str) -> str:
    pending = row.get("board_approval") == "pending"
    board_date = row.get("board_approval_date")
    if board_date is None:
        board_date = "" if pending else today
    pending_label = ""
    if security_type == "option_grant":
        pending_label = (
            '<label class="pending-label" data-sectype="option_grant">'
            f'<input type="checkbox" class="block-board-pending"{" checked" if pending else ""} '
            'onchange="toggleBoardPending(this)"/> Pending — not yet approved</label>'
        )
    return (
        f'{pending_label}'
        f'<input class="date-input block-board-date" type="date" value="{esc(board_date)}"'
        f'{" disabled" if pending else ""} oninput="onStakeInput()"/>'
    )


def build_stakeholder_block(row: Dict[str, Any], security_type: str, data: Dict[str, Any], knowns: Dict[str, Any]) -> str:
    name = esc(row.get("name", ""))
    email = esc(row.get("email", ""))
    qty = row.get("quantity", "")
    qty = "" if qty is None else esc(qty)
    currency = esc(knowns.get("currency", ""))
    today = knowns.get("today_iso", "")

    # Consumed per field as the block is built; whatever is left over had no
    # visible row and goes to the block-level banner instead of being dropped.
    notes = notes_by_field(row)
    # Fields the file spoke to but we couldn't resolve. These render with NOTHING
    # selected, so the form's own missingFields() gate blocks Review until the
    # admin chooses — the amber marker explains, this is what enforces.
    unresolved = set(notes)

    rows_html: List[str] = [
        kv_row(
            "Name",
            f'<div class="stake-name-wrap">'
            f'<input class="text-input stake-name-in" type="text" autocomplete="off" '
            f'placeholder="Search or type a new name…" value="{name}" '
            f'oninput="onStakeNameInput(this)" onfocus="onStakeNameFocus(this)"/>'
            f'<div class="stake-suggestions" style="display:none;"></div>'
            f'</div>',
            required=True, notes=notes.pop("name", None),
        ),
        kv_row(
            "Email",
            f'<input class="text-input stake-email-in" type="email" placeholder="Email" '
            f'value="{email}" oninput="onStakeInput()"/>',
            required=True, notes=notes.pop("email", None),
        ),
        kv_row(
            "Stakeholder type",
            f'<div class="toggle-row">{build_stakeholder_kind(row.get("stakeholder_kind", ""), "stakeholder_kind" in unresolved)}</div>',
            required=True, notes=notes.pop("stakeholder_kind", None),
        ),
        kv_row(
            "Relationship", build_relationship_select(row.get("relationship", "")),
            required=True, notes=notes.pop("relationship", None),
        ),
        kv_row(
            "Quantity",
            f'<input class="text-input stake-qty-in" type="number" inputmode="numeric" '
            f'placeholder="Quantity" value="{qty}" oninput="onStakeInput()"/>',
            required=True, notes=notes.pop("quantity", None),
        ),
    ]

    if security_type == "option_grant":
        exercise_price_default = row.get("exercise_price")
        if exercise_price_default is None:
            # Prefill from the single active valuation when there is exactly one.
            # Two or more (an HMRC report's AMV and UMV) deliberately leaves the
            # field empty — the hint asks the admin to pick rather than adopting
            # one price silently. Falls back to the batch-level default, which is
            # also what the deprecated has_409a shape supplies.
            exercise_price_default = sole_fmv_price(knowns)
            if exercise_price_default is None:
                exercise_price_default = knowns.get("exercise_price_default", "")
        templates = results(data.get("vesting_templates"))
        accel_templates = results(data.get("acceleration_templates"))
        no_vesting = row_no_vesting(row, knowns)
        vesting_start = row.get("vesting_start_date") or today
        vest_wrap_style = "" if not no_vesting else ' style="display:none;"'
        docsets = results(data.get("document_sets"))
        # Routes through default_so_type so a foreign so_type can't show an
        # HMRC/ATO field on a form whose Type buttons don't include it.
        so_type = default_so_type(str(knowns.get("jurisdiction", "US")), [row], row.get("option_type"))
        hmrc_notified = row.get("hmrc_notified") or today

        rows_html.append(kv_row(
            "Type",
            build_option_type(str(knowns.get("jurisdiction", "US")), [row], row.get("option_type"),
                              "option_type" in unresolved),
            sectype="option_grant",
            required=True, notes=notes.pop("option_type", None),
        ))
        price_hint = esc(build_exercise_price_hint(knowns, currency))
        rows_html.append(kv_row(
            "Exercise price",
            f'<p class="field-hint">{price_hint}</p>'
            f'<div class="price-row">'
            f'<input class="text-input block-exercise-price" type="text" inputmode="decimal" '
            f'value="{esc(exercise_price_default)}" oninput="onStakeInput()" style="width:140px;"/>'
            f'<span class="currency-suffix">{currency}</span></div>',
            sectype="option_grant",
            required=True, notes=notes.pop("exercise_price", None),
        ))
        rows_html.append(kv_row(
            "Issue date",
            f'<input class="date-input block-issue-date" type="date" value="{esc(row.get("issue_date") or today)}" '
            f'oninput="updateIssueDate(this)"/>',
            required=True, notes=notes.pop("issue_date", None),
        ))
        rows_html.append(kv_row(
            "Board approval",
            board_approval_html(row, today, security_type),
            required=True, notes=notes.pop("board_approval_date", None),
        ))
        vesting_options = build_vesting(
            templates, no_vesting, row_preferred_vesting(row, knowns),
            "vesting_template_id" in unresolved,
        )
        rows_html.append(kv_row(
            "Vesting schedule",
            f'<select class="select-input block-vesting-select" onchange="pickVesting(this)">'
            f'{vesting_options}</select>'
            f'<div class="block-vesting-start-wrap"{vest_wrap_style}>'
            f'<p class="field-sublabel">Vesting start date</p>'
            f'<input class="date-input block-vesting-start-date" type="date" value="{esc(vesting_start)}" '
            f'oninput="updateVestingStart(this)"/></div>',
            sectype="option_grant",
            required=True,
            notes=(notes.pop("vesting_template_id", None) or [])
                  + (notes.pop("vesting_start_date", None) or []) or None,
        ))
        rows_html.append(kv_row(
            "Documents",
            f'<p class="field-hint">Document templates attached to every grant.</p>'
            f'<div class="toggle-row wrap">{build_docsets(docsets, row.get("document_set_id"), "document_set_id" in unresolved)}</div>',
            sectype="option_grant",
            required=True, notes=notes.pop("document_set_id", None),
        ))
        rows_html.append(kv_row(
            "HMRC notified",
            f'<label class="pending-label"><input type="checkbox" class="block-hmrc-notified"'
            f'{" checked" if row.get("is_hmrc_notified") else ""} onchange="onStakeInput()"/> HMRC has been notified</label>'
            f'<input class="date-input block-hmrc-notified-date" type="date" value="{esc(hmrc_notified)}" '
            f'oninput="onStakeInput()"/>',
            sectype="option_grant", conditional_on="so_type_emi", hidden=(so_type not in HMRC_SO_TYPES),
            notes=(notes.pop("is_hmrc_notified", None) or [])
                  + (notes.pop("hmrc_notified", None) or []) or None,
        ))
        rows_html.append(kv_row(
            "ATO notified",
            f'<label class="pending-label"><input type="checkbox" class="block-ato-notified"'
            f'{" checked" if row.get("is_ato_notified") else ""} onchange="onStakeInput()"/> ATO has been notified</label>',
            sectype="option_grant", conditional_on="so_type_au", hidden=(so_type not in ATO_SO_TYPES),
            notes=notes.pop("is_ato_notified", None),
        ))
        emp_related = row.get("employment_related")
        rows_html.append(kv_row(
            "Employment related",
            f'<p class="field-hint">Was this grant acquired by reason of employment? Required for '
            f'Unapproved grants so they are reported correctly in the HMRC Other ERS annual return.</p>'
            f'<div class="toggle-row">'
            f'<button type="button" class="toggle{sel(emp_related is True)}" data-group="employment-related" '
            f'data-value="yes" onclick="pick(this)">Yes</button>'
            f'<button type="button" class="toggle{sel(emp_related is False)}" data-group="employment-related" '
            f'data-value="no" onclick="pick(this)">No</button></div>',
            sectype="option_grant",
            conditional_on="so_type_employment_related",
            hidden=(so_type not in EMPLOYMENT_RELATED_SO_TYPES),
            required=True,
            notes=notes.pop("employment_related", None),
        ))
        rows_html.append(advanced_accordion_grant(row, accel_templates, no_vesting, notes))
    else:
        price_default = row.get("price_per_share")
        if price_default is None:
            price_default = knowns.get("price_per_share_default", "")
        classes = results(data.get("share_classes"))
        preferred_prefix = row.get("share_class_prefix") or knowns.get("share_class_prefix")
        legends = results(data.get("legends"))
        preferred_legend = row.get("legend_id")
        chosen_legend_id = default_legend_id(legends, preferred_legend)
        selected_legend = next((lg for lg in legends if str(lg.get("id")) == chosen_legend_id), None)
        body = (selected_legend.get("text") or selected_legend.get("body") or "") if selected_legend else ""
        r144_mode = row.get("rule_144_mode", "issue_date")
        r144_date = row.get("rule_144_date") or today
        templates = results(data.get("vesting_templates"))
        accel_templates = results(data.get("acceleration_templates"))
        no_vesting_cert = cert_no_vesting(row, knowns)
        cert_vesting_start = row.get("vesting_start_date") or today
        cert_vest_wrap_style = "" if not no_vesting_cert else ' style="display:none;"'

        rows_html.append(kv_row(
            "Share class",
            f'<div class="toggle-row wrap">{build_share_classes(classes, preferred_prefix, "share_class_prefix" in unresolved)}</div>',
            sectype="certificate",
            required=True, notes=notes.pop("share_class_prefix", None),
        ))
        # LLC status can't be resolved (no MCP command returns it), so the hint
        # stays generic rather than confirming either way.
        price_hint = "0 is only valid for LLC corporations — otherwise enter a price greater than 0."
        rows_html.append(kv_row(
            "Price per share",
            f'<p class="field-hint">{esc(price_hint)}</p>'
            f'<div class="price-row"><span class="currency-suffix">{currency}</span>'
            f'<input class="text-input block-price-per-share" type="text" inputmode="decimal" '
            f'value="{esc(price_default)}" oninput="onStakeInput()" style="width:140px;"/></div>',
            sectype="certificate",
            required=True, notes=notes.pop("price_per_share", None),
        ))
        rows_html.append(kv_row(
            "Issue date",
            f'<input class="date-input block-issue-date" type="date" value="{esc(row.get("issue_date") or today)}" '
            f'oninput="updateIssueDate(this)"/>',
            required=True, notes=notes.pop("issue_date", None),
        ))
        rows_html.append(kv_row(
            "Board approval",
            board_approval_html(row, today, security_type),
            required=True, notes=notes.pop("board_approval_date", None),
        ))
        attest_style = "" if body else ' style="display:none;"'
        rows_html.append(kv_row(
            "Build legend",
            f'<p class="field-hint">Legal text printed on every certificate to restrict transfer. Read the full '
            f'body before continuing — you are attesting to it.</p>'
            f'<div class="toggle-row wrap">{build_legends(legends, preferred_legend, "legend_id" in unresolved)}</div>'
            f'<div class="block-legend-attest legend-attest"{attest_style}>{esc(body)}</div>',
            sectype="certificate",
            required=True, notes=notes.pop("legend_id", None),
        ))
        r144_date_style = "" if r144_mode == "other" else ' style="display:none;"'
        r144_reason = row.get("rule_144_reason")
        rows_html.append(kv_row(
            "Rule 144 date",
            f'<p class="field-hint">Holding-period start date for restricted securities.</p>'
            f'<div class="toggle-row">'
            f'<button type="button" class="toggle{sel(r144_mode != "other")}" data-group="rule144" '
            f'data-value="issue_date" onclick="pickRule144(this)">Use the issue date</button>'
            f'<button type="button" class="toggle{sel(r144_mode == "other")}" data-group="rule144" '
            f'data-value="other" onclick="pickRule144(this)">Use a different date</button></div>'
            f'<input class="date-input block-rule144-date" type="date" value="{esc(r144_date)}"'
            f'{r144_date_style} oninput="onStakeInput()"/>'
            f'<div class="block-rule144-reason-wrap"{r144_date_style}>'
            f'<p class="field-sublabel">Reason for the different date</p>'
            f'{build_rule144_reason_select(r144_reason)}</div>',
            sectype="certificate",
            required=True,
            notes=(notes.pop("rule_144_date", None) or [])
                  + (notes.pop("rule_144_reason", None) or []) or None,
        ))
        cert_vesting_options = build_vesting(
            templates, no_vesting_cert, row_preferred_vesting(row, knowns),
            "vesting_template_id" in unresolved,
        )
        rows_html.append(kv_row(
            "Vesting schedule",
            f'<select class="select-input block-vesting-select" onchange="pickVesting(this)">'
            f'{cert_vesting_options}</select>'
            f'<div class="block-vesting-start-wrap"{cert_vest_wrap_style}>'
            f'<p class="field-sublabel">Vesting start date</p>'
            f'<input class="date-input block-vesting-start-date" type="date" value="{esc(cert_vesting_start)}" '
            f'oninput="updateVestingStart(this)"/></div>',
            sectype="certificate",
            notes=(notes.pop("vesting_template_id", None) or [])
                  + (notes.pop("vesting_start_date", None) or []) or None,
        ))
        rows_html.append(advanced_accordion_cert(row, accel_templates, no_vesting_cert, notes))

    row_key = esc(row.get("row_key", ""))
    error_banner = build_block_error_banner(row.get("server_errors"))
    # Anything still in `notes` had no visible row — surfaced, never dropped.
    import_banner = build_import_leftover_banner(notes)
    return (
        f'<div class="stake-block" data-stake-block data-row-key="{row_key}">'
        '<div class="stake-block-head">'
        '<span class="stake-block-title"></span>'
        '<button class="btn-trash" type="button" onclick="removeStakeBlock(this)" title="Remove stakeholder">'
        '<svg width="13" height="13" fill="none" viewBox="0 0 20 20"><path d="M8 2h4M3 5h14M6 5l1 12h6l1-12" '
        'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        '</button></div>'
        f'{error_banner}{import_banner}'
        f'<div class="kv-table">{"".join(rows_html)}</div>'
        '</div>'
    )


def build_stakeholder_blocks(rows: List[Dict[str, Any]], security_type: str, data: Dict[str, Any], knowns: Dict[str, Any]) -> str:
    """One key-value block per named person; a single blank block when none
    were named.

    Stamps a stable ``row_key`` (``data-row-key``) onto each block — its own,
    or a fresh positional ``r<index>`` fallback — so the orchestrator can
    re-match a resubmitted row to its saved ``draft_pk`` (SKILL.md Hard rule 4)
    without relying on array position, which desyncs if a block is
    added/removed between saves.

    The positional fallback probes past any ``r<N>`` already in use so a mix
    of explicit and missing keys at different indices can't mint a duplicate."""
    if not rows:
        rows = [{}]
    existing_keys = {r.get("row_key") for r in rows if r.get("row_key")}
    out = []
    for i, r in enumerate(rows):
        if not r.get("row_key"):
            probe = i
            candidate = f"r{probe}"
            while candidate in existing_keys:
                probe += 1
                candidate = f"r{probe}"
            existing_keys.add(candidate)
            r = {**r, "row_key": candidate}
        out.append(build_stakeholder_block(r, security_type, data, knowns))
    return "".join(out)


# ── Stakeholder roster (STAKEHOLDER_LIST_JSON) ──

# Fields the form's autocomplete and the parent skill's Phase 1 local match reuse,
# so the roster is fetched once instead of once per grantee.
_ROSTER_FIELDS = ("email", "id", "kind", "event_relationship")


def build_stakeholder_list(stakeholders: List[Dict[str, Any]]) -> str:
    """A JSON array literal for the form's ``const STAKEHOLDERS = …;`` —
    always valid (``"[]"`` when empty), escaped so a value can't break out of
    the ``<script>`` block.

    Reads ``name`` from either ``name`` or ``full_name`` — the real
    ``cap_table:get:stakeholders`` result uses ``full_name`` exclusively.
    Output key is always normalized to ``name``."""
    rows = []
    for s in stakeholders or []:
        if not isinstance(s, dict):
            continue
        name = s.get("name") or s.get("full_name")
        if not name:
            continue  # nameless records can't be matched or displayed
        row: Dict[str, Any] = {"name": name}
        for f in _ROSTER_FIELDS:
            if s.get(f) is not None:
                row[f] = s[f]
        rows.append(row)
    dumped = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
    # Safe to embed inside a <script> tag (mirrors the standard </ and angle-bracket escapes).
    return (
        dumped.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    )
