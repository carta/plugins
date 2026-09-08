"""
Shared label-reconciliation helpers for shape adapters.

Budget workbooks and their chart-of-accounts mapping sheets rarely spell a
department the same way twice. The same team can appear as:

  - a crosstab super-header        "Client Services"
  - an outline sub-section header  "CS"
  - a mapping-sheet section        "CS (Client Services)"
  - a Carta reporting-tag value    "CS"

Adapters must not carry a hardcoded translation table for any of this — a
table only ever describes the one workbook it was written against. Instead,
every adapter resolves labels against vocabulary derived from the files it
was actually given, using the heuristics below.

Two directions are needed:

  `match_section(label, sections)`  — an outline sub-section header or a
      crosstab super-header, resolved onto the mapping sheet's own section
      vocabulary. Handles the abbreviation-plus-expansion form
      ("CS" ↔ "CS (Client Services)").

  `tag_value_for_section(section, vocabulary)` — a mapping section resolved to
      the canonical department name the rest of the pipeline keys on.
      Prefers a parenthetical expansion, then the part before a separator,
      then the section itself; finally reconciles that against `vocabulary`
      (the department names the budget workbook actually uses) so
      "Investment" lands on "Investment Team" when the workbook says so.

Sections that describe no single department — income lines, firm-wide
allocations — are reported by `is_cross_cutting()` and carry no department.
"""

from __future__ import annotations

import re

# Mapping-sheet sections that span every department rather than naming one.
# These are accounting concepts, not organizational units: a row filed under
# them applies firm-wide, so deriving a department alias from one would
# wrongly bind every department to that row's Carta tag.
# Section names a CLIENT writes in their workbook. Not our identifiers —
# renaming these stops the match and silently derives no aliases.
_CROSS_CUTTING = {
    "income",
    "revenue",
    "revenues",
    "all",
    "all departments",
    "all depts",
    "shared",
    "firm",
    "firm total",
    "firm-wide",
    "firmwide",
    "unallocated",
    "n/a",
}

_PAREN_RX = re.compile(r"\(([^)]*)\)")
_TRAILING_PAREN_RX = re.compile(r"\s*\([^)]*\)\s*$")
# Separators that introduce a qualifier rather than a second department:
# "Operations/Finance" is the Operations team, filed with Finance.
# "&" requires surrounding whitespace, unlike "/" — "G&A" and "R&D" are
# single department names, not two departments joined by "&".
_SEPARATOR_RX = re.compile(r"\s*[/|]\s*|\s+&\s+|\s+and\s+", re.IGNORECASE)
_PUNCT_RX = re.compile(r"[^a-z0-9 ]+")
_WS_RX = re.compile(r"\s+")


def normalize(s) -> str:
    """Casefold, drop punctuation, collapse whitespace. Comparison key only —
    never emitted, so the workbook's own capitalization survives."""
    if not isinstance(s, str):
        return ""
    return _WS_RX.sub(" ", _PUNCT_RX.sub(" ", s.strip().lower())).strip()


def is_cross_cutting(section) -> bool:
    """True when a section names an accounting concept rather than a team."""
    return normalize(section) in _CROSS_CUTTING


def _variants(label: str) -> list[str]:
    """Every normalized form a label might be written as elsewhere.

    "CS (Client Services)" → ["cs client services", "cs", "client services"]
    "Operations/Finance"   → ["operationsfinance", "operations"]
    """
    out: list[str] = []

    def add(v: str) -> None:
        v = normalize(v)
        if v and v not in out:
            out.append(v)

    add(label)
    inner = _PAREN_RX.search(label)
    if inner:
        add(inner.group(1))                      # the expansion
        add(_TRAILING_PAREN_RX.sub("", label))   # the abbreviation
    head = _SEPARATOR_RX.split(label)[0]
    if head != label:
        add(head)
    return out


