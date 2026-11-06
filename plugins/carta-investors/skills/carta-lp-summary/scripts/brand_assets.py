#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["fonttools", "brotli"]
# ///
"""Firm branding for the LP Summary (the page and its PDF export), written into the page config.

The config file (lp-summary-data.json, one per firm in that firm's own workdir) is the one place the brand lives, so a logo's base64 never
passes through the model's context and the firm name never reaches the shell:

  apply --config FILE [--logo PATH | --logo-url URL] [--accent #RRGGBB] [--font FAMILY]
      Sets config["brand"] = {firmName (the config's firm_name), logoDataUri, accentHex,
      displayFont, displayFontTtf}. The logo is embedded as a data: URI (artifacts cannot load
      external images). A display font is kept only if its static Regular TTF downloads from the
      Google Fonts repository; otherwise it is left out and the summary says so in a "note".
      Prints a summary without the base64.
  decline --config FILE
      Sets config["brand_declined"] = true: the user said no to branding when the build offered
      it, so later rebuilds do not ask again.
  carry --from OLD --to NEW
      Copies OLD's brand (or its declined offer) into NEW when both configs are for the same firm,
      so a republish keeps the brand, or the answer, without asking again.
      Prints {"carried": true|false}.

  apply-board --config FILE --board FILE [--heading-font FAMILY] [--body-font FAMILY] [--accent #RRGGBB] [--logo PATH | --logo-url URL]
      Applies a saved brand board (the carta-brand-extraction result) as config["brand"]: primary,
      secondary and text colours, and the heading and body fonts the board lists as @font-face
      files. --accent replaces the board's primary colour. Each font file is embedded once, as a
      data: URI (woff2, woff, TrueType or OpenType): a face that is not TrueType is kept for the
      page as it is and converted to TrueType for the PDF (jsPDF reads nothing else); a TrueType
      face is kept as the PDF font and the page builds its own face from it. A family the board
      has no files for falls back to the Google Fonts repository's static TTF. Prints a summary
      without the base64, with a "note" for anything left out. The page and the PDF decide which
      colours and how many faces they can use.

Exit codes: 0 done; 1 bad input (missing file, bad colour, logo too large or not an image).
"""

import argparse
import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

EXIT_OK, EXIT_INPUT = 0, 1
MAX_LOGO_BYTES = 1_000_000
MAX_FONT_BYTES = 800_000
MAX_WEB_FONT_BYTES = 600_000
MAX_WEB_FONTS = 4
LOGO_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml",
              ".webp": "image/webp", ".gif": "image/gif"}
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")
FAMILY = re.compile(r"^[A-Za-z0-9 ]{1,40}$")
GOOGLE_FONTS_RAW = "https://raw.githubusercontent.com/google/fonts/main/{licence}/{dir}/{path}"


def log(msg):
    print("[brand] " + msg, file=sys.stderr)


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def fetch(url, limit):
    with urllib.request.urlopen(url, timeout=20) as res:  # noqa: S310 — https URLs only, checked by callers
        body = res.read(limit + 1)
        return body, res.headers.get("Content-Type", "")


def logo_data_uri(path=None, url=None):
    """(data URI, None) or (None, reason)."""
    if path:
        p = Path(path)
        mime = LOGO_TYPES.get(p.suffix.lower())
        if not p.is_file() or not mime:
            return None, "logo must be a PNG, JPG, SVG, WebP or GIF file: " + str(p)
        body = p.read_bytes()
    else:
        if not url.startswith("https://"):
            return None, "logo URL must be https"
        try:
            body, ctype = fetch(url, MAX_LOGO_BYTES)
        except OSError as e:
            return None, "logo did not download: " + str(e)
        mime = ctype.split(";")[0].strip().lower()
        if mime not in LOGO_TYPES.values():
            return None, "logo URL did not return an image (" + (mime or "no type") + ")"
    if len(body) > MAX_LOGO_BYTES:
        return None, "logo is larger than 1 MB; use a smaller file"
    return data_uri(body, mime), None


