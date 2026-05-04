#!/usr/bin/env python3
"""
Form ADV Part 1A — Preparation Package PDF Generator
For use with the Carta carta-form-adv Claude skill
"""

import json
import os
import sys
from datetime import datetime

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                    Paragraph, Spacer, HRFlowable, PageBreak)
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, '-m', 'pip', 'install', 'reportlab', '-q'])
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (SimpleDocTemplate, Table, TableStyle,
                                    Paragraph, Spacer, HRFlowable, PageBreak)
    from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT


# ── Color palette ──────────────────────────────────────────────────────────────
CARTA_BLUE      = colors.HexColor('#0A2463')
CARTA_TEAL      = colors.HexColor('#3E92CC')
MANUAL_ORANGE   = colors.HexColor('#CC4400')
LIGHT_GREY      = colors.HexColor('#F5F5F5')
MEDIUM_GREY     = colors.HexColor('#CCCCCC')
DARK_GREY       = colors.HexColor('#555555')
GREEN_BG        = colors.HexColor('#E8F5E9')
ORANGE_BG       = colors.HexColor('#FFF3E0')
BLUE_BG         = colors.HexColor('#EEF2FF')


# ── Formatters ─────────────────────────────────────────────────────────────────

def fmt_currency(v):
    if v is None: return "—"
    try: return f"${float(v):,.0f}"
    except: return "—"

def fmt_pct(v, decimals=1):
    if v is None: return "—"
    try: return f"{float(v):.{decimals}f}%"
    except: return "—"

def fmt_int(v):
    if v is None: return "—"
    try: return f"{int(float(v)):,}"
    except: return "—"

def fmt_date(v):
    if not v: return "—"
    return str(v)[:10]

def fmt_multiple(v):
    if v is None: return "—"
    try: return f"{float(v):.2f}x"
    except: return "—"

def pct_range_label(pct):
    """Map a % to the SEC Item 5.H range label."""
    if pct < 10:   return "Less than 10%"
    elif pct < 25: return "10% up to 25%"
    elif pct < 50: return "25% up to 50%"
    elif pct < 75: return "50% up to 75%"
    elif pct < 90: return "75% up to 90%"
    else:           return "More than 90%"


# ── Style builder ──────────────────────────────────────────────────────────────

def build_styles():
    base = getSampleStyleSheet()
    return {
        'title': ParagraphStyle('title', parent=base['Normal'],
            fontSize=17, fontName='Helvetica-Bold', alignment=TA_CENTER,
            textColor=CARTA_BLUE, spaceAfter=4),
        'subtitle': ParagraphStyle('subtitle', parent=base['Normal'],
            fontSize=9, fontName='Helvetica', alignment=TA_CENTER,
            textColor=DARK_GREY, spaceAfter=3),
        'section': ParagraphStyle('section', parent=base['Normal'],
            fontSize=10, fontName='Helvetica-Bold', textColor=colors.white,
            leftIndent=6, spaceAfter=0),
        'subsection': ParagraphStyle('subsection', parent=base['Normal'],
            fontSize=10, fontName='Helvetica-Bold', textColor=CARTA_BLUE,
            spaceBefore=10, spaceAfter=4),
        'body': ParagraphStyle('body', parent=base['Normal'],
            fontSize=9, fontName='Helvetica', spaceAfter=4),
        'label': ParagraphStyle('label', parent=base['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=DARK_GREY, spaceAfter=1),
        'value': ParagraphStyle('value', parent=base['Normal'],
            fontSize=9, fontName='Helvetica', spaceAfter=2),
        'manual': ParagraphStyle('manual', parent=base['Normal'],
            fontSize=9, fontName='Helvetica-Bold', textColor=MANUAL_ORANGE, spaceAfter=2),
        'note': ParagraphStyle('note', parent=base['Normal'],
            fontSize=8, fontName='Helvetica-Oblique', textColor=DARK_GREY,
            spaceAfter=4, leftIndent=6),
        'th': ParagraphStyle('th', parent=base['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=colors.white, alignment=TA_CENTER),
        'td': ParagraphStyle('td', parent=base['Normal'],
            fontSize=8, fontName='Helvetica', alignment=TA_CENTER),
        'td_left': ParagraphStyle('td_left', parent=base['Normal'],
            fontSize=8, fontName='Helvetica'),
        'td_manual': ParagraphStyle('td_manual', parent=base['Normal'],
            fontSize=8, fontName='Helvetica-Bold', textColor=MANUAL_ORANGE, alignment=TA_CENTER),
        'checklist': ParagraphStyle('checklist', parent=base['Normal'],
            fontSize=9, fontName='Helvetica', spaceAfter=4, leftIndent=8),
        'caveat': ParagraphStyle('caveat', parent=base['Normal'],
            fontSize=8, fontName='Helvetica', spaceAfter=4, leftIndent=10),
    }


# ── Reusable components ────────────────────────────────────────────────────────

def section_heading(text, styles):
    para = Paragraph(text, styles['section'])
    t = Table([[para]], colWidths=[7*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARTA_BLUE),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    return t


def subsection_heading(text, styles):
    para = Paragraph(text, styles['section'])
    t = Table([[para]], colWidths=[7*inch])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARTA_TEAL),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
    ]))
    return t


def field_table(rows, styles):
    """
    rows: list of (label_str, value_str_or_None, is_manual)
    Renders a 2-column label/value table.
    """
    data = []
    for label, value, is_manual in rows:
        lp = Paragraph(label, styles['label'])
        if is_manual:
            vp = Paragraph("⚠ ENTER MANUALLY IN IARD", styles['manual'])
        else:
            vp = Paragraph(str(value) if value is not None else "—", styles['value'])
        data.append([lp, vp])

    t = Table(data, colWidths=[2.8*inch, 4.2*inch])
    t.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 0), (-1, -1), [colors.white, LIGHT_GREY]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
    ]))
    return t


