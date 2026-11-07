# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
process.py — assemble lpa-audit JSON from the three DWH NDJSON responses.

Reads NDJSON responses from the three DWH queries the skill runs (all
issued with ``format="ndjson"``) and produces the JSON data file
consumed by the artifact-manager template.

Why three queries:
- Query T (LPA rows) — every row in DOCUMENT_AI_RECORD where
  DOCUMENT_TYPE = 'limited_partnership_agreement'. Each LPA extraction
  has ~2–4 rows (fund/GP/LP entities + optional terms event row),
  grouped by EXTRACTION_ID here: one document can hold several extractions
  (a packet split into segments), each its own agreement.
- Query O (operating agreement rows) — the same projection under
  DOCUMENT_TYPE = 'operating_agreement'. An LLC vehicle's governing
  document goes through the LPA extractor and writes the same record types,
  so it is assembled like an LPA. A separate query keeps each response under
  the connector's size cap.
- Query L (side letter rows) — every row where DOCUMENT_TYPE = 'side_letter'.
  Each side letter document has ~3 rows (fund entity, LP entity,
  side letter event with dates/execution status). One document can
  contain multiple side letters (repeating fund/LP/event triples).

Firm scoping happens in SQL, on FIRM_ID alone — both rows files are
already limited to one firm before they reach this script, which does no
tenant filtering of its own.

--firm-fund-names is a *coverage* input, not a scoping one: it is the
full list of fund vehicles the firm manages, and this script matches
the extracted LPA fund names against it to decide which fund each
extraction belongs to. A fund in that list with no matching extraction is
what produces a "missing LPA" row, so the list has to include funds with
no LPA — dropping them makes a gap unreportable rather than clean.

