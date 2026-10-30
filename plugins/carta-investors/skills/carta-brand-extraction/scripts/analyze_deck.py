# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "pypdf>=4.0",
#   "Pillow>=10.0",
#   "cryptography>=42",
# ]
# ///
"""Read a firm's brand from a deck it already has: a pitch deck or LP letter (PowerPoint .pptx,
.ppsx or .potx, or PDF).

A .pptx carries its brand exactly: the theme's accent colours and heading/body fonts, and
the logo on its slide master. A .pdf carries none of that as data, so its colours are the
non-neutral ones its first pages paint most often, and its logos are the images on those
pages: a best guess, which the output flags with "colors_exact": false.

Logo candidates are saved into --out-dir and keep only the types and size the LP Summary's
brand_assets.py accepts, so any path printed here can go straight to its --logo.

A part that cannot be read (one image, one page, one layout) is skipped; only a file that
cannot be read as a whole exits 1.

Usage:
    uv run analyze_deck.py <deck.pptx|.ppsx|.potx|.pdf> --out-dir <dir>

stdout: JSON {source, colors_exact, accent_candidates[{hex, label}], fonts{heading, body},
logo_candidates[{path, width, height, from}]}. Exit 1 with the reason on stderr when the
file cannot be read.
"""
from __future__ import annotations

import argparse
import colorsys
import hashlib
import io
import json
import posixpath
import sys
import zipfile
import zlib
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree

from PIL import Image

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}
REL_IMAGE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
REL_THEME = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"

# What brand_assets.py embeds as a logo (its LOGO_TYPES and MAX_LOGO_BYTES, kept equal by
# test_brand_deck.py); anything else could never be applied.
LOGO_SUFFIXES = {".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif"}
MAX_LOGO_BYTES = 1_000_000
# Icons and rule images are smaller than any usable logo.
MIN_LOGO_SIDE = 32
# A strip this many times wider than tall is a divider or a dot pattern, not a logo.
MAX_LOGO_ASPECT = 8
# A logo the PDF can show needs some ink darker than this on white (0 black, 1 white).
INK_LIGHTNESS = 0.85
MIN_INK_SHARE = 0.02
# A wide image shaped like the page is a background or a photo, not a logo.
BACKGROUND_MIN_WIDTH = 640
# Theme and relationship parts are small XML; anything larger is not a real deck part.
MAX_XML_BYTES = 5_000_000
# Form streams a page may parse in all (image draws don't count), so a form drawn many times inside itself can't run for hours.
MAX_FORM_DRAWS = 200
PPTX_SUFFIXES = {".pptx", ".ppsx", ".potx"}
PDF_PAGES = 3
MAX_COLORS = 6

PPTX_UNREADABLE = "this file isn't a readable PowerPoint"


class DeckError(Exception):
    pass


def hex_of(rgb: tuple[float, float, float]) -> str:
    return "#" + "".join(f"{max(0, min(255, round(c * 255))):02X}" for c in rgb)


def rgb_of(hex_value: str) -> tuple[float, float, float]:
    return tuple(int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5))


def is_neutral(rgb: tuple[float, float, float]) -> bool:
    # The same accent test as analyze_website.py, so the first candidate means the same
    # thing whatever the source.
    _, lightness, saturation = colorsys.rgb_to_hls(*rgb)
    return saturation <= 0.20 or lightness <= 0.10 or lightness >= 0.90


def looks_like_background(width: int, height: int, page_ratio: float | None) -> bool:
    if width < BACKGROUND_MIN_WIDTH or not height or not page_ratio:
        return False
    return abs(width / height - page_ratio) < 0.15