def data_table(headers, rows, styles, col_widths=None):
    """Standard data table with blue header row."""
    data = [[Paragraph(h, styles['th']) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c) if c is not None else "—", styles['td']) for c in row])

    if col_widths is None:
        w = 7 * inch / max(len(headers), 1)
        col_widths = [w] * len(headers)

    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CARTA_BLUE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
    ]))
    return t


# ── Page builders ──────────────────────────────────────────────────────────────

def build_cover(data, styles, story):
    firm = data.get('firm_name', 'Your Firm')
    rd   = data.get('reporting_date', '')

    story.append(Spacer(1, 0.4*inch))
    story.append(Paragraph("FORM ADV PART 1A", styles['title']))
    story.append(Paragraph("SEC Investment Adviser Registration — Filing Preparation Package", styles['subtitle']))
    story.append(Spacer(1, 6))
    story.append(Paragraph(f"<b>{firm}</b>", styles['subtitle']))
    story.append(Paragraph(f"Reporting Period Ending: <b>{rd}</b>", styles['subtitle']))
    story.append(Paragraph(
        f"Prepared by Carta Data Warehouse  |  Generated {datetime.now().strftime('%B %d, %Y')}",
        styles['subtitle']))
    story.append(Spacer(1, 10))
    story.append(HRFlowable(width='100%', thickness=2, color=CARTA_BLUE, spaceAfter=10))

    # Legend
    legend = Table([
        [Paragraph("⚡  PRE-FILLED FROM CARTA",
                   ParagraphStyle('gl', fontSize=9, fontName='Helvetica-Bold',
                                  textColor=colors.HexColor('#2D6A4F'))),
         Paragraph("Values computed from your Carta data warehouse. Review before filing.", styles['body'])],
        [Paragraph("⚠  ENTER MANUALLY IN IARD",
                   ParagraphStyle('ol', fontSize=9, fontName='Helvetica-Bold',
                                  textColor=MANUAL_ORANGE)),
         Paragraph("Fields Carta cannot compute. Complete directly in the IARD web portal.", styles['body'])],
    ], colWidths=[2.2*inch, 4.8*inch])
    legend.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('BACKGROUND', (0, 0), (-1, 0), GREEN_BG),
        ('BACKGROUND', (0, 1), (-1, 1), ORANGE_BG),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
    ]))
    story.append(legend)
    story.append(Spacer(1, 14))

    # Summary stats
    rollup = data.get('firm_rollup', {})
    funds  = data.get('funds', [])
    stats = Table([
        ['REGULATORY AUM', 'NET ASSET VALUE', 'PRIVATE FUNDS', 'TOTAL INVESTORS'],
        [fmt_currency(rollup.get('regulatory_aum')),
         fmt_currency(rollup.get('net_asset_value')),
         str(len(funds)),
         fmt_int(rollup.get('total_beneficial_owners'))],
    ], colWidths=[1.75*inch] * 4)
    stats.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CARTA_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, 1), BLUE_BG),
        ('FONTNAME', (0, 1), (-1, 1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 1), (-1, 1), 14),
        ('TEXTCOLOR', (0, 1), (-1, 1), CARTA_BLUE),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, 0), 8),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('TOPPADDING', (0, 1), (-1, 1), 14),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 14),
        ('GRID', (0, 0), (-1, -1), 0.5, MEDIUM_GREY),
    ]))
    story.append(stats)


