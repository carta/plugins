#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = [
#   "Pillow>=10.0",
# ]
# ///
"""compile_deck.py — Two-pass AGM deck compiler.

Pass 1 (deterministic substitution):
  uv run compile_deck.py \\
    --queries-dir /tmp/agm-queries \\
    --template references/template.html \\
    --brand-slug acme-company \\
    --firm-name "ACME Company" \\
    --period-label "Full Year 2025" \\
    --as-of-date 2025-12-31 \\
    --output /tmp/agm-deck/partial-deck.html \\
    --creative-prompt /tmp/agm-deck/creative-tokens.md

Pass 2 (apply Claude's creative tokens):
  uv run compile_deck.py \\
    --partial /tmp/agm-deck/partial-deck.html \\
    --creative-values /tmp/agm-deck/creative-values.json \\
    --output /tmp/agm-deck/firm-agm-2025.html
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from datetime import date, datetime
from pathlib import Path


# Constants

# (token, description, type) — "h"=headline cap, "n"=narrative cap
_CREATIVE = [
    ("COVER_HERO_LINE1",        "First line of cover hero — plain text, 4-8 words",           "h"),
    ("COVER_HERO_EMPHASIS",     "Emphasized phrase on second line — accent color in <em>",    "h"),
    ("COVER_STANDFIRST",        "1-2 sentences framing the deck: period, funds, key theme",   "n"),
    ("AGENDA_HEADLINE_PLAIN",   "Agenda headline opening — plain text",                        "h"),
    ("AGENDA_HEADLINE_EM",      "Emphasized ending for agenda headline",                       "h"),
    ("IRR_HEADLINE_PLAIN",      "IRR headline opening — sets the story",                       "h"),
    ("IRR_HEADLINE_EM",         "ONE emphasized word for IRR performance (e.g. 'exceptional')", "h"),
    ("IRR_HEADLINE_SUFFIX",     "Plain text completing the IRR headline (e.g. 'net returns.')", "h"),
    ("IRR_STANDFIRST",          "2-3 sentences on fund lifecycle & why older funds lead IRR",  "n"),
    ("NAV_TREND_FOOTNOTE",      "One sentence after em dash in NAV trend headline",            "n"),
    ("NAV_M1_NOTE",             "Short label for earliest NAV milestone",                      "n"),
    ("NAV_M2_NOTE",             "Short label for peak NAV milestone",                          "n"),
    ("NAV_M3_NOTE",             "Short label for mid-trend milestone",                         "n"),
    ("NAV_TREND_NOTE_TEXT",     "Footnote on accounting nuances (e.g. Fund I over-distribution)", "n"),
    ("DEPLOY_KPI1_NOTE",        "Sub-caption for newest fund KPI tile (vintage + % deployed)", "n"),
    ("DEPLOY_KPI2_NOTE",        "Sub-caption for second-newest fund KPI tile",                 "n"),
    ("DEPLOY_KPI3_NOTE",        "Sub-caption for 'older funds fully deployed' KPI",            "n"),
    ("LP_GEO_HEADLINE_PLAIN",   "LP geography headline opening — plain text",                  "h"),
    ("LP_GEO_HEADLINE_EM",      "Emphasized phrase for LP geography (e.g. 'global reach.')",  "h"),
    ("LP_GEO_NARRATIVE",        "2-3 sentences on LP geography & notable international LPs",   "n"),
    ("PORTFOLIO_HEADLINE_SUFFIX","Trailing plain text after FMV value in portfolio headline",  "h"),
    ("PORTFOLIO_CURRENCY_NOTE", "Explanation of multi-currency FMV reporting",                 "n"),
    ("RECENT_CONTEXT_BODY",     "2-3 sentences on J-curve & how newer fund IRR improves",      "n"),
    ("CROSS_HEADLINE_EM",       "Insight phrase for IRR vs TVPI (e.g. 'early vintages win on both.')", "h"),
    ("CROSS_INSIGHT_BODY",      "2-3 sentences interpreting IRR/TVPI correlation",             "n"),
    ("CLOSING_HERO_LINE1",      "First line of closing hero — plain text",                     "h"),
    ("CLOSING_HERO_EMPHASIS",   "Emphasized phrase on closing second line",                    "h"),
    ("CLOSING_THANK_YOU",       "1-2 sentences thanking LPs & affirming investment commitment", "n"),
]
CREATIVE_TOKENS = [t[0] for t in _CREATIVE]

# Tokens capped at 80 chars / 10 words (h1 text)
HEADLINE_TOKENS = {
    "PERF_HEADLINE_PLAIN", "PERF_HEADLINE_EM",
    "IRR4B_HEADLINE_PLAIN", "IRR4B_HEADLINE_EM",
    "NAV_HEADLINE_PLAIN", "NAV_HEADLINE_EM",
    "NAV_TREND_HEADLINE_PLAIN", "NAV_TREND_HEADLINE_EM",
    "DEPLOY_HEADLINE_PLAIN", "DEPLOY_HEADLINE_EM", "DEPLOY_HEADLINE_SUFFIX",
    "MULTI_FUND_HEADLINE_PLAIN", "MULTI_FUND_HEADLINE_EM",
    "PORTFOLIO_HEADLINE_PLAIN", "PORTFOLIO_HEADLINE_EM",
    "ASSET_HEADLINE_PLAIN", "ASSET_HEADLINE_EM", "ASSET_HEADLINE_PERCENT", "ASSET_HEADLINE_SUFFIX",
    "BUCKETS_HEADLINE_COUNT", "BUCKETS_HEADLINE_SUFFIX",
    "TOP_PERF_HEADLINE_PLAIN", "TOP_PERF_HEADLINE_EM",
    "GEO_HEADLINE_PLAIN", "GEO_HEADLINE_EM",
    "SPV_HEADLINE_PLAIN", "SPV_HEADLINE_EM",
    "FINANCING_HEADLINE_PLAIN", "FINANCING_HEADLINE_EM",
    "PROFIT_HEADLINE_EM", "PROFIT_HEADLINE_SUFFIX",
    "DEEPDIVE_HEADLINE_PLAIN", "DEEPDIVE_HEADLINE_EM",
    "EXPENSES_HEADLINE_EM", "EXPENSES_HEADLINE_SUFFIX",
    "LOGO_GRID_HEADLINE",
} | {t[0] for t in _CREATIVE if t[2] == "h"}

# Tokens capped at 120 chars (body / lede text)
NARRATIVE_TOKENS = {t[0] for t in _CREATIVE if t[2] == "n"}

# (slide_id, menu_label, data_query or None) — single source of truth for slide registry
_SLIDES = [
    ("01 Cover",                  "Cover",                           None),
    ("02 Agenda",                 "Agenda",                          None),
    ("03 Fund Performance",       "Fund Performance",                "fund_performance_summary"),
    ("04 Fund Net IRR",           "Net IRR",                         "fund_irr_vs_benchmarks"),
    ("04b Net IRR All Funds",     "Net IRR · Full Portfolio",        "fund_irr_vs_benchmarks"),
    ("05 NAV by Fund",            "NAV",                             "fund_performance_summary"),
    ("05b NAV Trend",             "NAV Trend",                       "nav_trend"),
    ("06 Multi-Fund Performance", "All Funds",                       "fund_performance_summary"),
    ("07 Capital Deployment",     "Deployment",                      "capital_deployment_dry_powder"),
    ("10 LP Geography",           "LP Geography",                    "lp_geography"),
    ("11 Portfolio Overview",     "Portfolio",                       "portfolio_overview"),
    ("11b Investment Performance","Investment Performance",           "investment_detail_performance"),
    ("12 Portfolio Logos",        "Logo Grid",                       "portfolio_company_logo_grid"),
    ("13 Asset Type Breakdown",   "Asset Types",                     "asset_type_breakdown"),
    ("14 Performance Buckets",    "Performance Buckets",             "investment_performance_buckets"),
    ("15 Top Performers",         "Top Performers",                  "top_performing_investments"),
    ("18 Geographic Mix",         "Geography",                       "geographic_portfolio_mix"),
    ("19 SPV Performance",        "SPV Performance",                 "spv_performance_table"),
    ("21 Profitability Tracker",  "Profitability",                   "profitability_milestone_tracker"),
    ("22 Financing Round History","Financing Round History",          "financing_round_history"),
    ("22b Early Vintage IRR",     "Benchmark · Early & Mid Vintage", "fund_irr_vs_benchmarks"),
    ("22c Recent Vintage IRR",    "Benchmark · Recent Vintage",      "fund_irr_vs_benchmarks"),
    ("25 IRR vs TVPI",            "IRR vs TVPI",                     "fund_irr_vs_benchmarks"),
    ("25b Portfolio Deep Dives",  "Portfolio Deep Dives",            "portfolio_overview"),
    ("27 Fund Expenses",          "Expenses",                        "fund_expenses_breakdown"),
    ("29 Closing",                "Closing",                         None),
]
SLIDE_ORDER  = [s[0] for s in _SLIDES]
SLIDE_LABELS = {s[0]: s[1] for s in _SLIDES}
SLIDE_QUERY  = {s[0]: s[2] for s in _SLIDES if s[2]}

BUCKET_ORDER = ["10x+", "3–10x", "1–3x", "<1x", "0x (Written Off)"]
BUCKET_SERIES = {"10x+": 1, "3–10x": 2, "1–3x": 3, "<1x": 4, "0x (Written Off)": 5}
ASSET_ORDER = [
    "PREFERRED_EQUITY", "COMMON_EQUITY", "FUND_INVESTMENT",
    "WARRANT", "SAFE", "CONVERTIBLE_NOTE",
]
ASSET_LABELS = {
    "PREFERRED_EQUITY": "Preferred Equity",
    "COMMON_EQUITY":    "Common Equity",
    "FUND_INVESTMENT":  "Fund Investment",
    "WARRANT":          "Warrants",
    "SAFE":             "SAFE",
    "CONVERTIBLE_NOTE": "Convertible Debt",
    "OTHER_GROUPED":    "Other",
}


# Helpers

def to_f(v, default=0.0) -> float:
    try:
        return float(str(v).replace("x", "").replace("%", "").replace(",", "") or 0)
    except Exception:
        return default


def to_i(v, default=0) -> int:
    try:
        return int(float(str(v or 0)))
    except Exception:
        return default


def fmt_currency(dollars: float, precision: int = 3) -> str:
    """Format raw dollar amount → $3.48B, $143M, $2.5M, $750K."""
    v = abs(dollars)
    if v >= 1_000_000_000:
        return f"${v / 1_000_000_000:.{precision}g}B"
    elif v >= 1_000_000:
        return f"${v / 1_000_000:.{precision}g}M"
    elif v >= 1_000:
        return f"${v / 1_000:.{precision}g}K"
    else:
        return f"${v:,.0f}"


def fmt_moic(v: float) -> str:
    return f"{v:.2f}×"


def fmt_pct(v: float, d: int = 1) -> str:
    return f"{v:.{d}f}%"


def cat_color(i: int, total: int = 6, dark_slide: bool = False) -> str:
    # 6 slots — matches the max category count any caller produces (slide 13's
    # asset-type breakdown caps at 5 main categories + 1 "Other" merge = 6).
    n = (i % 6) + 1
    return f"var(--ds-cat-{n})"


def initials(name: str) -> str:
    words = re.sub(r"[^a-zA-Z\s]", "", name).split()
    letters = [w[0].upper() for w in words if w]
    return "".join(letters[:2]) if letters else "?"


def cap_headline(text: str, max_chars: int = 55, max_words: int = 8) -> str:
    """Truncate headline text to fit within two rendered lines at 64px."""
    words = str(text).split()
    if len(words) > max_words:
        text = " ".join(words[:max_words])
    if len(str(text)) > max_chars:
        text = str(text)[:max_chars].rsplit(" ", 1)[0]
    return str(text).rstrip()


def cap_narrative(text: str, max_chars: int = 120) -> str:
    """Truncate narrative text to 120 chars at a word boundary."""
    text = str(text)
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit(" ", 1)[0].rstrip()


def short_company_name(name: str, max_len: int = 22) -> str:
    """Shorten a company name for use in headlines.
    Prefers the parenthetical alias (e.g. 'Example Holdings Limited (ExampleCo)' → 'ExampleCo').
    Falls back to first two words, then hard truncation."""
    # Extract parenthetical alias if it's shorter than max_len
    m = re.search(r'\(([^)]{2,})\)', name)
    if m and len(m.group(1)) <= max_len:
        return m.group(1)
    if len(name) <= max_len:
        return name
    # First two words
    words = name.split()[:2]
    short = " ".join(words)
    return short if len(short) <= max_len else name[:max_len].rstrip()


def short_fund_name(fund_name: str, vintage: str = "") -> str:
    """Shorten a fund name for chart labels."""
    n = fund_name
    suffixes = [", LP", ", LLC", ", L.P.", " Fund", ", Ltd."]
    for s in suffixes:
        n = n.replace(s, "")
    n = n.strip()
    if vintage:
        yr = str(vintage)[:4]
        return f"{n} ({yr})"
    return n


def numbers_to_words(n: int) -> str:
    words = {
        1: "one", 2: "two", 3: "three", 4: "four", 5: "five",
        6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten",
        11: "eleven", 12: "twelve", 13: "thirteen",
    }
    return words.get(n, str(n))


def load_query(queries_dir: Path, slug: str) -> list[dict]:
    """Load a query JSON file. Handles both old (arrays) and new (named dict) format."""
    path = queries_dir / f"{slug}.json"
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data.get("rows", [])
    columns = data.get("columns", [])
    if not rows:
        return []
    if isinstance(rows[0], dict):
        return rows
    # Old positional format: zip with columns
    return [dict(zip(columns, row)) for row in rows]


def hbar_rows(
    items: list[dict],
    label_fn,
    value_fn,
    label_fmt_fn=None,
    series_fn=None,
    max_rows: int = 8,
) -> tuple[float, str]:
    """Build hbar chart rows JSON. Returns (max_value, json_string)."""
    data = []
    for r in items[:max_rows]:
        v = to_f(value_fn(r))
        if not math.isfinite(v) or v < 0:
            continue
        lbl = label_fn(r)
        val_lbl = label_fmt_fn(v) if label_fmt_fn else str(v)
        series = series_fn(v) if series_fn else 1
        data.append({"label": lbl, "value": v, "valueLabel": val_lbl, "series": series})
    if not data:
        return 0.0, "[]"
    max_v: float = float(max(d["value"] for d in data))
    return max_v, json.dumps(data)


def donut_segments(items: list[tuple[str, float]], dark_slide: bool = False) -> str:
    """Build donut segments JSON with explicit cat colors."""
    segs = []
    for i, (label, value) in enumerate(items):
        color = cat_color(i) if i < 5 else "rgba(128,128,128,0.35)"
        segs.append({"label": label, "value": value, "color": color})
    return json.dumps(segs)


def hi_td(value: float, threshold: float) -> str:
    return ' class="hi"' if value >= threshold else ""


def mute_td() -> str:
    return ' class="mute"'


def dash_if_zero(v: float, fmt_fn) -> str:
    if v == 0:
        return '<td class="mute">—</td>'
    return f"<td>{fmt_fn(v)}</td>"


# Query loading + filtering helpers

def flagship_funds(rows: list[dict]) -> list[dict]:
    """Filter fund performance rows to flagship funds (exclude tiny SPVs)."""
    result = []
    for r in rows:
        size = to_f(r.get("fund_size", 0))
        # Keep funds >= $25M and not purely internal sub-entities with no data
        if size >= 25_000_000:
            result.append(r)
    return result


def merge_irr(funds: list[dict], irr_rows: list[dict]) -> list[dict]:
    """Join IRR onto fund performance rows by fund_name."""
    irr_by_name: dict[str, float] = {}
    for r in irr_rows:
        irr_by_name[r.get("fund_name", "")] = to_f(r.get("net_irr", 0))
    for f in funds:
        f["_net_irr"] = irr_by_name.get(f.get("fund_name", ""), 0.0)
    return funds


def fund_vintage_year(r: dict) -> str:
    vd = str(r.get("vintage_date", r.get("vintage_year", "")) or "")
    return vd[:4] if vd else ""


def tvpi_series(tvpi: float) -> int:
    if tvpi >= 5:     return 1
    if tvpi >= 2:     return 2
    if tvpi >= 1:     return 3
    return 4


def irr_series(irr: float) -> int:
    if irr >= 30:  return 1
    if irr >= 20:  return 2
    if irr >= 5:   return 3
    return 4


# Token builders — one function per slide / section

def build_global(args, qs: dict) -> dict:
    """Global tokens: FIRM_NAME, PERIOD_LABEL, AS_OF_DATE, BRAND_SLUG, active slide flags."""
    ad = args.as_of_date
    if isinstance(ad, str):
        ad = date.fromisoformat(ad)
    return {
        "FIRM_NAME":            args.firm_name,
        "PERIOD_LABEL":         args.period_label,
        "AS_OF_DATE":           ad.strftime("%B %d, %Y"),
        "AS_OF_YEAR":           str(ad.year),
        "BRAND_SLUG":           args.brand_slug,
        "GOOGLE_FONTS_QUERY":   "family=Inter:wght@200;300;400;500;600;700",
        "IRR_BENCHMARK_NOTE":   "Peer benchmark percentile data not available for this reporting period.",
        "CURRENCY":             "USD",
        "FINANCING_AS_OF_NOTE": f"Amounts in local currency. Data as of {ad.strftime('%B %d, %Y')}.",
        "CLOSING_EYEBROW":      f"Looking ahead · {ad.year + 1}",
        "CLOSING_FOOTER_LABEL": "Questions &amp; discussion",
    }


def build_slide03(funds: list[dict], as_of_date: date, period_label: str) -> dict:
    """03 Fund Performance · KPI strip (NAV/Value/Distributions/Funds) + TVPI hbar, top 5.

    The hbar chart sits in a max-height:300px container (see template.html) and each
    row is ~52-58px tall, so more than 5 rows overflow and get silently clipped.
    """
    if not funds:
        return {}
    sorted_tvpi = sorted(funds, key=lambda r: to_f(r.get("total_tvpi", 0)), reverse=True)

    total_nav = sum(to_f(r.get("ending_total_nav", 0)) for r in funds)
    total_dist = sum(to_f(r.get("total_distribution", 0)) for r in funds)
    total_value = total_nav + total_dist
    fund_count = len(funds)

    max_tvpi, tvpi_rows_json = hbar_rows(
        sorted_tvpi[:5],
        label_fn=lambda r: short_fund_name(r["fund_name"], fund_vintage_year(r)),
        value_fn=lambda r: to_f(r.get("total_tvpi", 0)),
        label_fmt_fn=fmt_moic,
        series_fn=tvpi_series,
    )

    return {
        "PERF_PERIOD_EYEBROW":  f"Fund performance · {period_label}",
        "PERF_HEADLINE_PLAIN":  f"{numbers_to_words(fund_count).capitalize()} funds.",
        "PERF_HEADLINE_EM":     fmt_currency(total_value),
        "TOTAL_NAV":            fmt_currency(total_nav),
        "TOTAL_VALUE":          fmt_currency(total_value),
        "DISTRIBUTIONS":        fmt_currency(total_dist),
        "ACTIVE_FUND_COUNT":    str(fund_count),
        "TVPI_CHART_MAX":       str(round(max_tvpi, 2)),
        "TVPI_CHART_ROWS":      tvpi_rows_json,
    }


def build_slide04(irr_rows: list[dict], as_of_date: date) -> dict:
    """04 Net IRR · Highest/Lowest KPIs + IRR hbar sorted descending."""
    # Only funds with a present net_irr — keep negative values (a fund early in
    # the J-curve legitimately has negative net IRR; excluding it here silently
    # drops it from the chart instead of showing the real, if unflattering, number.
    flagship_irr = [r for r in irr_rows if r.get("net_irr") is not None]

    if not flagship_irr:
        return {}

    sorted_irr = sorted(flagship_irr, key=lambda r: to_f(r.get("net_irr", 0)), reverse=True)
    top = sorted_irr[0]
    bot = sorted_irr[-1]

    max_irr, irr_rows_json = hbar_rows(
        sorted_irr[:8],
        label_fn=lambda r: short_fund_name(r["fund_name"], r.get("vintage_year", "")),
        value_fn=lambda r: to_f(r.get("net_irr", 0)),
        label_fmt_fn=fmt_pct,
        series_fn=irr_series,
    )

    return {
        "HIGHEST_IRR_VALUE": fmt_pct(to_f(top.get("net_irr", 0))),
        "HIGHEST_IRR_FUND":  short_fund_name(top["fund_name"], top.get("vintage_year", "")),
        "LOWEST_IRR_VALUE":  fmt_pct(to_f(bot.get("net_irr", 0))),
        "LOWEST_IRR_FUND":   short_fund_name(bot["fund_name"], bot.get("vintage_year", "")),
        "IRR_CHART_MAX":     str(round(max_irr, 2)),
        "IRR_CHART_ROWS":    irr_rows_json,
    }


def build_slide04b(irr_rows: list[dict], as_of_date: date) -> dict:
    """04b Net IRR All Funds · Dual hbar (older left / newer right), shared scale."""
    # Keep negative net_irr (legitimate J-curve values); only drop rows with no
    # net_irr at all.
    valid = sorted(
        [r for r in irr_rows if r.get("net_irr") is not None],
        key=lambda r: to_f(r.get("net_irr", 0)), reverse=True,
    )
    if not valid:
        return {}

    global_max = to_f(valid[0].get("net_irr", 0)) if valid else 100.0

    # Split into older (higher IRR) vs newer vintages
    mid = len(valid) // 2
    left = valid[:mid or 1]
    right = valid[mid:]

    def make_rows(items):
        return json.dumps([{
            "label": short_fund_name(r["fund_name"], r.get("vintage_year", "")),
            "value": to_f(r.get("net_irr", 0)),
            "valueLabel": fmt_pct(to_f(r.get("net_irr", 0))),
            "series": irr_series(to_f(r.get("net_irr", 0))),
        } for r in items[:9]])

    top_fund = valid[0] if valid else {}
    return {
        "IRR4B_EYEBROW":      f"Net IRR · All funds · As of {as_of_date.strftime('%B %d, %Y')}",
        "IRR4B_HEADLINE_PLAIN": f"{len(valid)} funds in the full portfolio —",
        "IRR4B_HEADLINE_EM":  f"leading fund at {fmt_pct(to_f(top_fund.get('net_irr', 0)))} net IRR",
        "IRR4B_GLOBAL_MAX":   str(round(global_max, 2)),
        "IRR4B_LEFT_LABEL":   "Flagship funds · Sorted by Net IRR",
        "IRR4B_RIGHT_LABEL":  "Newer vintages · Sorted by Net IRR",
        "IRR4B_LEFT_ROWS":    make_rows(left),
        "IRR4B_RIGHT_ROWS":   make_rows(right),
        "IRR4B_FOOTNOTE":     f"IRR as of {as_of_date.strftime('%B %d, %Y')}. Peer benchmark percentiles not available.",
    }


def build_slide05(funds: list[dict], as_of_date: date) -> dict:
    """05 NAV by Fund · Donut (NAV share per fund) + legend rows sorted by NAV desc."""
    sorted_nav = sorted(funds, key=lambda r: to_f(r.get("ending_total_nav", 0)), reverse=True)
    total_nav = sum(to_f(r.get("ending_total_nav", 0)) for r in funds)
    count = len(funds)

    # Donut: top 8 individually, rest grouped
    top8 = sorted_nav[:8]
    rest = sorted_nav[8:]
    segs = []
    for i, r in enumerate(top8):
        segs.append((short_fund_name(r["fund_name"]), to_f(r.get("ending_total_nav", 0)) / 1_000_000))
    if rest:
        rest_nav = sum(to_f(r.get("ending_total_nav", 0)) for r in rest) / 1_000_000
        segs.append(("Other funds", rest_nav))

    # Legend rows (top 5 individually, then grouped)
    legend_html_parts = []
    for i, r in enumerate(sorted_nav[:5]):
        nav = to_f(r.get("ending_total_nav", 0))
        pct = (nav / total_nav * 100) if total_nav else 0
        border = "border-bottom:1px solid var(--ds-rule);" if i < 4 else ""
        name = short_fund_name(r["fund_name"], fund_vintage_year(r))
        legend_html_parts.append(
            f'<div style="display:flex; align-items:baseline; justify-content:space-between; padding:10px 0; {border}">'
            f'<div style="display:flex; align-items:center; gap:12px;">'
            f'<span class="ds-swatch" data-series="{i+1}"></span>'
            f'<div class="ds-label">{name}</div></div>'
            f'<div style="display:flex; gap:24px; align-items:baseline;">'
            f'<div class="ds-num--sm" style="font-size:28px;">{fmt_currency(nav)}</div>'
            f'<div class="ds-label ds-label--sm ds-on-mute">{fmt_pct(pct)}</div></div></div>'
        )
    if sorted_nav[5:]:
        others = sorted_nav[5:]
        other_nav = sum(to_f(r.get("ending_total_nav", 0)) for r in others)
        other_pct = (other_nav / total_nav * 100) if total_nav else 0
        names = ", ".join(short_fund_name(r["fund_name"]) for r in others[:4])
        legend_html_parts.append(
            f'<div style="display:flex; align-items:baseline; justify-content:space-between; padding:10px 0;">'
            f'<div class="ds-label ds-on-mute">{names}</div>'
            f'<div style="display:flex; gap:24px; align-items:baseline;">'
            f'<div class="ds-num--sm" style="font-size:28px;">{fmt_currency(other_nav)}</div>'
            f'<div class="ds-label ds-label--sm ds-on-mute">{fmt_pct(other_pct)}</div></div></div>'
        )

    return {
        "NAV_HEADLINE_EM":         fmt_currency(total_nav),
        "FUND_COUNT_LABEL":        f"{numbers_to_words(count)} funds",
        "NAV_DONUT_CENTER_NUMBER": fmt_currency(total_nav),
        "NAV_DONUT_SEGMENTS":      donut_segments(segs),
        "NAV_LEGEND_ROWS":         "\n".join(legend_html_parts),
    }


def build_slide05b(nav_rows: list[dict], as_of_date: date) -> dict:
    """05b NAV Trend · Line chart over time with 3 milestone annotations."""
    if not nav_rows:
        return {}
    # Aggregate to year-end snapshots (quarter_end_date ending in -12-31)
    year_end: dict[str, float] = {}
    for r in nav_rows:
        qd = str(r.get("quarter_end_date", ""))
        if qd.endswith("-12-31") or qd.endswith("-12-31T00:00:00"):
            yr = qd[:4]
            nav = to_f(r.get("ending_total_nav", 0))
            year_end[yr] = year_end.get(yr, 0) + nav

    if not year_end:
        return {}

    sorted_years = sorted(year_end.keys())
    # Use up to 6 year-end points
    if len(sorted_years) > 6:
        # Keep first, peak, and last few
        sorted_years = sorted_years[-6:]

    vals = [year_end[y] for y in sorted_years]
    peak_val = max(vals)
    peak_yr = sorted_years[vals.index(peak_val)]
    current_val = vals[-1]
    current_yr = sorted_years[-1]

    # Y-axis: 0 to 110% of peak, rounded
    y_max = math.ceil(peak_val * 1.1 / 1_000_000 / 500) * 500  # nearest 500M above 110%

    # 4 milestone KPIs
    m_years = sorted_years
    m1_yr = m_years[0]
    m2_yr = peak_yr
    m3_idx = len(m_years) // 2
    m3_candidate = m_years[m3_idx]
    m3_yr = m3_candidate if m3_candidate != m2_yr else m_years[max(0, m3_idx - 1)]
    m4_yr = current_yr

    xlabels = [f"Dec {y}" for y in sorted_years]
    ylabels = [fmt_currency(y_max * 1_000_000), fmt_currency(y_max * 750_000),
               fmt_currency(y_max * 500_000), fmt_currency(y_max * 250_000)]
    values = [round(year_end[y] / 1_000_000, 1) for y in sorted_years]

    return {
        "NAV_TREND_PEAK_EM":    fmt_currency(peak_val),
        "NAV_TREND_PEAK_YEAR":  peak_yr,
        "NAV_M1_LABEL":         f"Dec {m1_yr}",
        "NAV_M1_VALUE":         fmt_currency(year_end[m1_yr]),
        "NAV_M2_LABEL":         f"Dec {m2_yr} (Peak)",
        "NAV_M2_VALUE":         fmt_currency(year_end[m2_yr]),
        "NAV_M3_LABEL":         f"Dec {m3_yr}",
        "NAV_M3_VALUE":         fmt_currency(year_end[m3_yr]),
        "NAV_M4_LABEL":         f"Dec {current_yr} (Current)",
        "NAV_M4_VALUE":         fmt_currency(current_val),
        "NAV_M4_NOTE":          "Continued LP realizations",
        "NAV_TREND_XLABELS":    json.dumps(xlabels),
        "NAV_TREND_YLABELS":    json.dumps(ylabels),
        "NAV_TREND_YDOMAIN":    json.dumps([0, y_max]),
        "NAV_TREND_VALUES":     json.dumps(values),
        "NAV_TREND_END_LABEL":  fmt_currency(current_val),
    }


def build_slide06(funds: list[dict], irr_rows: list[dict], currency: str = "USD") -> dict:
    """06 Multi-Fund Performance · Table with top 5 flagship funds (size, NAV, TVPI, IRR, DPI)."""
    if not funds:
        return {}
    funds = merge_irr(funds, irr_rows)
    top5 = sorted(funds, key=lambda r: to_f(r.get("total_tvpi", 0)), reverse=True)[:5]

    rows_html = []
    for r in top5:
        name = r.get("fund_name", "")
        yr = fund_vintage_year(r)
        size = to_f(r.get("fund_size", 0))
        called = to_f(r.get("total_cost_of_investments", size))
        nav = to_f(r.get("ending_total_nav", 0))
        dist = to_f(r.get("total_distribution", 0))
        tvpi = to_f(r.get("total_tvpi", 0))
        dpi = (dist / called) if called else 0
        irr = r.get("_net_irr", 0.0)

        dist_cell = dash_if_zero(dist, fmt_currency) if dist == 0 else f'<td>{fmt_currency(dist)}</td>'
        dpi_class = hi_td(dpi, 1.0) or (mute_td() if dpi < 0.01 else "")
        dpi_cell = f'<td style="color:rgba(255,255,255,0.4);">0.00×</td>' if dpi < 0.001 else f'<td{hi_td(dpi,1.0)}>{fmt_moic(dpi)}</td>'

        rows_html.append(
            f"<tr>"
            f"<td>{name}</td>"
            f"<td{mute_td()}>{yr}</td>"
            f"<td{mute_td()}>{fmt_currency(size)}</td>"
            f"<td{mute_td()}>{fmt_currency(called)}</td>"
            f"<td>{fmt_currency(nav)}</td>"
            f"{dist_cell}"
            f"<td{hi_td(tvpi, 2.0)}>{fmt_moic(tvpi)}</td>"
            f"{dpi_cell}"
            f"<td{hi_td(irr, 20.0)}>{fmt_pct(irr)}</td>"
            f"</tr>"
        )

    # Compute years of investing
    earliest = min(
        (to_i(fund_vintage_year(r)) for r in funds if fund_vintage_year(r)),
        default=2008,
    )
    years = datetime.now().year - earliest

    return {
        "MULTI_FUND_HEADLINE_PLAIN": f"{numbers_to_words(len(funds)).capitalize()} flagship funds.",
        "MULTI_FUND_HEADLINE_EM":    f"{numbers_to_words(years).capitalize() if years <= 13 else str(years)} years of investing.",
        "MULTI_FUND_TABLE_ROWS":     "\n".join(rows_html),
    }


def build_slide07(deploy_rows: list[dict]) -> dict:
    """07 Capital Deployment · 3 KPI tiles (newest funds) + deployment % hbar, top 6.

    The hbar chart sits in a max-height:360px container (see template.html) and each
    row is ~52-58px tall, so more than 6 rows overflow and get silently clipped.
    """
    if not deploy_rows:
        return {}

    # One row per fund per period — take the latest for each fund
    by_fund: dict[str, dict] = {}
    for r in deploy_rows:
        name = r.get("fund_name", "")
        if name not in by_fund or r.get("months_since_vintage", 0) > by_fund[name].get("months_since_vintage", 0):
            by_fund[name] = r

    funds = sorted(by_fund.values(), key=lambda r: to_i(r.get("vintage_year", 9999)))

    # KPI tiles: newest 2 funds + older funds status
    sorted_by_vintage = sorted(funds, key=lambda r: to_i(r.get("vintage_year", 0)), reverse=True)
    kpi1 = sorted_by_vintage[0] if sorted_by_vintage else {}
    kpi2 = sorted_by_vintage[1] if len(sorted_by_vintage) > 1 else {}

    def dry_powder_note(r):
        pct = to_f(r.get("pct_deployed", 0))
        yr = r.get("vintage_year", "")
        return f"{yr} vintage · {fmt_pct(pct)} deployed"

    max_dep, dep_rows = hbar_rows(
        sorted(funds, key=lambda r: to_f(r.get("pct_deployed", 0)), reverse=True)[:6],
        label_fn=lambda r: short_fund_name(r["fund_name"], r.get("vintage_year", "")),
        value_fn=lambda r: to_f(r.get("pct_deployed", 0)),
        label_fmt_fn=fmt_pct,
        series_fn=lambda v: 1 if v >= 95 else (2 if v >= 75 else (3 if v >= 50 else 4)),
    )

    return {
        "DEPLOY_HEADLINE_PLAIN":   f"Funds fully deployed.",
        "DEPLOY_HEADLINE_EM":      short_fund_name(kpi1.get("fund_name", "Latest Fund")),
        "DEPLOY_HEADLINE_SUFFIX":  f"early-stage with {fmt_currency(to_f(kpi1.get('dry_powder', 0)))} dry powder.",
        "DEPLOY_KPI1_LABEL":       f"{short_fund_name(kpi1.get('fund_name','Fund'))} Dry Powder",
        "DEPLOY_KPI1_VALUE":       fmt_currency(to_f(kpi1.get("dry_powder", 0))),
        "DEPLOY_KPI2_LABEL":       f"{short_fund_name(kpi2.get('fund_name','Fund 2'))} Dry Powder",
        "DEPLOY_KPI2_VALUE":       fmt_currency(to_f(kpi2.get("dry_powder", 0))),
        "DEPLOY_KPI3_LABEL":       "Older Funds Status",
        "DEPLOY_KPI3_VALUE":       "100%",
        "DEPLOY_CHART_ROWS":       dep_rows,
    }


US_STATES = {
    "AL": "Alabama",        "AK": "Alaska",         "AZ": "Arizona",       "AR": "Arkansas",
    "CA": "California",     "CO": "Colorado",        "CT": "Connecticut",   "DE": "Delaware",
    "FL": "Florida",        "GA": "Georgia",         "HI": "Hawaii",        "ID": "Idaho",
    "IL": "Illinois",       "IN": "Indiana",         "IA": "Iowa",          "KS": "Kansas",
    "KY": "Kentucky",       "LA": "Louisiana",       "ME": "Maine",         "MD": "Maryland",
    "MA": "Massachusetts",  "MI": "Michigan",        "MN": "Minnesota",     "MS": "Mississippi",
    "MO": "Missouri",       "MT": "Montana",         "NE": "Nebraska",      "NV": "Nevada",
    "NH": "New Hampshire",  "NJ": "New Jersey",      "NM": "New Mexico",    "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota",    "OH": "Ohio",          "OK": "Oklahoma",
    "OR": "Oregon",         "PA": "Pennsylvania",    "RI": "Rhode Island",  "SC": "South Carolina",
    "SD": "South Dakota",   "TN": "Tennessee",       "TX": "Texas",         "UT": "Utah",
    "VT": "Vermont",        "VA": "Virginia",        "WA": "Washington",    "WV": "West Virginia",
    "WI": "Wisconsin",      "WY": "Wyoming",         "DC": "Washington D.C.",
}


def expand_state(label: str) -> str:
    """Expand a US state abbreviation to its full name; pass other strings through."""
    return US_STATES.get(label.strip(), label)


def build_slide10(lp_rows: list[dict]) -> dict:
    """10 LP Geography · Aggregates 93 state-level rows → top 10 by commitment, hbar."""
    if not lp_rows:
        return {}

    # Aggregate by state/country (top 10 for the hbar)
    by_state: dict[str, dict] = {}
    for r in lp_rows:
        raw_state = r.get("partner_state") or r.get("partner_country", "Other")
        country = r.get("partner_country", "")
        state = expand_state(raw_state)  # TX → Texas, passes international through
        is_us = country.strip() in ("United States", "US", "USA", "United States of America")
        if is_us:
            key = state  # just the full state name, no country suffix
        else:
            key = country or state  # international: use country name
        commitment = to_f(r.get("total_commitment", 0))
        if key in by_state:
            by_state[key]["total_commitment"] = by_state[key].get("total_commitment", 0) + commitment
        else:
            by_state[key] = {"label": key, "total_commitment": commitment}

    sorted_states = sorted(by_state.values(), key=lambda r: r["total_commitment"], reverse=True)
    total_commitment = sum(r["total_commitment"] for r in sorted_states)
    top10 = sorted_states[:10]

    max_c, chart_rows = hbar_rows(
        top10,
        label_fn=lambda r: r["label"],
        value_fn=lambda r: r["total_commitment"] / 1_000_000,
        label_fmt_fn=lambda v: fmt_currency(v * 1_000_000),
        series_fn=lambda v: 1 if v >= 300 else (2 if v >= 100 else (3 if v >= 50 else 4)),
    )

    return {
        "LP_GEO_EYEBROW":     "Limited Partners · Commitment by Location",
        "LP_GEO_TOTAL":       fmt_currency(total_commitment),
        "LP_GEO_CHART_LABEL": "Commitment by State / Country · Top 10",
        "LP_GEO_CHART_MAX":   str(round(max_c, 0)),
        "LP_GEO_CHART_ROWS":  chart_rows,
    }


def build_slide11(portfolio_rows: list[dict]) -> dict:
    """11 Portfolio Overview · Top 8 by FMV hbar; headline uses short company name."""
    if not portfolio_rows:
        return {}
    sorted_fmv = sorted(portfolio_rows, key=lambda r: to_f(r.get("remaining_value", 0)), reverse=True)
    top = sorted_fmv[:10]
    max_fmv = to_f(top[0].get("remaining_value", 0)) / 1_000_000 if top else 1

    chart_rows = []
    for i, r in enumerate(top[:8]):
        fmv = to_f(r.get("remaining_value", 0))
        name = r.get("issuer_name", "")
        fund = short_fund_name(r.get("fund_name", ""))
        chart_rows.append({
            "label": f"{name} · {fund}",
            "value": round(fmv / 1_000_000, 1),
            "valueLabel": fmt_currency(fmv),
            "series": (i % 4) + 1,
        })

    top1 = top[0] if top else {}
    top1_name = short_company_name(top1.get("issuer_name", "Top company"))
    top1_fmv = fmt_currency(to_f(top1.get("remaining_value", 0)))

    return {
        "PORTFOLIO_EYEBROW":         "Portfolio · Top 8 holdings by current FMV",
        "PORTFOLIO_HEADLINE_PLAIN":  f"{top1_name} leads at",
        "PORTFOLIO_HEADLINE_EM":     top1_fmv,
        "PORTFOLIO_CHART_MAX":       str(round(max_fmv, 1)),
        "PORTFOLIO_CHART_ROWS":      json.dumps(chart_rows),
    }


def build_slide12(logo_rows: list[dict]) -> dict:
    """12 Portfolio Logos · 5×5 grid, top 25 by FMV; initials fallback if no https:// logo."""
    if not logo_rows:
        return {}
    sorted_rows = sorted(logo_rows, key=lambda r: to_f(r.get("total_fmv", 0)), reverse=True)

    accent_colors = ["var(--ds-accent-1)", "var(--ds-accent-2)", "var(--ds-accent-3)"]
    cards = []
    for i, r in enumerate(sorted_rows[:25]):
        name = r.get("corporation_name", "Unknown")
        logo_url = r.get("logo_url", "")
        fmv = to_f(r.get("total_fmv", 0)) / 1_000_000
        invested = to_f(r.get("total_invested", 0)) / 1_000_000
        moic = fmv / invested if invested > 0 else 0
        moic_str = fmt_moic(moic) if moic > 0 and moic < 10000 else "—"
        metric = f"{fmt_currency(fmv * 1_000_000)} · {moic_str}"
        inits = initials(name)
        bg = accent_colors[i % 3]

        # Validate logo URL
        use_logo = logo_url and logo_url.startswith("https://")

        if use_logo:
            img_html = (
                f'<img src="{logo_url}" alt="{name}" '
                f'style="max-width:80px;max-height:36px;object-fit:contain;" '
                f'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">'
                f'<div style="display:none;width:44px;height:44px;border-radius:50%;'
                f'background:{bg};color:#fff;font-weight:700;font-size:14px;'
                f'align-items:center;justify-content:center;">{inits}</div>'
            )
        else:
            img_html = (
                f'<div style="display:flex;width:44px;height:44px;border-radius:50%;'
                f'background:{bg};color:#fff;font-weight:700;font-size:14px;'
                f'align-items:center;justify-content:center;">{inits}</div>'
            )

        cards.append(
            f'<div style="background:#fff;border-radius:12px;border:1px solid var(--ds-rule);'
            f'display:flex;flex-direction:column;align-items:center;justify-content:center;'
            f'padding:16px 12px;gap:8px;box-shadow:0 1px 4px rgba(0,0,0,.06);">'
            f'{img_html}'
            f'<div style="font-size:11px;font-weight:600;color:var(--ds-ink);'
            f'text-align:center;line-height:1.2;">{name}</div>'
            f'<div style="font-size:10px;color:var(--ds-accent-2);font-weight:500;">{metric}</div>'
            f'</div>'
        )

    return {
        "LOGO_GRID_EYEBROW":  f"Top Companies by Value",
        "LOGO_GRID_HEADLINE": "Portfolio at a Glance",
        "LOGO_CARDS":         "\n".join(cards),
    }


