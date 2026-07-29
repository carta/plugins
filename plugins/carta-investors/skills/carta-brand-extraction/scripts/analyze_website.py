# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "requests>=2.31",
#   "beautifulsoup4>=4.12",
#   "Pillow>=10.0",
# ]
# ///
"""Analyze a website to extract brand identity elements.

Fetches the given URL, parses HTML + linked CSS, and extracts:
  - Theme colors (background, text, accent, border — with frequency ranking)
  - Typography (font families, weights, sizes)
  - Logo candidates (images in header/nav, favicon, og:image)
  - Hero / key imagery URLs

Outputs a JSON report to stdout that the SKILL.md workflow consumes.

Usage:
    uv run analyze_website.py <url>
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urljoin, urlparse


def _root_domain(netloc: str) -> str:
    """Return the registrable root domain (last two labels, no port, lowercase).

    Used for same-site checks that tolerate www/CDN subdomains:
      www.examplefirm.com     → examplefirm.com
      assets.examplefirm.com  → examplefirm.com
      otherbuilder.com        → otherbuilder.com  (different → filtered)
    """
    host = netloc.split(":")[0].lower()
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host

import requests
from bs4 import BeautifulSoup

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}

# ── Color extraction ────────────────────────────────────────────────────

_HEX_RE = re.compile(r"#(?:[0-9a-fA-F]{3}){1,2}\b")
_RGB_RE = re.compile(r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)")
_HSL_RE = re.compile(r"hsla?\(\s*(\d+)\s*,\s*(\d+)%?\s*,\s*(\d+)%?")

_SKIP_COLORS = frozenset({
    "#fff", "#ffffff", "#000", "#000000", "#00000000",
    "transparent", "inherit", "initial", "unset", "currentcolor",
})


def _normalize_hex(h: str) -> str:
    h = h.lower()
    if len(h) == 4:
        return f"#{h[1]*2}{h[2]*2}{h[3]*2}"
    return h


def _rgb_to_hex(r: int, g: int, b: int) -> str:
    return f"#{r:02x}{g:02x}{b:02x}"


def _extract_colors_from_text(text: str) -> list[str]:
    """Pull all color values from CSS / inline style text."""
    colors: list[str] = []
    for m in _HEX_RE.finditer(text):
        c = _normalize_hex(m.group())
        if c not in _SKIP_COLORS:
            colors.append(c)
    for m in _RGB_RE.finditer(text):
        c = _rgb_to_hex(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if c not in _SKIP_COLORS:
            colors.append(c)
    return colors


# Common framework default colors that are not part of the site's brand
_FRAMEWORK_COLORS = frozenset({
    "#3898ec",  # Webflow default link blue
    "#1890ff",  # Ant Design primary blue
    "#007bff",  # Bootstrap primary blue
    "#6c757d",  # Bootstrap secondary
    "#28a745",  # Bootstrap success
    "#dc3545",  # Bootstrap danger
    "#ffc107",  # Bootstrap warning
    "#17a2b8",  # Bootstrap info
    "#0d6efd",  # Bootstrap 5 primary
    "#198754",  # Bootstrap 5 success
    "#0dcaf0",  # Bootstrap 5 info
    "#6366f1",  # Tailwind indigo-500
    "#3b82f6",  # Tailwind blue-500
})

# ── Context-weighted color scoring ─────────────────────────────────────

_ELEMENT_CONTEXT_WEIGHTS: dict[str, float] = {
    "css_var_brand":  10.0,
    "header":          8.0,
    "nav":             8.0,
    "hero":            7.0,
    "button":          6.0,
    "cta":             6.0,
    "a_link":          3.0,
    "h1":              5.0,
    "h2":              4.0,
    "h3":              3.0,
    "footer":          2.0,
    "background":      1.5,
    "color":           2.0,
    "border":          0.5,
    "shadow":          0.3,
    "css_frequency":   1.0,
}

_HERO_KW = re.compile(r"hero|banner|jumbotron|splash|cover", re.IGNORECASE)


def _extract_element_colors(soup: BeautifulSoup) -> dict[str, list[str]]:
    """Extract colors from HTML elements with their semantic context.

    Single DOM walk — replaces the previous 5 separate find_all() passes.
    """
    element_colors: dict[str, list[str]] = {}

    def _add(color: str, context: str) -> None:
        c = _normalize_hex(color) if color.startswith("#") else color
        if c in _SKIP_COLORS:
            return
        ctxs = element_colors.setdefault(c, [])
        if context not in ctxs:
            ctxs.append(context)

    def _extract_from_style(style: str, context: str) -> None:
        for m in _HEX_RE.finditer(style):
            _add(m.group(), context)
        for m in _RGB_RE.finditer(style):
            _add(_rgb_to_hex(int(m.group(1)), int(m.group(2)), int(m.group(3))), context)

    for el in soup.find_all(True):
        style = el.get("style", "")
        if not style:
            continue
        tag = el.name
        cls = " ".join(el.get("class") or []).lower()

        if tag in ("header", "nav", "footer"):
            _extract_from_style(style, tag)
        elif tag in ("h1", "h2", "h3"):
            _extract_from_style(style, tag)
        elif tag == "button":
            _extract_from_style(style, "button")
        elif tag == "a":
            if any(kw in cls for kw in ("btn", "cta", "button")):
                _extract_from_style(style, "button")
            else:
                _extract_from_style(style, "a_link")
        elif _HERO_KW.search(cls):
            _extract_from_style(style, "hero")

    return element_colors


def _compute_brand_scores(
    color_counts: Counter,
    color_contexts: dict[str, list[str]],
    css_var_roles: dict[str, str],
    selector_hints: dict[str, list[str]],
    element_colors: dict[str, list[str]],
) -> dict[str, float]:
    scores: dict[str, float] = {}

    for hex_val, freq in color_counts.items():
        if hex_val in _FRAMEWORK_COLORS:
            continue
        score = 0.0
        score += min(freq, 10) * _ELEMENT_CONTEXT_WEIGHTS["css_frequency"]

        if hex_val in css_var_roles:
            role = css_var_roles[hex_val]
            if role in ("primary", "secondary", "accent"):
                score += _ELEMENT_CONTEXT_WEIGHTS["css_var_brand"]

        if hex_val in selector_hints:
            for hint in selector_hints[hex_val]:
                if hint in ("primary", "accent"):
                    score += 5.0
                elif hint in ("secondary", "link"):
                    score += 3.0

        if hex_val in color_contexts:
            for prop in color_contexts[hex_val]:
                if prop in ("background", "background-color"):
                    score += _ELEMENT_CONTEXT_WEIGHTS["background"]
                elif prop == "color":
                    score += _ELEMENT_CONTEXT_WEIGHTS["color"]
                elif prop in ("border", "border-color"):
                    score += _ELEMENT_CONTEXT_WEIGHTS["border"]
                elif prop in ("box-shadow", "text-shadow"):
                    score += _ELEMENT_CONTEXT_WEIGHTS["shadow"]

        if hex_val in element_colors:
            for ctx in element_colors[hex_val]:
                score += _ELEMENT_CONTEXT_WEIGHTS.get(ctx, 1.0)

        scores[hex_val] = score

    return scores


def _classify_color(hex_color: str) -> str:
    r = int(hex_color[1:3], 16)
    g = int(hex_color[3:5], 16)
    b = int(hex_color[5:7], 16)
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    if lum > 220:
        return "light-background"
    if lum < 40:
        return "dark-text"
    if lum < 100:
        return "dark-accent"
    return "accent"


# ── Single-pass CSS rule-block parser ───────────────────────────────────

_RULE_RE = re.compile(r"([^{}@/]+?)\s*\{([^}]+)\}", re.DOTALL)


def _parse_css_rules(all_css: str) -> list[tuple[str, str]]:
    """Parse CSS into (selector, declarations) pairs — done once, shared by all callers."""
    return _RULE_RE.findall(all_css)


# ── Color context + var/selector extraction ─────────────────────────────

_PROP_VAL_RE = re.compile(
    r"(background(?:-color)?|color|border(?:-color)?|"
    r"outline(?:-color)?|box-shadow|text-shadow|"
    r"fill|stroke|text-decoration-color)"
    r"\s*:\s*([^;}\n]+)",
    re.IGNORECASE,
)


def _extract_color_contexts(all_css: str) -> dict[str, list[str]]:
    contexts: dict[str, list[str]] = {}
    for m in _PROP_VAL_RE.finditer(all_css):
        prop = m.group(1).lower()
        val = m.group(2)
        for hex_m in _HEX_RE.finditer(val):
            c = _normalize_hex(hex_m.group())
            if c not in _SKIP_COLORS:
                ctxs = contexts.setdefault(c, [])
                if prop not in ctxs:
                    ctxs.append(prop)
        for rgb_m in _RGB_RE.finditer(val):
            c = _rgb_to_hex(int(rgb_m.group(1)), int(rgb_m.group(2)), int(rgb_m.group(3)))
            if c not in _SKIP_COLORS:
                ctxs = contexts.setdefault(c, [])
                if prop not in ctxs:
                    ctxs.append(prop)
    return contexts


_CSS_VAR_RE = re.compile(r"--([a-zA-Z0-9_-]+)\s*:\s*([^;}\n]+)")

_VAR_ROLE_KEYWORDS = {
    "primary": "primary", "secondary": "secondary", "accent": "accent",
    "brand": "primary", "danger": "danger", "error": "danger",
    "destructive": "danger", "warning": "warning", "caution": "warning",
    "success": "success", "positive": "success", "info": "info",
    "informational": "info", "muted": "muted", "subtle": "muted",
    "link": "link",
}


def _extract_css_var_roles(all_css: str) -> dict[str, str]:
    role_map: dict[str, str] = {}
    for m in _CSS_VAR_RE.finditer(all_css):
        var_name = m.group(1).lower()
        var_value = m.group(2).strip()
        hex_match = _HEX_RE.search(var_value)
        rgb_match = _RGB_RE.search(var_value)
        if not hex_match and not rgb_match:
            continue
        color = (
            _normalize_hex(hex_match.group()) if hex_match
            else _rgb_to_hex(int(rgb_match.group(1)), int(rgb_match.group(2)), int(rgb_match.group(3)))
        )
        if not color or color in _SKIP_COLORS:
            continue
        for kw, role in _VAR_ROLE_KEYWORDS.items():
            if kw in var_name:
                if color not in role_map or role in ("primary", "danger", "success"):
                    role_map[color] = role
                break
    return role_map


_SELECTOR_ROLE_KEYWORDS = {
    "primary": "primary", "secondary": "secondary", "accent": "accent",
    "danger": "danger", "error": "danger", "warning": "warning",
    "success": "success", "info": "info", "muted": "muted",
    "disabled": "muted", "link": "link", "cta": "primary",
    "hero": "primary", "nav": "primary", "header": "primary", "footer": "secondary",
}


def _extract_selector_roles(rules: list[tuple[str, str]]) -> dict[str, list[str]]:
    """Accepts pre-parsed (selector, declarations) pairs — no re-parse."""
    hints: dict[str, list[str]] = {}
    for selector, declarations in rules:
        selector_lc = selector.strip().lower()
        matched_roles = [
            role for kw, role in _SELECTOR_ROLE_KEYWORDS.items() if kw in selector_lc
        ]
        if not matched_roles:
            continue
        for hex_m in _HEX_RE.finditer(declarations):
            c = _normalize_hex(hex_m.group())
            if c not in _SKIP_COLORS:
                existing = hints.setdefault(c, [])
                for role in matched_roles:
                    if role not in existing:
                        existing.append(role)
        for rgb_m in _RGB_RE.finditer(declarations):
            c = _rgb_to_hex(int(rgb_m.group(1)), int(rgb_m.group(2)), int(rgb_m.group(3)))
            if c not in _SKIP_COLORS:
                existing = hints.setdefault(c, [])
                for role in matched_roles:
                    if role not in existing:
                        existing.append(role)
    return hints


# ── Semantic color role tagging ─────────────────────────────────────────

def _hex_to_hsl(hex_color: str) -> tuple[float, float, float]:
    r = int(hex_color[1:3], 16) / 255
    g = int(hex_color[3:5], 16) / 255
    b = int(hex_color[5:7], 16) / 255
    mx, mn = max(r, g, b), min(r, g, b)
    l = (mx + mn) / 2
    if mx == mn:
        h = s = 0.0
    else:
        d = mx - mn
        s = d / (2 - mx - mn) if l > 0.5 else d / (mx + mn)
        if mx == r:
            h = (g - b) / d + (6 if g < b else 0)
        elif mx == g:
            h = (b - r) / d + 2
        else:
            h = (r - g) / d + 4
        h /= 6
    return h * 360, s, l


def _hue_role(h: float, s: float, l: float) -> str | None:
    if s < 0.10:
        return None
    if h >= 345 or h < 20:
        return "danger"
    if 20 <= h < 45:
        return "warning"
    if 45 <= h < 65:
        return "warning"
    if 80 <= h < 170:
        return "success"
    if 190 <= h < 260:
        return "info"
    return None


def _assign_color_roles(
    colors: list[dict],
    css_var_roles: dict[str, str],
    selector_hints: dict[str, list[str]],
    color_contexts: dict[str, list[str]],
) -> list[dict]:
    for color in colors:
        h, s, l = _hex_to_hsl(color["hex"])
        color["_h"] = h
        color["_s"] = s
        color["_l"] = l

    for color in colors:
        hex_val = color["hex"]
        s, l = color["_s"], color["_l"]
        used_as = color_contexts.get(hex_val, [])
        role: str | None = None

        if l > 0.93:
            role = "background"
        elif l < 0.07 and s < 0.10:
            role = "text"

        if role is None and hex_val in css_var_roles:
            role = css_var_roles[hex_val]

        if role is None:
            is_bg_only = used_as and all(p in ("background", "background-color") for p in used_as)
            is_border_only = used_as and all(p in ("border", "border-color") for p in used_as)
            is_text_only = used_as == ["color"]

            if is_border_only:
                role = "border"
            elif l > 0.88 and s < 0.15:
                role = "background"
            elif is_bg_only and s < 0.10:
                role = "background"
            elif l < 0.12 and s < 0.10:
                role = "text"
            elif is_text_only and l < 0.30 and s < 0.10:
                role = "text"
            elif s < 0.06:
                role = "neutral"

        color["role"] = role

    has_primary = any(c.get("role") == "primary" for c in colors)
    has_secondary = any(c.get("role") == "secondary" for c in colors)
    candidates = [
        c for c in colors
        if c["_s"] > 0.20 and 0.10 < c["_l"] < 0.90 and c.get("role") is None
    ]

    if not has_primary and candidates:
        candidates[0]["role"] = "primary"
        has_primary = True

    if not has_secondary and has_primary and len(candidates) >= 2:
        for cand in candidates[1:]:
            if cand.get("role") is None:
                cand["role"] = "secondary"
                has_secondary = True
                break

    for color in colors:
        if color["role"] is not None:
            continue
        s, h = color["_s"], color["_h"]
        if s > 0.35:
            hue_guess = _hue_role(h, s, color["_l"])
            if hue_guess in ("danger", "warning", "success"):
                color["role"] = hue_guess

    for color in colors:
        if color["role"] is not None:
            continue
        color["role"] = "accent" if color["_s"] > 0.20 else "neutral"

    for color in colors:
        color.pop("_h", None)
        color.pop("_s", None)
        color.pop("_l", None)

    return colors


# ── Font extraction ─────────────────────────────────────────────────────

_FONT_FAMILY_RE = re.compile(r"font-family\s*:\s*([^;}\n]+)", re.IGNORECASE)
_FONT_SIZE_RE = re.compile(r"font-size\s*:\s*([^;}\n]+)", re.IGNORECASE)
_FONT_WEIGHT_RE = re.compile(r"font-weight\s*:\s*([^;}\n]+)", re.IGNORECASE)
_GOOGLE_FONTS_RE = re.compile(r"fonts\.googleapis\.com/css2?\?family=([^&\"']+)")

_GENERIC_FAMILIES = frozenset({
    "sans-serif", "serif", "monospace", "cursive", "fantasy",
    "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace",
    "ui-rounded", "-apple-system", "blinkmacsystemfont",
})

_ICON_FONT_PATTERNS = re.compile(
    r"(icon|webflow-|fontawesome|material|glyphicon|icomoon|feather|"
    r"fa-brands|fa-solid|fa-regular|dashicons|genericons|slick)",
    re.IGNORECASE,
)

_JUNK_VALUES = frozenset({
    "unset", "inherit", "initial", "revert", "revert-layer",
})


def _clean_font_name(name: str) -> str:
    return name.strip().strip("'\"").strip()


def _clean_css_value(val: str) -> str:
    return re.sub(r"\s*!important\s*$", "", val.strip(), flags=re.IGNORECASE)


def _extract_fonts_from_text(text: str) -> dict:
    families: Counter[str] = Counter()
    sizes: Counter[str] = Counter()
    weights: Counter[str] = Counter()

    for m in _FONT_FAMILY_RE.finditer(text):
        for part in m.group(1).split(","):
            name = _clean_font_name(part)
            if not name:
                continue
            lower = name.lower()
            if lower in _GENERIC_FAMILIES or lower in _JUNK_VALUES:
                continue
            if _ICON_FONT_PATTERNS.search(name):
                continue
            families[name] += 1

    for m in _FONT_SIZE_RE.finditer(text):
        val = _clean_css_value(m.group(1))
        if val.lower() not in _JUNK_VALUES:
            sizes[val] += 1

    for m in _FONT_WEIGHT_RE.finditer(text):
        val = _clean_css_value(m.group(1))
        if val.lower() not in _JUNK_VALUES:
            weights[val] += 1

    return {
        "families": families.most_common(10),
        "sizes": sizes.most_common(10),
        "weights": weights.most_common(10),
    }


def _extract_google_fonts(html: str, stylesheets: list[str]) -> list[str]:
    fonts: list[str] = []
    for text in [html, *stylesheets]:
        for m in _GOOGLE_FONTS_RE.finditer(text):
            for part in m.group(1).split("|"):
                name = part.split(":")[0].replace("+", " ")
                if name and name not in fonts:
                    fonts.append(name)
    return fonts


# ── @font-face extraction ──────────────────────────────────────────────

_FONT_FACE_RE = re.compile(r"@font-face\s*\{([^}]+)\}", re.DOTALL | re.IGNORECASE)
_FONT_FACE_SRC_RE = re.compile(r"""url\(\s*['"]?([^)'"]+?)['"]?\s*\)""", re.IGNORECASE)
_FONT_FACE_FORMAT_RE = re.compile(r"""format\(\s*['"]?([^)'"]+?)['"]?\s*\)""", re.IGNORECASE)
_FONT_FACE_STYLE_RE = re.compile(r"font-style\s*:\s*([^;}\n]+)", re.IGNORECASE)


def _extract_font_faces(all_css: str, base_url: str, google_fonts: list[str]) -> list[dict]:
    faces: list[dict] = []
    seen: set[str] = set()
    google_lower = {g.lower() for g in google_fonts}

    for m in _FONT_FACE_RE.finditer(all_css):
        block = m.group(1)
        family_m = _FONT_FAMILY_RE.search(block)
        if not family_m:
            continue
        family = _clean_font_name(family_m.group(1).split(",")[0])
        if not family or _ICON_FONT_PATTERNS.search(family) or family.lower() in google_lower:
            continue

        weight_m = _FONT_WEIGHT_RE.search(block)
        weight = _clean_css_value(weight_m.group(1)) if weight_m else "400"
        style_m = _FONT_FACE_STYLE_RE.search(block)
        style = _clean_css_value(style_m.group(1)) if style_m else "normal"

        sources: list[dict] = []
        for url_m in _FONT_FACE_SRC_RE.finditer(block):
            raw_url = url_m.group(1).strip()
            if raw_url.startswith("data:"):
                continue
            abs_url = urljoin(base_url, raw_url)
            fmt_after = block[url_m.end():]
            fmt_m = _FONT_FACE_FORMAT_RE.match(fmt_after.lstrip())
            fmt = fmt_m.group(1) if fmt_m else None
            sources.append({"url": abs_url, **({"format": fmt} if fmt else {})})

        if not sources:
            continue

        dedup_key = f"{family}|{weight}|{style}"
        if dedup_key in seen:
            continue
        seen.add(dedup_key)
        faces.append({"family": family, "weight": weight, "style": style, "sources": sources})

    return faces


_HEADING_KW = re.compile(
    r"\b(h[1-6]|\.heading|\.title|\.display|\.hero|\.headline|"
    r"\.subtitle|\.caption|\.body|\.lead|\.small|\.label)\b",
    re.IGNORECASE,
)


def _extract_type_scale(rules: list[tuple[str, str]]) -> list[dict]:
    """Accepts pre-parsed (selector, declarations) pairs — no re-parse."""
    scale: list[dict] = []
    seen_selectors: set[str] = set()

    for selector, declarations in rules:
        if not _HEADING_KW.search(selector):
            continue
        norm = re.sub(r"\s+", " ", selector).strip().lower()
        if norm in seen_selectors:
            continue
        seen_selectors.add(norm)

        entry: dict = {"selector": selector.strip()}
        size_m = _FONT_SIZE_RE.search(declarations)
        if size_m:
            entry["size"] = _clean_css_value(size_m.group(1))
        weight_m = _FONT_WEIGHT_RE.search(declarations)
        if weight_m:
            entry["weight"] = _clean_css_value(weight_m.group(1))
        family_m = _FONT_FAMILY_RE.search(declarations)
        if family_m:
            names = [_clean_font_name(p) for p in family_m.group(1).split(",")]
            names = [n for n in names if n and n.lower() not in _GENERIC_FAMILIES]
            if names:
                entry["family"] = names[0]
        lh_m = re.search(r"line-height\s*:\s*([^;}\n]+)", declarations, re.IGNORECASE)
        if lh_m:
            entry["line_height"] = _clean_css_value(lh_m.group(1))

        if "size" in entry or "family" in entry:
            scale.append(entry)

    def _sort_key(e: dict) -> tuple:
        sel = e.get("selector", "").lower()
        for i, tag in enumerate(["h1", "h2", "h3", "h4", "h5", "h6"]):
            if tag in sel:
                return (0, i)
        size = e.get("size", "0")
        try:
            if size.endswith("px"):
                return (1, -float(size[:-2]))
            elif size.endswith("em"):
                return (1, -float(size[:-2]) * 16)
            elif size.endswith("rem"):
                return (1, -float(size[:-3]) * 16)
        except ValueError:
            pass
        return (2, 0)

    scale.sort(key=_sort_key)
    return scale[:15]


def _extract_element_styles(soup: BeautifulSoup) -> list[dict]:
    entries: list[dict] = []
    for tag_name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
        for el in soup.find_all(tag_name, style=True):
            style = el.get("style", "")
            entry: dict = {"selector": tag_name, "source": "inline"}
            size_m = _FONT_SIZE_RE.search(style)
            if size_m:
                entry["size"] = _clean_css_value(size_m.group(1))
            weight_m = _FONT_WEIGHT_RE.search(style)
            if weight_m:
                entry["weight"] = _clean_css_value(weight_m.group(1))
            family_m = _FONT_FAMILY_RE.search(style)
            if family_m:
                names = [_clean_font_name(p) for p in family_m.group(1).split(",")]
                names = [n for n in names if n and n.lower() not in _GENERIC_FAMILIES]
                if names:
                    entry["family"] = names[0]
            text = el.get_text(strip=True)[:80]
            if text:
                entry["sample_text"] = text
            if "size" in entry or "family" in entry:
                entries.append(entry)
                break
    return entries


# ── Logo extraction ─────────────────────────────────────────────────────

#: Priority tier per extraction source, lowest first. Favicons and og:image /
#: twitter:image are almost always exported as flattened, opaque assets with a
#: solid (often white) background baked in — standard practice for browser tabs
#: and social-share previews — even when the site's real header logo is a
#: transparent PNG/SVG. Ranking the true header/nav logo above those fallbacks
#: means downstream consumers that just take `logos[0]` don't end up picking
#: the white-background variant.
_LOGO_SOURCE_PRIORITY = {
    "img-in-header": 0,
    "img-in-nav": 0,
    "img-in-logo-link": 0,
    "svg-in-logo-link": 0,
    "img-with-logo-attr": 1,
    "svg-logo-element": 1,
    "css-bg-in-header": 1,
    "favicon": 2,
    "og:image": 3,
    "twitter:image": 3,
}

#: Sources known to be routinely flattened onto an opaque background by the
#: platform/tooling that generates them, regardless of what the underlying
#: brand mark looks like. Surfaced so consumers can treat these as fallback-only.
_LOGO_LIKELY_OPAQUE_SOURCES = {"favicon", "og:image", "twitter:image"}


def _extract_logos(soup: BeautifulSoup, base_url: str) -> list[dict]:
    logos: list[dict] = []
    seen: set[str] = set()
    base_root = _root_domain(urlparse(base_url).netloc)

    def _add(url: str, source: str) -> None:
        abs_url = urljoin(base_url, url)
        if abs_url in seen:
            return
        # Skip logos hosted on a different root domain (third-party builders, CDNs
        # not owned by this firm). Inline SVGs (no URL) are always kept.
        if _root_domain(urlparse(abs_url).netloc) != base_root:
            return
        seen.add(abs_url)
        logos.append({
            "url": abs_url,
            "source": source,
            "likely_opaque_background": source in _LOGO_LIKELY_OPAQUE_SOURCES,
        })

    for link in soup.find_all("link", rel=lambda r: r and any(
        x in (r if isinstance(r, list) else [r])
        for x in ("icon", "shortcut icon", "apple-touch-icon")
    )):
        href = link.get("href")
        if href:
            _add(href, "favicon")

    for meta in soup.find_all("meta"):
        prop = meta.get("property", "") or meta.get("name", "")
        if prop in ("og:image", "twitter:image") and meta.get("content"):
            _add(meta["content"], prop)

    for container in soup.find_all(["header", "nav"]):
        for img in container.find_all("img"):
            src = img.get("src")
            if src:
                _add(src, f"img-in-{container.name}")

    for a_tag in soup.find_all("a"):
        a_cls = " ".join(a_tag.get("class", []))
        a_id = a_tag.get("id", "")
        if "logo" in f"{a_cls} {a_id}".lower():
            for img in a_tag.find_all("img"):
                src = img.get("src")
                if src:
                    _add(src, "img-in-logo-link")
            for svg in a_tag.find_all("svg"):
                logos.append({
                    "svg": str(svg)[:2000],
                    "source": "svg-in-logo-link",
                    "likely_opaque_background": False,
                })

    for img in soup.find_all("img"):
        src = img.get("src", "")
        alt = img.get("alt", "")
        cls = " ".join(img.get("class", []))
        if "logo" in f"{src} {alt} {cls}".lower() and src:
            _add(src, "img-with-logo-attr")

    for svg in soup.find_all("svg"):
        svg_id = svg.get("id", "")
        svg_cls = " ".join(svg.get("class", []))
        if "logo" in f"{svg_id} {svg_cls}".lower():
            logos.append({
                "svg": str(svg)[:2000],
                "source": "svg-logo-element",
                "likely_opaque_background": False,
            })

    for container in soup.find_all(["header", "nav"]):
        for el in container.find_all(style=True):
            style = el.get("style", "")
            bg_match = re.search(r'url\(["\']?([^)"\']+)', style)
            if bg_match:
                _add(bg_match.group(1), "css-bg-in-header")

    # Stable sort: within a tier, extraction order is preserved. This promotes
    # the true header/nav brand mark above favicon/og:image fallbacks without
    # discarding the latter — they're still useful when no header logo exists.
    logos.sort(key=lambda logo: _LOGO_SOURCE_PRIORITY.get(logo["source"], 1))

    return logos


# ── Imagery extraction ──────────────────────────────────────────────────

def _extract_hero_images(soup: BeautifulSoup, base_url: str) -> list[dict]:
    images: list[dict] = []
    seen: set[str] = set()
    base_root = _root_domain(urlparse(base_url).netloc)

    for img in soup.find_all("img"):
        src = img.get("src")
        if not src:
            continue
        abs_url = urljoin(base_url, src)
        if abs_url in seen:
            continue
        # Skip images hosted on a different root domain
        if _root_domain(urlparse(abs_url).netloc) != base_root:
            continue

        alt = img.get("alt", "")
        width = img.get("width", "")
        height = img.get("height", "")
        cls = " ".join(img.get("class", []))

        is_large = False
        try:
            if (width and int(width) > 400) or (height and int(height) > 300):
                is_large = True
        except ValueError:
            pass

        parent_classes = ""
        for parent in img.parents:
            if parent.name:
                parent_classes += " ".join(parent.get("class", [])) + " "

        is_hero = any(
            kw in f"{cls} {parent_classes}".lower()
            for kw in ("hero", "banner", "cover", "featured", "jumbotron", "splash")
        )

        is_tiny = False
        try:
            w = int(width) if width else 0
            h = int(height) if height else 0
            if (w and w < 40) or (h and h < 40):
                is_tiny = True
        except ValueError:
            pass
        if abs_url.endswith(".svg") and not is_large:
            is_tiny = True

        filename = abs_url.rsplit("/", 1)[-1].lower()
        if any(kw in filename for kw in (
            "close", "arrow", "chevron", "caret", "hamburger", "menu",
            "spinner", "loading", "icon", "check", "x.",
        )):
            is_tiny = True

        if (is_large or is_hero) and not is_tiny:
            seen.add(abs_url)
            images.append({"url": abs_url, "alt": alt, "context": "hero" if is_hero else "large-image"})

    for el in soup.find_all(style=True):
        style = el.get("style", "")
        bg_match = re.search(r'url\(["\']?([^)"\']+)', style)
        if bg_match:
            url = urljoin(base_url, bg_match.group(1))
            if url not in seen and _root_domain(urlparse(url).netloc) == base_root:
                seen.add(url)
                images.append({"url": url, "alt": "", "context": "css-background"})

    return images[:15]


# ── CSS fetching — parallel ─────────────────────────────────────────────

# Skip known framework/CDN stylesheets — they contain no brand colors
_SKIP_CSS_RE = re.compile(
    r"(bootstrap|tailwind|fontawesome|jquery|normalize|reset|animate\.css"
    r"|googleapis\.com/css|typekit\.net|cdn\.jsdelivr|unpkg\.com)",
    re.IGNORECASE,
)

_MAX_CSS_BYTES = 150_000   # 150 KB per file — enough for any real stylesheet
_MAX_CSS_FILES = 6         # fetch at most 6 linked stylesheets


def _fetch_stylesheets(soup: BeautifulSoup, base_url: str) -> list[str]:
    """Fetch linked stylesheets in parallel + collect inline <style> blocks."""
    sheets: list[str] = [tag.string for tag in soup.find_all("style") if tag.string]

    base_root = _root_domain(urlparse(base_url).netloc)
    hrefs = []
    for link in soup.find_all("link", rel="stylesheet"):
        href = link.get("href")
        if not href:
            continue
        css_url = urljoin(base_url, href)
        # Only fetch CSS from the same root domain — rejects third-party builder/CDN
        # stylesheets (e.g. otherbuilder.com when analyzing examplefirm.com) while
        # still allowing subdomains like assets.examplefirm.com.
        if _root_domain(urlparse(css_url).netloc) != base_root:
            continue
        if _SKIP_CSS_RE.search(css_url):
            continue
        hrefs.append(css_url)
        if len(hrefs) >= _MAX_CSS_FILES:
            break

    def _fetch_one(url: str) -> str | None:
        try:
            resp = requests.get(url, headers=_HEADERS, timeout=8)
            if resp.ok and len(resp.content) <= _MAX_CSS_BYTES:
                return resp.text
        except Exception:
            pass
        return None

    with ThreadPoolExecutor(max_workers=min(len(hrefs), 8)) as pool:
        futures = {pool.submit(_fetch_one, url): url for url in hrefs}
        for future in as_completed(futures):
            result = future.result()
            if result:
                sheets.append(result)

    return sheets


# ── Main analysis ───────────────────────────────────────────────────────

def analyze(url: str) -> dict:
    """Analyze the given URL and return a brand extraction report."""
    resp = requests.get(url, headers=_HEADERS, timeout=15)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    base_url = url

    # Fetch all CSS in parallel
    stylesheets = _fetch_stylesheets(soup, base_url)
    all_css = "\n".join(stylesheets)

    inline_styles = [el["style"] for el in soup.find_all(style=True)]
    all_style_text = all_css + "\n" + "\n".join(inline_styles)

    # Parse CSS rule blocks once — shared by selector analysis and type scale
    css_rules = _parse_css_rules(all_css)

    # ── Colors
    raw_colors = _extract_colors_from_text(all_style_text)
    color_counts = Counter(raw_colors)
    color_contexts = _extract_color_contexts(all_css)
    css_var_roles = _extract_css_var_roles(all_css)
    selector_hints = _extract_selector_roles(css_rules)      # uses pre-parsed rules
    element_colors = _extract_element_colors(soup)           # single DOM walk

    brand_scores = _compute_brand_scores(
        color_counts, color_contexts, css_var_roles, selector_hints, element_colors,
    )

    ranked_colors = sorted(brand_scores.items(), key=lambda x: x[1], reverse=True)
    top_colors = []
    for hex_val, score in ranked_colors[:25]:
        entry: dict = {
            "hex": hex_val,
            "count": color_counts.get(hex_val, 0),
            "score": round(score, 1),
            "classification": _classify_color(hex_val),
        }
        if hex_val in color_contexts:
            entry["used_as"] = color_contexts[hex_val]
        if hex_val in element_colors:
            entry["element_contexts"] = element_colors[hex_val]
        top_colors.append(entry)
    top_colors = top_colors[:20]

    top_colors = _assign_color_roles(top_colors, css_var_roles, selector_hints, color_contexts)

    brand_palette: dict[str, list[dict]] = {}
    for c in top_colors:
        role = c.get("role", "other")
        brand_palette.setdefault(role, []).append({
            "hex": c["hex"],
            "count": c["count"],
            "score": c.get("score", 0),
        })

    # ── Fonts
    font_data = _extract_fonts_from_text(all_style_text)
    google_fonts = _extract_google_fonts(resp.text, stylesheets)
    font_faces = _extract_font_faces(all_css, base_url, google_fonts)

    # ── Type scale — uses pre-parsed rules
    type_scale = _extract_type_scale(css_rules)
    element_styles = _extract_element_styles(soup)
    if element_styles:
        css_selectors = {e.get("selector", "").lower().strip() for e in type_scale}
        for es in element_styles:
            if es.get("selector", "").lower() not in css_selectors:
                type_scale.append(es)

    # ── Logos
    logos = _extract_logos(soup, base_url)

    # ── Imagery
    hero_images = _extract_hero_images(soup, base_url)

    # ── Meta
    title = soup.title.string.strip() if soup.title and soup.title.string else ""
    description = ""
    meta_desc = soup.find("meta", attrs={"name": "description"})
    if meta_desc and meta_desc.get("content"):
        description = meta_desc["content"]

    # CSS custom properties (design tokens)
    css_vars: dict[str, str] = {}
    for m in _CSS_VAR_RE.finditer(all_css):
        var_name = m.group(1)
        var_value = m.group(2).strip()
        if any(kw in var_name.lower() for kw in (
            "color", "bg", "background", "text", "font", "border",
            "primary", "secondary", "accent", "brand",
        )):
            css_vars[f"--{var_name}"] = var_value

    return {
        "url": url,
        "title": title,
        "description": description,
        "brand_palette": brand_palette,
        "colors": top_colors,
        "typography": {
            "families": [{"name": n, "count": c} for n, c in font_data["families"]],
            "sizes": [{"value": v, "count": c} for v, c in font_data["sizes"]],
            "weights": [{"value": v, "count": c} for v, c in font_data["weights"]],
            "google_fonts": google_fonts,
            "font_faces": font_faces,
            "type_scale": type_scale,
        },
        "logos": logos,
        "imagery": hero_images,
        "css_custom_properties": css_vars,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract brand identity from a website")
    parser.add_argument("url", help="Website URL to analyze")
    args = parser.parse_args()

    url = args.url
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"

    try:
        report = analyze(url)
        json.dump(report, sys.stdout, indent=2)
    except requests.RequestException as e:
        json.dump({"error": str(e), "url": url}, sys.stdout, indent=2)
        sys.exit(1)


if __name__ == "__main__":
    main()