def build_fund_index(data, styles, story):
    """Fund index page — one row per fund with key stats. Especially useful for large firms."""
    funds = data.get('funds', [])
    demo_map = {d.get('fund_uuid', ''): d for d in data.get('investor_demographics', [])}

    story.append(PageBreak())
    story.append(section_heading("FUND INDEX — ALL PRIVATE FUNDS", styles))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        f"{len(funds)} fund(s) on file. Each fund requires one Schedule D §7.B.(1) entry in IARD. "
        "See Section B for per-fund detail.",
        styles['body']))
    story.append(Spacer(1, 8))

    headers = ['#', 'Fund Name', 'Type', 'Formation', 'Reg. AUM', 'NAV', 'Investors']
    rows = []
    for i, fund in enumerate(funds, 1):
        demo   = demo_map.get(fund.get('fund_uuid', ''), {})
        is_pit = fund.get('investor_count_is_point_in_time', False)
        inv    = fmt_int(fund.get('total_beneficial_owners'))
        inv    = inv + '*' if not is_pit else inv  # asterisk = snapshot fallback
        rows.append([
            str(i),
            fund.get('fund_name', '—'),
            fund.get('fund_type_classification', '—'),
            fmt_date(fund.get('formation_date')),
            fmt_currency(fund.get('regulatory_aum')),
            fmt_currency(fund.get('net_asset_value')),
            inv,
        ])

    # Name column gets more width; other cols fixed
    col_widths = [0.3*inch, 2.4*inch, 1.3*inch, 0.8*inch, 0.9*inch, 0.9*inch, 0.65*inch]

    header_paras  = [Paragraph(h, styles['th']) for h in headers]
    table_data    = [header_paras]
    for row in rows:
        # Left-align name; centre everything else
        cells = [Paragraph(str(row[0]), styles['td'])]
        cells.append(Paragraph(str(row[1]), styles['td_left']))
        cells += [Paragraph(str(c), styles['td']) for c in row[2:]]
        table_data.append(cells)

    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CARTA_BLUE),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, LIGHT_GREY]),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('FONTSIZE', (0, 0), (-1, -1), 8),
    ]))
    story.append(t)

    if any(not f.get('investor_count_is_point_in_time', True) for f in funds):
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "* Investor count is a current snapshot — NAV calculation not found for the reporting month-end. "
            "Verify against your subscription register for these funds.",
            styles['note']))


