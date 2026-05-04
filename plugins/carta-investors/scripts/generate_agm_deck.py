"""
Generate a branded AGM (Annual General Meeting) presentation PDF.

Takes two JSON inputs:
  1. Brand data  — output of analyze_website.py (colors, typography, logos)
  2. Fund data   — fund metrics, portfolio, capital activity, etc.

Usage:
  uv run generate_agm_deck.py <brand.json> <fund_data.json> [output.pdf]

Or from Claude, call programmatically:
  generate_agm_deck(brand_data, fund_data, "output.pdf")

The deck adapts all colors, accents, and typography to whatever brand
identity was extracted — it is NOT hard-coded to any specific firm.
"""
# /// script
# requires-python = ">=3.11"
# dependencies = ["reportlab"]
# ///
from __future__ import annotations

import json
import sys

from reportlab.lib.pagesizes import landscape, A4
from reportlab.lib.colors import HexColor, Color, white
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import Table, TableStyle

PAGE_W, PAGE_H = landscape(A4)
MARGIN = 50

FONT_HEADING = "Helvetica-Bold"
FONT_BODY = "Helvetica"
FONT_MONO = "Courier"


# ── Brand theme resolution ───────────────────────────────────────────────────

class Theme:
    """Resolved brand theme from analyze_website.py output."""

    def __init__(self, brand_data: dict) -> None:
        palette = brand_data.get("brand_palette", {})
        colors = brand_data.get("colors", [])

        self.firm_name = brand_data.get("firm_name", brand_data.get("title", ""))
        self.website_url = brand_data.get("url", brand_data.get("website_url", ""))

        self.primary = self._pick(palette, "primary", colors, "#1a1a1a")
        self.secondary = self._pick(palette, "secondary", colors, "#444444")
        self.accent = self._pick(palette, "accent", colors, "#0066cc")
        self.text = self._pick(palette, "text", colors, "#333333")
        self.bg_light = self._pick(palette, "background", colors, "#fafafa")
        self.neutral = self._pick(palette, "neutral", colors, "#222222")

        self.primary_c = HexColor(self.primary)
        self.secondary_c = HexColor(self.secondary)
        self.accent_c = HexColor(self.accent)
        self.text_c = HexColor(self.text)
        self.bg_light_c = HexColor(self.bg_light)
        self.neutral_c = HexColor(self.neutral)

        self.gray_100 = HexColor("#FAFAFA")
        self.gray_300 = HexColor("#DDDDDD")
        self.gray_500 = HexColor("#979797")
        self.gray_700 = HexColor("#333333")
        self.gray_900 = HexColor("#222222")

    @staticmethod
    def _pick(palette: dict, group: str, colors: list, fallback: str) -> str:
        items = palette.get(group, [])
        if items:
            return items[0].get("hex", fallback)
        for c in colors:
            if c.get("role") == group:
                return c.get("hex", fallback)
        return fallback


# ── Drawing helpers ──────────────────────────────────────────────────────────

def _wrap_text(text: str, font: str, size: int, max_width: float) -> list[str]:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        test = f"{current} {word}".strip()
        if stringWidth(test, font, size) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def _draw_page_bg(c: Canvas, t: Theme, dark: bool = False) -> None:
    if dark:
        c.setFillColor(t.secondary_c)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        # Darker band at bottom
        r, g, b = t.secondary_c.red, t.secondary_c.green, t.secondary_c.blue
        c.setFillColor(Color(r * 0.7, g * 0.7, b * 0.7))
        c.rect(0, 0, PAGE_W, PAGE_H * 0.3, fill=1, stroke=0)
    else:
        c.setFillColor(white)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)


def _draw_top_bar(c: Canvas, t: Theme) -> None:
    c.setFillColor(t.secondary_c)
    c.rect(0, PAGE_H - 6, PAGE_W, 6, fill=1, stroke=0)
    c.setFillColor(t.primary_c)
    c.rect(0, PAGE_H - 6, PAGE_W * 0.3, 6, fill=1, stroke=0)