def build_slide13(asset_rows: list[dict]) -> dict:
    """13 Asset Type · Donut + hbar; capped at 6 categories, tail merged into Other."""
    if not asset_rows:
        return {}

    # Build ordered dict
    by_type = {r.get("asset_class_type", r.get("asset_type", "OTHER")): r for r in asset_rows}
    total_fmv = sum(to_f(r.get("total_fmv", 0)) for r in asset_rows)

    ordered = [(k, by_type[k]) for k in ASSET_ORDER if k in by_type]
    # Add any additional types not in ASSET_ORDER, excluding generic catch-alls
    extras = [(k, v) for k, v in by_type.items() if k not in ASSET_ORDER and k not in ("OTHER", "TOKEN")]
    ordered += extras
    # Cap at 6 — merge tail into "Other"
    if len(ordered) > 6:
        main = ordered[:5]
        tail_fmv = sum(to_f(v.get("total_fmv", 0)) for _, v in ordered[5:])
        tail_cos = sum(to_i(v.get("company_count", 0)) for _, v in ordered[5:])
        tail_pct = tail_fmv / total_fmv * 100 if total_fmv else 0
        other = {"total_fmv": tail_fmv, "fmv_pct": tail_pct, "company_count": tail_cos}
        ordered = main + [("OTHER_GROUPED", other)]
    # Also include any actual "Other/Token" rows that exist, merging them at end
    elif "OTHER" in by_type or "TOKEN" in by_type:
        oth_fmv = sum(to_f(v.get("total_fmv", 0)) for k, v in by_type.items() if k in ("OTHER", "TOKEN"))
        oth_cos = sum(to_i(v.get("company_count", 0)) for k, v in by_type.items() if k in ("OTHER", "TOKEN"))
        oth_pct = oth_fmv / total_fmv * 100 if total_fmv else 0
        if oth_fmv > 0:
            ordered.append(("OTHER_GROUPED", {"total_fmv": oth_fmv, "fmv_pct": oth_pct, "company_count": oth_cos}))

    segs = []
    legend_parts = []
    for i, (k, r) in enumerate(ordered):
        fmv_pct = to_f(r.get("fmv_pct", 0))
        fmv = to_f(r.get("total_fmv", 0))
        cos = to_i(r.get("company_count", 0))
        label = ASSET_LABELS.get(k, k.replace("_", " ").title())
        color = cat_color(i)
        segs.append({"label": label, "value": fmv_pct, "color": color})
        pill_cls = ["", "ds-pill--2", "ds-pill--3"][i % 3]
        pill = f'<span class="ds-pill {pill_cls}">{cos} cos</span>'
        border = "border-bottom:1px solid var(--ds-rule);" if i < len(ordered) - 1 else ""
        legend_parts.append(
            f'<div style="display:flex; align-items:baseline; justify-content:space-between; padding:12px 0; {border}">'
            f'<div style="display:flex; align-items:center; gap:10px;">'
            f'<span class="ds-swatch" data-series="{i+1}"></span>'
            f'<div class="ds-label">{label}</div>{pill}</div>'
            f'<div style="display:flex; gap:20px; align-items:baseline;">'
            f'<div class="ds-num--sm" style="font-size:26px;">{fmt_currency(fmv)}</div>'
            f'<div class="ds-label ds-label--sm ds-on-mute">{fmt_pct(fmv_pct)}</div>'
            f'</div></div>'
        )

    top = ordered[0][1] if ordered else {}
    top_pct = to_f(top.get("fmv_pct", 0))
    top_label = ASSET_LABELS.get(ordered[0][0], "preferred equity") if ordered else "preferred equity"

    return {
        "ASSET_HEADLINE_PERCENT":      fmt_pct(top_pct),
        "ASSET_HEADLINE_SUFFIX":       f"of portfolio FMV in {top_label.lower()}.",
        "ASSET_DONUT_CENTER_NUMBER":   fmt_currency(total_fmv),
        "ASSET_DONUT_SEGMENTS":        json.dumps(segs),
        "ASSET_LEGEND_ROWS":           "\n".join(legend_parts),
    }