def build_item5(data, styles, story):
    rollup = data.get('firm_rollup', {})
    funds  = data.get('funds', [])
    demo   = data.get('investor_demographics', [])
    n      = len(funds)

    story.append(PageBreak())
    story.append(section_heading("SECTION A — ITEM 5: REGULATORY AUM, CLIENT TYPES & NON-US CLIENTS", styles))
    story.append(Spacer(1, 8))

    # 5.F — Regulatory AUM
    story.append(Paragraph("ITEM 5.F — REGULATORY ASSETS UNDER MANAGEMENT", styles['subsection']))
    aum_rows = [
        ['(a) Discretionary', fmt_currency(rollup.get('regulatory_aum')), str(n)],
        ['(b) Non-Discretionary', '$0', '0'],
        ['(c) TOTAL', fmt_currency(rollup.get('regulatory_aum')), str(n)],
    ]
    t = data_table(['', 'Dollar Amount', '# of Accounts'], aum_rows, styles,
                   col_widths=[3.5*inch, 2*inch, 1.5*inch])
    # Bold the total row
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CARTA_BLUE),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), BLUE_BG),
        ('TEXTCOLOR', (0, -1), (-1, -1), CARTA_BLUE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, LIGHT_GREY]),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (0, -1), 8),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
    ]))
    story.append(t)
    story.append(Paragraph(
        "All AUM is classified as <b>Discretionary</b> — fund managers have full investment authority "
        "over private funds. Regulatory AUM = Gross Assets + Unfunded Commitments (SEC balance sheet method).",
        styles['note']))

    # 5.D — Client types
    story.append(Spacer(1, 8))
    story.append(Paragraph("ITEM 5.D — CLIENT TYPES", styles['subsection']))
    client_rows = [['Pooled Investment Vehicles (private funds)', str(n), '100%']]
    story.append(data_table(['Client Type', '# of Clients', '% of Regulatory AUM'],
                            client_rows, styles, col_widths=[4*inch, 1.5*inch, 1.5*inch]))

    # 5.H — Non-US
    story.append(Spacer(1, 8))
    story.append(Paragraph("ITEM 5.H — NON-US CLIENTS", styles['subsection']))

    total_us       = sum((d.get('us_lp_investors')              or 0) for d in demo)
    total_non_us   = sum((d.get('non_us_lp_investors')          or 0) for d in demo)
    total_no_cntry = sum((d.get('lp_investors_no_country_on_file') or 0) for d in demo)
    total_lp_nav   = sum((d.get('total_lp_nav')                 or 0) for d in demo)
    non_us_nav     = sum((d.get('non_us_lp_nav')                or 0) for d in demo)
    pct_nav        = (non_us_nav / total_lp_nav * 100) if total_lp_nav else 0

    non_us_rows = [
        ['US Persons',           fmt_int(total_us),       '—'],
        ['Non-US Persons',       fmt_int(total_non_us),   fmt_pct(pct_nav)],
        ['Country Not on File',  fmt_int(total_no_cntry), '—'],
    ]
    story.append(data_table(['', 'LP Count', '% of LP NAV'],
                            non_us_rows, styles, col_widths=[3.5*inch, 1.75*inch, 1.75*inch]))
    story.append(Paragraph(
        f"✅  <b>IARD Item 5.H answer:</b>  Select <b>\"{pct_range_label(pct_nav)}\"</b>  "
        f"(approx. {pct_nav:.1f}% of LP NAV is from non-US investors). "
        "Verify partner_country data completeness before filing.",
        styles['note']))

    # Manual fields for Item 5
    story.append(Spacer(1, 8))
    story.append(Paragraph("ITEM 5 — MANUAL ENTRY REQUIRED IN IARD", styles['subsection']))
    manual_rows = [
        ("5.A — Total number of employees", None, True),
        ("5.B — Employees performing investment advisory functions", None, True),
        ("5.C — Types of compensation arrangements (checkboxes)", None, True),
        ("5.E — % of regulatory AUM subject to performance-based fees", None, True),
        ("5.G — Types of advisory services provided (checkboxes)", None, True),
        ("5.J — Do you sponsor wrap fee programs? (Y/N)", None, True),
    ]
    story.append(field_table(manual_rows, styles))