def invisible_on_white(img: Image.Image) -> bool:
    """True for an image made for dark slides: a white logo on transparency."""
    # 16- and 32-bit greyscale would clip to white in a direct RGBA conversion.
    if img.mode.startswith("I"):
        img = img.point(lambda v: v * (1 / 256)).convert("L")
    small = img.convert("RGBA")
    small.thumbnail((128, 128))
    raw = small.tobytes()
    ink = sum(1 for i in range(0, len(raw), 4)
              if raw[i + 3] >= 128 and (0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2]) / 255 < INK_LIGHTNESS)
    return ink < MIN_INK_SHARE * (len(raw) // 4)


def keep_logo(data: bytes, suffix: str, origin: str, out_dir: Path, seen: set[str],
              page_ratio: float | None) -> dict | None:
    digest = hashlib.sha256(data).hexdigest()
    if digest in seen or suffix not in LOGO_SUFFIXES or len(data) > MAX_LOGO_BYTES:
        return None
    # PowerPoint pairs every SVG picture with a PNG fallback, which the raster checks can
    # judge; an SVG can't be checked for being invisible on white.
    if suffix == ".svg":
        return None
    try:
        with Image.open(io.BytesIO(data)) as img:
            width, height = img.size
            if (max(width, height) < MIN_LOGO_SIDE or max(width, height) > MAX_LOGO_ASPECT * min(width, height)
                    or looks_like_background(width, height, page_ratio) or invisible_on_white(img)):
                return None
    except (OSError, Image.DecompressionBombError):
        return None
    seen.add(digest)
    path = out_dir / f"deck-logo-{len(seen)}{suffix}"
    path.write_bytes(data)
    return {"path": str(path), "width": width, "height": height, "from": origin}


def rank_logos(logos: list[dict]) -> list[dict]:
    # Groups keep the order they were found in (masters, layouts, then pages in order);
    # within each, the smaller image is likelier a logo.
    first: dict[str, int] = {}
    for i, logo in enumerate(logos):
        first.setdefault(logo["from"], i)
    return sorted(logos, key=lambda l: (first[l["from"]], l["width"] * l["height"]))


# --- PowerPoint -----------------------------------------------------------------------

def read_part(zf: zipfile.ZipFile, name: str, limit: int) -> bytes | None:
    """A zip entry's bytes, or None when it is missing, over `limit` once unpacked (checked
    before unpacking, so a zip bomb never inflates), or stored in a way that can't be read."""
    try:
        if zf.getinfo(name).file_size > limit:
            return None
        return zf.read(name)
    # NotImplementedError: an unsupported compression method; RuntimeError: an encrypted entry.
    except (KeyError, zipfile.BadZipFile, zlib.error, NotImplementedError, RuntimeError, EOFError):
        return None


def read_xml(zf: zipfile.ZipFile, name: str) -> ElementTree.Element | None:
    """A small XML part, parsed; None when it is missing, unreadable or malformed."""
    data = read_part(zf, name, MAX_XML_BYTES)
    if data is None:
        return None
    try:
        return ElementTree.fromstring(data)
    except ElementTree.ParseError:
        return None


def rels_of(zf: zipfile.ZipFile, part: str) -> list[tuple[str, str]]:
    """(type, absolute target) for each relationship of a part; none when they can't be read."""
    folder, name = posixpath.split(part)
    rels_path = posixpath.join(folder, "_rels", name + ".rels")
    root = read_xml(zf, rels_path)
    if root is None:
        return []

    def resolve(target: str) -> str:
        # A target starting with / is relative to the package root, not to the part.
        return posixpath.normpath(target.lstrip("/") if target.startswith("/") else posixpath.join(folder, target))

    return [(r.get("Type", ""), resolve(r.get("Target", "")))
            for r in root.findall("rel:Relationship", NS) if r.get("TargetMode") != "External"]


def theme_part(zf: zipfile.ZipFile) -> str:
    for rel_type, target in rels_of(zf, "ppt/slideMasters/slideMaster1.xml"):
        if rel_type == REL_THEME and target in zf.namelist():
            return target
    if "ppt/theme/theme1.xml" in zf.namelist():
        return "ppt/theme/theme1.xml"
    raise DeckError("this PowerPoint has no theme")


def theme_colour(slot: ElementTree.Element | None) -> str | None:
    if slot is None:
        return None
    srgb = slot.find("a:srgbClr", NS)
    if srgb is not None:
        return "#" + srgb.get("val", "").upper()
    scrgb = slot.find("a:scrgbClr", NS)
    if scrgb is not None:
        # Percentages in thousandths, linear light; convert to sRGB.
        try:
            linear = [int(scrgb.get(c, "")) / 100_000 for c in "rgb"]
        except ValueError:
            return None
        return hex_of(tuple(12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055
                            for v in (min(1, max(0, v)) for v in linear)))
    sys_clr = slot.find("a:sysClr", NS)
    if sys_clr is not None and sys_clr.get("lastClr"):
        return "#" + sys_clr.get("lastClr").upper()
    return None


def slide_ratio(zf: zipfile.ZipFile) -> float | None:
    try:
        size = read_xml(zf, "ppt/presentation.xml").find("p:sldSz", NS)
        return int(size.get("cx")) / int(size.get("cy"))
    except (AttributeError, TypeError, ValueError, ZeroDivisionError):
        return None


def theme_accents(scheme: ElementTree.Element | None) -> list[dict]:
    accents = []
    for i in range(1, 7):
        hex_value = theme_colour(scheme.find(f"a:accent{i}", NS) if scheme is not None else None)
        try:
            usable = len(hex_value) == 7 and not is_neutral(rgb_of(hex_value))
        except (TypeError, ValueError):
            usable = False
        if usable:
            accents.append({"hex": hex_value, "label": f"accent{i}"})
    return accents


def analyze_pptx(path: Path, out_dir: Path) -> dict:
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise DeckError(PPTX_UNREADABLE)
    with zf:
        theme = read_xml(zf, theme_part(zf))
        if theme is None:
            raise DeckError(PPTX_UNREADABLE)

        def font(kind: str) -> str | None:
            latin = theme.find(f".//a:fontScheme/a:{kind}/a:latin", NS)
            face = latin.get("typeface", "") if latin is not None else ""
            return face if face and not face.startswith("+") else None

        ratio = slide_ratio(zf)
        logos, seen = [], set()
        for folder, origin in (("ppt/slideMasters/", "slide master"), ("ppt/slideLayouts/", "slide layout")):
            for part in sorted(n for n in zf.namelist() if n.startswith(folder) and n.endswith(".xml")):
                for rel_type, target in rels_of(zf, part):
                    if rel_type != REL_IMAGE or target not in zf.namelist():
                        continue
                    data = read_part(zf, target, MAX_LOGO_BYTES)
                    if data is None:
                        continue
                    logo = keep_logo(data, Path(target).suffix.lower(), origin, out_dir, seen, ratio)
                    if logo:
                        logos.append(logo)
        return {"source": "pptx", "colors_exact": True,
                "accent_candidates": theme_accents(theme.find(".//a:clrScheme", NS)),
                "fonts": {"heading": font("majorFont"), "body": font("minorFont")},
                "logo_candidates": rank_logos(logos)}


# --- PDF --------------------------------------------------------------------------------

FILL_PAINTS = {b"f", b"F", b"f*", b"Tj", b"TJ", b"'", b'"'}
STROKE_PAINTS = {b"S", b"s"}
FILL_AND_STROKE_PAINTS = {b"B", b"B*", b"b", b"b*"}


def cmyk_to_rgb(c: float, m: float, y: float, k: float) -> tuple[float, float, float]:
    return ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))


