#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""Groups the 9 DWH stems into the user-facing datasets the freshness panel shows.

Every stem in emit_stem_sql._ORDER belongs to exactly one dataset (union == all 9).
Consumed by build_kpi_datadir.py (freshness stamping) and refresh.py (key->stems).
Stdlib-only, 3.9-safe.
"""
from typing import List

DATASETS = [
    {"key": "kpis", "label": "Operating KPIs",
     "blurb": "Reported revenue, ARR, EBITDA, headcount and custom KPIs.",
     "stems": ["financials"]},
    {"key": "forecasts", "label": "Forecasts",
     "blurb": "Company estimates behind the Company page's Forecast card and the Metrics pivot's Estimate columns.",
     "stems": ["forecasts"]},
    {"key": "holdings", "label": "Holdings & returns",
     "blurb": "Schedule of Investments, value history and deal IRR.",
     "stems": ["holdings", "holdings_history", "deal_irr"]},
    {"key": "ownership", "label": "Ownership & cap tables",
     "blurb": "Ownership %, post-money, cap tables, the fund directory and company identity.",
     "stems": ["fdshares", "capstack", "funds", "entity_identity", "corporation_links"]},
]

STEM_TO_DATASET = {s: ds["key"] for ds in DATASETS for s in ds["stems"]}
ALL_STEMS = [s for ds in DATASETS for s in ds["stems"]]
_KEYS = frozenset(ds["key"] for ds in DATASETS)


def stems_for(keys):
    # type: (List[str]) -> List[str]
    """Ordered, de-duplicated stems for the given dataset keys. Raises ValueError on
    an unknown key so a bad /api/refresh body fails loud, not silently empty."""
    out = []
    for k in keys:
        if k not in _KEYS:
            raise ValueError("unknown dataset key: %s" % k)
        for ds in DATASETS:
            if ds["key"] == k:
                for s in ds["stems"]:
                    if s not in out:
                        out.append(s)
    return out