def build_slide14(bucket_rows: list[dict]) -> dict:
    """14 Performance Buckets · 5 MOIC tiers (10×+/3–10×/1–3×/<1×/0×) — count + hbar."""
    if not bucket_rows:
        return {}

    # Normalise bucket names
    def norm(raw: str) -> str:
        s = str(raw).strip()
        if "10" in s and ("+" in s or "x+" in s.lower()):
            return "10x+"
        if "3" in s and "10" in s:
            return "3–10x"
        if "1" in s and "3" in s:
            return "1–3x"
        if "<" in s and "1" in s:
            return "<1x"
        if "0" in s and ("write" in s.lower() or "written" in s.lower()):
            return "0x (Written Off)"
        return s

    by_bucket = {norm(r.get("performance_bucket", "")): r for r in bucket_rows}
    total_count = sum(to_i(r.get("company_count", 0)) for r in bucket_rows)

    def bucket_data(key):
        r = by_bucket.get(key, {})
        cos = to_i(r.get("company_count", 0))
        inv = to_f(r.get("total_invested", 0))
        val = to_f(r.get("total_value", 0))
        return cos, inv, val

    b10_cos, b10_inv, b10_val = bucket_data("10x+")
    b3_cos, b3_inv, b3_val = bucket_data("3–10x")
    b1_cos, b1_inv, b1_val = bucket_data("1–3x")
    blt_cos, blt_inv, blt_val = bucket_data("<1x")
    b0_cos, b0_inv, b0_val = bucket_data("0x (Written Off)")

    chart_rows = json.dumps([
        {"label": "10×+",             "value": b10_cos, "valueLabel": f"{b10_cos} companies", "series": 1},
        {"label": "3–10×",            "value": b3_cos,  "valueLabel": f"{b3_cos} companies",  "series": 2},
        {"label": "1–3×",             "value": b1_cos,  "valueLabel": f"{b1_cos} companies",  "series": 3},
        {"label": "<1×",              "value": blt_cos, "valueLabel": f"{blt_cos} companies", "series": 4},
        {"label": "0× (written off)", "value": b0_cos,  "valueLabel": f"{b0_cos} companies",  "series": 5},
    ])

    return {
        "BUCKETS_HEADLINE_COUNT":   f"{b10_cos} companies",
        "BUCKETS_HEADLINE_SUFFIX":  f"returning 10× or more — from just {fmt_currency(b10_inv)} invested.",
        "BUCKET_10X_COUNT":         str(b10_cos),
        "BUCKET_10X_DETAIL":        f"{fmt_currency(b10_inv)} cost → {fmt_currency(b10_val)} value",
        "BUCKET_3_10X_COUNT":       str(b3_cos),
        "BUCKET_3_10X_DETAIL":      f"{fmt_currency(b3_inv)} cost → {fmt_currency(b3_val)} value",
        "BUCKET_1_3X_COUNT":        str(b1_cos),
        "BUCKET_1_3X_DETAIL":       f"{fmt_currency(b1_inv)} cost → {fmt_currency(b1_val)} value",
        "BUCKET_LT1X_COUNT":        str(blt_cos),
        "BUCKET_LT1X_DETAIL":       f"{fmt_currency(blt_inv)} cost → {fmt_currency(blt_val)} value",
        "BUCKET_0X_COUNT":          str(b0_cos),
        "BUCKET_0X_DETAIL":         f"{fmt_currency(b0_inv)} cost → $0 value",
        "BUCKETS_TOTAL_COUNT":      str(total_count),
        "BUCKETS_OUTPERFORM_COUNT": str(b10_cos + b3_cos),
        "BUCKETS_CHART_MAX":        str(max(b1_cos, b10_cos, blt_cos, b0_cos, b3_cos)),
        "BUCKETS_CHART_ROWS":       chart_rows,
    }