def _draw_footer(c: Canvas, t: Theme, page_num: int, total: int,
                 firm_name: str, dark: bool = False) -> None:
    color = Color(1, 1, 1, 0.4) if dark else t.gray_500
    c.setFillColor(color)
    c.setFont(FONT_BODY, 7)
    c.drawString(MARGIN, 25, f"{firm_name}  |  Annual General Meeting  |  Confidential")
    c.drawRightString(PAGE_W - MARGIN, 25, f"{page_num} / {total}")
    line_color = Color(1, 1, 1, 0.1) if dark else t.gray_300
    c.setStrokeColor(line_color)
    c.line(MARGIN, 38, PAGE_W - MARGIN, 38)


def _draw_section_label(c: Canvas, t: Theme, y: float, label: str) -> float:
    c.setFont(FONT_HEADING, 8)
    c.setFillColor(t.primary_c)
    c.drawString(MARGIN, y, label.upper())
    return y - 24


def _draw_heading(c: Canvas, t: Theme, y: float, text: str, size: int = 28) -> float:
    c.setFont(FONT_HEADING, size)
    c.setFillColor(t.secondary_c)
    c.drawString(MARGIN, y, text)
    return y - size - 8


def _draw_kpi_card(c: Canvas, t: Theme, x: float, y: float, w: float, h: float,
                   value: str, label: str, accent: bool = False) -> None:
    bg = t.secondary_c if accent else t.gray_100
    c.setFillColor(bg)
    c.roundRect(x, y, w, h, 6, fill=1, stroke=0)

    text_color = white if accent else t.secondary_c
    label_color = Color(1, 1, 1, 0.6) if accent else t.gray_500

    c.setFont(FONT_HEADING, 22)
    c.setFillColor(text_color)
    c.drawString(x + 16, y + h - 38, value)

    c.setFont(FONT_BODY, 9)
    c.setFillColor(label_color)
    c.drawString(x + 16, y + 12, label)


