"""Generate a brand board as a PDF using reportlab.

Dependencies: reportlab, Pillow, requests.

Claude calls `generate_brand_board_pdf(data, output_path)` where `data` is the
JSON object returned by analyze_website.py (with colors, typography, logos, etc.
already classified by Claude into primary/secondary/accent/neutral groups).

The resulting PDF is a single-page (or multi-page if content overflows) visual
reference sheet with color swatches, typography samples, logo placements, and
design token summaries.
"""
from __future__ import annotations

import io
import tempfile

import requests
from PIL import Image as PILImage
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen.canvas import Canvas


PAGE_W, PAGE_H = landscape(A4)
MARGIN = 40
CONTENT_W = PAGE_W - 2 * MARGIN


def _draw_color_swatch(c: Canvas, x: float, y: float, hex_color: str, size: float = 50) -> None:
    """Draw a color swatch rectangle with hex label beneath."""
    # Swatch
    r = int(hex_color[1:3], 16) / 255
    g = int(hex_color[3:5], 16) / 255
    b = int(hex_color[5:7], 16) / 255
    c.setFillColorRGB(r, g, b)
    c.setStrokeColorRGB(0.85, 0.85, 0.85)
    c.roundRect(x, y - size, size, size, 4, fill=1, stroke=1)
    # Label
    c.setFillColorRGB(0.4, 0.4, 0.4)
    c.setFont("Courier", 7)
    c.drawCentredString(x + size / 2, y - size - 12, hex_color)


def _section_title(c: Canvas, x: float, y: float, title: str) -> float:
    """Draw a section title and return the new y position."""
    c.setFont("Helvetica-Bold", 9)
    c.setFillColorRGB(0.6, 0.6, 0.6)
    c.drawString(x, y, title.upper())
    return y - 20


def _download_image_to_temp(url: str) -> str | None:
    """Download an image URL to a temp file, return the path."""
    try:
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"
        })
        if not resp.ok:
            return None
        img = PILImage.open(io.BytesIO(resp.content))
        tmp = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img.save(tmp, format="PNG")
        tmp.close()
        return tmp.name
    except Exception:
        return None


def generate_brand_board_pdf(
    data: dict,
    output_path: str,
    firm_name: str = "",
) -> str:
    """Generate a brand board PDF and return the output path.

    Args:
        data: The classified brand data dict with keys:
            colors: { primary: [{hex}], secondary: [...], accent: [...], neutral: [...] }
            fonts: [{ family, weights, sizes }]
            logos: [{ url }]
            tokens: [{ name, value }]
            website_url: str
        output_path: Where to save the PDF.
        firm_name: Company name for the header.
    """
    c = Canvas(output_path, pagesize=landscape(A4))
    y = PAGE_H - MARGIN

    # ── Header
    c.setFont("Helvetica-Bold", 28)
    c.setFillColorRGB(0.1, 0.1, 0.1)
    c.drawString(MARGIN, y, firm_name or "Brand Board")
    y -= 20

    c.setFont("Helvetica", 10)
    c.setFillColorRGB(0.6, 0.6, 0.6)
    c.drawString(MARGIN, y, "Brand Board")
    y -= 14

    url = data.get("website_url", "")
    if url:
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(0.7, 0.7, 0.7)
        c.drawString(MARGIN, y, url)
    y -= 30

    # Divider
    c.setStrokeColorRGB(0.88, 0.88, 0.88)
    c.line(MARGIN, y, PAGE_W - MARGIN, y)
    y -= 30

    # ── Color Palette
    colors = data.get("colors", {})
    y = _section_title(c, MARGIN, y, "Color Palette")

    x = MARGIN
    for group_name in ("primary", "secondary", "accent", "neutral"):
        group = colors.get(group_name, [])
        if not group:
            continue
        c.setFont("Helvetica", 8)
        c.setFillColorRGB(0.5, 0.5, 0.5)
        c.drawString(x, y, group_name.capitalize())
        swatch_y = y - 8
        for i, color_item in enumerate(group[:5]):
            _draw_color_swatch(c, x + i * 62, swatch_y, color_item["hex"])
        x += max(len(group[:5]) * 62, 120) + 20
        if x > PAGE_W - MARGIN - 100:
            x = MARGIN
            y -= 85

    y -= 85

    # ── Typography
    fonts = data.get("fonts", [])
    if fonts:
        y = _section_title(c, MARGIN, y, "Typography")
        for font_item in fonts[:3]:
            family = font_item.get("family", "Unknown")
            weights = font_item.get("weights", ["400"])
            sizes = font_item.get("sizes", ["14px"])

            c.setFont("Helvetica-Bold", 10)
            c.setFillColorRGB(0.1, 0.1, 0.1)
            c.drawString(MARGIN, y, family)
            y -= 16

            c.setFont("Helvetica", 20)
            c.drawString(MARGIN, y, "The quick brown fox jumps over the lazy dog")
            y -= 18

            c.setFont("Courier", 8)
            c.setFillColorRGB(0.6, 0.6, 0.6)
            weights_str = ", ".join(str(w) for w in weights)
            sizes_str = ", ".join(str(s) for s in sizes)
            c.drawString(MARGIN, y, f"Weights: {weights_str}  |  Sizes: {sizes_str}")
            y -= 24

    # ── Logos
    logos = data.get("logos", [])
    if logos and y > 120:
        y = _section_title(c, MARGIN, y, "Logo")
        for logo in logos[:2]:
            logo_url = logo.get("url")
            if not logo_url:
                continue
            tmp_path = _download_image_to_temp(logo_url)
            if tmp_path:
                try:
                    c.drawImage(
                        tmp_path, MARGIN, y - 60,
                        width=150, height=60,
                        preserveAspectRatio=True, mask="auto",
                    )
                except Exception:
                    pass
                y -= 75

    # ── Design Tokens
    tokens = data.get("tokens", [])
    if tokens and y > 80:
        y = _section_title(c, MARGIN, y, "Design Tokens")
        for token in tokens[:8]:
            c.setFont("Courier-Bold", 8)
            c.setFillColorRGB(0.6, 0.6, 0.6)
            c.drawString(MARGIN, y, token.get("name", ""))
            c.setFont("Courier", 8)
            c.setFillColorRGB(0.3, 0.3, 0.3)
            c.drawString(MARGIN + 180, y, token.get("value", ""))
            y -= 14

    # ── Footer
    c.setFont("Helvetica", 7)
    c.setFillColorRGB(0.75, 0.75, 0.75)
    c.drawCentredString(PAGE_W / 2, 20, f"Generated from {url} — Brand Board")

    c.save()
    return output_path