def colour_space(name, resources) -> str | None:
    """'rgb', 'cmyk' or None (a space whose components aren't RGB or CMYK)."""
    if name in ("/DeviceRGB", "/CalRGB"):
        return "rgb"
    if name == "/DeviceCMYK":
        return "cmyk"
    try:
        space = resources["/ColorSpace"][name].get_object()
        if space[0] == "/ICCBased":
            return {3: "rgb", 4: "cmyk"}.get(int(space[1].get_object()["/N"]))
        return colour_space(space[0], resources) if space[0] == "/CalRGB" else None
    except (KeyError, TypeError, IndexError, ValueError, AttributeError):
        return None


def to_rgb(space: str | None, operands) -> tuple[float, float, float] | None:
    try:
        values = [float(v) for v in operands]
    except (TypeError, ValueError):
        return None
    if space == "rgb" and len(values) == 3:
        return tuple(values)
    if space == "cmyk" and len(values) == 4:
        return cmyk_to_rgb(*values)
    return None


# Forms drawn inside forms: deep enough for real exports, and it stops a form that draws itself.
MAX_FORM_DEPTH = 4


def stream_colours(contents, pdf, resources, state: dict, counts: Counter, depth: int = 0,
                   draws: list | None = None) -> None:
    """Count the fill or stroke colour in effect at each paint in one content stream, and in
    each Form XObject it draws, starting from the graphics state given."""
    from pypdf.generic import ContentStream

    resources = resources or {}
    draws = [0] if draws is None else draws
    # Colour is graphics state: q saves it and Q restores it.
    saved = []

    def paint(kind: str) -> None:
        rgb = state[kind]
        if rgb is not None and not is_neutral(rgb):
            counts[hex_of(rgb)] += 1

    for operands, op in ContentStream(contents, pdf).operations:
        if op == b"q":
            saved.append(dict(state))
        elif op == b"Q" and saved:
            state = saved.pop()
        elif op in (b"rg", b"RG"):
            state["fill" if op == b"rg" else "stroke"] = to_rgb("rgb", operands)
        elif op in (b"k", b"K"):
            state["fill" if op == b"k" else "stroke"] = to_rgb("cmyk", operands)
        elif op in (b"g", b"G"):
            state["fill" if op == b"g" else "stroke"] = None
        elif op in (b"cs", b"CS") and operands:
            kind = "fill" if op == b"cs" else "stroke"
            state[kind + "_space"] = colour_space(operands[0], resources)
            state[kind] = None
        elif op in (b"sc", b"scn"):
            state["fill"] = to_rgb(state["fill_space"], operands)
        elif op in (b"SC", b"SCN"):
            state["stroke"] = to_rgb(state["stroke_space"], operands)
        elif op in FILL_PAINTS:
            paint("fill")
        elif op in STROKE_PAINTS:
            paint("stroke")
        elif op in FILL_AND_STROKE_PAINTS:
            paint("fill")
            paint("stroke")
        elif op == b"Do" and operands and depth < MAX_FORM_DEPTH and draws[0] < MAX_FORM_DRAWS:
            try:
                form = resources["/XObject"][operands[0]].get_object()
                if form.get("/Subtype") == "/Form":
                    draws[0] += 1
                    stream_colours(form, pdf, form.get("/Resources") or resources,
                                   dict(state), counts, depth + 1, draws)
            except Exception:  # one unreadable form skips only that form
                continue