def display_font_ttf(family, limit=MAX_FONT_BYTES):
    """The family's static Regular TTF from the Google Fonts repository as a data URI, or None."""
    slug = family.lower().replace(" ", "")
    name = family.replace(" ", "") + "-Regular.ttf"
    for licence in ("ofl", "apache", "ufl"):
        for path in (name, "static/" + name):
            try:
                body, _ = fetch(GOOGLE_FONTS_RAW.format(licence=licence, dir=slug, path=path), limit)
            except OSError:
                continue
            if len(body) <= limit and FONT_MAGIC.get(body[:4], (None,))[0] == "ttf":
                return data_uri(body, "font/ttf")
    return None


FONT_MAGIC = {b"wOF2": ("woff2", "font/woff2"), b"wOFF": ("woff", "font/woff"), b"\x00\x01\x00\x00": ("ttf", "font/ttf"),
              b"true": ("ttf", "font/ttf"), b"OTTO": ("otf", "font/otf")}
FORMAT_ORDER = ["woff2", "woff", "ttf", "truetype", "otf", "opentype"]
INK_ROLES = ("text", "dark-text")


def top_colour(palette, *roles):
    """The most-used hex among the palette's `roles` (first role that has one), or None."""
    for role in roles:
        entries = [c for c in (palette.get(role) or []) if isinstance(c, dict) and HEX.match(str(c.get("hex", "")))]
        if entries:
            return max(entries, key=lambda c: c.get("count", 0))["hex"].upper()
    return None


def face_weight(face):
    match = re.search(r"\d+", str(face.get("weight", "400")))
    return int(match.group()) if match else (700 if "bold" in str(face.get("weight")).lower() else 400)


def pick_faces(faces, family, bold):
    """The family's upright face closest to Regular (or Bold), or None."""
    own = [f for f in faces if str(f.get("family", "")).strip().lower() == family.lower() and str(f.get("style", "normal")).lower() == "normal"]
    if not own:
        return None
    want = 700 if bold else 400
    best = min(own, key=lambda f: abs(face_weight(f) - want))
    return best if abs(face_weight(best) - want) <= 100 else None


def fetch_face(face):
    """(bytes, kind, mime) of the face's best source, or None."""
    sources = [x for x in face.get("sources", []) if isinstance(x, dict) and str(x.get("url", "")).startswith("https://")]
    sources.sort(key=lambda x: FORMAT_ORDER.index(x["format"].lower()) if str(x.get("format", "")).lower() in FORMAT_ORDER else len(FORMAT_ORDER))
    for source in sources:
        try:
            body, _ = fetch(source["url"], MAX_WEB_FONT_BYTES)
        except OSError:
            continue
        kind = FONT_MAGIC.get(body[:4])
        if kind and len(body) <= MAX_WEB_FONT_BYTES:
            return body, kind[0], kind[1]
    return None


def to_ttf(body, kind):
    """TrueType bytes for the font, or None: jsPDF embeds only TrueType outlines, so a CFF-based
    OpenType file (or a conversion that fails) leaves the PDF on the standard typeface."""
    if kind == "ttf":
        return body
    try:
        import io
        from fontTools.ttLib import TTFont
        font = TTFont(io.BytesIO(body))
        if "glyf" not in font:
            return None
        font.flavor = None
        out = io.BytesIO()
        font.save(out)
        return out.getvalue()
    except Exception:  # noqa: BLE001 — any parse or missing-brotli failure means no PDF font
        return None


def data_uri(body, mime):
    return "data:" + mime + ";base64," + base64.b64encode(body).decode("ascii")