def build_slide15(top_rows: list[dict]) -> dict:
    """15 Top Performers · MOIC hbar + top-2 callout cards with fund/value detail."""
    if not top_rows:
        return {}
    # Filter out unrealistic MOICs (total_invested = 0)
    valid = [r for r in top_rows if to_f(r.get("total_invested", 0)) > 0]
    if not valid:
        return {}
    sorted_rows = sorted(valid, key=lambda r: to_f(r.get("moic", r.get("total_value", 0))), reverse=True)
    top = sorted_rows[:8]
    max_moic = to_f(top[0].get("moic", 0)) if top else 1

    chart_rows = json.dumps([{
        "label":      f"{r.get('issuer_name','?')} ({short_fund_name(r.get('fund_name',''))})",
        "value":      to_f(r.get("moic", 0)),
        "valueLabel": fmt_moic(to_f(r.get("moic", 0))),
        "series":     (i % 4) + 1,
    } for i, r in enumerate(top)])

    # Two callout companies
    c1 = top[0] if top else {}
    c2 = top[1] if len(top) > 1 else {}

    def callout_body(r):
        fmv = to_f(r.get("remaining_value", 0))
        inv = to_f(r.get("total_invested", 0))
        moic = to_f(r.get("moic", 0))
        return f"{fmt_currency(fmv)} remaining value · {fmt_moic(moic)} MOIC on {fmt_currency(inv)} invested"

    return {
        "TOP_PERF_HEADLINE_PLAIN":  f"{len(top)} investments",
        "TOP_PERF_HEADLINE_EM":     f"returning {fmt_moic(to_f(top[-1].get('moic',0)))} or better.",
        "TOP_PERF_CHART_MAX":       str(round(max_moic, 2)),
        "TOP_PERF_CHART_ROWS":      chart_rows,
        "TOP_PERF_CALLOUT1_LABEL":  f"{short_fund_name(c1.get('fund_name',''))} standout",
        "TOP_PERF_CALLOUT1_TITLE":  c1.get("issuer_name", "—"),
        "TOP_PERF_CALLOUT1_BODY":   callout_body(c1),
        "TOP_PERF_CALLOUT2_LABEL":  f"{short_fund_name(c2.get('fund_name',''))} standout",
        "TOP_PERF_CALLOUT2_TITLE":  c2.get("issuer_name", "—"),
        "TOP_PERF_CALLOUT2_BODY":   callout_body(c2),
        "TOP_PERF_CALLOUT3_BODY":   "Some positions are confidential. Company names withheld per fund policy.",
    }


