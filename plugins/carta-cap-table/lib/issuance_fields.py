# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Carta's issuance picklists and per-`so_type` field gates, stated in Python.

long-comment-ok: names the contract these constants exist to hold. The artifact's
form logic answers the same questions in JavaScript
(`skills/carta-issuance/issuance-artifact/resources/issuance.form.js`), and
`tests/carta-cap-table/test_issuance_artifact_rules.py` pins the two together. A
wrong `*_SO_TYPES` set misreports a grant to a tax authority rather than failing
visibly, so each membership is stated once here and compared, never copied. Which
fields each security type collects is stated in
`skills/carta-issuance/references/payload-reference.md`.
Python 3.9-safe: `uv` can resolve to macOS's system 3.9.
"""

# ── Jurisdiction → so_type buttons (carta-issuance Picklists). Primary first. ──
JURISDICTION_SO_TYPES = {
    "US": ["ISO", "NSO", "INTL"],
    "UK": ["EMI", "CSOP", "Unapproved"],
    "AU": ["Startup Concessions", "Non-Concessional", "ZEPO"],
}

# Full `issue_date_relationship` picklist (payload-reference.md). Every
# stakeholder answers it, so every row offers the whole list.
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

# The MCP `stakeholder_kind` contract (payload-reference.md) —
# INDIVIDUAL/NON-INDIVIDUAL, not the raw Django enum's ORGANIZATION.
STAKEHOLDER_KIND_CHOICES = [("INDIVIDUAL", "Individual"), ("NON-INDIVIDUAL", "Non-individual")]

# `rule_144_difference_reason` picklist (payload-reference.md). Required whenever
# the Rule 144 date differs from the issue date.
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

# `threshold_value_type` (PIU only) — what DraftThresholdValueTypeFieldValidator
# accepts. The field manifest's FAIR_MARKET_VALUE/OTHER are a different surface.
THRESHOLD_VALUE_TYPE_CHOICES = [("Unit", "Per unit"), ("Overall", "Overall")]