def load_face(cache, faces, family, bold):
    """The family's Regular (or Bold) face as {"web", "ttf", "problem"}, fetched once per run, or None.

    web: the file as the page can use it, or None for a TrueType file (the page builds its face
    from the PDF font). ttf: TrueType data URI for the PDF, or None with the reason in problem."""
    key = (family.lower(), bold)
    if key not in cache:
        face = pick_faces(faces, family, bold)
        got = fetch_face(face) if face else None
        cache[key] = None
        if got:
            body, kind, mime = got
            converted = to_ttf(body, kind)
            problem = None if converted else "its outlines are not TrueType"
            if converted and len(converted) > MAX_FONT_BYTES:
                converted, problem = None, "it is over " + str(MAX_FONT_BYTES // 1000) + " KB as TrueType"
            ttf = data_uri(converted, "font/ttf") if converted else None
            cache[key] = {"web": None if kind == "ttf" and ttf else data_uri(body, mime), "ttf": ttf, "problem": problem}
    return cache[key]


def board_font(brand, faces, family, role, notes, cache):
    """Embeds `family` into brand: its faces for the page and Regular (and Bold) TrueType for the PDF."""
    if not family or not FAMILY.match(family.strip()):
        return
    family = family.strip()
    regular, bold = load_face(cache, faces, family, False), load_face(cache, faces, family, True)
    if not regular and not bold:
        google = display_font_ttf(family, MAX_WEB_FONT_BYTES)
        regular = {"web": None, "ttf": google, "problem": None} if google else None
    if not regular and not bold:
        notes.append("No font files for " + family + " on the brand board or Google Fonts; the " + role + " stays the standard typeface.")
        return
    held = brand.setdefault("webFonts", [])
    for weight, face in ((400, regular), (700, bold)):
        if face and face["web"] and len(held) < MAX_WEB_FONTS and not any(f["family"] == family and f["weight"] == weight for f in held):
            held.append({"family": family, "weight": weight, "uri": face["web"]})
    if not (regular and regular["ttf"]):
        reason = regular["problem"] if regular else "the board has no Regular face"
        notes.append(family + " cannot be a PDF font (" + reason + "); the PDF " + role + " uses the standard typeface.")
    elif role == "heading":
        brand["displayFont"], brand["displayFontTtf"] = family, regular["ttf"]
    else:
        brand["bodyFont"], brand["bodyFontTtf"] = family, regular["ttf"]
        if brand.get("displayFont") == family:
            del brand["displayFontTtf"]  # the template draws the title from the body font's file
        if bold and bold["ttf"]:
            brand["bodyFontBoldTtf"] = bold["ttf"]
    brand.setdefault("fontFamilies", {})[role] = family


def apply_board(args):
    config = read_json(args.config)
    board = read_json(args.board)
    firm = str(config.get("firm_name") or "").strip()
    if not firm:
        log("the config has no firm_name")
        return EXIT_INPUT
    brand = {"firmName": firm}
    notes = []
    if args.logo or args.logo_url:
        uri, reason = logo_data_uri(args.logo, args.logo_url)
        if reason:
            log(reason)
            return EXIT_INPUT
        brand["logoDataUri"] = uri
    if args.accent and not HEX.match(args.accent):
        log("accent must be #RRGGBB, got " + args.accent)
        return EXIT_INPUT
    palette = board.get("brand_palette") if isinstance(board.get("brand_palette"), dict) else {}
    primary = args.accent.upper() if args.accent else top_colour(palette, "primary", "accent")
    secondary = top_colour(palette, "secondary", "accent")
    ink = top_colour(palette, *INK_ROLES)
    if primary:
        brand["accentHex"] = primary
    if secondary and secondary != primary:
        brand["secondaryHex"] = secondary
    if ink:
        brand["inkHex"] = ink
    typography = board.get("typography") if isinstance(board.get("typography"), dict) else {}
    faces = [f for f in typography.get("font_faces", []) if isinstance(f, dict)]
    cache = {}
    board_font(brand, faces, args.heading_font, "heading", notes, cache)
    board_font(brand, faces, args.body_font, "body", notes, cache)
    config["brand"] = brand
    write_json(args.config, config)
    summary = {"logo": "logoDataUri" in brand, "accentHex": brand.get("accentHex"), "secondaryHex": brand.get("secondaryHex"),
               "inkHex": brand.get("inkHex"), "fonts": brand.get("fontFamilies", {}),
               "pdfFonts": {"heading": "displayFont" in brand, "body": "bodyFontTtf" in brand, "bodyBold": "bodyFontBoldTtf" in brand}}
    if notes:
        summary["note"] = " ".join(notes)
    print(json.dumps(summary))
    return EXIT_OK


def apply(args):
    config = read_json(args.config)
    firm = str(config.get("firm_name") or "").strip()
    if not firm:
        log("the config has no firm_name")
        return EXIT_INPUT
    brand = {"firmName": firm}
    if args.logo or args.logo_url:
        uri, reason = logo_data_uri(args.logo, args.logo_url)
        if reason:
            log(reason)
            return EXIT_INPUT
        brand["logoDataUri"] = uri
    if args.accent:
        if not HEX.match(args.accent):
            log("accent must be #RRGGBB, got " + args.accent)
            return EXIT_INPUT
        brand["accentHex"] = args.accent.upper()
    font = None
    if args.font and FAMILY.match(args.font.strip()):
        ttf = display_font_ttf(args.font.strip())
        if ttf:
            font = args.font.strip()
            brand["displayFont"], brand["displayFontTtf"] = font, ttf
    config["brand"] = brand
    write_json(args.config, config)
    summary = {"logo": "logoDataUri" in brand, "accentHex": brand.get("accentHex"), "displayFont": font}
    if args.font and not font:
        summary["note"] = "No static TTF for " + args.font.strip() + " on Google Fonts; the PDF uses the standard typeface."
    print(json.dumps(summary))
    return EXIT_OK


def decline(args):
    config = read_json(args.config)
    config["brand_declined"] = True
    write_json(args.config, config)
    print(json.dumps({"brand_declined": True}))
    return EXIT_OK


def carry(args):
    old, new = read_json(args.src), read_json(args.dst)
    same_firm = old.get("firm_context_id") and str(old.get("firm_context_id")) == str(new.get("firm_context_id"))
    carried = False
    if same_firm and isinstance(old.get("brand"), dict) and "brand" not in new:
        new["brand"], carried = old["brand"], True
    elif same_firm and old.get("brand_declined") is True and "brand" not in new:
        new["brand_declined"], carried = True, True
    if carried:
        write_json(args.dst, new)
    print(json.dumps({"carried": carried}))
    return EXIT_OK


def main(argv):
    ap = argparse.ArgumentParser(description="Firm branding for the LP Summary page and PDF export.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("apply")
    a.add_argument("--config", required=True)
    logo = a.add_mutually_exclusive_group()
    logo.add_argument("--logo")
    logo.add_argument("--logo-url")
    a.add_argument("--accent")
    a.add_argument("--font")
    b = sub.add_parser("apply-board")
    b.add_argument("--config", required=True)
    b.add_argument("--board", required=True)
    b.add_argument("--heading-font")
    b.add_argument("--body-font")
    b.add_argument("--accent")
    blogo = b.add_mutually_exclusive_group()
    blogo.add_argument("--logo")
    blogo.add_argument("--logo-url")
    d = sub.add_parser("decline")
    d.add_argument("--config", required=True)
    c = sub.add_parser("carry")
    c.add_argument("--from", dest="src", required=True)
    c.add_argument("--to", dest="dst", required=True)
    args = ap.parse_args(argv)
    try:
        return {"apply": apply, "apply-board": apply_board, "decline": decline, "carry": carry}[args.cmd](args)
    except (OSError, ValueError) as e:
        log(str(e))
        return EXIT_INPUT


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