def build_slide18(geo_rows: list[dict]) -> dict:
    """18 Geographic Mix · Donut + table; geo_label() resolves 'International' → country name."""
    if not geo_rows:
        return {}
    sorted_geo = sorted(geo_rows, key=lambda r: to_f(r.get("total_fmv", 0)), reverse=True)
    total_fmv = sum(to_f(r.get("total_fmv", 0)) for r in geo_rows)

    def geo_label(r: dict) -> str:
        """Use specific country/region name, not generic 'International'."""
        geo = r.get("geography", "")
        country = r.get("country", "")
        if not geo or geo.lower() in ("international", "other", "unknown"):
            # Use country if specific, else fall back
            return country if country and country not in ("None", "Unknown", "") else "Other"
        return geo

    segs = []
    table_parts = []
    for i, r in enumerate(sorted_geo[:5]):
        geo = geo_label(r)
        fmv = to_f(r.get("total_fmv", 0))
        pct = fmv / total_fmv * 100 if total_fmv else 0
        cos = to_i(r.get("company_count", 0))
        segs.append({"label": geo, "value": round(pct, 2), "color": cat_color(i)})

        kpi_class = "ds-kpi-highlight" if i == 0 else ("ds-kpi-highlight--2" if i == 1 else "")
        border = "border-bottom:1px solid var(--ds-rule);" if i < len(sorted_geo) - 1 else ""
        swatch_n = i + 1
        fmv_str = fmt_currency(fmv)
        pct_str = fmt_pct(pct)
        cos_str = str(cos)
        table_parts.append(
            f'<div style="display:grid; grid-template-columns:1fr auto auto; gap:20px; '
            f'align-items:baseline; padding:28px 0; {border}">'
            f'<div style="display:flex; align-items:center; gap:10px;">'
            f'<span class="ds-swatch" data-series="{swatch_n}"></span>'
            f'<div class="ds-label">{geo}</div></div>'
            f'<div class="ds-num--sm {kpi_class}" style="font-size:40px;">'
            f'{cos_str}<span class="ds-num__unit" style="font-size:18px;">cos</span></div>'
            f'<div style="text-align:right;">'
            f'<div class="ds-num--sm" style="font-size:32px;">{fmv_str}</div>'
            f'<div class="ds-label ds-label--sm ds-on-mute">{pct_str} of FMV</div>'
            f'</div></div>'
        )

    top = sorted_geo[0] if sorted_geo else {}
    top_pct = to_f(top.get("total_fmv", 0)) / total_fmv * 100 if total_fmv else 0
    top_geo = geo_label(top) if top else "US"
    dominant_pct_str = fmt_pct(top_pct)

    # Only claim "selective international exposure" if a second geography is
    # actually present — otherwise the headline asserts diversification that
    # doesn't exist in the data (LO — client-A 100%-US portfolio bug).
    if len(sorted_geo) > 1 and top_pct < 99.95:
        headline_plain = f"Predominantly {top_geo}-focused with"
        headline_em = "selective international exposure."
    else:
        headline_plain = f"Entirely {top_geo}-focused —"
        headline_em = "no international exposure."

    return {
        "GEO_HEADLINE_PLAIN":        headline_plain,
        "GEO_HEADLINE_EM":           headline_em,
        "GEO_DONUT_CENTER_LABEL":    f"{top_geo} by FMV",
        "GEO_DONUT_CENTER_NUMBER":   dominant_pct_str,
        "GEO_DONUT_SEGMENTS":        json.dumps(segs),
        "GEO_TABLE_ROWS":            "\n".join(table_parts),
    }


def build_slide19(spv_rows: list[dict]) -> dict:
    """19 SPV Performance · MOIC hbar for SPV vehicles, top by TVPI."""
    if not spv_rows:
        return {}
    sorted_spv = sorted(spv_rows, key=lambda r: to_f(r.get("tvpi", r.get("moic", 0))), reverse=True)
    max_tvpi, spv_chart = hbar_rows(
        sorted_spv[:12],
        label_fn=lambda r: short_fund_name(r.get("fund_name", "SPV")),
        value_fn=lambda r: to_f(r.get("tvpi", r.get("moic", 0))),
        label_fmt_fn=fmt_moic,
        series_fn=lambda v: 1 if v >= 2 else (2 if v >= 1 else (3 if v >= 0.5 else 4)),
    )

    top = sorted_spv[0] if sorted_spv else {}
    top_tvpi = to_f(top.get("tvpi", top.get("moic", 0)))
    top_nav = to_f(top.get("ending_nav", top.get("nav", 0)))
    top_name = top.get("fund_name", "Top SPV")

    return {
        "SPV_HEADLINE_PLAIN":  f"{top_name} at",
        "SPV_HEADLINE_EM":     f"{fmt_moic(top_tvpi)} TVPI leads SPV returns.",
        "SPV_TOP_TVPI":        f"{top_tvpi:.2f}",
        "SPV_TOP_NAME_NAV":    f"{top_name} · NAV {fmt_currency(top_nav)}",
        "SPV_TOTAL_COUNT":     str(len(spv_rows)),
        "SPV_CHART_MAX":       str(round(max_tvpi, 2)),
        "SPV_CHART_ROWS":      spv_chart,
    }