Fund-name matching (fund_key / fund_match / resolve_fund): sibling vehicles
at one firm routinely differ by a single word — "Fund IV, LP" vs "Fund IV
Holdings, LP", "Fund III" vs "Fund III GP, LLC" vs "Fund III-A" vs "Fund III
(Cayman)". So only formatting is normalized (case, punctuation, L.P./LP,
IV/4, one trailing legal form, round labels like "(Series B)"); every other
word is identity. Two names match only when their words line up one-for-one,
allowing typo-level spelling differences. Each extraction resolves to one legal
vehicle (all of Carta's per-round funds for it); a tie between different
vehicles resolves to neither (surfaced as possibleLpaNames for review).

Investor-name matching (norm_name / fuzzy_ratio / best_match) is separate:
it matches side-letter LPs against an LPA's LP roster, where
SequenceMatcher.ratio() >= 0.85 is still the right tool. Both are stdlib-only
(no PyPI at runtime).

Usage:
    uv run process.py \\
        --lpa-rows          "<QUERY_T_PATH>" \\
        --operating-agreement-rows "<QUERY_O_PATH>" \\
        --side-letter-rows  "<QUERY_L_PATH>" \\
        --firm-id           "0021beba-…" \\
        --firm-name         "M13" \\
        --firm-carta-id     12345 \\
        --firm-fund-names-file "<CWD>/m13-funds.json" \\
        --out "<WORKSPACE>/carta-lpa-audit-data.json"

    --firm-fund-names takes the same JSON array inline instead of from a file.

stdlib-only by design — no PyPI fetches at runtime, so it works inside
network-isolated sandboxes (e.g. Cowork).
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# NDJSON parser — same wire shape as spa-audit / co-investors.
# ---------------------------------------------------------------------------

_METADATA_HEADER_PREFIX = "total_rows:"
_NULL_STRS = {"", "null", "NULL", "Null", "—", "-"}


def parse_ndjson(text: str) -> list[dict[str, Any]]:
    """Parse a carta-mcp NDJSON response into a list of row dicts."""
    rows: list[dict[str, Any]] = []
    if not text:
        return rows
    body = text
    stripped = text.lstrip()
    if stripped:
        first_line = stripped.splitlines()[0]
        if first_line.startswith(_METADATA_HEADER_PREFIX) and "\n\n" in text:
            _header, body = text.split("\n\n", 1)
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("(Result truncated"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError as e:
            print(f"WARN: skipping malformed NDJSON line: {e}", file=sys.stderr)
            continue
        if isinstance(obj, dict):
            rows.append(obj)
    return rows


# ---------------------------------------------------------------------------
# Value coercion
# ---------------------------------------------------------------------------

def _to_int(v: Any) -> int | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in _NULL_STRS:
        return None
    try:
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _to_float(v: Any) -> float | None:
    if v is None:
        return None
    s = str(v).strip().replace(",", "")
    if s in _NULL_STRS:
        return None
    try:
        return float(s)
    except (TypeError, ValueError):
        return None


def _to_bool(v: Any) -> bool | None:
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    s = str(v).strip().lower()
    if s in _NULL_STRS:
        return None
    return s in {"true", "1", "yes", "t"}


def _to_str(v: Any) -> str | None:
    """Coerce to a stripped string; None-ish → None."""
    if v is None:
        return None
    s = str(v).strip()
    if s in _NULL_STRS:
        return None
    return s


def _clean_currency(v: Any) -> str | None:
    """Return a bare 3-letter ISO-4217-shaped code, or None.

    Mirrors carta-spa-audit's cleanCurrency (references/artifact.html
    ~line 1260). Rejects anything that isn't exactly 3 alphabetic
    characters. It normalises a RAW_JSON:...:currency_code sibling; the
    free-form `currency` value goes through ``_freeform_currency``.
    """
    s = _to_str(v)
    if s is None:
        return None
    upper = s.upper()
    return upper if len(upper) == 3 and upper.isalpha() else None


def _freeform_currency(v: Any) -> str | None:
    """The free-form RAW_JSON `currency` string when it is itself a bare ISO code ("EUR"), else None.

    The extractor writes prose there too ("United States dollars", "Sterling or £"),
    so only an exact upper-case three-letter value is trusted; nothing is guessed from prose.
    """
    s = _to_str(v)
    return s if s is not None and _clean_currency(s) == s else None


def _load_attrs(row: dict) -> dict:
    """ATTRIBUTES may arrive as a JSON string or a native dict depending on
    the connector serialization. Normalize to dict."""
    attrs = row.get("ATTRIBUTES")
    if attrs is None:
        return {}
    if isinstance(attrs, dict):
        return attrs
    if isinstance(attrs, str):
        try:
            return json.loads(attrs)
        except json.JSONDecodeError:
            return {}
    return {}


def _load_bboxes(row: dict) -> dict:
    """BOUNDING_BOXES may arrive as JSON string or native dict; may be None
    for event rows."""
    bb = row.get("BOUNDING_BOXES")
    if bb is None:
        return {}
    if isinstance(bb, dict):
        return bb
    if isinstance(bb, str):
        try:
            return json.loads(bb)
        except json.JSONDecodeError:
            return {}
    return {}


def _load_raw_json(row: dict) -> dict:
    """RAW_JSON may arrive as a JSON string or a native dict; None pre-cutover
    (documents created before 2026-07-10) and for a small tail after."""
    rj = row.get("RAW_JSON")
    if rj is None:
        return {}
    if isinstance(rj, dict):
        return rj
    if isinstance(rj, str):
        try:
            return json.loads(rj)
        except json.JSONDecodeError:
            return {}
    return {}


def _unwrap(node: Any) -> Any:
    """Unwrap one citation envelope to its scalar value; pass a bare scalar
    through unchanged. A null-valued envelope unwraps to None."""
    if isinstance(node, dict) and "value" in node and "citations" in node:
        return node["value"]
    return node


def _rj_get(raw_json: dict, *path: "str | int") -> Any:
    """Navigate parsed RAW_JSON by nested keys/indices and unwrap a citation
    envelope to its scalar value. Tries the bare path, then the
    `extraction`-prefixed path (see SKILL.md Caveats). Returns None if the
    path is missing or the envelope's own value is a JSON null, rather than
    a stringified envelope.

    long-comment-ok: the extraction-prefix duality is load-bearing and not obvious from the signature
    """
    if not raw_json:
        return None
    roots = [raw_json]
    extraction = raw_json.get("extraction")
    if isinstance(extraction, dict):
        roots.append(extraction)
    for root in roots:
        node: Any = root
        ok = True
        for key in path:
            if isinstance(key, int):
                if isinstance(node, list) and 0 <= key < len(node):
                    node = node[key]
                else:
                    ok = False
                    break
            elif isinstance(node, dict) and key in node:
                node = node[key]
            else:
                ok = False
                break
        if not ok:
            continue
        unwrapped = _unwrap(node)
        if unwrapped is not None:
            return unwrapped
    return None


def _rj_field(raw_json: dict, path: tuple, caster) -> Any:
    """Read one scalar field from RAW_JSON. There is no ATTRIBUTES fallback:
    document-ai builds ATTRIBUTES from the same extraction, so a field RAW_JSON
    leaves null is null there too (see SKILL.md "RAW_JSON as the source")."""
    return caster(_rj_get(raw_json, *path))


def _to_date10(v: Any) -> "str | None":
    """Truncate an ISO date/datetime string to its date-only prefix.
    RAW_JSON dates arrive as full datetimes (`2021-06-21T00:00:00`);
    ATTRIBUTES carries date-only strings (`2021-06-21`) -- normalize both."""
    s = _to_str(v)
    return s[:10] if s else None


def _rj_fee_rate(raw_json: dict) -> "float | None":
    """The investment-period management fee rate, or 0 when the LPA states that no fee is charged."""
    rate = _rj_field(raw_json, ("management_fee", "management_fee_rate_investment_period"), _to_float)
    if rate is None and _rj_field(raw_json, ("management_fee", "pays_management_fee"), _to_bool) is False:
        return 0.0
    return rate


def _rj_member_names(raw_json: dict, *path: str) -> "str | None":
    """Join a RAW_JSON member array's names into one string."""
    members = _rj_get(raw_json, *path)
    if not isinstance(members, list):
        return None
    names = []
    for m in members:
        if not isinstance(m, dict):
            continue
        name = _unwrap(m.get("name"))
        if name:
            names.append(str(name))
    return ", ".join(names) if names else None


def _rj_carry_tier_rates(raw_json: dict) -> "list[float] | None":
    """The GP shares of the waterfall's split tiers, distinct and in document order.

    None unless there are two or more: a single share is a flat carry, which the
    carry rate already states."""
    tiers = _rj_get(raw_json, "carried_interest", "waterfall_tiers")
    rates: list[float] = []
    for tier in tiers if isinstance(tiers, list) else []:
        if not isinstance(tier, dict) or _to_str(_unwrap(tier.get("kind"))) != "split":
            continue
        rate = _to_float(_unwrap(tier.get("percentage_to_gp")))
        if rate is not None and rate not in rates:
            rates.append(rate)
    return rates if len(rates) > 1 else None


def _rj_has_preferred_return_tier(raw_json: dict) -> bool:
    """True when a waterfall tier is a preferred return.

    Without one or a stated preferred rate, a multiple on a tiered-carry ladder ("20% until the LPs receive 3x,
    then 25%") is where the carry steps up, not a hurdle."""
    tiers = _rj_get(raw_json, "carried_interest", "waterfall_tiers")
    return any(
        isinstance(tier, dict) and _to_str(_unwrap(tier.get("kind"))) == "preferred_return"
        for tier in (tiers if isinstance(tiers, list) else [])
    )


def _load_provisions(value: Any) -> list[dict]:
    """Parse a side letter's economic_provisions field.

    Shape from the pipeline is an ARRAY of provision objects like
    ``[{"provision_type": "REDUCED_CARRIED_INTEREST", "rate_paid": "15%"}]``.
    Snowflake VARIANT arrives here as either a native list, a JSON-encoded
    string, or None. Coverage is currently ~12% (66/541 side letters as of
    2026-07-16) and only ``REDUCED_CARRIED_INTEREST`` has been observed as a
    provision_type value, but the pipeline surface may expand — we preserve
    unknown provision_type / extra keys verbatim so the template can render
    them without a code change.
    """
    if value is None:
        return []
    if isinstance(value, str):
        s = value.strip()
        if not s or s in _NULL_STRS:
            return []
        try:
            value = json.loads(s)
        except json.JSONDecodeError:
            return []
    if isinstance(value, list):
        return [p for p in value if isinstance(p, dict)]
    return []


# ---------------------------------------------------------------------------
# Fuzzy name matching (stdlib)
# ---------------------------------------------------------------------------

_ENTITY_SUFFIX_RE = re.compile(
    r",?\s*(INC|LLC|LTD|LIMITED|CORP|CORPORATION|L\.?P\.?|PBC|CO\.?|HOLDINGS|TECHNOLOGIES|TECHNOLOGY|COMPANY|PARTNERS|PARTNERSHIP|GP)\.?\s*$",
    re.IGNORECASE,
)
_PARENTHETICAL_RE = re.compile(r"\s*\([^)]*\).*$")
_PUNCT_RE = re.compile(r"[,.]")
_GP_ENTITY_RE = re.compile(
    r"\b(GP|Management)\b(?:[\s-]*(?:[IVX]+|\d+))?\s*,?\s*(LLC|LTD|LLP|CORP|CORPORATION|INC\.?|CO\.?)\s*$",
    re.IGNORECASE,
)


def norm_name(name: str | None) -> str:
    """Normalize a fund/GP name for fuzzy matching.

    Strips parentheticals, common entity suffixes (L.P., LLC, Corp, etc.),
    and punctuation, then uppercases. Mirrors the SQL-side normalization
    used in spa-audit's fuzzy match, but pure Python since we're joining
    against a list that came from MCP (fa__list__entities), not from a
    DWH-side join.
    """
    if not name:
        return ""
    s = name.strip()
    s = _PARENTHETICAL_RE.sub("", s)
    prev = None
    while prev != s:  # strip multiple stacked suffixes ("… GP, LLC")
        prev = s
        s = _ENTITY_SUFFIX_RE.sub("", s).strip()
    s = _PUNCT_RE.sub("", s)
    return s.upper().strip()


# Series token extraction — critical for disambiguating "Fund II" vs "Fund III".
# Fuzzy ratio alone treats those two names as a ~0.94 match (they share "Fund" +
# most of the name); without series matching, sibling funds collide.
_ROMAN = "M{0,4}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{1,3})"
_SERIES_RE = re.compile(rf"\b((?:{_ROMAN})|\d+)\b", re.IGNORECASE)

_ROMAN_TO_INT = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5,
    "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10,
    "XI": 11, "XII": 12,
}


def _series_num(name: str) -> int | None:
    """Return the last series-number token in ``name`` as an int (Roman or digit),
    or None if none present. Used to disambiguate Fund II vs Fund III.

    Looks at the ORIGINAL name (not the norm form) so we don't confuse
    entity-suffix "V" (rare — some vehicles) with a truly-absent series.
    """
    if not name:
        return None
    matches = _SERIES_RE.findall(name.upper())
    if not matches:
        return None
    # The regex has groups from the Roman alternation; the full match is
    # the outer capture. Pull raw tokens with finditer instead.
    tokens = [m.group(1).upper() for m in _SERIES_RE.finditer(name.upper())]
    if not tokens:
        return None
    last = tokens[-1]
    if last.isdigit():
        return int(last)
    return _ROMAN_TO_INT.get(last)


def _same_series(a: str, b: str) -> bool:
    """True if both names have the same series number, or neither has one."""
    sa, sb = _series_num(a), _series_num(b)
    return sa == sb  # both None → True; one None + one int → False


def fuzzy_ratio(a: str, b: str) -> float:
    """difflib.SequenceMatcher.ratio() on normalized names — 0.0 to 1.0.

    Returns 0.0 if the series numbers disagree (e.g. Fund II vs Fund III) —
    those are distinct vehicles even when the strings are 94% similar.
    """
    if not a or not b:
        return 0.0
    if not _same_series(a, b):
        return 0.0
    return SequenceMatcher(None, norm_name(a), norm_name(b)).ratio()


def _is_gp_entity(name: str | None) -> bool:
    """True if name looks like a GP management entity rather than a fund vehicle."""
    if not name:
        return False
    return bool(_GP_ENTITY_RE.search(name.strip()))


def _date_within_window(a: str | None, b: str | None, days: int = 7) -> bool:
    """True if ISO date strings a and b are within `days` calendar days of each other."""
    if not a or not b:
        return False
    try:
        da = datetime.strptime(a[:10], "%Y-%m-%d")
        db = datetime.strptime(b[:10], "%Y-%m-%d")
        return abs((da - db).days) <= days
    except (ValueError, TypeError):
        return False


def best_match(target: str, candidates: list[str], threshold: float = 0.85) -> str | None:
    """Return the best-matching candidate (or None if all below threshold)."""
    if not target or not candidates:
        return None
    best = max(candidates, key=lambda c: fuzzy_ratio(target, c))
    return best if fuzzy_ratio(target, best) >= threshold else None


# ---------------------------------------------------------------------------
# Fund-name identity matching (stdlib)
# ---------------------------------------------------------------------------
# norm_name strips HOLDINGS / GP / parentheticals, so "Fund IV" and "Fund IV
# Holdings" collide at 1.0. fund_key keeps every word but one trailing legal form.

# Longest first, so "LIMITED PARTNERSHIP" wins over "LIMITED".
_LEGAL_FORMS: list[tuple[tuple[str, ...], str]] = [
    (("LIMITED", "LIABILITY", "COMPANY"), "LLC"),
    (("LIMITED", "PARTNERSHIP"), "LP"),
    (("L", "L", "C"), "LLC"),
    (("L", "P"), "LP"),
    (("LLLP",), "LP"),
    (("LP",), "LP"),
    (("LLC",), "LLC"),
    (("LLP",), "LLP"),
    (("LTD",), "LTD"),
    (("LIMITED",), "LTD"),
    (("INC",), "INC"),
    (("CORP",), "CORP"),
    (("CORPORATION",), "CORP"),
    (("PBC",), "PBC"),
    (("PLC",), "PLC"),
    (("SCSP",), "SCSP"),
    (("SCS",), "SCS"),
    (("SARL",), "SARL"),
]
# Words that carry no identity within one firm's fund list ("Acme Fund II" and
# "Acme II" are the same vehicle).
_FUND_FILLER = frozenset({"THE", "AND", "FUND"})
_ROMAN_NUMERALS = {
    "I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8,
    "IX": 9, "X": 10, "XI": 11, "XII": 12, "XIII": 13, "XIV": 14, "XV": 15,
    "XVI": 16, "XVII": 17, "XVIII": 18, "XIX": 19, "XX": 20,
}
# Parentheticals that describe the entity ("(a Delaware limited partnership)") are
# dropped; any other ("(Cayman)", "(AIV)") is part of the name.
_BOILERPLATE_PAREN_RE = re.compile(
    r"[\"“”]|^\s*(A|AN|THE)\s|LIMITED PARTNERSHIP|LIMITED LIABILITY|COMPANY|CORPORATION"
    r"|FORMERLY|PREVIOUSLY|F/K/A|\bFKA\b|HEREINAFTER|REFERRED",
    re.IGNORECASE,
)
# Carta labels one legal vehicle's rounds as separate funds ("…, L.P. (Series B)",
# "(Common Secondary)"). Those parentheticals name a security, not the entity.
_SECURITY_LABEL_PAREN_RE = re.compile(
    r"\b(SERIES|CLASS|COMMON|PREFERRED|STOCK|SECONDARY|SAFE|CONVERTIBLE|NOTES?|WARRANTS?|SEED|TRANCHE|BRIDGE|EXT"
    r"|JAN(UARY)?|FEB(RUARY)?|MAR(CH)?|APR(IL)?|MAY|JUNE?|JULY?|AUG(UST)?|SEPT?(EMBER)?|OCT(OBER)?|NOV(EMBER)?|DEC(EMBER)?)\b",
    re.IGNORECASE,
)
# A series LLC's series follow its last spaced dash ("Acme Owl, LLC - Series I", "Acme Series
# LLC – Widgets Series"). Like "(Series B)", the series is not the entity.
_SERIES_SUFFIX_RE = re.compile(
    r"\s[-–—]\s(?:(?!\s[-–—]\s).)*\b(SERIES|CLASS)\b(?:(?!\s[-–—]\s).)*$", re.IGNORECASE
)
# The word Carta's fund names use to split one series into classes ("… Series- Class A").
_CLASS_WORD = "CLASS"
# A series named within its LLC ("Harbor Series (the “Series”) of Acme Series LLC", "Kraken I, a
# Series of Acme LLC") is the series Carta writes "Acme Series LLC - Harbor Series".
_SERIES_OF_PARENT_RE = re.compile(
    r"^(?P<series>.+?)\s*(?:\([^)]*\))?\s*,?\s+(?P<a_series>an?\s+series\s+)?of\s+"
    r"(?P<parent>.+?\b(?:LLC|L\.L\.C\.?|LP|L\.P\.?))\s*$",
    re.IGNORECASE,
)
_SERIES_WORD = "SERIES"
_SERIES_WORD_RE = re.compile(rf"\b{_SERIES_WORD}\b", re.IGNORECASE)
# A series label after the series word: a numeral, roman numeral, letter or letter-digit code.
_SERIES_LABEL_RE = re.compile(r"\d+\w*|[IVXLCDM]+|[A-Z]\d*")
# Words before the series word that quantify or describe series in general ("each series",
# "Delaware series limited liability company", which loses its legal form before this test).
_SERIES_GENERIC_WORDS = frozenset({
    "EACH", "ALL", "ANY", "EVERY", "MULTIPLE", "SEPARATE", "VARIOUS", "MORE", "SUCH", "ONE",
    "NEW", "ADDITIONAL", "OTHER", "FUTURE", "DELAWARE", "DISTINCT",
})
# Words that make text before the series word a sentence, not a name ("may issue series",
# "interests in series"). "OF" is not one: "Class of 2024 Series" is a name. "A" is a class
# letter, not an article, right after a _CLASS_LABEL_WORDS word ("Class A Series").
_SERIES_SENTENCE_WORDS = frozenset({"A", "AN", "IN", "MAY", "BE", "ISSUE", "ISSUED", "ESTABLISH", "ESTABLISHED"})
_CLASS_LABEL_WORDS = frozenset({_CLASS_WORD, "TRANCHE"})
# Statutory kinds of series: they describe series in general ("each protected series"), not one.
_SERIES_KIND_WORDS = frozenset({"PROTECTED", "REGISTERED"})
_PAREN_GROUP_RE = re.compile(r"\(([^)]*)\)")
_UNCLOSED_PAREN_RE = re.compile(r"\(.*$")
_DROP_CHARS_RE = re.compile(r"[.'’]")
_NON_ALNUM_RE = re.compile(r"[^A-Z0-9]+")

# Match tiers, strongest first.
FUND_MATCH_EXACT = 3        # same words, same (or unstated) legal form
FUND_MATCH_FORM_DIFFERS = 2  # same words, different legal form (LP vs LLC)
FUND_MATCH_CLOSE = 1         # words line up, with typo-level spelling differences


def _fund_tokens(text: str) -> list[str]:
    s = text.upper().replace("&", " AND ")
    s = _DROP_CHARS_RE.sub("", s)
    return _NON_ALNUM_RE.sub(" ", s).split()


def _main_name(name: str) -> str:
    """A name with its parentheticals (closed or trailing-unclosed) blanked out."""
    return _UNCLOSED_PAREN_RE.sub(" ", _PAREN_GROUP_RE.sub(" ", name))


def _is_series_designation(tokens: list[str]) -> bool:
    """Whether words end as a series is named: the last series word, followed only by labels
    ("Harbor Series", "Series I", "Series A-1", "Series 2021-A-1"). "Acme Series A Fund"
    names a fund, not a series: FUND is no label."""
    if _SERIES_WORD not in tokens:
        return False
    last = len(tokens) - 1 - tokens[::-1].index(_SERIES_WORD)
    return all(_SERIES_LABEL_RE.fullmatch(t) for t in tokens[last + 1:])


def _series_of_parent(name: str) -> str:
    """A series named within its LLC, rewritten the way Carta names it: "‹LLC› - ‹series›".

    Any other name comes back unchanged. The text before "of" must end as a series
    designation, the last series word followed only by labels ("Series A-1"; see
    _is_series_designation), or the name must say ", a Series of", so
    "Acme Series A Fund of Funds, LP" and "Bank of America Fund LLC" stay as they are.
    """
    m = _SERIES_OF_PARENT_RE.match(name)
    if not m:
        return name
    # One spaced dash may stand between the LLC and the series, so none stays inside it.
    series = re.sub(r"\s+[-–—]\s+", " ", m.group("series")).strip(" ,-–—")
    if not _is_series_designation(_fund_tokens(series)):
        if not m.group("a_series"):
            return name
        series += " Series"
    return f"{m.group('parent')} - {series}"


def fund_key(name: str | None) -> tuple[tuple[str, ...], str | None]:
    """Reduce a fund name to (identity words, legal form).

    "Acme Capital Fund IV Holdings, L.P." -> (("ACME", "CAPITAL", "4", "HOLDINGS"),
    "LP"). Roman numerals become digits so "Fund IV" == "Fund 4".
    """
    if not name:
        return (), None
    name = _series_of_parent(name)
    kept_parens = [
        m.group(1) for m in _PAREN_GROUP_RE.finditer(name)
        if not _BOILERPLATE_PAREN_RE.search(m.group(1)) and not _SECURITY_LABEL_PAREN_RE.search(m.group(1))
    ]
    main = _SERIES_SUFFIX_RE.sub("", _main_name(name))
    tokens = _fund_tokens(main)
    form: str | None = None
    for seq, canon in _LEGAL_FORMS:
        if len(tokens) > len(seq) and tuple(tokens[-len(seq):]) == seq:
            tokens = tokens[:-len(seq)]
            form = canon
            break
    for paren in kept_parens:
        tokens.extend(_fund_tokens(paren))
    out: list[str] = []
    for tok in tokens:
        if tok in _FUND_FILLER:
            continue
        if tok in _ROMAN_NUMERALS:
            tok = str(_ROMAN_NUMERALS[tok])
        elif tok.isdigit():
            tok = str(int(tok))
        out.append(tok)
    return tuple(out), form


def _fund_tokens_close(x: str, y: str) -> bool:
    """Same word allowing a typo or plural. Numbers and short words must be exact."""
    if x == y:
        return True
    if x.isdigit() or y.isdigit() or len(x) < 4 or len(y) < 4:
        return False
    return SequenceMatcher(None, x, y).ratio() >= 0.8


def _fund_words_align(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    return (
        all(any(_fund_tokens_close(x, y) for y in b) for x in a)
        and all(any(_fund_tokens_close(y, x) for x in a) for y in b)
    )


def fund_match(a: str | None, b: str | None) -> tuple[int, float] | None:
    """(tier, similarity) if a and b name the same fund vehicle, else None.

    A word present on one side with no counterpart on the other — HOLDINGS, GP,
    PARALLEL, CAYMAN, a series letter — is a different vehicle, however similar
    the rest of the string is.
    """
    ta, fa = fund_key(a)
    tb, fb = fund_key(b)
    if not ta or not tb:
        return None
    ja, jb = "".join(ta), "".join(tb)
    ratio = SequenceMatcher(None, ja, jb).ratio()
    if ja == jb:
        if fa is None or fb is None or fa == fb:
            return FUND_MATCH_EXACT, ratio
        return FUND_MATCH_FORM_DIFFERS, ratio
    if _fund_words_align(ta, tb):
        return FUND_MATCH_CLOSE, ratio
    return None


def _same_vehicle(names: list[str]) -> bool:
    """True if every name has the same identity words and no two state different legal forms."""
    keys = [fund_key(n) for n in names]
    forms = {form for _, form in keys if form is not None}
    return len({tokens for tokens, _ in keys}) == 1 and len(forms) <= 1


def resolve_fund(name: str | None, firm_fund_names: list[str]) -> tuple[list[str], int | None, list[str]]:
    """Pick the firm fund(s) an extracted name belongs to.

    Returns (funds, tier, tied). A clear winner beats the runner-up on tier, or on
    similarity by >= 0.05. Candidates that tie but name one legal vehicle (Carta
    rounds of one SPV) all win. Any other tie attributes nothing; `tied` lists the
    candidates, because a visible "needs review" beats a confident wrong fund. A name no
    fund matches resolves to the one fund whose name is it with one run of words written
    as initials, either way round ("FP Global I SPV" and "Future Positive Global I SPV").
    """
    scored: list[tuple[tuple[int, float], str]] = []
    for fund in firm_fund_names:
        m = fund_match(name, fund)
        if m is not None:
            scored.append((m, fund))
    if not scored:
        named = _bare_series(name, firm_fund_names) or _named_by_initials(name, firm_fund_names)
        return (named, FUND_MATCH_CLOSE, []) if named else ([], None, [])
    scored.sort(key=lambda s: s[0], reverse=True)  # stable: firm-list order breaks exact ties
    (top_tier, top_ratio), _ = scored[0]
    top = [f for (t, r), f in scored if t == top_tier and top_ratio - r < 0.05]
    if len(top) == 1 or _same_vehicle(top):
        return top, top_tier, []
    return [], None, top


def _bare_series(name: str | None, firm_fund_names: list[str]) -> list[str]:
    """The firm's series a name gives without its LLC ("Harbor Continuation Series" for "Acme
    Series LLC - Harbor Continuation Series"), or that series' classes. Empty unless the name
    says it is a series, carries a word beyond the series word and its label, and exactly one
    LLC at the firm has a series by that name."""
    if not name or not _SERIES_WORD_RE.search(name):
        return []
    tokens = _fund_tokens(_main_name(name))
    # "Series I" alone says which series of some LLC, not which LLC: it needs a name of its own.
    if all(t == _SERIES_WORD or _SERIES_LABEL_RE.fullmatch(t) for t in tokens):
        return []
    key = "".join(tokens)
    named = [f for f in firm_fund_names if _dash_series(f) == key]
    return named if named and _same_vehicle(named) else []


def series_tokens(name: str | None) -> list[str]:
    """A fund name's identity words with its series or class label kept.

    fund_key drops "(Series: Octane C)" and " - Series I" so every series of an
    LLC resolves together. A series agreement or side letter is then narrowed to
    its series with this key: legal forms, filler words and spacing are ignored,
    the label is not.
    """
    if not name:
        return []
    name = _series_of_parent(name)
    kept = _PAREN_GROUP_RE.sub(lambda m: " " if _BOILERPLATE_PAREN_RE.search(m.group(1)) else f" {m.group(1)} ", name)
    tokens = _fund_tokens(kept)
    for seq, _ in _LEGAL_FORMS:
        n = len(seq)
        i = 0
        while i + n <= len(tokens):
            if tuple(tokens[i:i + n]) == seq:
                del tokens[i:i + n]
            else:
                i += 1
    out = []
    for tok in tokens:
        if tok in _FUND_FILLER:
            continue
        out.append(str(_ROMAN_NUMERALS[tok]) if tok in _ROMAN_NUMERALS else str(int(tok)) if tok.isdigit() else tok)
    return out


def series_key(name: str | None) -> str:
    """series_tokens as one string, for comparing two names whole."""
    return "".join(series_tokens(name))


def _starts_with_words(tokens: list[str], prefix: list[str]) -> bool:
    """prefix is a leading run of whole words of tokens: whether a master_series already
    starts with its LLC's name ("Acme LLC Series 1"), or needs the name joined to it."""
    return bool(prefix) and tokens[:len(prefix)] == prefix


def _series_named(targets: list[str], name: str) -> list[str]:
    """The series among targets that name points to: the one it names, or that series'
    classes when Carta splits it ("… Series A1- Class B"). Empty when name points only to
    the parent LLC, or to a series Carta doesn't list ("Series A" is not "Series A-1")."""
    key = series_key(name)
    named = [t for t in targets if series_key(t) == key]
    if not named and key != "".join(fund_key(name)[0]):
        named = [t for t in targets if series_key(t).startswith(key + _CLASS_WORD)]
    return named


def _agreement_series_name(lpa: dict) -> "str | None":
    """The series an agreement states it governs, joined to its LLC's name.

    The extractor's master_series holds a series name ("Kraken Series"), the parent's
    name, or a sentence about issuing series; only a series name points anywhere.
    """
    parent, series = lpa["fund"]["name"], lpa["fund"].get("masterSeries")
    if not parent or not series:
        return None
    return series if _starts_with_words(series_tokens(series), series_tokens(parent)) else f"{parent} - {series}"


def _states_series(lpa: dict) -> bool:
    """Whether the agreement's master_series, less the LLC's name, designates a series.

    A designation is the series word followed by a label ("Series I", "Series A-1",
    "Series 2021-A-1"), or the series word ending a name ("Kraken Series", "Class of 2024
    Series", "Class A Series"; only "of ..." may follow it). Text before the series word,
    less any trailing _SERIES_KIND_WORDS, is a name only if it holds none of
    _SERIES_SENTENCE_WORDS (bar a class letter) and does not end in one of
    _SERIES_GENERIC_WORDS. The parent's name, a bare "Series", "Each Series" and a sentence about series ("a Delaware
    series limited liability company", "may issue series of interests") designate none. A value naming two or more
    series ("Series I Units; Series II Units") is no one series' schedule, so it designates none either. A
    designation followed by "of" and then a series word that is itself a designation by this same test ("Class A
    Series of Kraken Series") is part of that later series, not a second one; a later series word that designates
    nothing ("Kraken Series of Units of each Series") leaves the first designation standing.
    """
    parent, series = lpa["fund"]["name"], lpa["fund"].get("masterSeries")
    tokens, parent_tokens = series_tokens(series), series_tokens(parent)
    if _starts_with_words(tokens, parent_tokens):
        tokens = tokens[len(parent_tokens):]
    designated: set[str] = set()
    for i, token in enumerate(tokens):
        if token != _SERIES_WORD or (designation := _designation(tokens, i)) is None:
            continue
        label = tokens[i + 1] if i + 1 < len(tokens) else ""
        rest = tokens[i + 2:] if _SERIES_LABEL_RE.fullmatch(label) else tokens[i + 1:]
        if rest[:1] == ["OF"] and any(
            tokens[k] == _SERIES_WORD and _designation(tokens, k) is not None for k in range(i + 1, len(tokens))
        ):
            continue
        designated.add(designation)
    return len(designated) == 1


def _designation(tokens: list[str], i: int) -> "str | None":
    """The series the series word at tokens[i] designates (its label, or the name before it), or None."""
    label = tokens[i + 1] if i + 1 < len(tokens) else ""
    if _SERIES_LABEL_RE.fullmatch(label):
        return label
    head, tail = tokens[:i], tokens[i + 1:]
    while head and head[-1] in _SERIES_KIND_WORDS:
        head.pop()
    ends_name = not tail or tail[0] == "OF"
    sentence = any(
        w in _SERIES_SENTENCE_WORDS and not (w == "A" and j and head[j - 1] in _CLASS_LABEL_WORDS)
        for j, w in enumerate(head)
    )
    if ends_name and head and head[-1] not in _SERIES_GENERIC_WORDS and not sentence:
        return " ".join(head)
    return None


def _dash_series(name: str) -> str | None:
    """The series a name's final spaced-dash segment labels ("SERIES2"), or None.

    A class label after a series name is dropped, so every class Carta splits one series
    into is that series. A segment that starts with the class word ("- Class B", "- Class
    of 2024 Series") keeps its whole label.
    """
    m = _SERIES_SUFFIX_RE.search(_main_name(_series_of_parent(name)))
    if not m:
        return None
    tokens = _fund_tokens(m.group(0))
    cls = tokens.index(_CLASS_WORD) if _CLASS_WORD in tokens else 0
    return "".join(tokens[:cls] if cls else tokens)


def _agreement_series(targets: list[str], lpa: dict) -> list[str]:
    """The targets an agreement names as its series: by its own name, or failing that by
    the series it states it governs (master_series)."""
    named = _series_named(targets, lpa["fund"]["name"])
    if not named and (series_name := _agreement_series_name(lpa)):
        named = _series_named(targets, series_name)
    return named


def _distinct_series(targets: list[str]) -> bool:
    """Whether targets are distinct dash-labelled series of one LLC."""
    return len({_dash_series(t) for t in targets}) >= 2


def _series_for_agreement(targets: list[str], lpa: dict) -> list[str]:
    """The series of one LLC an agreement's terms belong to.

    Each series' terms sit in its own schedule, so an agreement goes to the series it
    names, and nowhere if it names only the parent LLC. Targets that are not distinct
    dash-labelled series ("(Series B)" rounds of one SPV) all keep it.
    """
    if not _distinct_series(targets):
        return targets
    return _agreement_series(targets, lpa)


def _is_parent_agreement(targets: list[str], lpa: dict) -> bool:
    """Whether an agreement is the parent LLC's own, so it governs series with none of their own.

    Targets are distinct dash-labelled series and the agreement reaches none of them and
    designates none in its name or master_series. A schedule that states a series, listed
    or not, is that series' and says nothing about its siblings.
    """
    if not _distinct_series(targets) or _dash_series(lpa["fund"]["name"]) is not None:
        return False
    return not _agreement_series(targets, lpa) and not _states_series(lpa)


def _narrow_to_named_series(targets: list[str], letter_name: str, attributed: dict) -> list[str]:
    """The series of one LLC a side letter belongs to.

    A letter naming one series goes to it alone; one naming a series Carta splits
    into classes goes to those classes. One naming only the parent LLC, or a series
    Carta doesn't list, stays on every series. A letter left on several is marked
    sharedAcrossSeries so the totals count it once.
    """
    named = _series_named(targets, letter_name)
    if len(named) == 1:
        return named
    attributed["sharedAcrossSeries"] = True
    return named or targets

# Carry above this percentage is not a fund's carry.
FUND_CARRY_MAX_PCT = 50

# Ranges outside which an extracted term is more likely a misread than a real
# term: a GP agreement's profit split read as carry, a hurdle multiple read as a
# percentage. Flagged for the reader to check against the LPA, never hidden: an
# unusual term can be real. (field, out of range?, reason)
TERM_CHECKS = (
    ("mgmtFeeRateInvestmentPeriod", lambda v, t: v > 5, "above 5%"),
    ("mgmtFeeRatePostInvestment", lambda v, t: v > 5, "above 5%"),
    ("mgmtFeeRatePostInvestment",
     lambda v, t: t.get("mgmtFeeRateInvestmentPeriod") is not None and v > t["mgmtFeeRateInvestmentPeriod"],
     "higher than the fee during the investment period"),
    ("carriedInterestRate", lambda v, t: v > FUND_CARRY_MAX_PCT, f"above {FUND_CARRY_MAX_PCT}%"),
    ("preferredReturnRate", lambda v, t: v > 30, "above 30%, may be a multiple"),
    ("fundTermYears", lambda v, t: v < 1 or v > 30, "outside 1 to 30 years"),
    ("investmentPeriodYears",
     lambda v, t: t.get("fundTermYears") is not None and v > t["fundTermYears"],
     "longer than the fund term"),
    ("capitalCallNoticeDays", lambda v, t: v < 3 or v > 90, "outside 3 to 90 days"),
)


def term_flags(terms: dict) -> list[dict]:
    """The extracted terms worth checking against the LPA, each with its reason."""
    return [
        {"field": field, "reason": reason}
        for field, out_of_range, reason in TERM_CHECKS
        if terms.get(field) is not None and out_of_range(terms[field], terms)
    ]


# ---------------------------------------------------------------------------
# LPA extraction assembly
# ---------------------------------------------------------------------------

LPA_DOCUMENT_TYPE = "limited_partnership_agreement"
OPERATING_AGREEMENT_DOCUMENT_TYPE = "operating_agreement"
# An LLC fund's operating agreement states real carry, so it is kept. Above
# FUND_CARRY_MAX_PCT the figure is a member profit split (a holdings LLC paying 100%
# to its manager), not fund carry, so these terms are withheld.
OPERATING_AGREEMENT_WITHHELD_TERMS = (
    "carriedInterestRate", "carryTierRates", "preferredReturnRate", "preferredReturnMultiple", "waterfallStructure",
)

# The terms the fund table shows. An agreement is "Full data" only when it states one of
# them, and the one stating the most of them is the fund's agreement: a fee basis or a
# waterfall type alone leaves every column blank. Kept in step with HEADLINE_TERMS in artifact.html.
HEADLINE_TERMS = (
    "mgmtFeeRateInvestmentPeriod", "carriedInterestRate", "preferredReturnRate",
    "preferredReturnMultiple", "fundTermYears", "investmentPeriodYears",
)

SHORT_TEXT_LIMIT = 60


def _shorten(text: "str | None", limit: int = SHORT_TEXT_LIMIT) -> "str | None":
    """Cut long verbatim text to ``limit`` characters at a word boundary, ending in an ellipsis."""
    if text is None or len(text) <= limit:
        return text
    return text[:limit].rsplit(" ", 1)[0].rstrip(",;:. ") + "…"


def build_lpas(lpa_rows: list[dict], document_type: str = LPA_DOCUMENT_TYPE) -> dict[str, dict]:
    """Group LPA rows by EXTRACTION_ID into structured dicts, keyed by extraction id.

    One document can hold several extractions (a packet split into segments,
    e.g. two LPAs in one file), so two agreements from one document stay
    separate and share a ``documentId``.

    ``document_type`` is the DOCUMENT_TYPE the rows were queried under: an
    operating agreement runs the same extractor and writes the same record
    types as an LPA, so both go through here.

    Each returned dict has:
      - documentId: the source document, for links
      - extractionId
      - documentType
      - fund:  {name, state_of_formation, lpa_date, ...}
      - generalPartner: {name, entity_type, state_of_formation, ...}
      - limitedPartners: [{name, entity_type, commitment_amount, address,
        currencyCode}, ...]
      - currencyCode: ISO code (e.g. "EUR") from RAW_JSON, or None. The
        currency_code siblings win; else the free-form `currency` value when it
        is exactly an ISO code. None means the currency is unknown, never USD.
      - notFundLpa: True for an operating agreement whose stated carry is above
        FUND_CARRY_MAX_PCT, read as a member profit split rather than fund carry;
        its carry, tiers, hurdle and waterfall are then withheld. False otherwise,
        including for an operating agreement with ordinary carry.
      - terms: {carried_interest_rate, preferred_return_rate, ...}
      - termsExtracted: bool  (False if no limited_partnership event row, or one
        whose every term is empty: the model found the section but stated nothing)
      - boundingBoxes: dotted-path → {page, top, bottom, left, right}
      - createdAt: earliest CREATED_AT across the extraction
    """
    grouped: dict[str, list[dict]] = {}
    for row in lpa_rows:
        eid = row.get("EXTRACTION_ID")
        if not eid:
            continue
        grouped.setdefault(eid, []).append(row)

    out: dict[str, dict] = {}
    for eid, rows in grouped.items():
        lp_record_indexes: list[int] = []
        bboxes: dict[str, dict] = {}
        created_ats: list[str] = []
        terms_extracted = False
        currency_codes: list[str] = []
        raw_json: dict = {}

        for row in rows:
            record_type = (row.get("RECORD_TYPE") or "").lower()
            kind = (row.get("KIND") or "").lower()
            row_bboxes = _load_bboxes(row)
            if row_bboxes:
                bboxes.update(row_bboxes)
            ca = row.get("CREATED_AT")
            if ca:
                created_ats.append(str(ca))
            ccy = _clean_currency(row.get("DOCUMENT_CURRENCY_CODE"))
            if ccy:
                currency_codes.append(ccy)
            if not raw_json:
                raw_json = _load_raw_json(row)

            if kind == "entity" and record_type == "limited_partner":
                lp_record_indexes.append(_to_int(row.get("RECORD_INDEX")) or 0)
            elif kind == "event" and record_type == "limited_partnership":
                terms_extracted = True

        # LP rows are written in parties.limited_partners[] order, so the Nth
        # row by RECORD_INDEX is the Nth array entry (validated: counts always
        # match). Joining by name instead would miss every unnamed LP.
        rj_lps = _rj_get(raw_json, "parties", "limited_partners")
        if not isinstance(rj_lps, list):
            rj_lps = []

        # The per-field currency_code siblings are rare; most LPAs carry only the free-form value.
        currency_code = currency_codes[0] if currency_codes else _freeform_currency(_rj_get(raw_json, "currency"))
        lps: list[dict] = []
        for lp_pos in range(len(lp_record_indexes)):
            rj_lp = rj_lps[lp_pos] if lp_pos < len(rj_lps) and isinstance(rj_lps[lp_pos], dict) else {}
            lps.append({
                "name": _to_str(_unwrap(rj_lp.get("name"))),
                "entityType": _to_str(_unwrap(rj_lp.get("entity_type"))),
                "commitmentAmount": _to_float(_unwrap(rj_lp.get("commitment_amount"))),
                "percentageInterest": _to_float(_unwrap(rj_lp.get("percentage_interest"))),
                "address": _to_str(_unwrap(rj_lp.get("address"))),
                # A fund's roster can span several documents, so each LP keeps
                # the currency of the extraction its amount came from.
                "currencyCode": currency_code,
            })

        fee_basis = _rj_field(raw_json, ("management_fee", "management_fee_basis_investment_period"), _to_str)
        terms = {
            "carriedInterestRate": _rj_field(raw_json, ("carried_interest", "carried_interest_rate"), _to_float),
            "carryTierRates": _rj_carry_tier_rates(raw_json),
            "preferredReturnRate": _rj_field(raw_json, ("carried_interest", "preferred_return_rate"), _to_float),
            # A hurdle stated as a multiple of capital (1.6 for 1.6x), beside or instead of a rate.
            "preferredReturnMultiple": _rj_field(raw_json, ("carried_interest", "preferred_return_multiple"), _to_float),
            "waterfallStructure": _rj_field(raw_json, ("carried_interest", "distribution_waterfall_type"), _to_str),
            "mgmtFeeRateInvestmentPeriod": _rj_fee_rate(raw_json),
            "mgmtFeeRatePostInvestment": _rj_field(raw_json, ("management_fee", "management_fee_rate_post_investment"), _to_float),
            "mgmtFeeBasisInvestmentPeriod": fee_basis,
            "mgmtFeeBasisShort": _shorten(fee_basis),
            "fundTermYears": _rj_field(raw_json, ("fund_terms", "fund_term_years"), _to_float),
            "investmentPeriodYears": _rj_field(raw_json, ("fund_terms", "investment_period_years"), _to_float),
            "capitalCallNoticeDays": _rj_field(raw_json, ("capital_provisions", "capital_call_notice_days"), _to_int),
            "initialClosingDate": _rj_field(raw_json, ("fund_terms", "initial_closing_date"), _to_date10),
        } if terms_extracted else {}
        if (
            terms.get("preferredReturnMultiple") is not None
            and terms.get("preferredReturnRate") is None
            and terms.get("carryTierRates")
            and not _rj_has_preferred_return_tier(raw_json)
        ):
            terms["preferredReturnMultiple"] = None
        # An event row with every term empty states nothing, so it is no more "Full data" than none.
        terms_extracted = terms_extracted and any(v not in (None, "", []) for v in terms.values())
        # Counted before a withheld profit split is cleared: the agreement did state it.
        headline_term_count = sum(terms.get(field) is not None for field in HEADLINE_TERMS) if terms_extracted else 0
        carry = terms.get("carriedInterestRate")
        not_fund_lpa = (
            document_type == OPERATING_AGREEMENT_DOCUMENT_TYPE and carry is not None and carry > FUND_CARRY_MAX_PCT
        )
        if not_fund_lpa:
            for field in OPERATING_AGREEMENT_WITHHELD_TERMS:
                terms[field] = None

        out[eid] = {
            "documentId": rows[0].get("DOCUMENT_ID"),
            "extractionId": eid,
            "documentType": document_type,
            "notFundLpa": not_fund_lpa,
            "fund": {
                "name": _rj_field(raw_json, ("fund_info", "fund_name"), _to_str),
                "stateOfFormation": _rj_field(raw_json, ("fund_info", "state_of_formation"), _to_str),
                "lpaDate": _rj_field(raw_json, ("fund_info", "lpa_date"), _to_date10),
                "masterSeries": _rj_field(raw_json, ("fund_info", "master_series"), _to_str),
                "fundPurpose": _rj_field(raw_json, ("fund_info", "fund_purpose"), _to_str),
                # RAW_JSON only -- ATTRIBUTES never carries these three.
                "registeredAgent": _to_str(_rj_get(raw_json, "fund_info", "registered_agent_name")),
                "principalOffice": _to_str(_rj_get(raw_json, "fund_info", "principal_office_address")),
                "governingLaw": _to_str(_rj_get(raw_json, "document_metadata", "governing_law")),
            },
            "generalPartner": {
                "name": _rj_field(raw_json, ("parties", "general_partner", "name"), _to_str),
                "entityType": _rj_field(raw_json, ("parties", "general_partner", "entity_type"), _to_str),
                "stateOfFormation": _rj_field(raw_json, ("parties", "general_partner", "state_of_formation"), _to_str),
                "commitmentAmount": _rj_field(raw_json, ("parties", "general_partner", "commitment_amount"), _to_float),
                "commitmentPercentage": _rj_field(raw_json, ("parties", "general_partner", "commitment_percentage"), _to_float),
                "address": _rj_field(raw_json, ("parties", "general_partner", "address"), _to_str),
                # RAW_JSON only -- ATTRIBUTES never carries it.
                "managingMembers": _rj_member_names(raw_json, "parties", "general_partner", "members"),
            },
            "limitedPartners": lps,
            "currencyCode": currency_code,
            "termsExtracted": terms_extracted,
            "headlineTermCount": headline_term_count,
            "terms": terms,
            "termFlags": term_flags(terms),
            "boundingBoxes": bboxes,
            "createdAt": min(created_ats) if created_ats else None,
        }

    return out


# ---------------------------------------------------------------------------
# Side letter extraction assembly
# ---------------------------------------------------------------------------

def build_side_letters(sl_rows: list[dict]) -> list[dict]:
    """Group side letter rows by EXTRACTION_ID and pair LP/event rows.

    One document can hold several side letter extractions (a packet split
    into segments); each keeps its own RAW_JSON and positional pairing.

    Each side letter extraction contains a repeating pattern:
      fund entity row (once) → LP entity → side_letter event → LP entity → side_letter event → …

    Returns a flat list where each dict is one side letter (one LP, one
    event). A single extraction with 3 LPs produces 3 dicts.
    """
    grouped: dict[str, list[dict]] = {}
    for row in sl_rows:
        eid = row.get("EXTRACTION_ID")
        if not eid:
            continue
        grouped.setdefault(eid, []).append(row)

    out: list[dict] = []
    for eid, rows in grouped.items():
        did = rows[0].get("DOCUMENT_ID")
        # Sort by RECORD_INDEX so LP/event pairs stay adjacent -- this order
        # also lines up 1:1 with RAW_JSON's side_letters[] array (validated:
        # cardinality always matches on real data).
        rows.sort(key=lambda r: _to_int(r.get("RECORD_INDEX")) or 0)
        raw_json = next((rj for r in rows if (rj := _load_raw_json(r))), {})
        rj_side_letters = _rj_get(raw_json, "side_letters")
        if not isinstance(rj_side_letters, list):
            rj_side_letters = []

        # Extraction-level, same for every side letter in this extraction.
        fund_name = _to_str(_rj_get(raw_json, "issuer_name"))

        # Pair each LP entity with the next side_letter event row; sl_idx
        # tracks that row's position for the positional RAW_JSON join.
        pending_lp: dict | None = None
        sl_idx = 0
        for row in rows:
            rt = (row.get("RECORD_TYPE") or "").lower()
            kind = (row.get("KIND") or "").lower()
            attrs = _load_attrs(row)
            if rt == "limited_partner" and kind == "entity":
                pending_lp = attrs
            elif rt == "side_letter" and kind == "event":
                sl_obj = rj_side_letters[sl_idx] if sl_idx < len(rj_side_letters) else None
                sl_idx += 1

                def _sl_field(key: str, caster):
                    return caster(_unwrap(sl_obj.get(key)) if isinstance(sl_obj, dict) else None)

                def _provision_summary(key: str) -> str | None:
                    obj = sl_obj.get(key) if isinstance(sl_obj, dict) else None
                    return _to_str(_unwrap(obj.get("summary"))) if isinstance(obj, dict) else None

                # capital_commitment: ATTRIBUTES is pre-formatted ("$1,000,000"),
                # RAW_JSON a bare number -- stays ATTRIBUTES-only.
                out.append({
                    "documentId": did,
                    "extractionId": eid,
                    "fundName": fund_name,
                    "lpName": _sl_field("investor", _to_str),
                    "lpCapitalCommitment": _to_str((pending_lp or {}).get("capital_commitment")),
                    # From RAW_JSON (~6.7% coverage) — see SKILL.md Caveats.
                    "currencyCode": _clean_currency(row.get("DOCUMENT_CURRENCY_CODE")),
                    "issueDate": _sl_field("issue_date", _to_date10),
                    "executedByInvestor": _sl_field("executed_by_investor", _to_bool),
                    "executedByIssuer": _to_bool(_rj_get(raw_json, "executed_by_issuer")),
                    "hasDraftMarkings": _to_bool(_rj_get(raw_json, "has_draft_markings")),
                    "hasUnfilledPlaceholders": _to_bool(_rj_get(raw_json, "has_unfilled_placeholders")),
                    "economicProvisions": _load_provisions(attrs.get("economic_provisions")),
                    # RAW_JSON only -- no ATTRIBUTES counterpart. Tiered or
                    # IRR-based fee and carry terms land in complex_* rather than
                    # in economic_provisions.
                    "complexManagementFee": _provision_summary("complex_management_fee"),
                    "complexCarry": _provision_summary("complex_carry"),
                    "mfnProvision": _provision_summary("mfn_provision"),
                    "excuseRight": _provision_summary("excuse_right"),
                    "transferRestrictionModification": _provision_summary("transfer_restriction_modification"),
                    "createdAt": _to_str(row.get("CREATED_AT")),
                })
                pending_lp = None

    return out


_PROVISION_SUMMARY_KEYS = (
    "complexManagementFee", "complexCarry", "mfnProvision", "excuseRight",
    "transferRestrictionModification",
)


def has_provisions(sl: dict) -> bool:
    """True when the letter carries any extracted provision, economic or not."""
    return bool(sl.get("economicProvisions")) or any(sl.get(k) for k in _PROVISION_SUMMARY_KEYS)


def dedupe_side_letters(sls: list[dict]) -> list[dict]:
    """Collapse duplicate side letter extractions of the same underlying letter.

    An LPA + side letter package is often re-uploaded per investor's
    subscription bundle, so the *same* side letter for the *same*
    counterparty on the *same* issue date can appear ~2–10× in
    DOCUMENT_AI_RECORD. Group by (counterparty, issue_date, role), the
    counterparty compared modulo case and punctuation ("Acme Ltd." and
    "Acme Ltd" are one investor). Then fold into a counterparty's one signed,
    dated letter any copy of it that is undated, or is a draft, unfilled or
    unsigned by the fund: those are versions of that letter, not new ones. Two
    signed letters on different dates stay apart. Within each group, keep the
    "cleanest" extraction:

      1. Prefer the one with any provision extracted (a stub extraction may
         miss provisions the fuller pass caught).
      2. Prefer the one without `has_draft_markings` set (drafty scans
         are lower-fidelity signals of the executed document).
      3. Prefer the one without `has_unfilled_placeholders` set
         (unfilled scans similarly suggest a template, not a final
         document — even when the pipeline flagged the same doc twice).
      4. Prefer the most recent by ``createdAt`` (later extractions
         usually reflect a schema/parser improvement).

    Ties fall through in order — the first pass with maximum
    (has_provisions, not_drafty, not_unfilled, createdAt) wins.
    """
    groups: dict[tuple[str, str, str], list[dict]] = {}
    for sl in sls:
        key = (
            _lp_key(sl.get("counterpartyName")),
            (sl.get("issueDate") or "").strip(),
            (sl.get("role") or "").strip(),
        )
        groups.setdefault(key, []).append(sl)

    final_by_party: dict[tuple[str, str], list[tuple[str, str, str]]] = {}
    for key, group in groups.items():
        if key[0] and key[1] and any(_is_final(sl) for sl in group):
            final_by_party.setdefault((key[0], key[2]), []).append(key)
    for key in list(groups):
        finals = final_by_party.get((key[0], key[2]), [])
        if len(finals) != 1 or key == finals[0]:
            continue
        if not key[1] or not any(_is_final(sl) for sl in groups[key]):
            groups[finals[0]].extend(groups.pop(key))

    out: list[dict] = []
    for group in groups.values():
        if len(group) == 1:
            out.append(group[0])
            continue
        # Cleanliness score, higher = cleaner. Tuple comparison ordered:
        # (has_provisions, not_drafty, not_unfilled, createdAt).
        def cleanliness(sl: dict) -> tuple:
            has_prov = 1 if has_provisions(sl) else 0
            not_drafty = 0 if sl.get("hasDraftMarkings") else 1
            not_unfilled = 0 if sl.get("hasUnfilledPlaceholders") else 1
            ts = sl.get("createdAt") or ""
            return (has_prov, not_drafty, not_unfilled, ts)
        out.append(max(group, key=cleanliness))
    return out


def _is_final(sl: dict) -> bool:
    """A signed copy: no draft markings, no blanks, and not marked unsigned by the fund."""
    return not sl.get("hasDraftMarkings") and not sl.get("hasUnfilledPlaceholders") and sl.get("executedByIssuer") is not False


# ---------------------------------------------------------------------------
# GP-entity fallback attribution
# ---------------------------------------------------------------------------

def _gp_entity_fallback(
    unattributed: list[dict],
    funds_out: list[dict],
) -> list[dict]:
    """Attempt secondary attribution for GP-entity side letters.

    The extraction pipeline sometimes stores the GP LLC name in the fund field
    rather than the LP fund vehicle. When no direct fuzzy match fires, try two
    fallbacks in order:
      A — LP name lookup: check each fund's LP roster (from LPA extractions)
          for the side letter's lpName. If exactly one fund matches, attribute
          with attributionMethod="lp-name".
      B — Issue date window: compare issueDate against each fund's lpaDate
          (±7 days). If exactly one fund matches, attribute with
          attributionMethod="date-inferred".

    Attributed side letters are appended to the matching fund's sideLetters
    list and sideLetterCount is incremented. Unresolved letters are returned.
    """
    fund_lp_norms: dict[str, frozenset[str]] = {}
    fund_lpa_dates: dict[str, str | None] = {}
    for fund in funds_out:
        fn = fund["fundName"]
        lpa = fund.get("lpa")
        if lpa:
            fund_lp_norms[fn] = frozenset(
                norm_name(lp.get("name"))
                for lp in (lpa.get("limitedPartners") or [])
                if lp.get("name")
            )
            terms = lpa.get("terms") or {}
            fund_lpa_dates[fn] = (
                (lpa.get("fund") or {}).get("lpaDate")
                or terms.get("initialClosingDate")
            )
        else:
            fund_lp_norms[fn] = frozenset()
            fund_lpa_dates[fn] = None

    unresolved: list[dict] = []
    for sl in unattributed:
        lp_name = sl.get("lpName")
        issue_date = sl.get("issueDate")
        matched_fund: str | None = None
        method = "unresolved"

        # Step A — LP name lookup
        if lp_name:
            norm_lp = norm_name(lp_name)
            if norm_lp:
                lp_matches = [fn for fn, lp_set in fund_lp_norms.items() if norm_lp in lp_set]
                if len(lp_matches) == 1:
                    matched_fund, method = lp_matches[0], "lp-name"

        # Step B — issue date window (±7 days)
        if matched_fund is None:
            date_matches = [fn for fn, d in fund_lpa_dates.items() if _date_within_window(issue_date, d)]
            if len(date_matches) == 1:
                matched_fund, method = date_matches[0], "date-inferred"

        attributed_sl = {**sl, "role": "issuer", "counterpartyName": lp_name, "attributionMethod": method}
        if matched_fund is not None:
            for fund in funds_out:
                if fund["fundName"] == matched_fund:
                    fund["sideLetters"].append(attributed_sl)
                    fund["sideLetterCount"] += 1
                    break
        else:
            unresolved.append(attributed_sl)

    return unresolved


# ---------------------------------------------------------------------------
# Firm-fund matching + coverage assembly
# ---------------------------------------------------------------------------

def _lp_key(name: str | None) -> str:
    """Identity of an LP across LPA copies: the name modulo case and punctuation.

    Deliberately stricter than norm_name, which also drops legal forms and
    parentheticals — merging two different investors would hide one of them.
    """
    return re.sub(r"[^A-Z0-9]+", " ", (name or "").upper()).strip()


def merge_lp_rosters(selected_eid: str, hit_eids: list[str], lpas: dict[str, dict]) -> list[dict]:
    """One LP roster for a fund, across every LPA document that resolved to it.

    Funds collect an executed copy of the LPA per investor, so any one copy
    names only its own signatory. A named LP appears once, preferring the entry
    that carries a commitment. Unnamed entries come from the selected LPA only,
    so N copies cannot multiply them.
    """
    roster: list[dict] = []
    position: dict[str, int] = {}
    for eid in [selected_eid, *(e for e in hit_eids if e != selected_eid)]:
        for lp in lpas[eid]["limitedPartners"]:
            key = _lp_key(lp.get("name"))
            if not key:
                if eid == selected_eid:
                    roster.append(lp)
                continue
            if key not in position:
                position[key] = len(roster)
                roster.append(lp)
            elif roster[position[key]]["commitmentAmount"] is None and lp["commitmentAmount"] is not None:
                roster[position[key]] = lp
    return roster


def _letter_key(sl: dict) -> tuple[str, str]:
    return (sl.get("extractionId") or "", sl.get("lpName") or "")


def match_funds(
    firm_fund_names: list[str],
    lpas: dict[str, dict],
    side_letters: list[dict],
) -> list[dict]:
    """For each of the firm's funds, resolve LPA extraction + side letter list.

    Returns a list of fund dicts in the order supplied.
    """
    return match_all(firm_fund_names, lpas, side_letters)[0]


def match_all(
    firm_fund_names: list[str],
    lpas: dict[str, dict],
    side_letters: list[dict],
) -> tuple[list[dict], set[str], set[tuple[str, str]]]:
    """match_funds, plus what it did not use.

    Returns (funds, claimed extraction ids, attributed side-letter keys). An
    extraction no fund claimed, or a letter no fund received, is what the report
    lists as unmatched instead of dropping it.
    """
    resolved: dict[str, tuple[list[str], int | None, list[str]]] = {}

    def resolve(name: str) -> tuple[list[str], int | None, list[str]]:
        if name not in resolved:
            resolved[name] = resolve_fund(name, firm_fund_names)
        return resolved[name]

    # Each LPA resolves to at most one fund, so "Fund IV Holdings" never also
    # lands on "Fund IV". Copies of one LPA resolve together by name.
    # (extraction, tier, names this fund's series)
    lpa_hits: dict[str, list[tuple[str, int, bool]]] = {}
    possible_names: dict[str, list[str]] = {}
    # Series left without their own agreement while the parent LLC's is on file.
    parent_agreements: dict[str, list[dict]] = {}
    governing: set[str] = set()
    for eid, lpa in lpas.items():
        lpa_name = lpa["fund"]["name"]
        if not lpa_name:
            continue
        funds, tier, tied = resolve(lpa_name)
        if len(funds) > 1:
            series = _series_for_agreement(funds, lpa)
            if _is_parent_agreement(funds, lpa):
                for fund in funds:
                    refs = parent_agreements.setdefault(fund, [])
                    if fund in series:
                        continue
                    governing.add(eid)
                    if lpa_name not in [r["name"] for r in refs]:
                        refs.append({"name": lpa_name, "documentId": lpa["documentId"]})
                tied = []
            else:
                tied = tied if series else funds
            funds = series
        names_series = set(_agreement_series(funds, lpa))
        for fund in funds:
            lpa_hits.setdefault(fund, []).append((eid, tier, fund in names_series))
        for t in tied:
            names = possible_names.setdefault(t, [])
            if lpa_name not in names:
                names.append(lpa_name)

    # The firm's fund is the issuer (grants terms to an LP) or the investor (got
    # terms from another manager's fund). Issuer resolves first so a letter never
    # counts twice. A portfolio company's round letter naming the fund as investor
    # stays unclaimed: side_letter_summary counts it as a company letter.
    sls_by_fund: dict[str, list[dict]] = {}
    attributed_sl_keys: set[tuple[str, str]] = set()
    for sl in side_letters:
        fund_name = sl.get("fundName")
        lp_name = sl.get("lpName")
        targets, _, issuer_tied = resolve(fund_name) if fund_name else ([], None, [])
        if targets:
            attributed = {**sl, "role": "issuer", "counterpartyName": lp_name}
            letter_name = fund_name
        elif not issuer_tied and lp_name and not is_company_letter(sl) and (targets := resolve(lp_name)[0]):
            attributed = {**sl, "role": "investor", "counterpartyName": fund_name}
            letter_name = lp_name
        else:
            continue
        if len(targets) > 1:
            targets = _narrow_to_named_series(targets, letter_name, attributed)
        for target in targets:
            sls_by_fund.setdefault(target, []).append({**attributed})
        attributed_sl_keys.add(_letter_key(sl))

    funds_out: list[dict] = []
    for firm_name in firm_fund_names:
        # Prefer the agreement stating the most headline terms, then any populated terms, then an
        # agreement naming this fund's series, then the stronger name match, then recency.
        matched_lpa: dict | None = None
        match_tier: int | None = None
        hits = lpa_hits.get(firm_name) or []
        if hits:
            matched_eid, match_tier, _ = max(
                hits,
                key=lambda h: (
                    lpas[h[0]]["headlineTermCount"], bool(lpas[h[0]].get("termsExtracted")), h[2], h[1],
                    lpas[h[0]].get("createdAt") or "",
                ),
            )
            matched_lpa = {
                **lpas[matched_eid],
                "limitedPartners": merge_lp_rosters(matched_eid, [h[0] for h in hits], lpas),
            }

        matching_sls = list(sls_by_fund.get(firm_name) or [])

        # Collapse duplicate uploads (same counterparty + issue date + role) and
        # then sort so side letters with extracted provisions float to the top —
        # the modified ones are the actionable read for a GP; unmodified side
        # letters fall in date-desc order below them.
        matching_sls = dedupe_side_letters(matching_sls)
        matching_sls.sort(key=lambda sl: (sl.get("issueDate") or ""), reverse=True)
        matching_sls.sort(key=lambda sl: 0 if has_provisions(sl) else 1)

        # Status enum
        parent_refs = [] if matched_lpa else parent_agreements.get(firm_name, [])
        if matched_lpa is None and parent_refs:
            status = "PARENT_AGREEMENT"  # series' own terms not on file; the parent LLC's agreement is
        elif matched_lpa is None:
            status = "MISSING"
        elif not matched_lpa["headlineTermCount"]:
            status = "PARTIAL"  # LPA detected, but it states none of the terms the table shows
        else:
            status = "EXTRACTED"

        funds_out.append({
            "fundName": firm_name,
            "lpaStatus": status,
            "sideLetterCount": granted_count(matching_sls),
            "documentId": matched_lpa["documentId"] if matched_lpa else None,
            "lpa": matched_lpa,
            # "exact" = same name; "close" = typo-level or legal-form difference.
            "lpaMatch": None if match_tier is None else ("exact" if match_tier == FUND_MATCH_EXACT else "close"),
            # LPAs that tie between this fund and a sibling, so neither got them.
            "possibleLpaNames": possible_names.get(firm_name, []) if matched_lpa is None else [],
            "parentAgreements": parent_refs,
            # Order is already provisions-first, then date-desc — set above.
            # Do NOT re-sort here or the provisions-first ordering is lost.
            "sideLetters": matching_sls,
        })

    # GP-entity fallback: side letters whose fundName looks like "Firm GP, LLC"
    # don't match any fund vehicle by name. Attempt attribution via LP name
    # lookup (against fund LP rosters from LPA extractions) or issue date.
    gp_sls = [
        sl for sl in side_letters
        if _is_gp_entity(sl.get("fundName"))
        and _letter_key(sl) not in attributed_sl_keys
    ]
    if gp_sls:
        print(f"  {len(gp_sls)} GP-entity side letter(s) found — attempting fallback attribution…", flush=True)
        unresolved = _gp_entity_fallback(gp_sls, funds_out)
        if unresolved:
            print(
                f"  {len(unresolved)} GP-entity side letter(s) could not be attributed to a fund vehicle "
                f"and are excluded from fund cards.",
                flush=True,
            )

    # Runs last so it also covers side letters the GP-entity fallback just
    # attributed, not only the direct fund-name matches.
    _backfill_commitments_from_lpa(funds_out)

    claimed = {eid for hits in lpa_hits.values() for eid, _, _ in hits} | governing
    attributed_sl_keys.update(_letter_key(sl) for fund in funds_out for sl in fund["sideLetters"])
    return funds_out, claimed, attributed_sl_keys


def _backfill_commitments_from_lpa(funds_out: list[dict]) -> None:
    """Fill a side letter's missing commitment from its fund's LPA roster.

    A side letter states its own capital_commitment on only ~15.7% of documents,
    but the same investor's figure usually sits on the fund's LPA. Sets
    lpCapitalCommitmentFromLpa so the renderer can mark a backfilled figure as
    inferred instead of passing it off as the letter's own.
    """
    filled = 0
    for fund in funds_out:
        lpa = fund.get("lpa") or {}
        # Only LPs carrying an amount are candidates, so a name match against a
        # commitment-less row can't shadow a usable one.
        by_name = {
            lp["name"]: lp
            for lp in (lpa.get("limitedPartners") or [])
            if lp.get("name") and lp.get("commitmentAmount") is not None
        }
        if not by_name:
            continue
        for sl in fund.get("sideLetters") or []:
            if sl.get("lpCapitalCommitment"):
                continue
            # Investor-role letters name a portfolio company as the counterparty
            # and this fund as the LP, so neither matches this fund's roster.
            if sl.get("role") == "investor":
                continue
            name = sl.get("lpName") or sl.get("counterpartyName")
            hit = best_match(name, list(by_name)) if name else None
            if hit is None:
                continue
            sl["lpCapitalCommitmentAmount"] = by_name[hit]["commitmentAmount"]
            sl["lpCapitalCommitmentCurrency"] = by_name[hit].get("currencyCode")
            sl["lpCapitalCommitmentFromLpa"] = True
            filled += 1
    if filled:
        print(f"  Backfilled {filled} side letter commitment(s) from LPA rosters.", flush=True)


def granted_count(sls: list[dict]) -> int:
    """Side letters a fund granted its own LPs.

    Letters it received as an investor in a portfolio company stay on the fund,
    listed apart, but are a different question from what it granted.
    """
    return sum(1 for sl in sls if sl.get("role") != "investor")


def granted_letters(funds: list[dict]) -> list[dict]:
    """Every letter the firm's funds granted, once.

    A letter shown on each series of an LLC (sharedAcrossSeries) is one letter.
    """
    seen: set[tuple] = set()
    out = []
    for fund in funds:
        for sl in fund["sideLetters"]:
            if sl.get("role") == "investor":
                continue
            if sl.get("sharedAcrossSeries"):
                key = (fund_key(sl.get("fundName"))[0], _lp_key(sl.get("counterpartyName")), sl.get("issueDate") or "")
                if key in seen:
                    continue
                seen.add(key)
            out.append(sl)
    return out


# Entity types that never carry an LPA: listed as not audited rather than missing.
NOT_AUDITED_TYPES = frozenset({"GP Entity", "Management Co", "Elimination Entity"})


# A fund's Carta reporting currency; render-artifact.py's _load_entity applies the same rule.
_ENTITY_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")


def parse_firm_entities(value: Any) -> list[dict]:
    """The firm's entities as {name, carta_id, entity_type, currency}; a bare name has no type and is always audited.

    Strips and validates name and entity_type as render-artifact.py's _load_entity does,
    so one funds file splits the same way in both modes.
    """
    if not isinstance(value, list):
        raise ValueError("firm-fund-names must be a JSON array")
    out = []
    for item in value:
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            raise ValueError(f"firm-fund-names entry needs a non-empty name: {item!r}")
        entity_type = item.get("entity_type")
        if entity_type is not None and (not isinstance(entity_type, str) or not entity_type.strip()):
            raise ValueError(f"firm-fund-names entity_type must be a non-empty string: {item!r}")
        currency = item.get("currency")
        if currency is not None:
            if not isinstance(currency, str) or not _ENTITY_CURRENCY_RE.match(currency.strip().upper()):
                raise ValueError(f"firm-fund-names currency must be a three-letter ISO code: {item!r}")
            currency = currency.strip().upper()
        out.append({
            "name": item["name"].strip(),
            "carta_id": item.get("carta_id"),
            "entity_type": entity_type.strip() if entity_type else None,
            "currency": currency,
        })
    return out


def fill_fund_currency(fund: dict, currency: str | None) -> dict:
    """The fund with every currency its documents leave unknown set to the fund's Carta currency.

    Carta's reporting currency (fa__list__entities' `currency`) is the fund's own, so
    an LP commitment, the GP commitment and a side-letter commitment backfilled from
    the roster (_backfill_commitments_from_lpa, which only fills letters the fund
    granted) in an agreement that states no currency are in it. A currency a document
    states is never replaced. Returns a copy: funds can share one agreement's LP rows.
    """
    if not currency or not fund.get("lpa"):
        return fund
    lpa = {
        **fund["lpa"],
        "currencyCode": fund["lpa"].get("currencyCode") or currency,
        "limitedPartners": [
            {**lp, "currencyCode": lp.get("currencyCode") or currency}
            for lp in fund["lpa"].get("limitedPartners") or []
        ],
    }
    letters = [
        {**sl, "lpCapitalCommitmentCurrency": sl.get("lpCapitalCommitmentCurrency") or currency}
        if sl.get("lpCapitalCommitmentFromLpa") else sl
        for sl in fund.get("sideLetters") or []
    ]
    return {**fund, "lpa": lpa, "sideLetters": letters}


# Carta entity names that mark a record as something other than a fund vehicle, each
# with the reason shown for it. Kept in step with NON_FUND_NAME_PATTERNS in artifact.html.
NON_FUND_NAME_PATTERNS = (
    ("wire instructions", (r"\bwire instructions?\b",)),
    ("custodial account", (r"\bF/?B/?O\b", r"for the benefit of", r"\bCust(odian)?\b\.?")),
    ("trust", (r"\btrust\b", r"\bEMBT\b", r"\bdeed of (donation|trust)\b")),
    ("duplicate", (r"\bdupe\b", r"\bduplicate\b")),
    ("combined entry", (
        r"(?:\bLP\b|\bL\.P\.|\bLLC\b|\bL\.L\.C\.|\bFund \w+\b).*\s(and|&)\s.*(?:\bLP\b|\bL\.P\.|\bLLC\b|\bL\.L\.C\.|\bFund\b)",
    )),
)
_NON_FUND_NAME_RES = tuple(
    (reason, [re.compile(p, re.IGNORECASE) for p in patterns]) for reason, patterns in NON_FUND_NAME_PATTERNS
)


def _non_fund_name_reason(name: str, firm_name: str) -> str | None:
    """Why a Carta entity name marks a non-fund record, or None for a name that could be a fund."""
    for reason, regexes in _NON_FUND_NAME_RES:
        if any(r.search(name) for r in regexes):
            return reason
    # fund_key drops a series and the word "Fund", so a series of an LLC named for the firm,
    # or the firm's unnumbered "<Firm> Fund", would otherwise have the firm's key.
    firm_words = fund_key(firm_name)[0]
    adds_fund = "FUND" in _fund_tokens(_main_name(name)) and "FUND" not in _fund_tokens(firm_name)
    if firm_words and _dash_series(name) is None and not adds_fund and fund_key(name)[0] == firm_words:
        return "the firm itself"
    return None


def split_audited(funds: list[dict], entities: list[dict], firm_name: str) -> tuple[list[dict], list[dict]]:
    """Set aside entities that are not fund vehicles, unless an agreement or side letter landed on one.

    A GP or management company's operating agreement splits profit among its members;
    read as an LPA, that split shows as "carry", and a missing one as a missing LPA.
    An entity of a type in NOT_AUDITED_TYPES is set aside unless a side letter landed on it;
    any other entity is set aside when its name matches NON_FUND_NAME_PATTERNS or is the
    firm's own, and no agreement (its own or a parent's) and no side letter matched it.
    """
    by_name = {e["name"]: e for e in entities}
    audited, not_audited = [], []
    for fund in funds:
        entity = by_name.get(fund["fundName"]) or {}
        entity_type = entity.get("entity_type")
        reason = None
        if entity_type in NOT_AUDITED_TYPES and not fund["sideLetterCount"]:
            reason = "entity type"
        elif not fund["lpa"] and not fund["parentAgreements"] and not fund["sideLetterCount"]:
            reason = _non_fund_name_reason(fund["fundName"], firm_name)
        if reason:
            not_audited.append({"name": fund["fundName"], "entityType": entity_type, "reason": reason})
        else:
            audited.append({
                **fill_fund_currency(fund, entity.get("currency")),
                "cartaId": entity.get("carta_id"),
                "entityType": entity_type,
            })
    return audited, not_audited


# Words every manager's names share, so a match on one says nothing about whose fund it is.
_GENERIC_NAME_WORDS = frozenset({
    "THE", "AND", "OF", "FUND", "FUNDS", "CAPITAL", "VENTURE", "VENTURES", "PARTNERS", "PARTNERSHIP",
    "MANAGEMENT", "GROUP", "HOLDINGS", "INVESTMENTS", "INVESTMENT", "ADVISORS", "EQUITY", "GROWTH",
    "OPPORTUNITIES", "OPPORTUNITY", "COMPANY", "SERIES", "SPV", "LP", "LLC", "GP", "INC", "LTD", "CO", "CORP",
    # Words that name the type of vehicle, not the manager.
    "PARALLEL", "GLOBAL", "OFFSHORE", "CAYMAN", "FEEDER", "MASTER", "LIMITED", "INVESTORS", "ASSOCIATES",
    "PARTNER", "INTERNATIONAL", "AIV", "AGGREGATOR", "BLOCKER", "TRUST",
    # Words that name a manager's role, not which manager.
    "MANAGER", "MANAGERS", "ADVISOR", "ADVISER", "ADVISERS", "GENERAL",
})
# A word in at least this many of the firm's entity names is its fund family's
# ("Summit", "Northstar"): a document sharing only that word could be any of the family.
_FAMILY_WORD_MIN_NAMES = 3


def _brand_words(name: str | None) -> set[str]:
    """The distinctive words of a manager or fund name ("Acme" in "Acme Venture Partners").

    A fund number ("III") is never one: it ties Acme Fund III to every manager's Fund III.
    """
    return {
        w for w in _fund_tokens(name or "")
        if len(w) > 2 and not w.isdigit() and w not in _ROMAN_NUMERALS and w not in _GENERIC_NAME_WORDS
    }


def _own_words(firm_names: list[str]) -> set[str]:
    """The distinctive words of the firm's and its entities' names."""
    return set().union(*(_brand_words(n) for n in firm_names)) if firm_names else set()


def _document_entry(lpa: dict) -> dict:
    """The compact view of an extraction the report lists; no roster or terms."""
    return {
        "documentId": lpa["documentId"],
        "extractionId": lpa["extractionId"],
        "documentType": lpa["documentType"],
        "fundName": lpa["fund"]["name"],
        "gpName": lpa["generalPartner"]["name"],
        "lpaDate": lpa["fund"]["lpaDate"],
        "termsExtracted": lpa["termsExtracted"],
    }


# A GP, manager or adviser entity: its operating agreement governs the manager, never a fund.
_MANAGER_ENTITY_RE = re.compile(
    r"\b(GP|General Partner|Managers?|Management|Advis[eo]rs?)\b(?:[\s-]*(?:[IVX]+|\d+))?(?:\s+(?:Company|Co\.?))?\s*,?\s*"
    r"(LLC|L\.L\.C\.?|LTD\.?|LIMITED|LLP|LP|L\.P\.?|CORP\.?|CORPORATION|INC\.?|CO\.?)?\s*$",
    re.IGNORECASE,
)


def _invests_in(lpa: dict, firm_names: list[str]) -> bool:
    """Whether an agreement's investor roster names one of the firm's entities, even one it cannot tell from a sibling."""
    for lp in lpa["limitedPartners"]:
        if lp.get("name"):
            funds, _, tied = resolve_fund(lp["name"], firm_names)
            if funds or tied:
                return True
    return False


def split_unclaimed(
    lpas: dict[str, dict], claimed: set[str], firm_names: list[str]
) -> tuple[list[dict], list[dict]]:
    """Sort extractions no fund claimed into (unmatched, received from other managers).

    One that shares a distinctive word with the firm's or its entities' names (in
    the fund or GP name) is most likely the firm's own fund under a name Carta does
    not use, so a rebrand shows as "didn't match" for the user to link by hand. The
    rest are other managers' agreements: listed as received when their roster names
    one of the firm's entities as an investor, and otherwise dropped: nothing ties
    them to the firm, so the report neither lists nor counts them. An agreement
    whose fund name is a GP, manager or adviser entity's ("Acme Fund I GP, LLC")
    is dropped too: it governs the manager, so linking it to a fund is never the fix.
    """
    own_words = _own_words(firm_names)
    unmatched, received = [], []
    for eid, lpa in lpas.items():
        if eid in claimed or _MANAGER_ENTITY_RE.search((lpa["fund"]["name"] or "").strip()):
            continue
        words = _brand_words(lpa["fund"]["name"]) | _brand_words(lpa["generalPartner"]["name"])
        if words & own_words:
            unmatched.append(_document_entry(lpa))
        elif _invests_in(lpa, firm_names):
            received.append(_document_entry(lpa))
    return unmatched, received


def _family_words(firm_name: str, entity_names: list[str]) -> set[str]:
    """The words the firm's own name and its fund family share, which point at no one fund."""
    counts: dict[str, int] = {}
    for name in entity_names:
        for word in _brand_words(name):
            counts[word] = counts.get(word, 0) + 1
    return _brand_words(firm_name) | {w for w, n in counts.items() if n >= _FAMILY_WORD_MIN_NAMES}


def _initials_variants(words: tuple[str, ...]) -> set[tuple[str, ...]]:
    """Each way to collapse one run of 2+ consecutive alphabetic words to its initials.

    ("ACME", "VENTURES", "GLOBAL", "1") gives ("AV", "GLOBAL", "1") among others. A
    number is never part of a run.
    """
    variants = set()
    for start in range(len(words)):
        for end in range(start + 2, len(words) + 1):
            run = words[start:end]
            if not all(w.isalpha() for w in run):
                break
            variants.add(words[:start] + ("".join(w[0] for w in run),) + words[end:])
    return variants


def _same_name_by_initials(fund_name: str, document_name: str) -> bool:
    """One name is the other with a run of words written as initials ("AV" for "Acme Ventures")."""
    fund_words, document_words = fund_key(fund_name)[0], fund_key(document_name)[0]
    return fund_words in _initials_variants(document_words) or document_words in _initials_variants(fund_words)


def _named_by_initials(name: str | None, firm_fund_names: list[str]) -> list[str]:
    """The one fund whose name is this one with a run of words as initials, either way round; empty when none or several are.

    A GP or manager entity's name is never read this way: it is not a fund's agreement.
    """
    if not name or _is_gp_entity(name):
        return []
    named = [f for f in firm_fund_names if not _is_gp_entity(f) and _same_name_by_initials(f, name)]
    return named if len(named) == 1 else []


def _could_be_fund(fund_name: str, document: dict, family: set[str]) -> bool:
    """An unmatched document could be this fund's under another name.

    It shares a word naming this fund rather than its family ("Widgets"), or the
    fund's number: an unmatched document already shares a word with the firm, so
    "Summit Secondary VP VII" may be "Acme Venture Partners VII" before a rename.
    A GP or manager entity is never a fund's agreement, and "I" alone is too common a
    number to say anything: a number counts from 2 up. A document whose name is the
    fund's with a run of words written as initials is the fund's too ("AV Global I"
    for "Acme Ventures Global I").
    """
    if _is_gp_entity(document["fundName"]):
        return False
    if _same_name_by_initials(fund_name, document["fundName"] or ""):
        return True
    words = _brand_words(document["fundName"]) | _brand_words(document["gpName"])
    if words & (_brand_words(fund_name) - family):
        return True
    number = _series_num(fund_name)
    return number is not None and number >= 2 and number == _series_num(document["fundName"] or "")


def assign_coverage_states(
    funds: list[dict], lpas: dict[str, dict], unmatched: list[dict], firm_name: str, entity_names: list[str]
) -> None:
    """Split MISSING into why: nothing extracted, or a document that did not match.

    NO_DOCUMENTS: the firm has no LPA or operating agreement extractions at all.
    NAME_MISMATCH: this fund has no document, but an LPA tied between it and a
    sibling, or an unmatched document could be its (see _could_be_fund); the
    candidates' fund names go in possibleLpaNames. MISSING stays for a fund with no
    sign of a document among the firm's own. An unmatched document elsewhere at the
    firm is no sign: a firm that invests in other managers' funds always has some.
    """
    family = _family_words(firm_name, entity_names)
    for fund in funds:
        if fund["lpaStatus"] != "MISSING":
            continue
        if not lpas:
            fund["lpaStatus"] = "NO_DOCUMENTS"
            continue
        candidates = [d["fundName"] for d in unmatched if d["fundName"] and _could_be_fund(fund["fundName"], d, family)]
        if candidates or fund["possibleLpaNames"]:
            fund["lpaStatus"] = "NAME_MISMATCH"
            fund["possibleLpaNames"] = list(dict.fromkeys([*fund["possibleLpaNames"], *candidates]))


def mark_inherited(funds: list[dict]) -> None:
    """Series that share one master agreement point at it instead of repeating it.

    Every series resolves to the same document, so each would otherwise repeat its
    terms and LP roster. The master is the fund the agreement names itself; the
    others keep their terms but drop the roster, and say whose it is.
    """
    by_doc: dict[str, list[dict]] = {}
    for fund in funds:
        if fund["lpa"]:
            by_doc.setdefault(fund["lpa"]["extractionId"], []).append(fund)
    for group in by_doc.values():
        if len(group) < 2:
            continue
        agreement_key = fund_key(group[0]["lpa"]["fund"]["name"])
        master = next((f for f in group if fund_key(f["fundName"]) == agreement_key), group[0])
        for fund in group:
            if fund is master:
                continue
            fund["inheritedFromMaster"] = master["fundName"]
            fund["lpa"] = {**fund["lpa"], "limitedPartnerCount": len(fund["lpa"]["limitedPartners"]), "limitedPartners": []}


# Words in a name that say the entity pools money for a main fund or a single deal. "Holdings"
# and "Opportunity" are left out: both also name main funds.
VEHICLE_WORDS = (
    "aggregator", "feeder", "blocker", "side[ -]?fund", "aiv", "alternative investment vehicle",
    "co[ -]?invest(?:ment)?", "spv",
)

_VEHICLE_NAME = re.compile(r"\b(?:" + "|".join(VEHICLE_WORDS) + r")\b", re.IGNORECASE)
_SPV_TYPE = re.compile(r"\bSPV\b", re.IGNORECASE)
# A 0 fee or carry is the agreement saying there is none, so only a non-zero value counts.
ECONOMIC_TERMS = ("mgmtFeeRateInvestmentPeriod", "mgmtFeeRatePostInvestment", *OPERATING_AGREEMENT_WITHHELD_TERMS)


def is_vehicle_agreement(fund: dict) -> bool:
    """A vehicle whose agreement carries no fee, carry, hurdle or waterfall.

    SPVs, aggregators, feeders, blockers and side funds distribute pro rata or take
    their economics from the main fund's agreement, so blank terms there are by
    design, not a gap. A vehicle that states carry or a fee keeps EXTRACTED, and an
    operating agreement whose profit split was withheld (notFundLpa) is not one.
    """
    lpa = fund["lpa"]
    if fund["lpaStatus"] not in ("EXTRACTED", "PARTIAL") or not lpa or lpa["notFundLpa"]:
        return False
    is_vehicle = bool(_SPV_TYPE.search(fund.get("entityType") or "")) or any(
        _VEHICLE_NAME.search(name or "") for name in (fund["fundName"], lpa["fund"]["name"])
    )
    return is_vehicle and not any(lpa["terms"].get(field) for field in ECONOMIC_TERMS)


def mark_vehicle_agreements(funds: list[dict]) -> None:
    """Move vehicle agreements out of EXTRACTED and PARTIAL; needs entityType, so runs after split_audited."""
    for fund in funds:
        if is_vehicle_agreement(fund):
            fund["lpaStatus"] = "VEHICLE_AGREEMENT"


# Legal forms an operating company takes. Funds take them too (an offshore "Ltd.", a blocker or
# fund "Inc."), so a name with a fund or vehicle word is never a company's.
_COMPANY_FORMS = frozenset({"INC", "CORP", "PBC", "PLC", "LTD"})
_FUND_WORDS = frozenset({"FUND", "FUNDS", "CAPITAL", "PARTNERS", "VENTURES", "INVESTMENTS", "HOLDINGS", "SICAV"})
# Forms companies take outside the US and UK. fund_key does not strip them, so they are read as
# the name's last word ("Anyfin AB", "Universal Diagnostics, S.A.", "Mondu GmbH").
_FOREIGN_COMPANY_FORMS = frozenset({"AB", "AG", "GMBH", "SA", "SAS", "SPA", "SRL", "BV", "NV", "OY", "OYJ", "ASA", "KK"})


def is_company_letter(sl: dict) -> bool:
    """Whether a side letter's issuer is an operating company: a portfolio company's round, not a fund's LPA."""
    name = sl.get("fundName") or ""
    if _VEHICLE_NAME.search(name) or _FUND_WORDS & set(_fund_tokens(name)):
        return False
    if fund_key(name)[1] in _COMPANY_FORMS:
        return True
    words = _fund_tokens(_main_name(name))
    return len(words) > 1 and words[-1] in _FOREIGN_COMPANY_FORMS


def _names_the_firm(sl: dict, firm_names: list[str], own_words: set[str]) -> bool:
    """Whether an unclaimed letter could be the firm's.

    Its issuer is unnamed, a party is one of the firm's names written with initials
    ("AV Global I SPV" for "Acme Ventures Global I SPV", which has no distinctive word
    left), or a party shares a distinctive word with the firm.
    """
    if not sl.get("fundName"):
        return True
    parties = [p for p in (sl["fundName"], sl.get("lpName")) if p]
    if any(_same_name_by_initials(name, party) for name in firm_names for party in parties):
        return True
    return bool(set().union(*(_brand_words(p) for p in parties)) & own_words)


def side_letter_summary(
    funds: list[dict], side_letters: list[dict], attributed: set[tuple[str, str]], firm_names: list[str]
) -> tuple[dict[str, int], list[dict]]:
    """Counts of letters granted, received, from companies and unmatched, and the unmatched ones.

    Raw rows run above what lands on a fund because duplicate uploads fold together.
    A letter whose issuer is a company is a portfolio company's round: no fund
    receives it, and it is counted apart from, and never listed with, the unmatched
    ones. A letter no fund claimed whose parties could not be the firm is between
    another manager's fund and its investors: it is dropped, neither listed nor
    counted, and left out of `extracted` too. firm_names are the firm's and its
    entities' names.
    """
    unclaimed = [sl for sl in side_letters if _letter_key(sl) not in attributed]
    not_company = [sl for sl in unclaimed if not is_company_letter(sl)]
    own_words = _own_words(firm_names)
    unmatched = [sl for sl in not_company if _names_the_firm(sl, firm_names, own_words)]
    other_parties = len(not_company) - len(unmatched)
    received = {_letter_key(sl) for fund in funds for sl in fund["sideLetters"] if sl.get("role") == "investor"}
    counts = {
        "granted": len(granted_letters(funds)),
        "received": len(received),
        "company": len(unclaimed) - len(not_company),
        "unmatched": len(unmatched),
        "extracted": len(side_letters) - other_parties,
    }
    return counts, unmatched


def coverage_counts(funds: list[dict]) -> dict[str, int]:
    def count(status: str) -> int:
        return sum(1 for f in funds if f["lpaStatus"] == status)

    return {
        "totalFunds": len(funds),
        "extracted": count("EXTRACTED"),
        "vehicleAgreement": count("VEHICLE_AGREEMENT"),
        "partial": count("PARTIAL"),
        "parentAgreement": count("PARENT_AGREEMENT"),
        "missing": count("MISSING"),
        "nameMismatch": count("NAME_MISMATCH"),
        "noDocuments": count("NO_DOCUMENTS"),
        "totalSideLetters": len(granted_letters(funds)),
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Assemble lpa-audit JSON from the two DWH NDJSON responses."
    )
    parser.add_argument("--lpa-rows", required=True,
                        help="NDJSON blob file — all LPA extraction rows.")
    parser.add_argument("--operating-agreement-rows", required=True,
                        help="NDJSON blob file — all operating agreement extraction rows.")
    parser.add_argument("--side-letter-rows", required=True,
                        help="NDJSON blob file — all side letter extraction rows.")
    parser.add_argument("--firm-id", required=True, help="Firm UUID (36 chars).")
    parser.add_argument("--firm-name", required=True)
    parser.add_argument("--firm-carta-id", required=True)
    fund_names = parser.add_mutually_exclusive_group(required=True)
    fund_names.add_argument("--firm-fund-names",
                            help="JSON array of the firm's entities (from fa__list__entities): "
                                 '{"name", "carta_id", "entity_type"} objects, or bare names.')
    fund_names.add_argument("--firm-fund-names-file",
                            help="Path to a file holding the --firm-fund-names JSON array.")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    print("Parsing NDJSON responses…", flush=True)
    lpa_rows = parse_ndjson(Path(args.lpa_rows).read_text(encoding="utf-8"))
    oa_rows = parse_ndjson(Path(args.operating_agreement_rows).read_text(encoding="utf-8"))
    sl_rows = parse_ndjson(Path(args.side_letter_rows).read_text(encoding="utf-8"))
    print(f"  Query T: {len(lpa_rows)} LPA rows", flush=True)
    print(f"  Query O: {len(oa_rows)} operating agreement rows", flush=True)
    print(f"  Query L: {len(sl_rows)} side letter rows", flush=True)

    try:
        raw_fund_names = (
            Path(args.firm_fund_names_file).read_text(encoding="utf-8")
            if args.firm_fund_names_file
            else args.firm_fund_names
        )
        firm_entities = parse_firm_entities(json.loads(raw_fund_names))
    except (OSError, json.JSONDecodeError, ValueError) as e:
        print(f"ERROR: could not parse --firm-fund-names: {e}", file=sys.stderr)
        sys.exit(1)

    print("Assembling LPA extractions…", flush=True)
    lpas = {
        **build_lpas(lpa_rows, LPA_DOCUMENT_TYPE),
        **build_lpas(oa_rows, OPERATING_AGREEMENT_DOCUMENT_TYPE),
    }
    print(f"  {len(lpas)} LPA and operating agreement extractions", flush=True)

    print("Assembling side letters…", flush=True)
    side_letters = build_side_letters(sl_rows)
    print(f"  {len(side_letters)} side letters", flush=True)

    print("Matching firm funds…", flush=True)
    entity_names = [e["name"] for e in firm_entities]
    matched, claimed, attributed = match_all(entity_names, lpas, side_letters)
    firm_names = [args.firm_name, *entity_names]
    unmatched_docs, received_docs = split_unclaimed(lpas, claimed, firm_names)
    assign_coverage_states(matched, lpas, unmatched_docs, args.firm_name, entity_names)
    mark_inherited(matched)
    funds, not_audited = split_audited(matched, firm_entities, args.firm_name)
    mark_vehicle_agreements(funds)
    coverage = coverage_counts(funds)
    letter_counts, unmatched_letters = side_letter_summary(funds, side_letters, attributed, firm_names)
    print(
        f"  {coverage['extracted']} extracted, {coverage['vehicleAgreement']} vehicle agreements, "
        f"{coverage['partial']} partial, "
        f"{coverage['parentAgreement']} governed by a parent agreement, "
        f"{coverage['missing']} missing, {coverage['nameMismatch']} name mismatch, "
        f"{coverage['noDocuments']} no documents; {len(unmatched_docs)} unmatched and "
        f"{len(received_docs)} received documents; side letters {letter_counts}",
        flush=True,
    )

    now = datetime.now(timezone.utc)
    generated_at = f"{_MONTHS[now.month - 1]} {now.day}, {now.year}"

    data = {
        "meta": {
            "firmId": args.firm_id,
            "firmName": args.firm_name,
            "firmCartaId": args.firm_carta_id,
            "generatedAt": generated_at,
        },
        "coverage": coverage,
        "funds": funds,
        "notAudited": not_audited,
        "unmatchedDocuments": unmatched_docs,
        "receivedDocuments": received_docs,
        "sideLetterCounts": letter_counts,
        "unmatchedSideLetters": unmatched_letters,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")
    size_kb = out_path.stat().st_size / 1024
    print(f"Done — {out_path} ({size_kb:.1f} KB)", flush=True)


if __name__ == "__main__":
    main()
