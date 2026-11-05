#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Firm branding for the LP Summary's PDF export, written into the page config.

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
    return "data:" + mime + ";base64," + base64.b64encode(body).decode("ascii"), None


def display_font_ttf(family):
    """The family's static Regular TTF from the Google Fonts repository as a data URI, or None."""
    slug = family.lower().replace(" ", "")
    name = family.replace(" ", "") + "-Regular.ttf"
    for licence in ("ofl", "apache", "ufl"):
        for path in (name, "static/" + name):
            try:
                body, _ = fetch(GOOGLE_FONTS_RAW.format(licence=licence, dir=slug, path=path), MAX_FONT_BYTES)
            except OSError:
                continue
            if len(body) <= MAX_FONT_BYTES and body[:4] in (b"\x00\x01\x00\x00", b"true"):
                return "data:font/ttf;base64," + base64.b64encode(body).decode("ascii")
    return None


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
    ap = argparse.ArgumentParser(description="Firm branding for the LP Summary's PDF export.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("apply")
    a.add_argument("--config", required=True)
    logo = a.add_mutually_exclusive_group()
    logo.add_argument("--logo")
    logo.add_argument("--logo-url")
    a.add_argument("--accent")
    a.add_argument("--font")
    d = sub.add_parser("decline")
    d.add_argument("--config", required=True)
    c = sub.add_parser("carry")
    c.add_argument("--from", dest="src", required=True)
    c.add_argument("--to", dest="dst", required=True)
    args = ap.parse_args(argv)
    try:
        return {"apply": apply, "decline": decline, "carry": carry}[args.cmd](args)
    except (OSError, ValueError) as e:
        log(str(e))
        return EXIT_INPUT


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