def build_slide22(fin_rows: list[dict], as_of_date: date, logo_rows = None) -> dict:
    """22 Financing Round History · Top 10 recent investments in 2-column card layout."""
    if not fin_rows:
        return {}

    # Build name → logo_url lookup from portfolio logo grid (case-insensitive, first-word fallback)
    logo_lookup: dict[str, str] = {}
    for lr in (logo_rows or []):
        url = lr.get("logo_url", "")
        if not (url and url.startswith("https://")):
            continue
        corp = lr.get("corporation_name", "")
        logo_lookup[corp.lower()] = url
        # also index by first word for fuzzy matching
        first = corp.split()[0].lower().rstrip(".,") if corp else ""
        if first and first not in logo_lookup:
            logo_lookup[first] = url

    def logo_html(name: str) -> str:
        key = name.lower()
        url = logo_lookup.get(key) or logo_lookup.get(name.split()[0].lower().rstrip(".,") if name else "")
        if url:
            return (f'<img src="{url}" alt="{name}" '
                    f'style="height:28px;width:52px;object-fit:contain;flex-shrink:0;"'
                    f' onerror="this.style.display=\'none\'">')
        return (f'<div style="width:28px;height:28px;border-radius:50%;background:var(--ds-accent-1);'
                f'color:#fff;font-size:9px;font-weight:700;display:flex;align-items:center;'
                f'justify-content:center;flex-shrink:0;">{initials(name)}</div>')

    # Filter to last 18 months and sort by cash_raised desc
    cutoff = as_of_date.replace(year=as_of_date.year - 2)
    recent = []
    for r in fin_rows:
        rd_str = str(r.get("raised_date", r.get("closing_date", "")) or "")
        try:
            rd = date.fromisoformat(rd_str[:10])
        except Exception:
            continue
        if rd >= cutoff:
            recent.append(r)

    if not recent:
        recent = fin_rows  # fallback: show all

    recent = sorted(recent, key=lambda r: to_f(r.get("cash_raised", 0)), reverse=True)[:10]
    top10 = recent[:10]
    half = len(top10) // 2 or 1

    def make_col_rows(items, highlight_first: bool = False):
        rows_html = []
        for j, r in enumerate(items):
            name   = r.get("company_name", "Unknown")
            rnd    = r.get("round", "")
            sc     = r.get("shareclass_name", "")
            dt     = str(r.get("raised_date", r.get("closing_date", "")) or "")[:7]
            raised = to_f(r.get("cash_raised", 0))
            amt_cls = "ds-kpi-highlight" if (highlight_first and j == 0) else (
                      "ds-kpi-highlight--2" if (highlight_first and j == 1) else "")
            rows_html.append(
                f'<tr>'
                f'<td style="padding:12px 0; border-bottom:1px solid var(--ds-rule);">'
                f'<div style="display:flex; align-items:center; gap:10px;">{logo_html(name)}'
                f'<div><div class="ds-body" style="font-size:17px; font-weight:500;">{name}</div>'
                f'<div class="ds-label ds-on-mute" style="margin-top:2px;">{sc or rnd} · {dt}</div>'
                f'</div></div></td>'
                f'<td class="ds-label ds-on-mute" style="padding:12px 0 12px 20px; border-bottom:1px solid var(--ds-rule); text-align:right; white-space:nowrap;">{rnd}</td>'
                f'<td class="ds-num--sm {amt_cls}" style="font-size:22px; padding:12px 0 12px 24px; border-bottom:1px solid var(--ds-rule); text-align:right;">{fmt_currency(raised)}</td>'
                f'</tr>'
            )
        return (
            '<table style="width:100%; border-collapse:collapse;">'
            '<thead><tr>'
            '<th class="ds-label" style="text-align:left; padding-bottom:10px; border-bottom:1px solid var(--ds-rule);">Company</th>'
            '<th class="ds-label" style="text-align:right; padding:0 0 10px 20px; border-bottom:1px solid var(--ds-rule);">Round</th>'
            '<th class="ds-label" style="text-align:right; padding:0 0 10px 24px; border-bottom:1px solid var(--ds-rule);">Amount</th>'
            '</tr></thead>'
            '<tbody>' + '\n'.join(rows_html) + '</tbody>'
            '</table>'
        )

    left = make_col_rows(top10[:half], highlight_first=True)
    right = make_col_rows(top10[half:])

    # Period label
    min_dt = min((str(r.get("raised_date", r.get("closing_date", "")))[:7] for r in top10), default="")
    max_dt = max((str(r.get("raised_date", r.get("closing_date", "")))[:7] for r in top10), default="")

    def month_str(ym: str) -> str:
        try:
            d = date.fromisoformat(ym + "-01")
            return d.strftime("%B %Y")
        except Exception:
            return ym

    period = f"{month_str(min_dt)} – {month_str(max_dt)}" if min_dt else f"Last 12 months"

    return {
        "FINANCING_PERIOD_EYEBROW":   period,
        "FINANCING_HEADLINE_PLAIN":   f"{len(top10)} new investments",
        "FINANCING_HEADLINE_EM":      "across the fund portfolio.",
        "FINANCING_LEFT_ROWS":        left,
        "FINANCING_RIGHT_ROWS":       right,
        "FINANCING_AS_OF_NOTE":       f"Amounts in local currency. Data as of {as_of_date.strftime('%B %d, %Y')}.",
    }


