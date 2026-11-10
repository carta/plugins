#!/usr/bin/env python3
"""manco_labels.py — label normalization and P&L side helpers shared across
carta-manco-reporting's build scripts.
"""

import re


def _norm_label(v):
    return " ".join(str(v or "").strip().lower().replace("&", "and").split())


def _label_tokens(v):
    return set(re.findall(r"[a-z0-9]+", _norm_label(v)))


def is_income_section(section):
    """Whether a workbook files a line under income rather than spend.

    The firm's own heading, not a guess from the GL code. A management fee
    posts to an account whose code begins with a 6 on some charts, which
    reads as an expense to any prefix test.
    """
    t = (section or "").strip().lower()
    return "income" in t or "revenue" in t
