#!/usr/bin/env python3
"""fund-modeling path resolver + filesystem helpers for SKILL.md steps.

Subcommands:
  resolve <firm-name>       print the firm's slug + raw/dashboard paths + snapshot age. Read-only (creates no dir).
                            On an exact-slug miss, also prints `suggested_match=` lines for cached firms whose
                            slug the typed name plausibly abbreviates/mistypes (e.g. "acme" →
                            "acme-venture-capital"), so the caller can offer a deterministic did-you-mean.
  touch-empty <path>        create an empty file (records a "fetched, none published" stem).
  list-dashboards           scan cached dashboards; print each one's firm name, slug, age, dashboard_dir + identity.
  find-by-id <id>           scan cached dashboards for a matching firmId/firmUuid; print the hit.

The slug is derived from the firm name here (not by the caller) so every session
resolves the same directory for a firm. slugify is idempotent, so passing an
already-slugified value is safe.
"""
import argparse
import difflib
import hashlib
import json
import os
import pathlib
import re
import time
import unicodedata


def slugify(name):
    # Transliterate accents (Å->A), lowercase, collapse non-alphanumerics to hyphens.
    ascii_name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_name.lower()).strip("-")
    # Non-Latin names (CJK/Cyrillic/…) leave nothing ASCII; hash a normalized key so
    # distinct firms keep distinct, stable dirs instead of collapsing onto one.
    if not slug:
        key = " ".join(name.split()).lower()
        slug = "firm-" + hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return slug


def cache_root():
    env = os.environ.get("FUND_MODELING_DATA")
    if env:
        return pathlib.Path(env)
    return pathlib.Path.home() / ".cache" / "fund-modeling"


def raw_dir(slug):
    return cache_root() / "raw" / slug


def dashboard_dir(slug):
    return cache_root() / "dashboards" / slug


def _age_days(snap):
    return int((time.time() - snap.stat().st_mtime) // 86400)


def _format_name(name):
    # A Carta firm name may carry a tab/newline that would split a tab-delimited record.
    return re.sub(r"[\t\r\n]+", " ", name or "").strip()


def snapshot_age_days(slug):
    snap = dashboard_dir(slug) / "snapshot.json"
    if not snap.exists():
        return None
    return _age_days(snap)


def _fuzzy_candidates(typed_slug, limit=3):
    if len(typed_slug) < 3:  # a shorter slug fuzzy-matches nearly every cache
        return []
    typed_tokens = set(typed_slug.split("-"))
    scored = []
    for slug, source, age in _scan_dashboards():
        if slug == typed_slug:
            continue  # exact hit is the caller's fast path, not a suggestion
        cand_tokens = set(slug.split("-"))
        ratio = difflib.SequenceMatcher(None, typed_slug, slug).ratio()
        subset = typed_tokens <= cand_tokens or cand_tokens <= typed_tokens
        prefix = slug.startswith(typed_slug + "-") or typed_slug.startswith(slug + "-")
        if subset or prefix or ratio >= 0.82:
            tier = 2 if (subset or prefix) else 1
            sort_key = (tier, ratio, -age, slug)
            scored.append((sort_key, (slug, source, age)))
    # Sort on sort_key alone — the candidate tuple holds a dict and must never reach a tie-break.
    scored.sort(key=lambda entry: entry[0], reverse=True)
    return [candidate for _sort_key, candidate in scored[:limit]]


def cmd_resolve(name):
    # Read-only: report paths + age without creating dirs (writers create them on demand at build).
    slug = slugify(name)
    r = raw_dir(slug)
    d = dashboard_dir(slug)
    age = snapshot_age_days(slug)
    print("slug=%s" % slug)
    print("cache_root=%s" % cache_root())
    print("raw_dir=%s" % r)
    print("dashboard_dir=%s" % d)
    print("snapshot_age_days=%s" % ("none" if age is None else age))
    if age is None:
        for c_slug, source, c_age in _fuzzy_candidates(slug):
            c_name = _format_name(source.get("firm"))
            print("suggested_match=%s\tname=%s\tage_days=%s\tdashboard_dir=%s" % (
                c_slug, c_name, c_age, dashboard_dir(c_slug)))


def cmd_touch_empty(path):
    p = pathlib.Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("", encoding="utf-8")
    print(p)


def _scan_dashboards():
    # Yield (slug, source-dict, age_days) for every cached dashboard with a readable snapshot.
    root = cache_root() / "dashboards"
    if not root.is_dir():
        return
    for d in sorted(root.iterdir()):
        snap = d / "snapshot.json"
        if not snap.is_file():
            continue
        try:
            parsed = json.loads(snap.read_text(encoding="utf-8"))
            src = parsed.get("source") if isinstance(parsed, dict) else None
            source = src if isinstance(src, dict) else {}
        except (ValueError, OSError):
            source = {}
        yield d.name, source, _age_days(snap)


def cmd_list_dashboards():
    found = False
    for slug, source, age in _scan_dashboards():
        found = True
        name = _format_name(source.get("firm"))
        print("dashboard\tslug=%s\tname=%s\tage_days=%s\tdashboard_dir=%s\tfirmId=%s\tfirmUuid=%s" % (
            slug, name, age, dashboard_dir(slug),
            source.get("firmId") if source.get("firmId") is not None else "",
            source.get("firmUuid") or ""))
    if not found:
        print("dashboards=none")


def cmd_find_by_id(fid):
    target = str(fid).strip()
    if not target:  # a blank/failed URL parse must not match an identity-less (null-firmUuid) cache
        print("match=none")
        return
    for slug, source, age in _scan_dashboards():
        sid = source.get("firmId")
        if (sid is not None and str(sid) == target) or (source.get("firmUuid") or "") == target:
            name = _format_name(source.get("firm"))
            print("match=%s" % slug)
            print("name=%s" % name)
            print("raw_dir=%s" % raw_dir(slug))
            print("dashboard_dir=%s" % dashboard_dir(slug))
            print("snapshot_age_days=%s" % age)
            return
    print("match=none")


def main():
    ap = argparse.ArgumentParser(description="fund-modeling path resolver")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p_resolve = sub.add_parser("resolve")
    p_resolve.add_argument("name")
    p_touch = sub.add_parser("touch-empty")
    p_touch.add_argument("path")
    sub.add_parser("list-dashboards")
    p_find = sub.add_parser("find-by-id")
    p_find.add_argument("id")
    a = ap.parse_args()
    if a.cmd == "resolve":
        cmd_resolve(a.name)
    elif a.cmd == "touch-empty":
        cmd_touch_empty(a.path)
    elif a.cmd == "list-dashboards":
        cmd_list_dashboards()
    elif a.cmd == "find-by-id":
        cmd_find_by_id(a.id)


if __name__ == "__main__":
    main()