def build_schedule_d(data, styles, story):
    funds     = data.get('funds', [])
    demo_map  = {d.get('fund_uuid', ''): d for d in data.get('investor_demographics', [])}

    story.append(PageBreak())
    story.append(section_heading("SECTION B — SCHEDULE D §7.B.(1): PER-FUND DETAIL", styles))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "Complete one §7.B.(1) entry in IARD for each private fund below. "
        "Orange fields must be entered manually.",
        styles['body']))

    for i, fund in enumerate(funds):
        fname = fund.get('fund_name', 'Unknown Fund')
        fuuid = fund.get('fund_uuid', '')
        demo  = demo_map.get(fuuid, {})

        story.append(Spacer(1, 10))
        story.append(subsection_heading(f"FUND {i+1}:  {fname}", styles))
        story.append(Spacer(1, 4))

        # Identification
        strategy_code  = fund.get('investment_strategy_code') or ''
        fund_type      = fund.get('fund_type_classification') or '—'
        fund_type_display = f"{fund_type}  [Carta code: {strategy_code}]" if strategy_code else fund_type

        is_pit = fund.get('investor_count_is_point_in_time', False)
        inv_count_note = "as of reporting date" if is_pit else "⚠ current snapshot — NAV not calculated for this month-end"

        story.append(Paragraph("Identification & Structure", styles['subsection']))
        id_rows = [
            ("Q.1 — Fund Legal Name",                         fname, False),
            ("Q.1 — Private Fund ID Number (PFID)",           None, True),
            ("Q.2 — Is this adviser the fund's primary adviser?", None, True),
            ("Q.3 — Other advisers / sub-advisers (if any)",  None, True),
            ("Q.4 — Fund Type Classification",                fund_type_display, False),
            ("Q.5 — Legal Structure / Organizational Form",   fund.get('legal_structure', '—'), False),
            ("Q.6 — Fund Formation Date",                     fmt_date(fund.get('formation_date')), False),
            ("Q.7 — Fiscal Year End (Month)",                 None, True),
            ("Q.8 — Currently open to new investors? (Y/N)",  None, True),
            ("Q.9 — Minimum investment amount",               None, True),
        ]
        story.append(field_table(id_rows, styles))

        # Financial
        story.append(Spacer(1, 6))
        story.append(Paragraph("Financial Data  (Q.10 – Q.12)", styles['subsection']))
        fin_rows = [
            ("Q.10a — Gross Asset Value",                     fmt_currency(fund.get('total_gross_assets')), False),
            ("   › Fair Market Value of Investments",         fmt_currency(fund.get('fair_market_value')), False),
            ("   › Cash & Cash Equivalents",                  fmt_currency(fund.get('cash')), False),
            ("   › Other Assets",                             fmt_currency(fund.get('other_assets')), False),
            ("Q.10b — Total Borrowings Outstanding",          fmt_currency(fund.get('total_borrowings_outstanding')), False),
            ("Q.10c — Net Asset Value (NAV) — Total",         fmt_currency(fund.get('net_asset_value')), False),
            ("   › LP NAV",                                   fmt_currency(fund.get('lp_nav')), False),
            ("   › GP NAV",                                   fmt_currency(fund.get('gp_nav')), False),
            ("Q.11 — Unfunded Capital Commitments",           fmt_currency(fund.get('unfunded_commitments')), False),
            ("Regulatory AUM  (Gross Assets + Unfunded)",     fmt_currency(fund.get('regulatory_aum')), False),
            ("Q.12a — Annual Subscriptions — Total",          fmt_currency(fund.get('annual_subscriptions')), False),
            ("   › LP Annual Subscriptions",                  fmt_currency(fund.get('annual_lp_subscriptions')), False),
            ("   › GP Annual Subscriptions",                  fmt_currency(fund.get('annual_gp_subscriptions')), False),
            ("Q.12b — Annual Distributions — Total",          fmt_currency(fund.get('annual_distributions')), False),
            ("   › LP Annual Distributions",                  fmt_currency(fund.get('annual_lp_distributions')), False),
            ("   › GP Annual Distributions",                  fmt_currency(fund.get('annual_gp_distributions')), False),
            ("Contributions Since Inception — Total",         fmt_currency(fund.get('contributions_since_inception')), False),
            ("   › LP Contributions (ITD)",                   fmt_currency(fund.get('lp_contributions_since_inception')), False),
            ("Distributions Since Inception — Total",         fmt_currency(fund.get('distributions_since_inception')), False),
            ("   › LP Distributions (ITD)",                   fmt_currency(fund.get('lp_distributions_since_inception')), False),
        ]
        story.append(field_table(fin_rows, styles))

        # Beneficial owners
        story.append(Spacer(1, 6))
        story.append(Paragraph("Beneficial Owner Breakdown  (Q.13 – Q.16)", styles['subsection']))

        total_inv = demo.get('total_active_investors') or 0
        def owner_pct(key):
            v = demo.get(key) or 0
            return f"~{v/total_inv*100:.0f}%  ({fmt_int(v)} investors)" if total_inv else "—"

        bo_rows = [
            ("Q.13 — Total # of Beneficial Owners",           fmt_int(fund.get('total_beneficial_owners')), False),
            ("   › Limited Partners (LPs)",                   fmt_int(fund.get('beneficial_owners_lp')), False),
            ("   › General Partners (GPs)",                   fmt_int(fund.get('beneficial_owners_gp')), False),
            ("   Investor count source",                       inv_count_note, False),
            ("Q.14 — Any non-US beneficial owners? (Y/N)",
             'Yes' if (demo.get('non_us_lp_investors') or 0) > 0 else 'No (verify country data)', False),
            ("Q.15 — % of beneficial owners who are non-US",  fmt_pct(demo.get('pct_non_us_lp_investors')), False),
            ("Q.16 — % owned by individuals / HNW",           owner_pct('individual_investors'), False),
            ("Q.16 — % owned by other private funds",         owner_pct('fund_investors'), False),
            ("Q.16 — % owned by trusts / foundations",        owner_pct('trust_foundation_investors'), False),
            ("Q.16 — % owned by corporations / LLCs",         owner_pct('corporate_investors'), False),
            ("Q.16 — % owned by pension / retirement plans",  owner_pct('pension_plan_investors'), False),
        ]
        story.append(field_table(bo_rows, styles))

        # Manual fund fields
        story.append(Spacer(1, 6))
        story.append(Paragraph("Additional Fund Fields — Manual Entry Required", styles['subsection']))
        mfund_rows = [
            ("Auditor name and city",                         None, True),
            ("Auditor PCAOB registration number",             None, True),
            ("Custodian — is it a related person? (Y/N)",    None, True),
            ("3(c)(1) or 3(c)(7) exemption relied upon",     None, True),
            ("Form D file number (021-XXXXXX from SEC EDGAR)", None, True),
            ("Frequency of asset valuation",                  None, True),
            ("Who performs the valuation: internal or 3rd-party?", None, True),
            ("Side pocket arrangements (Y/N)",                None, True),
            ("Gate on investor redemptions (Y/N)",            None, True),
        ]
        story.append(field_table(mfund_rows, styles))