def _draw_table(c: Canvas, t: Theme, x: float, y: float,
                data: list[list[str]], col_widths: list[float]) -> float:
    table = Table(data, colWidths=col_widths)
    stripe_bg = HexColor("#F7F9FC")

    style_commands: list = [
        ("FONTNAME", (0, 0), (-1, 0), FONT_HEADING),
        ("FONTSIZE", (0, 0), (-1, 0), 8),
        ("FONTNAME", (0, 1), (-1, -1), FONT_BODY),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("BACKGROUND", (0, 0), (-1, 0), t.secondary_c),
        ("TEXTCOLOR", (0, 1), (-1, -1), t.gray_900),
        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
        ("ALIGN", (0, 0), (0, -1), "LEFT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("LINEBELOW", (0, 0), (-1, 0), 0.5, t.primary_c),
        ("LINEBELOW", (0, -1), (-1, -1), 0.5, t.gray_300),
        ("GRID", (0, 0), (-1, -1), 0.25, t.gray_300),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_commands.append(("BACKGROUND", (0, i), (-1, i), stripe_bg))

    table.setStyle(TableStyle(style_commands))
    tw, th = table.wrap(0, 0)
    table.drawOn(c, x, y - th)
    return y - th - 16


def _scale_cols(specs: list[float]) -> list[float]:
    total = sum(specs)
    available = PAGE_W - 2 * MARGIN
    return [w * available / total for w in specs]


# ── Section numbering (populated at render time) ────────────────────────────

_SECTION_NUMS: dict = {}
_ACTIVE_LABELS: list[str] = []


def _section_label(slide_fn) -> str:
    num = _SECTION_NUMS.get(slide_fn)
    if num is None:
        return SLIDE_LABELS.get(slide_fn, "")
    return f"{num:02d}  {SLIDE_LABELS[slide_fn]}"


# ── Slide builders ───────────────────────────────────────────────────────────

def _slide_cover(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t, dark=True)

    c.setFillColor(t.primary_c)
    c.rect(MARGIN, PAGE_H * 0.52, 60, 4, fill=1, stroke=0)

    c.setFont(FONT_HEADING, 42)
    c.setFillColor(white)
    c.drawString(MARGIN, PAGE_H * 0.52 - 52, "Annual General Meeting")

    fund_name = fd.get("fund_name", "Fund")
    c.setFont(FONT_BODY, 18)
    c.setFillColor(t.primary_c)
    c.drawString(MARGIN, PAGE_H * 0.52 - 82, fund_name)

    as_of = fd.get("as_of_date", "")
    c.setFont(FONT_BODY, 13)
    c.setFillColor(Color(1, 1, 1, 0.5))
    c.drawString(MARGIN, PAGE_H * 0.52 - 112, f"{as_of}  |  Confidential" if as_of else "Confidential")

    firm = t.firm_name or fd.get("firm_name", "")
    c.setFont(FONT_HEADING, 14)
    c.setFillColor(Color(1, 1, 1, 0.25))
    c.drawString(MARGIN, 50, firm.upper())

    _draw_footer(c, t, page, total, firm, dark=True)


def _slide_agenda(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, "Overview")
    y = _draw_heading(c, t, y, "Agenda")
    y -= 16

    agenda = fd.get("agenda", _ACTIVE_LABELS if _ACTIVE_LABELS else [
        "Fund Performance Summary",
        "Portfolio Overview & Key Metrics",
        "Capital Activity & Cash Flows",
        "Top Performing Investments",
        "Market Outlook & Strategy",
        "Q&A",
    ])
    for i, item in enumerate(agenda, 1):
        c.setFont(FONT_HEADING, 24)
        c.setFillColor(t.primary_c)
        c.drawString(MARGIN, y, f"{i:02d}")
        c.setFont(FONT_BODY, 14)
        c.setFillColor(t.gray_900)
        c.drawString(MARGIN + 50, y + 2, item)
        c.setStrokeColor(t.gray_300)
        c.line(MARGIN, y - 12, PAGE_W - MARGIN, y - 12)
        y -= 42

    _draw_footer(c, t, page, total, firm)


def _slide_fund_performance(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_fund_performance))
    y = _draw_heading(c, t, y, "Fund Performance Summary", size=24)
    y -= 8

    kpis = fd.get("kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 0))
        y -= card_h + 24

    perf = fd.get("performance_table", {})
    if perf:
        headers = perf.get("headers", [])
        rows = perf.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([130] + [85] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    disclaimer = fd.get("performance_disclaimer", "")
    if disclaimer:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, disclaimer)

    _draw_footer(c, t, page, total, firm)


def _slide_portfolio(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_portfolio))
    y = _draw_heading(c, t, y, "Portfolio Companies", size=24)
    y -= 4

    portfolio = fd.get("portfolio_table", {})
    if portfolio:
        headers = portfolio.get("headers", [])
        rows = portfolio.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("portfolio_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_capital_activity(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_capital_activity))
    y = _draw_heading(c, t, y, "Capital Activity & Cash Flows", size=24)
    y -= 4

    cap_kpis = fd.get("capital_kpis", [])
    if cap_kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(cap_kpis) - 1) * 16) / len(cap_kpis)
        card_h = 65
        for i, kpi in enumerate(cap_kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 1))
        y -= card_h + 24

    cap_table = fd.get("capital_table", {})
    if cap_table:
        headers = cap_table.get("headers", [])
        rows = cap_table.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([110] + [100] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("capital_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_top_investments(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_top_investments))
    y = _draw_heading(c, t, y, "Top Performing Investments", size=24)
    y -= 4

    top_table = fd.get("top_investments_table", {})
    if top_table:
        headers = top_table.get("headers", [])
        rows = top_table.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([35, 90, 85, 55, 70, 80, 55, 65][:len(headers)])
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("top_investments_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_outlook(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_outlook))
    y = _draw_heading(c, t, y, "Market Outlook & Strategy", size=24)
    y -= 12

    themes = fd.get("outlook_themes", [])
    for item in themes:
        title = item.get("title", "")
        desc = item.get("description", "")

        c.setFillColor(t.primary_c)
        c.circle(MARGIN + 5, y + 4, 4, fill=1, stroke=0)

        c.setFont(FONT_HEADING, 13)
        c.setFillColor(t.secondary_c)
        c.drawString(MARGIN + 20, y, title)
        y -= 18

        c.setFont(FONT_BODY, 10)
        c.setFillColor(t.gray_700)
        max_w = PAGE_W - 2 * MARGIN - 20
        lines = _wrap_text(desc, FONT_BODY, 10, max_w)
        for line in lines:
            c.drawString(MARGIN + 20, y, line)
            y -= 14
        y -= 18

    _draw_footer(c, t, page, total, firm)


def _slide_fund_overview(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_fund_overview))
    y = _draw_heading(c, t, y, "Fund Overview", size=24)
    y -= 8

    kpis = fd.get("fund_overview_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 0))
        y -= card_h + 24

    summary = fd.get("fund_overview_summary", "")
    if summary:
        c.setFont(FONT_BODY, 10)
        c.setFillColor(t.gray_700)
        max_w = PAGE_W - 2 * MARGIN
        lines = _wrap_text(summary, FONT_BODY, 10, max_w)
        for line in lines:
            c.drawString(MARGIN, y, line)
            y -= 14

    _draw_footer(c, t, page, total, firm)


def _slide_benchmarks(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_benchmarks))
    y = _draw_heading(c, t, y, "Performance Benchmarks", size=24)
    y -= 8

    kpis = fd.get("benchmark_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 0))
        y -= card_h + 24

    table_data = fd.get("benchmark_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([130] + [85] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("benchmark_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_nav_bridge(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_nav_bridge))
    y = _draw_heading(c, t, y, "NAV Bridge", size=24)
    y -= 4

    table_data = fd.get("nav_bridge_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("nav_bridge_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_sector_allocation(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_sector_allocation))
    y = _draw_heading(c, t, y, "Sector Allocation", size=24)
    y -= 8

    kpis = fd.get("sector_allocation_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 0))
        y -= card_h + 24

    table_data = fd.get("sector_allocation_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    _draw_footer(c, t, page, total, firm)


def _slide_vintage_allocation(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_vintage_allocation))
    y = _draw_heading(c, t, y, "Vintage Allocation", size=24)
    y -= 4

    table_data = fd.get("vintage_allocation_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("vintage_allocation_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_realized(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_realized))
    y = _draw_heading(c, t, y, "Realized Investments", size=24)
    y -= 8

    kpis = fd.get("realized_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 1))
        y -= card_h + 24

    table_data = fd.get("realized_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([110] + [80] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("realized_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_watchlist(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_watchlist))
    y = _draw_heading(c, t, y, "Watchlist", size=24)
    y -= 4

    table_data = fd.get("watchlist_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("watchlist_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_fees(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_fees))
    y = _draw_heading(c, t, y, "Fees & Expenses", size=24)
    y -= 8

    kpis = fd.get("fees_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 1))
        y -= card_h + 24

    table_data = fd.get("fees_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([130] + [85] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("fees_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_balance_sheet(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_balance_sheet))
    y = _draw_heading(c, t, y, "Balance Sheet", size=24)
    y -= 4

    table_data = fd.get("balance_sheet_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        n = len(headers)
        col_w = _scale_cols([110] + [80] * (n - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("balance_sheet_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_lp_summary(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_lp_summary))
    y = _draw_heading(c, t, y, "LP Base Summary", size=24)
    y -= 8

    kpis = fd.get("lp_summary_kpis", [])
    if kpis:
        card_w = (PAGE_W - 2 * MARGIN - (len(kpis) - 1) * 16) / len(kpis)
        card_h = 65
        for i, kpi in enumerate(kpis):
            _draw_kpi_card(c, t,
                           MARGIN + i * (card_w + 16), y - card_h,
                           card_w, card_h,
                           kpi["value"], kpi["label"],
                           accent=kpi.get("accent", i % 2 == 0))
        y -= card_h + 24

    table_data = fd.get("lp_summary_table", {})
    if table_data:
        headers = table_data.get("headers", [])
        rows = table_data.get("rows", [])
        data = [headers] + rows
        col_w = _scale_cols([130] + [85] * (len(headers) - 1))
        y = _draw_table(c, t, MARGIN, y, data, col_w)

    note = fd.get("lp_summary_note", "")
    if note:
        c.setFont(FONT_BODY, 8)
        c.setFillColor(t.gray_500)
        c.drawString(MARGIN, y, note)

    _draw_footer(c, t, page, total, firm)


def _slide_esg(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_esg))
    y = _draw_heading(c, t, y, "ESG & Impact", size=24)
    y -= 12

    themes = fd.get("esg_themes", [])
    for item in themes:
        title = item.get("title", "")
        desc = item.get("description", "")

        c.setFillColor(t.primary_c)
        c.circle(MARGIN + 5, y + 4, 4, fill=1, stroke=0)

        c.setFont(FONT_HEADING, 13)
        c.setFillColor(t.secondary_c)
        c.drawString(MARGIN + 20, y, title)
        y -= 18

        c.setFont(FONT_BODY, 10)
        c.setFillColor(t.gray_700)
        max_w = PAGE_W - 2 * MARGIN - 20
        lines = _wrap_text(desc, FONT_BODY, 10, max_w)
        for line in lines:
            c.drawString(MARGIN + 20, y, line)
            y -= 14
        y -= 18

    _draw_footer(c, t, page, total, firm)


def _slide_risks(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t)
    _draw_top_bar(c, t)
    firm = t.firm_name or fd.get("firm_name", "")
    y = PAGE_H - 70

    y = _draw_section_label(c, t, y, _section_label(_slide_risks))
    y = _draw_heading(c, t, y, "Key Risks", size=24)
    y -= 12

    themes = fd.get("risk_themes", [])
    for item in themes:
        title = item.get("title", "")
        desc = item.get("description", "")

        c.setFillColor(t.primary_c)
        c.circle(MARGIN + 5, y + 4, 4, fill=1, stroke=0)

        c.setFont(FONT_HEADING, 13)
        c.setFillColor(t.secondary_c)
        c.drawString(MARGIN + 20, y, title)
        y -= 18

        c.setFont(FONT_BODY, 10)
        c.setFillColor(t.gray_700)
        max_w = PAGE_W - 2 * MARGIN - 20
        lines = _wrap_text(desc, FONT_BODY, 10, max_w)
        for line in lines:
            c.drawString(MARGIN + 20, y, line)
            y -= 14
        y -= 18

    _draw_footer(c, t, page, total, firm)


def _slide_closing(c: Canvas, t: Theme, fd: dict, page: int, total: int) -> None:
    _draw_page_bg(c, t, dark=True)
    firm = t.firm_name or fd.get("firm_name", "")

    c.setFillColor(t.primary_c)
    c.rect(MARGIN, PAGE_H * 0.55, 60, 4, fill=1, stroke=0)

    c.setFont(FONT_HEADING, 36)
    c.setFillColor(white)
    c.drawString(MARGIN, PAGE_H * 0.55 - 46, "Thank You")

    c.setFont(FONT_BODY, 16)
    c.setFillColor(Color(1, 1, 1, 0.6))
    c.drawString(MARGIN, PAGE_H * 0.55 - 78, "Questions & Discussion")

    contact = fd.get("contact", {})
    c.setFont(FONT_BODY, 12)
    c.setFillColor(Color(1, 1, 1, 0.4))
    y = PAGE_H * 0.55 - 130
    for line in contact.get("lines", [firm]):
        c.drawString(MARGIN, y, line)
        y -= 20

    c.setFont(FONT_HEADING, 14)
    c.setFillColor(Color(1, 1, 1, 0.25))
    c.drawString(MARGIN, 50, firm.upper())

    _draw_footer(c, t, page, total, firm, dark=True)


# ── Main entry point ─────────────────────────────────────────────────────────

SLIDE_LABELS = {
    _slide_fund_overview: "Fund Overview",
    _slide_fund_performance: "Fund Performance",
    _slide_benchmarks: "Performance Benchmarks",
    _slide_nav_bridge: "NAV Bridge",
    _slide_portfolio: "Portfolio Overview",
    _slide_sector_allocation: "Sector Allocation",
    _slide_vintage_allocation: "Vintage Allocation",
    _slide_top_investments: "Top Investments",
    _slide_realized: "Realized Investments",
    _slide_watchlist: "Watchlist",
    _slide_capital_activity: "Capital Activity",
    _slide_fees: "Fees & Expenses",
    _slide_balance_sheet: "Balance Sheet",
    _slide_lp_summary: "LP Base Summary",
    _slide_esg: "ESG & Impact",
    _slide_outlook: "Market Outlook",
    _slide_risks: "Key Risks",
}

SLIDE_BUILDERS = [
    _slide_cover,
    _slide_agenda,
    _slide_fund_overview,
    _slide_fund_performance,
    _slide_benchmarks,
    _slide_nav_bridge,
    _slide_portfolio,
    _slide_sector_allocation,
    _slide_vintage_allocation,
    _slide_top_investments,
    _slide_realized,
    _slide_watchlist,
    _slide_capital_activity,
    _slide_fees,
    _slide_balance_sheet,
    _slide_lp_summary,
    _slide_esg,
    _slide_outlook,
    _slide_risks,
    _slide_closing,
]


def generate_agm_deck(brand_data: dict, fund_data: dict, output_path: str) -> str:
    """Generate a branded AGM deck PDF.

    :param brand_data: Output of analyze_website.py (or manually constructed brand dict).
    :param fund_data: Fund metrics, portfolio, capital activity, outlook themes, etc.
    :param output_path: Where to write the PDF.
    :returns: The output path.
    """
    global _SECTION_NUMS, _ACTIVE_LABELS
    t = Theme(brand_data)
    slides = [b for b in SLIDE_BUILDERS]

    data_requirements = {
        _slide_fund_overview: ("fund_overview_kpis",),
        _slide_fund_performance: ("kpis", "performance_table"),
        _slide_benchmarks: ("benchmark_kpis", "benchmark_table"),
        _slide_nav_bridge: ("nav_bridge_table",),
        _slide_portfolio: ("portfolio_table",),
        _slide_sector_allocation: ("sector_allocation_kpis", "sector_allocation_table"),
        _slide_vintage_allocation: ("vintage_allocation_table",),
        _slide_top_investments: ("top_investments_table",),
        _slide_realized: ("realized_kpis", "realized_table"),
        _slide_watchlist: ("watchlist_table",),
        _slide_capital_activity: ("capital_kpis", "capital_table"),
        _slide_fees: ("fees_kpis", "fees_table"),
        _slide_balance_sheet: ("balance_sheet_table",),
        _slide_lp_summary: ("lp_summary_kpis", "lp_summary_table"),
        _slide_esg: ("esg_themes",),
        _slide_outlook: ("outlook_themes",),
        _slide_risks: ("risk_themes",),
    }

    active: list = []
    for slide_fn in slides:
        reqs = data_requirements.get(slide_fn)
        if reqs and not any(fund_data.get(k) for k in reqs):
            continue
        active.append(slide_fn)

    _no_number = {_slide_cover, _slide_agenda, _slide_closing}
    _SECTION_NUMS = {}
    _ACTIVE_LABELS = []
    num = 1
    for slide_fn in active:
        if slide_fn in _no_number:
            continue
        _SECTION_NUMS[slide_fn] = num
        _ACTIVE_LABELS.append(SLIDE_LABELS.get(slide_fn, ""))
        num += 1

    total = len(active)
    canvas = Canvas(output_path, pagesize=landscape(A4))
    canvas.setTitle(f"{t.firm_name} — AGM")
    canvas.setAuthor(t.firm_name)

    for i, slide_fn in enumerate(active, 1):
        slide_fn(canvas, t, fund_data, i, total)
        canvas.showPage()

    canvas.save()
    return output_path


def main() -> None:
    if len(sys.argv) < 3:
        print("Usage: generate_agm_deck.py <brand.json> <fund_data.json> [output.pdf]")
        sys.exit(1)

    with open(sys.argv[1]) as f:
        brand_data = json.load(f)
    with open(sys.argv[2]) as f:
        fund_data = json.load(f)

    output = sys.argv[3] if len(sys.argv) > 3 else "agm-deck.pdf"
    result = generate_agm_deck(brand_data, fund_data, output)
    print(f"Generated: {result}")


if __name__ == "__main__":
    main()