def _initials(label: str) -> str:
    """First letter of each word — "Founder Services" → "fs".

    For matching a short internal shorthand against a canonical multi-word
    name when the two share no literal substring. A mapping sheet's own
    convention isn't always "<abbreviation> (<full name>)" (this module's
    own docstring example, "CS (Client Services)"); some write the reverse,
    an internal code name with the real abbreviation parenthesized —
    "GAP (FS)" for "Founder Services" — where neither "GAP" nor "FS" is a
    substring of "founder services" for the substring check below to catch.
    Single-word labels return "" — an initialism only means something
    against a multi-word name.
    """
    words = normalize(label).split()
    return "".join(w[0] for w in words) if len(words) >= 2 else ""


def _score(a: str, b: str) -> int:
    """How strongly two labels refer to the same thing. 0 = unrelated.

    Scored rather than boolean so a caller comparing one label against many
    candidates picks the strongest, not merely the first — otherwise
    "Investment" would bind to whichever of "Investment" and
    "Investment Team" happened to be enumerated first.
    """
    va, vb = _variants(a), _variants(b)
    if va and vb and va[0] == vb[0]:
        return 100                                   # identical
    for i, x in enumerate(va):
        for j, y in enumerate(vb):
            if x == y:
                return 90 - (i + j)                  # a variant matched
    for x in va:
        for y in vb:
            if not x or not y:
                continue
            if x.startswith(y + " ") or y.startswith(x + " "):
                return 60                            # leading-token prefix
            if x in y or y in x:
                return 40                            # substring
    for x in va:
        for y in vb:
            if not x or not y:
                continue
            if x == _initials(y) or y == _initials(x):
                return 55                            # initialism
    return 0


def _best(label, candidates, floor: int = 40):
    """Highest-scoring candidate at or above `floor`, else None. Ties break
    on enumeration order, so callers control precedence by ordering."""
    best, best_score = None, 0
    for cand in candidates:
        s = _score(label, cand)
        if s > best_score:
            best, best_score = cand, s
    return best if best_score >= floor else None


def match_section(label, sections):
    """Resolve a workbook label onto the mapping sheet's section vocabulary.

    Returns the matching section string, or None when the label names no
    section the mapping knows about (a workbook can carry sub-sections the
    mapping author never filed against).
    """
    if not label or not sections:
        return None
    return _best(label, list(sections))


def tag_value_for_section(section, vocabulary=None):
    """Canonical department name for a mapping-sheet section.

    `vocabulary` is the set of department names the budget workbook itself
    uses (crosstab super-headers, typically). When supplied, the derived
    name is reconciled against it so every artifact in the pipeline keys on
    one spelling. Returns "" for cross-cutting sections.
    """
    if not section or is_cross_cutting(section):
        return ""

    inner = _PAREN_RX.search(section)
    if inner and inner.group(1).strip():
        derived = inner.group(1).strip()          # "CS (Client Services)"
    else:
        derived = _SEPARATOR_RX.split(section)[0].strip() or section.strip()

    if vocabulary:
        hit = _best(derived, list(vocabulary))
        if hit:
            return hit
    return derived


def dept_vocabulary(budget_payload) -> list[str]:
    """Department names a parsed budget.json actually uses.

    Reads every emitted shape, newest first:

      `tag_values`             a crosstab's ordered column list, which is
                                the authoritative set — it includes columns
                                the workbook declares but leaves empty
      `rows[].by_column` keys   a crosstab's per-row column values
      `rows[].dept`             an outline's sub-section headers
      `rows[].dimension`        the pre-outline crosstab shape

    Returns [] for a budget with no department axis at all — an outline
    parsed without a mapping, say.

    All four are read because the crosstab's emission changed when it moved
    to the workbook-outline shape, and a consumer that only knew the old
    form returned nothing for the new one. That failure is quiet: the
    mapping falls back to names derived from its own sections, so
    "Investment" never reconciles onto the workbook's "Investment Team" and
    the department alias silently stops matching.
    """
    payload = budget_payload or {}
    out: list[str] = []

    def add(candidate) -> None:
        if isinstance(candidate, str) and candidate.strip():
            v = candidate.strip()
            if v not in out:
                out.append(v)

    for name in payload.get("tag_values") or []:
        add(name)
    for row in payload.get("rows") or []:
        # by_dept is the same field parsed before the rename.
        for name in (row.get("by_column") or row.get("by_dept") or {}):
            add(name)
        add(row.get("tag_value"))
        add((row.get("dimension") or {}).get("tag_value"))
    return out