def page_colours(page, counts: Counter) -> None:
    contents = page.get_contents()
    if contents is None:
        return
    state = {"fill": None, "stroke": None, "fill_space": "rgb", "stroke_space": "rgb"}
    stream_colours(contents, page.pdf, page.get("/Resources"), state, counts)


def pdf_colours(pages) -> list[dict]:
    counts: Counter[str] = Counter()
    for page in pages:
        try:
            page_colours(page, counts)
        except Exception:  # one unreadable page stream must not lose the others' colours
            continue
    return [{"hex": h, "label": f"used {n} times"} for h, n in counts.most_common(MAX_COLORS)]


def pdf_logos(pages, out_dir: Path) -> list[dict]:
    logos, seen = [], set()
    for number, page in enumerate(pages, start=1):
        try:
            box = page.mediabox
            ratio = float(box.width) / float(box.height) if float(box.height) else None
            keys = list(page.images.keys())
        except Exception:
            continue
        for key in keys:
            # pypdf decodes an image when it is fetched; a filter it can't decode skips that image.
            try:
                buffer = io.BytesIO()
                image = page.images[key].image
                # PNG holds no CMYK; a press-ready JPEG logo is converted rather than lost.
                if image.mode not in ("1", "L", "LA", "P", "RGB", "RGBA", "I", "I;16"):
                    image = image.convert("RGB")
                image.save(buffer, format="PNG")
            except Exception:
                continue
            logo = keep_logo(buffer.getvalue(), ".png", f"page {number}", out_dir, seen, ratio)
            if logo:
                logos.append(logo)
    return logos


def analyze_pdf(path: Path, out_dir: Path) -> dict:
    from pypdf import PasswordType, PdfReader
    from pypdf.errors import DependencyError, PdfReadError

    try:
        reader = PdfReader(path)
        # Restriction-only PDFs (an owner password, an empty user password) open in any viewer.
        if reader.is_encrypted and reader.decrypt("") == PasswordType.NOT_DECRYPTED:
            raise DeckError("this PDF is password-protected")
        pages = list(reader.pages[:PDF_PAGES])
    # An encryption scheme pypdf can't handle reads the same as a damaged file.
    except (PdfReadError, DependencyError, NotImplementedError):
        raise DeckError("this file isn't a readable PDF")
    # A PDF's embedded font names are subset tags like ABCDEF+Font-Bold, not family names.
    return {"source": "pdf", "colors_exact": False, "accent_candidates": pdf_colours(pages),
            "fonts": {"heading": None, "body": None}, "logo_candidates": rank_logos(pdf_logos(pages, out_dir))}


def analyze(path: Path, out_dir: Path) -> dict:
    if not path.is_file():
        raise DeckError(f"{path.name} wasn't found")
    suffix = path.suffix.lower()
    if suffix not in PPTX_SUFFIXES | {".pdf"}:
        raise DeckError(f"only PowerPoint ({', '.join(sorted(PPTX_SUFFIXES))}) and PDF decks can be read")
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        # A rerun into the same folder must not leave an earlier deck's logos beside this one's.
        for old in out_dir.glob("deck-logo-*"):
            old.unlink()
        # Prove the folder takes a file now, so a write failure is never blamed on the deck.
        probe = out_dir / "deck-logo-probe"
        probe.write_bytes(b"")
        probe.unlink()
    except OSError:
        raise DeckError(f"the folder {out_dir} can't be written to")
    try:
        return analyze_pptx(path, out_dir) if suffix in PPTX_SUFFIXES else analyze_pdf(path, out_dir)
    except PermissionError:
        raise DeckError(f"{path.name} can't be opened (no permission)")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("deck", type=Path)
    parser.add_argument("--out-dir", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = analyze(args.deck, args.out_dir)
    except DeckError as exc:
        print(f"Couldn't read the deck: {exc}.", file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