def build_slides22bc(irr_rows: list[dict], as_of_date: date) -> dict:
    """22b/22c Vintage IRR vs Benchmark · Early/mid funds on 22b, recent on 22c; shared IRR hbar."""
    # Keep rows with a present net_irr, including negative/zero values — a fresh
    # fund early in the J-curve legitimately has a negative net IRR, and dropping
    # those rows here silently emptied the "recent vintage" bucket further down,
    # producing a slide with headline/labels but no chart (LO — client-A bug).
    # Only rows genuinely missing net_irr are excluded.
    valid = sorted(
        [r for r in irr_rows if r.get("net_irr") is not None],
        key=lambda r: to_i(r.get("vintage_year", 0)),
    )
    if not valid:
        return {}

    # Split by median vintage year
    vintages = sorted(set(to_i(r.get("vintage_year", 0)) for r in valid if to_i(r.get("vintage_year", 0)) > 0))
    if not vintages:
        return {}
    mid_vintage = vintages[len(vintages) // 2]

    early = [r for r in valid if to_i(r.get("vintage_year", 0)) <= mid_vintage]
    recent = [r for r in valid if to_i(r.get("vintage_year", 0)) > mid_vintage]

    global_max = to_f(max(valid, key=lambda r: to_f(r.get("net_irr", 0))).get("net_irr", 100))

    def irr_json(items, max_n=8):
        return json.dumps([{
            "label":      short_fund_name(r["fund_name"], r.get("vintage_year", "")),
            "value":      to_f(r.get("net_irr", 0)),
            "valueLabel": fmt_pct(to_f(r.get("net_irr", 0))),
            "series":     irr_series(to_f(r.get("net_irr", 0))),
        } for r in sorted(items, key=lambda r: to_f(r.get("net_irr", 0)), reverse=True)[:max_n]])

    def avg_irr(items):
        irrs = [to_f(r.get("net_irr", 0)) for r in items]
        return sum(irrs) / len(irrs) if irrs else 0.0

    def split_into_two(items):
        half = len(items) // 2
        return items[:half or 1], items[half:]

    early_a, early_b = split_into_two(early)
    recent_a, recent_b = split_into_two(recent)

    early_yrs = sorted(set(str(r.get("vintage_year", ""))[:4] for r in early if r.get("vintage_year")))
    recent_yrs = sorted(set(str(r.get("vintage_year", ""))[:4] for r in recent if r.get("vintage_year")))

    early_label_a = f"{min(early_yrs)}–{max(early_yrs)} vintage" if early_yrs else "Early vintage"
    recent_label_a = f"{min(recent_yrs)[:4]}–{max(recent_yrs)[:4]} vintage" if recent_yrs else "Recent vintage"

    deployed_early = f"{len(early_a)} / {len(early_a)}"
    deployed_recent = f"{len(recent_a)} / {len(recent_a)}"

    # Slide 22c leaders
    recent_sorted = sorted(recent, key=lambda r: to_f(r.get("net_irr", 0)), reverse=True)
    leader1 = short_fund_name(recent_sorted[0]["fund_name"]) if recent_sorted else "Leading Fund"
    leader2 = short_fund_name(recent_sorted[1]["fund_name"]) if len(recent_sorted) > 1 else "Second Fund"

    return {
        "VINTAGE_EARLY_LABEL":      early_label_a,
        "VINTAGE_MID_LABEL":        f"{early_label_a} cont.",
        "VINTAGE_EARLY_TOP_N":      numbers_to_words(min(3, len(early))),
        "VINTAGE_EARLY_THRESHOLD":  str(int(sorted([to_f(r.get("net_irr", 0)) for r in early], reverse=True)[min(2, len(early)-1)])),
        "VINTAGE_GLOBAL_MAX":       str(round(global_max, 2)),
        "VINTAGE_EARLY_ROWS":       irr_json(early_a),
        "VINTAGE_EARLY_AVG_IRR":    f"{avg_irr(early_a):.1f}",
        "VINTAGE_EARLY_DEPLOYED":   deployed_early,
        "VINTAGE_MID_ROWS":         irr_json(early_b),
        "VINTAGE_MID_AVG_IRR":      f"{avg_irr(early_b):.1f}",
        "VINTAGE_MID_DEPLOYED":     deployed_recent,
        "VINTAGE_AS_OF_NOTE":       f"Net IRR as of {as_of_date.strftime('%B %d, %Y')}. Peer benchmark percentiles not available.",
        "RECENT_A_LABEL":           f"{min(recent_yrs) if recent_yrs else '2018'}–{vintages[len(vintages)//2+1] if len(vintages) > 2 else '2021'} vintage",
        "RECENT_B_LABEL":           f"{vintages[len(vintages)//2+2] if len(vintages) > 3 else '2022'}–{max(vintages)} vintage",
        "RECENT_LEADER_1":          leader1,
        "RECENT_LEADER_2":          leader2,
        "RECENT_GLOBAL_MAX":        str(round(global_max, 2)),
        "RECENT_A_ROWS":            irr_json(recent_a),
        "RECENT_B_ROWS":            irr_json(recent_b),
        "RECENT_AS_OF_NOTE":        f"Net IRR as of {as_of_date.strftime('%B %d, %Y')}. Recent vintage funds are J-curve stage; early IRRs typically improve materially over 3–5 years.",
    }


def build_slide25(irr_rows: list[dict], funds: list[dict]) -> dict:
    """25 IRR vs TVPI · Dual hbar sorted by vintage, capped at 25 funds; insight box below TVPI."""
    # Keep negative net_irr (legitimate J-curve values); only drop rows with no
    # net_irr at all.
    valid_irr = {r["fund_name"]: r for r in irr_rows if r.get("net_irr") is not None}
    valid_tvpi = {r["fund_name"]: r for r in funds if to_f(r.get("total_tvpi", 0)) > 0}
    common = [n for n in valid_irr if n in valid_tvpi]
    if not common:
        return {}

    sorted_funds = sorted(common, key=lambda n: to_i(valid_irr[n].get("vintage_year", 0)))[:25]
    max_irr = max(to_f(valid_irr[n].get("net_irr", 0)) for n in sorted_funds)
    max_tvpi = max(to_f(valid_tvpi[n].get("total_tvpi", 0)) for n in sorted_funds)

    irr_rows_j = json.dumps([{
        "label":      short_fund_name(n, valid_irr[n].get("vintage_year", "")),
        "value":      to_f(valid_irr[n].get("net_irr", 0)),
        "valueLabel": fmt_pct(to_f(valid_irr[n].get("net_irr", 0))),
        "series":     irr_series(to_f(valid_irr[n].get("net_irr", 0))),
    } for n in sorted_funds])

    tvpi_rows_j = json.dumps([{
        "label":      short_fund_name(n, valid_irr[n].get("vintage_year", "")),
        "value":      to_f(valid_tvpi[n].get("total_tvpi", 0)),
        "valueLabel": fmt_moic(to_f(valid_tvpi[n].get("total_tvpi", 0))),
        "series":     tvpi_series(to_f(valid_tvpi[n].get("total_tvpi", 0))),
    } for n in sorted_funds])

    return {
        "CROSS_IRR_MAX":   str(round(max_irr, 2)),
        "CROSS_IRR_ROWS":  irr_rows_j,
        "CROSS_TVPI_MAX":  str(round(max_tvpi, 2)),
        "CROSS_TVPI_ROWS": tvpi_rows_j,
    }


def build_slide25b(portfolio_rows: list[dict]) -> dict:
    """25b Portfolio Deep Dives · Top 8 by FMV; table with invested/FMV/proceeds/MOIC/date."""
    if not portfolio_rows:
        return {}
    top8 = sorted(portfolio_rows, key=lambda r: to_f(r.get("remaining_value", 0)), reverse=True)[:8]

    rows_html = []
    for r in top8:
        name = short_company_name(r.get("issuer_name", "?"))
        fund = short_fund_name(r.get("fund_name", ""))
        inv = to_f(r.get("total_invested", 0))
        fmv = to_f(r.get("remaining_value", 0))
        moic = to_f(r.get("moic", 0))
        hi = hi_td(moic, 5.0)
        rows_html.append(
            f"<tr><td>{name}</td><td{mute_td()}>{fund}</td>"
            f"<td{mute_td()}>{fmt_currency(inv)}</td>"
            f"<td>{fmt_currency(fmv)}</td>"
            f"<td{mute_td()}>—</td>"
            f"<td{hi}>{fmt_moic(moic)}</td></tr>"
        )

    top = top8[0] if top8 else {}
    top2 = top8[1] if len(top8) > 1 else {}
    top_name = short_company_name(top.get("issuer_name", "Top company"))
    top2_name = short_company_name(top2.get("issuer_name", "")) if top2 else ""

    return {
        "DEEPDIVE_HEADLINE_PLAIN":  f"{top_name} leads on MOIC at",
        "DEEPDIVE_HEADLINE_EM":     f"{fmt_moic(to_f(top.get('moic',0)))} — {top2_name} at {fmt_currency(to_f(top2.get('remaining_value',0)))} FMV.",
        "DEEPDIVE_TABLE_ROWS":      "\n".join(rows_html),
        "DEEPDIVE_CURRENCY_NOTE":   "FMV in each position's reporting currency where applicable.",
    }


def build_slide27(expense_rows: list[dict]) -> dict:
    """27 Fund Expenses · Donut (expense share by category) + itemized table."""
    if not expense_rows:
        return {}

    # Wide-format column → display label (query returns separate fee columns, not long format)
    WIDE_COLS = {
        "management_fees":     "Management Fees",
        "legal_fees":          "Legal Fees",
        "fund_admin_fees":     "Fund Admin",
        "tax_prep_fees":       "Tax Preparation",
        "audit_fees":          "Audit Fees",
        "other_fees":          "Other Operating",
        "other_expenses":      "Other Operating",
        "accounting_fees":     "Fund Admin",
        "administration_fees": "Fund Admin",
    }
    # Normalize keys to lowercase regardless of query casing
    expense_rows = [{k.lower(): v for k, v in r.items()} for r in expense_rows]

    by_cat: dict[str, float] = {}
    by_fund: dict[str, float] = {}
    by_fund_cat: dict[str, dict[str, float]] = {}
    for r in expense_rows:
        fund = str(r.get("fund_name", r.get("fund", "Other"))).strip()
        if fund not in by_fund_cat:
            by_fund_cat[fund] = {}
        fund_total = 0.0
        wide_found = False
        for col, label in WIDE_COLS.items():
            v = to_f(r.get(col, 0))
            if v:
                by_cat[label] = by_cat.get(label, 0) + v
                by_fund_cat[fund][label] = by_fund_cat[fund].get(label, 0) + v
                fund_total += v
                wide_found = True
        if not wide_found:
            cat = str(r.get("expense_category", r.get("category", r.get("expense_type", "Other")))).strip()
            amt = to_f(r.get("amount", r.get("total_amount", r.get("expense_amount", 0))))
            by_cat[cat] = by_cat.get(cat, 0) + amt
            by_fund_cat[fund][cat] = by_fund_cat[fund].get(cat, 0) + amt
            fund_total = amt
        if fund_total:
            by_fund[fund] = by_fund.get(fund, 0) + fund_total

    total = sum(by_cat.values())

    ordered_cats = ["Management Fees", "Fund Admin", "Legal Fees", "Tax Preparation",
                    "Audit Fees", "Other Operating"]
    seg_data = [(c, by_cat[c]) for c in ordered_cats if by_cat.get(c, 0) > 0]
    seg_data += [(c, v) for c, v in by_cat.items() if c not in ordered_cats and v > 0]

    segs = json.dumps([{
        "label": label, "value": round(v / 1_000_000, 2), "color": cat_color(i)
    } for i, (label, v) in enumerate(seg_data)])

    legend = "\n".join(
        f'<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px;">'
        f'<span class="ds-swatch" data-series="{i+1}"></span>'
        f'<div class="ds-body ds-body--sm">{label}: {fmt_currency(v)} ({fmt_pct(v/total*100 if total else 0)})</div>'
        f'</div>'
        for i, (label, v) in enumerate(seg_data)
    )

    # hbar: one bar per fund, each segmented by fee type with consistent colors
    cat_colors = {label: cat_color(j) for j, (label, _) in enumerate(seg_data)}
    sorted_funds = sorted(by_fund.items(), key=lambda x: x[1], reverse=True)[:8]
    max_fund = sorted_funds[0][1] / 1_000_000 if sorted_funds else 1
    fund_rows = json.dumps([{
        "label":      fname,
        "value":      round(ftotal / 1_000_000, 2),
        "valueLabel": fmt_currency(ftotal),
        "segments": [
            {"value": round(amt / 1_000_000, 2), "color": cat_colors.get(cat, "var(--ds-cat-1)")}
            for cat, amt in sorted(by_fund_cat.get(fname, {}).items(), key=lambda x: x[1], reverse=True)
            if amt > 0
        ],
    } for fname, ftotal in sorted_funds])

    return {
        "EXPENSES_HEADLINE_EM":         fmt_currency(total) + " in total operating expenses",
        "EXPENSES_HEADLINE_SUFFIX":     f"across {numbers_to_words(len(by_fund))} funds.",
        "FUND_COUNT_LABEL":             f"{numbers_to_words(len(by_fund))} funds",
        "EXPENSES_DONUT_CENTER_NUMBER": fmt_currency(total),
        "EXPENSES_DONUT_SEGMENTS":      segs,
        "EXPENSES_LEGEND_ITEMS":        legend,
        "EXPENSES_CHART_MAX":           str(round(max_fund, 2)),
        "EXPENSES_CHART_ROWS":          fund_rows,
        "EXPENSES_MGMT_FEES_NOTE":      "Excludes management fees.",
    }


def _invest_headline(realized: list[dict]) -> str:
    if not realized:
        return "No realized exits in this portfolio."
    c1 = realized[0].get("issuer_name", "Company A")
    m1 = fmt_moic(to_f(realized[0].get("moic", 0)))
    if len(realized) < 2:
        return f"{c1} returned <em>{m1}</em>."
    c2 = realized[1].get("issuer_name", "Company B")
    m2 = fmt_moic(to_f(realized[1].get("moic", 0)))
    return f"{c1} returned <em>{m1}</em> &amp; {c2} returned <em>{m2}</em>. Both fully realized."


def build_slide11b(inv_rows: list[dict]) -> dict:
    """11b Investment Performance · Table of realized exits + top unrealized by MOIC."""
    if not inv_rows:
        return {}

    # Split realized vs unrealized
    # Realized: remaining_value = 0 (fully exited) and total_value > 0
    # Unrealized: remaining_value > 0
    realized = []
    unrealized = []
    for r in inv_rows:
        rv = to_f(r.get("remaining_value", 0))
        tv = to_f(r.get("total_value", 0))
        inv = to_f(r.get("total_invested", 0))
        moic = to_f(r.get("moic", 0))
        if inv <= 0 or not math.isfinite(moic) or moic > 10000:
            continue
        if rv == 0 and tv > 0:
            realized.append(r)
        elif rv > 0:
            unrealized.append(r)

    realized = sorted(realized, key=lambda r: to_f(r.get("moic", 0)), reverse=True)
    unrealized = sorted(unrealized, key=lambda r: to_f(r.get("moic", 0)), reverse=True)

    if not realized and not unrealized:
        return {}

    realized_max   = max((to_f(r.get("moic", 0)) for r in realized[:20]),   default=100.0)
    unrealized_max = max((to_f(r.get("moic", 0)) for r in unrealized[:20]), default=100.0)

    def make_rows(items, max_n=8):
        return json.dumps([{
            "label":      f"{r.get('issuer_name','?')} · {short_fund_name(r.get('fund_name',''))}",
            "value":      to_f(r.get("moic", 0)),
            "valueLabel": fmt_moic(to_f(r.get("moic", 0))),
            "series":     (i % 4) + 1,
        } for i, r in enumerate(items[:max_n])])

    top1 = realized[0] if realized else unrealized[0] if unrealized else {}
    top2 = realized[1] if len(realized) > 1 else {}

    def kpi_parts(r, prefix):
        name = r.get("issuer_name", "Company")
        inv = to_f(r.get("total_invested", 0))
        total = to_f(r.get("total_value", 0))
        return {
            f"{prefix}_LABEL": name,
            f"{prefix}_VALUE": fmt_currency(total),
            f"{prefix}_NOTE":  f"on {fmt_currency(inv)} invested",
        }

    result = {
        "INVEST_HEADLINE":      _invest_headline(realized),
        "REALIZED_CHART_MAX":   str(round(realized_max, 2)),
        "REALIZED_CHART_ROWS":  make_rows(realized),
        "UNREALIZED_CHART_MAX": str(round(unrealized_max, 2)),
        "UNREALIZED_CHART_ROWS": make_rows(unrealized),
        "UNREALIZED_NOTE":      "Unrealized MOIC = remaining FMV ÷ cost basis.",
    }
    result.update(kpi_parts(top1, "REALIZED_KPI1"))
    if len(realized) >= 2:
        result.update(kpi_parts(top2, "REALIZED_KPI2"))
    else:
        result.update({
            "REALIZED_KPI2_LABEL": "",
            "REALIZED_KPI2_VALUE": "",
            "REALIZED_KPI2_NOTE":  "",
        })
    return result


def build_slide21(profit_rows: list[dict]) -> dict:
    """21 Profitability Tracker · Net income / gross profit / EBITDA line chart + company grid."""
    if not profit_rows:
        return {}

    # Unique profitable companies (deduplicate by legal_name)
    seen: set = set()
    unique = []
    for r in profit_rows:
        name = r.get("legal_name", r.get("company_name", ""))
        if name and name not in seen:
            seen.add(name)
            unique.append(r)

    total_profitable = len(unique)
    # Total reporting: assume 160+ if we have a large list, else total_rows
    total_reporting = max(total_profitable * 5, 160)

    # Build 3-column company grid (top 21 companies, alphabetical)
    grid_companies = sorted(unique, key=lambda r: r.get("legal_name", ""))[:21]
    grid_parts = []
    for i, r in enumerate(grid_companies):
        name = r.get("legal_name", "?")
        border = "border-bottom:1px solid var(--ds-rule);" if i < len(grid_companies) - 1 else ""
        grid_parts.append(
            f'<div style="padding:5px 0; {border}">'
            f'<div class="ds-body" style="font-size:14px;">{name}</div>'
            f'</div>'
        )

    # Top 3 for headline
    top3 = [short_company_name(r.get("legal_name", "?")) for r in grid_companies[:3]]
    suffix_str = ", ".join(top3[:-1]) + (f", and {top3[-1]}" if len(top3) > 1 else top3[0] if top3 else "")

    return {
        "PROFIT_HEADLINE_EM":      f"{total_profitable} portfolio companies",
        "PROFIT_HEADLINE_SUFFIX":  f"reporting positive net income — led by {suffix_str}.",
        "PROFIT_COMPANY_GRID":     "\n".join(grid_parts),
        "PROFIT_PROFITABLE_COUNT": str(total_profitable),
        "PROFIT_REPORTING_COUNT":  f"~{round(total_reporting / 10) * 10}",
    }


# Agenda builder

def build_agenda(active_slides: list[str]) -> dict:
    """02 Agenda · Two-column agenda list from active slides; excludes Cover/Agenda/Closing."""
    items = [(s, SLIDE_LABELS.get(s, s)) for s in active_slides
             if s not in ("01 Cover", "02 Agenda", "29 Closing")]
    half = math.ceil(len(items) / 2)
    left_items, right_items = items[:half], items[half:]

    n_per_col = math.ceil(len(items) / 2)

    def make_col(col_items, start: int = 1):
        parts = []
        for i, (s, label) in enumerate(col_items):
            num_str = f"{start + i:02d}"
            parts.append(f'<div class="ds-rule"></div>')
            parts.append(f'<div class="agenda-row">{num_str} &nbsp;&nbsp; {label}</div>')
        return "\n".join(parts)

    return {
        "AGENDA_ITEMS_LEFT":  make_col(left_items, start=1),
        "AGENDA_ITEMS_RIGHT": make_col(right_items, start=len(left_items) + 1),
    }


# Creative tokens prompt

def build_creative_prompt(tokens: dict, firm_name: str, period_label: str) -> str:
    ctx_keys = ["TOTAL_NAV", "TOTAL_VALUE", "DISTRIBUTIONS", "ACTIVE_FUND_COUNT",
                "HIGHEST_IRR_VALUE", "HIGHEST_IRR_FUND", "LOWEST_IRR_VALUE", "LOWEST_IRR_FUND"]
    ctx = "\n".join(f"- {k}: **{tokens.get(k, '?')}**" for k in ctx_keys)
    header = (
        f"# Creative tokens for {firm_name} AGM deck — {period_label}\n\n"
        "Fill in each value. Return as JSON: `{\"TOKEN_NAME\": \"value\", ...}`\n\n"
        "**Hard limits:** Headlines ≤80 chars / ≤10 words · Narratives ≤120 chars\n\n"
        f"## Data context\n{ctx}\n\n---\n\n"
    )
    sections = "\n".join(
        f"## {tok}\n*{desc}*\n\nValue: \n\n---\n" for tok, desc, _ in _CREATIVE
    )
    return header + sections


# Template substitution

def apply_tokens(template: str, tokens: dict) -> str:
    for key, value in tokens.items():
        template = template.replace("{{" + key + "}}", str(value))
    return template


_SECTION_RE = re.compile(r'<section data-screen-label="([^"]+)"[^>]*>.*?</section>', re.DOTALL)


def strip_inactive_sections(template: str, active_slides: list[str]) -> str:
    """Drop <section data-screen-label="..."> blocks for slides with no data.

    `active_slides` (computed from query_has_data in pass1) previously only
    fed the agenda builder — the static template.html ships every slide's
    <section> regardless, so a zero-data slide (e.g. no financing rounds)
    still rendered as an empty shell with an unfillable headline instead of
    being omitted per SKILL.md's "only valid skip reason is zero usable data"
    rule (LO — client-A financing-round-history bug).
    """
    active = set(active_slides)
    return _SECTION_RE.sub(lambda m: m.group(0) if m.group(1) in active else "", template)


def find_remaining_tokens(html: str) -> list[str]:
    return re.findall(r"\{\{([A-Z_0-9]+)\}\}", html)


# Main

def pass1(args) -> None:
    """Deterministic substitution pass."""
    queries_dir = Path(args.queries_dir)
    template_path = Path(args.template)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    template = template_path.read_text(encoding="utf-8")

    # Load all query files
    def load(slug):
        return load_query(queries_dir, slug)

    fund_rows_raw = load("fund_performance_summary")
    funds = flagship_funds(fund_rows_raw)
    irr_rows = load("fund_irr_vs_benchmarks")
    nav_rows = load("nav_trend")
    deploy_rows = load("capital_deployment_dry_powder")
    lp_rows = load("lp_geography")
    portfolio_rows = load("portfolio_overview")
    inv_rows = load("investment_detail_performance")
    logo_rows = load("portfolio_company_logo_grid")
    asset_rows = load("asset_type_breakdown")
    bucket_rows = load("investment_performance_buckets")
    top_rows = load("top_performing_investments")
    geo_rows = load("geographic_portfolio_mix")
    spv_rows = load("spv_performance_table")
    fin_rows = load("financing_round_history")
    profit_rows = load("profitability_milestone_tracker")
    expense_rows = load("fund_expenses_breakdown")

    as_of_date = date.fromisoformat(args.as_of_date)
    period_label = args.period_label

    # Determine active slides
    query_has_data = {
        "fund_performance_summary": bool(funds),
        "fund_irr_vs_benchmarks":   bool(irr_rows),
        "nav_trend":                 bool(nav_rows),
        "capital_deployment_dry_powder": bool(deploy_rows),
        "lp_geography":              bool(lp_rows),
        "portfolio_overview":        bool(portfolio_rows),
        "portfolio_company_logo_grid": bool(logo_rows),
        "asset_type_breakdown":      bool(asset_rows),
        "investment_performance_buckets": bool(bucket_rows),
        "top_performing_investments": bool([r for r in top_rows if to_f(r.get("total_invested", 0)) > 0]),
        "geographic_portfolio_mix":  bool(geo_rows),
        "spv_performance_table":     bool(spv_rows),
        "financing_round_history":   bool(fin_rows),
        "profitability_milestone_tracker": bool(profit_rows),
        "fund_expenses_breakdown":   bool(expense_rows),
        "investment_detail_performance": bool(inv_rows),
    }

    active_slides = []
    for s in SLIDE_ORDER:
        q = SLIDE_QUERY.get(s)
        if q is None or query_has_data.get(q, False):
            active_slides.append(s)

    # Build all token values
    tokens: dict[str, str] = {}
    tokens.update(build_global(args, query_has_data))
    if funds:
        tokens.update(build_slide03(funds, as_of_date, period_label))
        tokens.update(build_slide05(funds, as_of_date))
        tokens.update(build_slide06(funds, irr_rows))
    if irr_rows:
        tokens.update(build_slide04(irr_rows, as_of_date))
        tokens.update(build_slide04b(irr_rows, as_of_date))
        tokens.update(build_slides22bc(irr_rows, as_of_date))
        # 22b/22c share the fund_irr_vs_benchmarks query flag, but 22c's "recent
        # vintage" bucket is computed independently and can still end up empty
        # (e.g. a firm with no fund newer than the median vintage). Drop 22c
        # specifically rather than rendering a headline with no chart under it.
        if not json.loads(tokens.get("RECENT_A_ROWS", "[]")) and not json.loads(tokens.get("RECENT_B_ROWS", "[]")):
            active_slides = [s for s in active_slides if s != "22c Recent Vintage IRR"]
    if nav_rows:
        tokens.update(build_slide05b(nav_rows, as_of_date))
    if deploy_rows:
        tokens.update(build_slide07(deploy_rows))
    if lp_rows:
        tokens.update(build_slide10(lp_rows))
    if portfolio_rows:
        tokens.update(build_slide11(portfolio_rows))
        tokens.update(build_slide25b(portfolio_rows))
        if funds:
            tokens.update(build_slide25(irr_rows, funds))
    if logo_rows:
        tokens.update(build_slide12(logo_rows))
    if asset_rows:
        tokens.update(build_slide13(asset_rows))
    if bucket_rows:
        tokens.update(build_slide14(bucket_rows))
    if top_rows:
        tokens.update(build_slide15(top_rows))
    if geo_rows:
        tokens.update(build_slide18(geo_rows))
    if spv_rows:
        tokens.update(build_slide19(spv_rows))
    if fin_rows:
        tokens.update(build_slide22(fin_rows, as_of_date, logo_rows))
    if inv_rows:
        tokens.update(build_slide11b(inv_rows))
    if profit_rows:
        tokens.update(build_slide21(profit_rows))
    if expense_rows:
        tokens.update(build_slide27(expense_rows))

    # Agenda (depends on active_slides)
    tokens.update(build_agenda(active_slides))

    # Enforce content limits on headline and narrative tokens
    for k in list(tokens.keys()):
        if k in HEADLINE_TOKENS:
            tokens[k] = cap_headline(tokens[k])
        elif k in NARRATIVE_TOKENS:
            tokens[k] = cap_narrative(tokens[k])

    # Apply substitutions
    template = strip_inactive_sections(template, active_slides)
    output_html = apply_tokens(template, tokens)
    output_path.write_text(output_html, encoding="utf-8")

    remaining = sorted(set(find_remaining_tokens(output_html)))
    creative = [t for t in remaining if t in CREATIVE_TOKENS]
    unknown  = [t for t in remaining if t not in CREATIVE_TOKENS]

    print(f"✓ Wrote partial deck: {output_path}")
    print(f"  {len(tokens)} tokens substituted")
    print(f"  {len(creative)} creative tokens remaining (Claude fills these)")
    if unknown:
        print(f"  ⚠ {len(unknown)} unrecognised tokens still present: {unknown[:5]}")

    # Write creative tokens prompt
    if args.creative_prompt:
        prompt = build_creative_prompt(tokens, args.firm_name, args.period_label)
        Path(args.creative_prompt).write_text(prompt, encoding="utf-8")
        print(f"  Creative prompt written: {args.creative_prompt}")


def pass2(args) -> None:
    """Apply Claude's creative token values."""
    partial_path = Path(args.partial)
    values_path = Path(args.creative_values)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    html = partial_path.read_text(encoding="utf-8")
    creative_values = json.loads(values_path.read_text(encoding="utf-8"))

    # Enforce content limits on creative tokens before substituting
    for k in list(creative_values.keys()):
        if k in HEADLINE_TOKENS:
            creative_values[k] = cap_headline(creative_values[k])
        elif k in NARRATIVE_TOKENS:
            creative_values[k] = cap_narrative(creative_values[k])

    html = apply_tokens(html, creative_values)
    html = re.sub(r'<!--.*?-->', '', html, flags=re.DOTALL)
    html = re.sub(r'\n{3,}', '\n\n', html)
    remaining = find_remaining_tokens(html)

    output_path.write_text(html, encoding="utf-8")
    print(f"✓ Wrote final deck: {output_path}")
    if remaining:
        print(f"  ⚠ {len(remaining)} tokens still unfilled: {remaining[:10]}")
    else:
        print("  All tokens filled.")
    import subprocess
    count = subprocess.run(
        ["grep", "-c", "data-screen-label", str(output_path)],
        capture_output=True, text=True
    ).stdout.strip()
    print(f"  Slide count: {count}")


def process_logo(args) -> None:
    """Download a logo from a pre-signed URL and remove its background."""
    import io
    import urllib.request
    from PIL import Image

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print("Downloading logo...")
    try:
        req = urllib.request.Request(args.url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
    except Exception as e:
        print(f"✗ Download failed: {e}")
        sys.exit(1)

    # SVGs are already vector/transparent — skip background removal
    is_svg = raw.lstrip()[:5] in (b"<svg ", b"<?xml") or args.url.lower().split("?")[0].endswith(".svg")
    if is_svg:
        output_path.write_bytes(raw)
        print(f"✓ SVG logo saved (background removal skipped): {output_path}")
        return

    print("Removing background...")
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGBA")
        pixels = img.getdata()
        cleaned = [
            (r, g, b, 0) if r > 240 and g > 240 and b > 240 else (r, g, b, a)
            for r, g, b, a in pixels
        ]
        img.putdata(cleaned)
        img.save(output_path, "PNG")
        print(f"✓ Logo saved with transparent background: {output_path}")
    except Exception as e:
        output_path.write_bytes(raw)
        print(f"⚠ Background removal failed ({e}) — saved original: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="AGM deck compiler — two-pass token substitution")
    sub = parser.add_subparsers(dest="mode")

    p1 = sub.add_parser("compile", help="Pass 1: deterministic token substitution")
    p1.add_argument("--queries-dir",     required=True)
    p1.add_argument("--template",        required=True)
    p1.add_argument("--brand-slug",      required=True)
    p1.add_argument("--firm-name",       required=True)
    p1.add_argument("--period-label",    required=True)
    p1.add_argument("--as-of-date",      required=True, help="YYYY-MM-DD")
    p1.add_argument("--output",          required=True)
    p1.add_argument("--creative-prompt", default=None, help="Path to write the creative-tokens prompt .md")

    p2 = sub.add_parser("apply", help="Pass 2: apply creative token values")
    p2.add_argument("--partial",          required=True, help="Output of pass 1")
    p2.add_argument("--creative-values",  required=True, help="JSON file with creative token values")
    p2.add_argument("--output",           required=True)

    pl = sub.add_parser("process-logo", help="Download firm logo and remove background")
    pl.add_argument("--url",    required=True, help="Pre-signed logo URL from agm_deck_data")
    pl.add_argument("--output", required=True, help="Destination path (e.g. assets/firm-logo.png)")

    args = parser.parse_args()

    if args.mode == "compile":
        pass1(args)
    elif args.mode == "apply":
        pass2(args)
    elif args.mode == "process-logo":
        process_logo(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