def build_asset_composition(data, styles, story):
    rollup = data.get('firm_rollup', {})
    total  = rollup.get('total_active_fmv') or 0

    story.append(PageBreak())
    story.append(section_heading("SECTION C — SCHEDULE D §5.K.(1): ASSET CATEGORY COMPOSITION", styles))
    story.append(Spacer(1, 4))
    story.append(Paragraph(
        "§5.K.(1) applies to separately managed accounts (SMAs). If your firm manages only private funds "
        "with no SMAs, enter $0 in IARD for this section. The data below reflects your portfolio composition "
        "across all funds and is provided for reference.",
        styles['note']))
    story.append(Spacer(1, 6))

    cats = [
        ('Exchange-Traded Equity (U.S. and non-U.S.)',                  rollup.get('fmv_exchange_traded_equity')),
        ('Private Equity (non-public ownership interests)',              rollup.get('fmv_private_equity')),
        ('Securities issued by other pooled investment vehicles',        rollup.get('fmv_pooled_investment_vehicles')),
        ('Options and warrants',                                         rollup.get('fmv_options_and_warrants')),
        ('Digital assets / cryptocurrency',                              rollup.get('fmv_digital_assets')),
        ('Other alternatives',                                           rollup.get('fmv_other_alternatives')),
    ]

    rows = []
    for label, fmv in cats:
        fmv_v = fmv or 0
        pct   = (fmv_v / total * 100) if total else 0
        rows.append([label, fmt_currency(fmv_v), fmt_pct(pct)])
    rows.append(['TOTAL ACTIVE INVESTMENT FMV', fmt_currency(total), '100%'])

    t = data_table(['Asset Category', 'FMV', '% of Portfolio'], rows, styles,
                   col_widths=[4.5*inch, 1.25*inch, 1.25*inch])
    # Bold and highlight total row
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), CARTA_BLUE),
        ('FONTNAME', (0, -1), (-1, -1), 'Helvetica-Bold'),
        ('BACKGROUND', (0, -1), (-1, -1), BLUE_BG),
        ('TEXTCOLOR', (0, -1), (-1, -1), CARTA_BLUE),
        ('ROWBACKGROUNDS', (0, 1), (-1, -2), [colors.white, LIGHT_GREY]),
        ('GRID', (0, 0), (-1, -1), 0.3, MEDIUM_GREY),
        ('ALIGN', (1, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (0, -1), 8),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
    ]))
    story.append(t)


def build_caveats_and_checklist(data, styles, story):
    story.append(PageBreak())
    story.append(section_heading("SECTION D — CAVEATS & IARD FILING CHECKLIST", styles))
    story.append(Spacer(1, 8))
    story.append(Paragraph("<b>Data Caveats — Review Before Filing</b>", styles['subsection']))

    caveats = [
        ("Investor Counts",
         "Current Carta snapshot, not point-in-time as of the reporting date. "
         "Verify against your subscription register if investors joined or left near year-end."),
        ("Non-US Classification",
         "Based on the partner_country field in Carta (user-entered). "
         "Partners with no country on file are excluded from the US/non-US calculation."),
        ("Fund Type Classification",
         "Estimated from investment_strategy_code. Confirm the correct SEC classification "
         "(venture capital, private equity, hedge fund, etc.) against your fund documents — "
         "this is a legal determination."),
        ("Formation Date",
         "Based on the GL-vintage date in Carta. Verify against the certificate of formation / LP agreement."),
        ("Borrowings",
         "Covers account types 2000–2999, which may include distribution payables and deferred "
         "capital calls in addition to true credit facilities. Review the GL if precision is needed."),
        ("Legal Names",
         "Fund display names in Carta may differ from legal entity names. "
         "Always verify the exact legal name against formation documents before entering in IARD."),
    ]
    for title, detail in caveats:
        story.append(Paragraph(f"•  <b>{title}:</b>  {detail}", styles['caveat']))
        story.append(Spacer(1, 3))

    story.append(Spacer(1, 12))
    story.append(Paragraph("<b>IARD Filing Checklist</b>", styles['subsection']))

    steps = [
        "☐  Log into IARD at www.adviserinfo.sec.gov → File Form ADV Annual Amendment",
        "☐  Complete Item 5: employees, compensation types, services (enter manually)",
        "☐  Enter Regulatory AUM from Section A — select Discretionary only",
        "☐  Item 5.D: select client type = Pooled Investment Vehicles",
        "☐  Item 5.H: select the non-US AUM % range from Section A",
        "☐  Schedule D §7.B.(1): complete one entry per fund from Section B",
        "☐  Enter auditor, custodian, and exemption details for each fund",
        "☐  Complete Items 6–12: other business activities, affiliated persons, custody, disclosures",
        "☐  Complete Schedules A & B: direct and indirect ownership of the adviser",
        "☐  Review all entries → Submit in IARD",
    ]
    for step in steps:
        story.append(Paragraph(step, styles['checklist']))
        story.append(Spacer(1, 2))

    story.append(Spacer(1, 14))
    story.append(HRFlowable(width='100%', thickness=1, color=MEDIUM_GREY))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Data sourced from Carta Data Warehouse  ·  Balance sheet uses effective_date (accounting date)  ·  "
        f"Generated {datetime.now().strftime('%B %d, %Y at %I:%M %p')}  ·  "
        "This document is a filing preparation tool — all figures should be reviewed before submission to IARD.",
        styles['note']))


# ── Entry point ────────────────────────────────────────────────────────────────

def generate_pdf(data_path, output_path=None):
    with open(data_path, 'r') as f:
        data = json.load(f)

    firm = data.get('firm_name', 'firm')
    rd   = data.get('reporting_date', '')
    year = rd[:4] if rd else 'filing'

    if output_path is None:
        safe = firm.replace(' ', '_').replace('/', '_')[:30]
        output_path = os.path.expanduser(f"~/Downloads/FormADV_{safe}_{year}.pdf")

    styles = build_styles()
    story  = []

    build_cover(data, styles, story)
    build_fund_index(data, styles, story)
    build_item5(data, styles, story)
    build_schedule_d(data, styles, story)
    build_asset_composition(data, styles, story)
    build_caveats_and_checklist(data, styles, story)

    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        rightMargin=0.75*inch, leftMargin=0.75*inch,
        topMargin=0.75*inch,   bottomMargin=0.75*inch,
        title=f"Form ADV Part 1A — {firm} — {rd}",
        author="Carta Data Warehouse",
        subject="SEC Form ADV Part 1A Filing Preparation"
    )
    doc.build(story)
    return output_path


if __name__ == '__main__':
    data_path   = sys.argv[1] if len(sys.argv) > 1 else '/tmp/form_adv_data.json'
    output_path = sys.argv[2] if len(sys.argv) > 2 else None
    result = generate_pdf(data_path, output_path)
    print(f"PDF saved: {result}")
